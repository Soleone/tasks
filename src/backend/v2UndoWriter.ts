import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CommandError } from "./errors.js";
import { batchIntentPlan, applyV2BatchJournal, guardV2Batch, parseV2BatchIntent, persistV2UndoArchive, retireV2BatchStages, v2UndoRecoveryLocation } from "./v2BatchJournal.js";
import type { V2BatchIntent } from "./v2BatchJournal.js";
import { readV2CanonicalRoot, readV2RegularFile, readV2RootDescriptor } from "./v2CanonicalReader.js";
import { guardCopySource } from "./v2CopyFiles.js";
import { persistV2Pending, retireV2Pending, withV2RootWriterLock } from "./v2LocalDomain.js";
import { readV2Pending } from "./v2Pending.js";
import type { V2Request } from "./v2Protocol.js";
import { projectV2Tasks } from "./v2Queries.js";
import { localPathOutsideV2Root, synchronizeV2Authority, withV2CacheTransaction } from "./v2QueryCache.js";
import type { V2QueryAuthority } from "./v2QueryCache.js";
import { findV2Receipt, requireV2WriteContext, storeV2Receipt } from "./v2Receipts.js";
import type { V2CanonicalTask } from "./v2TaskModel.js";
import { selectV2UndoHistory } from "./v2UndoHistory.js";
import { parseV2Undo, planV2Undo } from "./v2UndoPlan.js";
import type { V2UndoPlan } from "./v2UndoPlan.js";
import { exactV2Hash } from "./v2UpdateJournal.js";

function requireUndoBudget(database: DatabaseSync, count: number): void {
  const state = database.prepare("SELECT counter, revision FROM v2_query_state WHERE singleton = 1").get()!;
  if (!Number.isSafeInteger((state.counter as number) + count * 3 + 9) || !Number.isSafeInteger((state.revision as number) + 3)) throw new CommandError("UNSUPPORTED_COMMAND", "explicit fresh-cache authority is required before undo or status batch");
}
function undoResult(command: string, plan: V2UndoPlan, authority: V2QueryAuthority): Record<string, unknown> {
  const projections = new Map(projectV2Tasks(plan.tasks, authority).map(task => [task.id, task]));
  const changed = plan.affectedIds.length !== 0;
  if (command === "task.status.undo") return { task: projections.get(plan.selectedIds[0]), changed };
  return { tasks: plan.selectedIds.flatMap(id => projections.has(id) ? [projections.get(id)] : []), changed, ...(plan.removedIds.length ? { removedIds: plan.removedIds } : {}) };
}

export function commitV2Undo(database: DatabaseSync, intent: V2BatchIntent): Record<string, unknown> {
  const plan = batchIntentPlan(intent);
  guardV2Batch(intent, true);
  requireUndoBudget(database, intent.files.length);
  const snapshot = applyV2BatchJournal(intent);
  const remove = database.prepare("DELETE FROM v2_query_tasks WHERE id = ?");
  for (const id of plan.affectedIds) remove.run(id);
  const authority = synchronizeV2Authority(database, intent.root, snapshot);
  const affected = new Set(plan.affectedIds);
  // Read fixed originals, not the potentially already-applied subset observed during recovery.
  const before = batchIntentPlanOriginals(intent).filter(task => affected.has(task.id));
  const after = snapshot.tasks.filter(task => affected.has(task.id));
  database.prepare("INSERT INTO v2_operations VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(intent.operationId, authority.writeContext, plan.affectedIds[0], intent.request.command, JSON.stringify(intent.request.actor), intent.at, JSON.stringify({ tasks: before, undoOf: plan.claims }), JSON.stringify({ tasks: after }));
  const member = database.prepare("INSERT INTO v2_operation_members VALUES (?, ?)");
  for (const id of affected) member.run(intent.operationId, id);
  for (const claim of plan.claims) database.prepare("INSERT INTO v2_undo_claims VALUES (?, ?, ?)").run(claim.operationId, claim.taskId, intent.operationId);
  const result = { ...undoResult(intent.request.command, { ...plan, tasks: snapshot.tasks }, authority), operationId: intent.operationId, ...(v2UndoRecoveryLocation(intent) ? { recoveryLocation: v2UndoRecoveryLocation(intent) } : {}) };
  if (authority.writeContext === intent.request.writeContext) storeV2Receipt(database, intent.request, result);
  return result;
}
function batchIntentPlanOriginals(intent: V2BatchIntent): V2CanonicalTask[] {
  return intent.files.map(file => JSON.parse(Buffer.from(file.beforeBytes, "base64").toString()) as V2CanonicalTask);
}

export function executeV2Undo(request: V2Request, rootPath: string, cachePath: string) {
  const root = readV2RootDescriptor(rootPath);
  return withV2RootWriterLock(root, () => {
    let completed: V2BatchIntent | undefined;
    const outcome = withV2CacheTransaction(cachePath, root, database => {
      let authority = synchronizeV2Authority(database, root);
      requireV2WriteContext(request, authority);
      const input = parseV2Undo(request.command, request.args);
      const receipt = findV2Receipt(database, request);
      if (receipt) return { writeContext: authority.writeContext, result: receipt };
      if (readV2Pending(root)) throw new CommandError("RECOVERY_PENDING", "root has an unfinished intent");
      const snapshot = readV2CanonicalRoot(root.rootPath);
      if (snapshot.rootIdentity !== root.rootIdentity) throw new CommandError("STALE_WRITE_CONTEXT", "physical root changed during observation");
      guardCopySource(snapshot);
      if (!request.readOnly && !request.dryRun) requireUndoBudget(database, snapshot.tasks.length);
      authority = synchronizeV2Authority(database, root, snapshot);
      requireV2WriteContext(request, authority);
      if (input.kind !== "operation") for (const reference of input.tasks) {
        if (!authority.versions.has(reference.id)) throw new CommandError("TASK_NOT_FOUND", "batch task was not found");
        if (authority.versions.get(reference.id) !== reference.expectedVersion) throw new CommandError("STALE_TASK_VERSION", "batch task version changed");
      }
      const at = new Date().toISOString();
      const sources = selectV2UndoHistory(database, authority.writeContext, input, snapshot.tasks);
      const plan = planV2Undo(input, snapshot.tasks, at, sources);
      for (const id of plan.removedIds) {
        if (snapshot.conflictFiles.some(file => file.relativePath.startsWith(`tasks/${id}.sync-conflict-`))) throw new CommandError("OPERATION_UNAVAILABLE", "creation has conflict evidence requiring inspection");
        const bytes = readV2RegularFile(path.join(root.rootPath, "tasks", `${id}.json`));
        if (!sources.some(source => source.command === "task.create" && bytes.equals(Buffer.from(`${JSON.stringify(source.after)}\n`)))) throw new CommandError("OPERATION_UNAVAILABLE", "creation bytes changed since capture");
      }
      if (request.dryRun || request.readOnly) return { writeContext: authority.writeContext, result: { ...undoResult(request.command, plan, authority), dryRun: request.dryRun, readOnly: request.readOnly } };
      if (plan.affectedIds.length === 0) { const result = undoResult(request.command, plan, authority); storeV2Receipt(database, request, result); return { writeContext: authority.writeContext, result }; }
      requireUndoBudget(database, snapshot.tasks.length);
      const files = snapshot.tasks.map(task => {
        const before = readV2RegularFile(path.join(root.rootPath, "tasks", `${task.id}.json`));
        if (exactV2Hash(before) !== snapshot.files.find(file => file.relativePath === `tasks/${task.id}.json`)!.sha256) throw new CommandError("STALE_FILE", "batch task changed before staging");
        const next = plan.tasks.find(next => next.id === task.id);
        const nextBytes = !next ? null : JSON.stringify(next) === JSON.stringify(task) ? before.toString("base64") : Buffer.from(`${JSON.stringify(next)}\n`).toString("base64");
        return { taskId: task.id, beforeBytes: before.toString("base64"), nextBytes };
      });
      const intent = parseV2BatchIntent({ format: "taskdb.pending-batch", version: 1, root, cachePath: localPathOutsideV2Root(cachePath, root.rootPath), request, operationId: randomUUID(), at, sources, files, guards: snapshot.files }, root);
      guardV2Batch(intent, false);
      persistV2UndoArchive(intent);
      guardV2Batch(intent, false);
      persistV2Pending(root, intent);
      const result = commitV2Undo(database, intent);
      completed = intent;
      return { writeContext: authority.writeContext, result };
    });
    if (completed) { retireV2BatchStages(completed); retireV2Pending(root); }
    return outcome;
  });
}
