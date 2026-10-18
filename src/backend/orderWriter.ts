import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CommandError } from "./errors.js";
import { readCanonicalRoot, readRegularFile, readRootDescriptor } from "./canonicalReader.js";
import { refuseDescriptorConflicts } from "./copyFiles.js";
import { persistPending, retirePending, withRootWriterLock } from "./localDomain.js";
import {
  applyOrderJournal,
  guardOrder,
  orderIntentPlan,
  parseOrderIntent,
  retireOrderStages,
} from "./orderJournal.js";
import type { OrderIntent } from "./orderJournal.js";
import { readPending } from "./pending.js";
import type { Request } from "./protocol.js";
import { projectTasks } from "./queries.js";
import { localPathOutsideRoot, synchronizeAuthority, withCacheTransaction } from "./queryCache.js";
import type { QueryAuthority } from "./queryCache.js";
import { findReceipt, requireWriteContext, storeReceipt } from "./receipts.js";
import { parseOrder, planOrder } from "./taskOrdering.js";
import type { CanonicalTask } from "./taskModel.js";
import type { OrderPlan } from "./taskOrdering.js";
import { exactHash } from "./updateJournal.js";

function orderResult(
  plan: OrderPlan,
  authority: QueryAuthority,
  tasks: CanonicalTask[],
): Record<string, unknown> {
  const planned = new Map(plan.after.map((task) => [task.id, task]));
  const projected = new Map(
    projectTasks(
      tasks.map((task) => planned.get(task.id) ?? task),
      authority,
    ).map((task) => [task.id, task]),
  );
  return {
    tasks: plan.selectedIds.map((id) => projected.get(id)),
    parentId: plan.parentId,
    changed: plan.changed,
    rewrittenIds: plan.writes.map((task) => task.id),
  };
}
function requireOrderBudget(database: DatabaseSync, taskCount: number): void {
  const state = database
    .prepare("SELECT counter, revision FROM v2_query_state WHERE singleton = 1")
    .get()!;
  if (
    !Number.isSafeInteger((state.counter as number) + taskCount * 3 + 5) ||
    !Number.isSafeInteger((state.revision as number) + 3)
  )
    throw new CommandError(
      "UNSUPPORTED_COMMAND",
      "explicit fresh-cache authority is required before ordering",
    );
}

export function commitOrder(database: DatabaseSync, intent: OrderIntent): Record<string, unknown> {
  const plan = orderIntentPlan(intent);
  const guarded = guardOrder(intent, true);
  requireOrderBudget(database, guarded.tasks.length);
  const snapshot = applyOrderJournal(intent, guarded);
  // Logical selected moves can retain exact bytes. Reissue the complete affected scope conservatively.
  const remove = database.prepare("DELETE FROM v2_query_tasks WHERE id = ?");
  for (const task of plan.before) remove.run(task.id);
  const authority = synchronizeAuthority(database, intent.root, snapshot);
  const affected = new Set([...plan.selectedIds, ...plan.writes.map((task) => task.id)]);
  const before = {
    parentId: plan.parentId,
    selectedIds: plan.selectedIds,
    rewrittenIds: plan.writes.map((task) => task.id),
    scope: plan.before.map(({ id, orderKey }) => ({ id, orderKey })),
    tasks: plan.before.filter((task) => affected.has(task.id)),
  };
  const after = {
    ...before,
    scope: plan.after.map(({ id, orderKey }) => ({ id, orderKey })),
    tasks: plan.after.filter((task) => affected.has(task.id)),
  };
  database
    .prepare("INSERT INTO v2_operations VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(
      intent.operationId,
      authority.writeContext,
      plan.selectedIds[0],
      intent.request.command,
      JSON.stringify(intent.request.actor),
      intent.at,
      JSON.stringify(before),
      JSON.stringify(after),
    );
  const member = database.prepare("INSERT INTO v2_operation_members VALUES (?, ?)");
  for (const id of affected) member.run(intent.operationId, id);
  const result = {
    ...orderResult(plan, authority, snapshot.tasks),
    operationId: intent.operationId,
  };
  if (authority.writeContext === intent.request.writeContext)
    storeReceipt(database, intent.request, result);
  return result;
}

export function executeOrder(request: Request, rootPath: string, cachePath: string) {
  const root = readRootDescriptor(rootPath);
  return withRootWriterLock(root, () => {
    let completed: OrderIntent | undefined;
    const outcome = withCacheTransaction(cachePath, root, (database) => {
      let authority = synchronizeAuthority(database, root);
      requireWriteContext(request, authority);
      const input = parseOrder(request.command, request.args);
      const receipt = findReceipt(database, request);
      if (receipt) return { writeContext: authority.writeContext, result: receipt };
      if (readPending(root))
        throw new CommandError("RECOVERY_PENDING", "root has an unfinished intent");
      const snapshot = readCanonicalRoot(root.rootPath);
      if (snapshot.rootIdentity !== root.rootIdentity)
        throw new CommandError("STALE_WRITE_CONTEXT", "physical root changed during observation");
      refuseDescriptorConflicts(snapshot.rootPath);
      authority = synchronizeAuthority(database, root, snapshot);
      requireWriteContext(request, authority);
      for (const reference of input.tasks) {
        if (!authority.versions.has(reference.id))
          throw new CommandError("TASK_NOT_FOUND", "selected ordering task was not found");
        if (authority.versions.get(reference.id) !== reference.expectedVersion)
          throw new CommandError("STALE_TASK_VERSION", "selected ordering version changed");
      }
      const plan = planOrder(input, snapshot.tasks);
      if (request.readOnly || request.dryRun)
        return {
          writeContext: authority.writeContext,
          result: {
            ...orderResult(plan, authority, snapshot.tasks),
            readOnly: request.readOnly,
            dryRun: request.dryRun,
          },
        };
      if (!plan.changed) {
        const result = orderResult(plan, authority, snapshot.tasks);
        storeReceipt(database, request, result);
        return { writeContext: authority.writeContext, result };
      }
      requireOrderBudget(database, snapshot.tasks.length);
      const files = plan.before.map((task) => {
        const before = readRegularFile(path.join(root.rootPath, "tasks", `${task.id}.json`));
        if (
          exactHash(before) !==
          snapshot.files.find((file) => file.relativePath === `tasks/${task.id}.json`)!.sha256
        )
          throw new CommandError("STALE_FILE", "ordering task changed before staging");
        const next = plan.writes.find((next) => next.id === task.id);
        return {
          taskId: task.id,
          beforeBytes: before.toString("base64"),
          nextBytes: next
            ? Buffer.from(`${JSON.stringify(next)}\n`).toString("base64")
            : before.toString("base64"),
        };
      });
      const intent = parseOrderIntent(
        {
          format: "taskdb.pending-order",
          version: 1,
          root,
          cachePath: localPathOutsideRoot(cachePath, root.rootPath),
          request,
          operationId: randomUUID(),
          at: new Date().toISOString(),
          files,
          guards: snapshot.files,
        },
        root,
      );
      guardOrder(intent, false);
      persistPending(root, intent);
      const result = commitOrder(database, intent);
      completed = intent;
      return { writeContext: authority.writeContext, result };
    });
    if (completed) {
      retireOrderStages(completed);
      retirePending(root);
    }
    return outcome;
  });
}
