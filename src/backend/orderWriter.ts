import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CommandError } from "./errors.js";
import { readV2CanonicalRoot, readV2RegularFile, readV2RootDescriptor } from "./canonicalReader.js";
import { guardCopySource } from "./copyFiles.js";
import { persistV2Pending, retireV2Pending, withV2RootWriterLock } from "./localDomain.js";
import { applyV2OrderJournal, guardV2Order, orderIntentPlan, parseV2OrderIntent, retireV2OrderStages } from "./orderJournal.js";
import type { V2OrderIntent } from "./orderJournal.js";
import { readV2Pending } from "./pending.js";
import type { V2Request } from "./protocol.js";
import { projectV2Tasks } from "./queries.js";
import { localPathOutsideV2Root, synchronizeV2Authority, withV2CacheTransaction } from "./queryCache.js";
import type { V2QueryAuthority } from "./queryCache.js";
import { findV2Receipt, requireV2WriteContext, storeV2Receipt } from "./receipts.js";
import { parseV2Order, planV2Order } from "./taskOrdering.js";
import type { V2CanonicalTask } from "./taskModel.js";
import type { V2OrderPlan } from "./taskOrdering.js";
import { exactV2Hash } from "./updateJournal.js";

function orderResult(plan: V2OrderPlan, authority: V2QueryAuthority, tasks: V2CanonicalTask[]): Record<string, unknown> {
  const planned = new Map(plan.after.map(task => [task.id, task]));
  const projected = new Map(projectV2Tasks(tasks.map(task => planned.get(task.id) ?? task), authority).map(task => [task.id, task]));
  return { tasks: plan.selectedIds.map(id => projected.get(id)), parentId: plan.parentId, changed: plan.changed, rewrittenIds: plan.writes.map(task => task.id) };
}
function requireOrderBudget(database: DatabaseSync, taskCount: number): void {
  const state = database.prepare("SELECT counter, revision FROM v2_query_state WHERE singleton = 1").get()!;
  if (!Number.isSafeInteger((state.counter as number) + taskCount * 3 + 5) || !Number.isSafeInteger((state.revision as number) + 3)) throw new CommandError("UNSUPPORTED_COMMAND", "explicit fresh-cache authority is required before ordering");
}

export function commitV2Order(database: DatabaseSync, intent: V2OrderIntent): Record<string, unknown> {
  const plan = orderIntentPlan(intent);
  const guarded = guardV2Order(intent, true);
  requireOrderBudget(database, guarded.tasks.length);
  const snapshot = applyV2OrderJournal(intent);
  // Logical selected moves can retain exact bytes. Reissue the complete affected scope conservatively.
  const remove = database.prepare("DELETE FROM v2_query_tasks WHERE id = ?");
  for (const task of plan.before) remove.run(task.id);
  const authority = synchronizeV2Authority(database, intent.root, snapshot);
  const affected = new Set([...plan.selectedIds, ...plan.writes.map(task => task.id)]);
  const before = { parentId: plan.parentId, selectedIds: plan.selectedIds, rewrittenIds: plan.writes.map(task => task.id), scope: plan.before.map(({ id, orderKey }) => ({ id, orderKey })), tasks: plan.before.filter(task => affected.has(task.id)) };
  const after = { ...before, scope: plan.after.map(({ id, orderKey }) => ({ id, orderKey })), tasks: plan.after.filter(task => affected.has(task.id)) };
  database.prepare("INSERT INTO v2_operations VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(intent.operationId, authority.writeContext, plan.selectedIds[0], intent.request.command, JSON.stringify(intent.request.actor), intent.at, JSON.stringify(before), JSON.stringify(after));
  const member = database.prepare("INSERT INTO v2_operation_members VALUES (?, ?)");
  for (const id of affected) member.run(intent.operationId, id);
  const result = { ...orderResult(plan, authority, snapshot.tasks), operationId: intent.operationId };
  if (authority.writeContext === intent.request.writeContext) storeV2Receipt(database, intent.request, result);
  return result;
}

export function executeV2Order(request: V2Request, rootPath: string, cachePath: string) {
  const root = readV2RootDescriptor(rootPath);
  return withV2RootWriterLock(root, () => {
    let completed: V2OrderIntent | undefined;
    const outcome = withV2CacheTransaction(cachePath, root, database => {
      let authority = synchronizeV2Authority(database, root);
      requireV2WriteContext(request, authority);
      const input = parseV2Order(request.command, request.args);
      const receipt = findV2Receipt(database, request);
      if (receipt) return { writeContext: authority.writeContext, result: receipt };
      if (readV2Pending(root)) throw new CommandError("RECOVERY_PENDING", "root has an unfinished intent");
      const snapshot = readV2CanonicalRoot(root.rootPath);
      if (snapshot.rootIdentity !== root.rootIdentity) throw new CommandError("STALE_WRITE_CONTEXT", "physical root changed during observation");
      guardCopySource(snapshot);
      authority = synchronizeV2Authority(database, root, snapshot);
      requireV2WriteContext(request, authority);
      for (const reference of input.tasks) {
        if (!authority.versions.has(reference.id)) throw new CommandError("TASK_NOT_FOUND", "selected ordering task was not found");
        if (authority.versions.get(reference.id) !== reference.expectedVersion) throw new CommandError("STALE_TASK_VERSION", "selected ordering version changed");
      }
      const plan = planV2Order(input, snapshot.tasks);
      if (request.readOnly || request.dryRun) return { writeContext: authority.writeContext, result: { ...orderResult(plan, authority, snapshot.tasks), readOnly: request.readOnly, dryRun: request.dryRun } };
      if (!plan.changed) { const result = orderResult(plan, authority, snapshot.tasks); storeV2Receipt(database, request, result); return { writeContext: authority.writeContext, result }; }
      requireOrderBudget(database, snapshot.tasks.length);
      const files = plan.before.map(task => {
        const before = readV2RegularFile(path.join(root.rootPath, "tasks", `${task.id}.json`));
        if (exactV2Hash(before) !== snapshot.files.find(file => file.relativePath === `tasks/${task.id}.json`)!.sha256) throw new CommandError("STALE_FILE", "ordering task changed before staging");
        const next = plan.writes.find(next => next.id === task.id);
        return { taskId: task.id, beforeBytes: before.toString("base64"), nextBytes: next ? Buffer.from(`${JSON.stringify(next)}\n`).toString("base64") : before.toString("base64") };
      });
      const intent = parseV2OrderIntent({ format: "taskdb.pending-order", version: 1, root, cachePath: localPathOutsideV2Root(cachePath, root.rootPath), request, operationId: randomUUID(), at: new Date().toISOString(), files, guards: snapshot.files }, root);
      guardV2Order(intent, false);
      persistV2Pending(root, intent);
      const result = commitV2Order(database, intent);
      completed = intent;
      return { writeContext: authority.writeContext, result };
    });
    if (completed) { retireV2OrderStages(completed); retireV2Pending(root); }
    return outcome;
  });
}
