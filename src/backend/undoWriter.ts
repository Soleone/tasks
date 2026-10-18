import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CommandError } from "./errors.js";
import {
  batchIntentPlan,
  applyBatchJournal,
  guardBatch,
  parseBatchIntent,
  persistUndoArchive,
  retireBatchStages,
  undoRecoveryLocation,
} from "./batchJournal.js";
import type { BatchIntent } from "./batchJournal.js";
import {
  readCanonicalRoot,
  readRegularFile,
  readRootDescriptor,
  exactHash,
} from "./canonicalReader.js";
import { refuseDescriptorConflicts } from "./copyFiles.js";
import { persistPending, retirePending, withRootWriterLock } from "./localDomain.js";
import { readPending } from "./pending.js";
import type { Request } from "./protocol.js";
import { projectTasks } from "./queries.js";
import { localPathOutsideRoot, synchronizeAuthority, withCacheTransaction } from "./queryCache.js";
import type { QueryAuthority } from "./queryCache.js";
import { findReceipt, requireWriteContext, storeReceipt } from "./receipts.js";
import type { CanonicalTask } from "./taskModel.js";
import { selectUndoHistory } from "./undoHistory.js";
import { parseUndo, planUndo } from "./undoPlan.js";
import type { UndoPlan } from "./undoPlan.js";

function requireUndoBudget(database: DatabaseSync, count: number): void {
  const state = database
    .prepare("SELECT counter, revision FROM v2_query_state WHERE singleton = 1")
    .get()!;
  if (
    !Number.isSafeInteger((state.counter as number) + count * 3 + 9) ||
    !Number.isSafeInteger((state.revision as number) + 3)
  )
    throw new CommandError(
      "UNSUPPORTED_COMMAND",
      "explicit fresh-cache authority is required before undo or status batch",
    );
}
function undoResult(
  command: string,
  plan: UndoPlan,
  authority: QueryAuthority,
): Record<string, unknown> {
  const projections = new Map(projectTasks(plan.tasks, authority).map((task) => [task.id, task]));
  const changed = plan.affectedIds.length !== 0;
  if (command === "task.status.undo")
    return { task: projections.get(plan.selectedIds[0]), changed };
  return {
    tasks: plan.selectedIds.flatMap((id) => (projections.has(id) ? [projections.get(id)] : [])),
    changed,
    ...(plan.removedIds.length ? { removedIds: plan.removedIds } : {}),
  };
}

export function commitUndo(database: DatabaseSync, intent: BatchIntent): Record<string, unknown> {
  const plan = batchIntentPlan(intent);
  const guarded = guardBatch(intent, true);
  requireUndoBudget(database, intent.files.length);
  const snapshot = applyBatchJournal(intent, guarded);
  const remove = database.prepare("DELETE FROM v2_query_tasks WHERE id = ?");
  for (const id of plan.affectedIds) remove.run(id);
  const authority = synchronizeAuthority(database, intent.root, snapshot);
  const affected = new Set(plan.affectedIds);
  // Read fixed originals, not the potentially already-applied subset observed during recovery.
  const before = batchIntentPlanOriginals(intent).filter((task) => affected.has(task.id));
  const after = snapshot.tasks.filter((task) => affected.has(task.id));
  database
    .prepare("INSERT INTO v2_operations VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(
      intent.operationId,
      authority.writeContext,
      plan.affectedIds[0],
      intent.request.command,
      JSON.stringify(intent.request.actor),
      intent.at,
      JSON.stringify({ tasks: before, undoOf: plan.claims }),
      JSON.stringify({ tasks: after }),
    );
  const member = database.prepare("INSERT INTO v2_operation_members VALUES (?, ?)");
  for (const id of affected) member.run(intent.operationId, id);
  for (const claim of plan.claims)
    database
      .prepare("INSERT INTO v2_undo_claims VALUES (?, ?, ?)")
      .run(claim.operationId, claim.taskId, intent.operationId);
  const result = {
    ...undoResult(intent.request.command, { ...plan, tasks: snapshot.tasks }, authority),
    operationId: intent.operationId,
    ...(undoRecoveryLocation(intent) ? { recoveryLocation: undoRecoveryLocation(intent) } : {}),
  };
  if (authority.writeContext === intent.request.writeContext)
    storeReceipt(database, intent.request, result);
  return result;
}
function batchIntentPlanOriginals(intent: BatchIntent): CanonicalTask[] {
  return intent.files.map(
    (file) => JSON.parse(Buffer.from(file.beforeBytes, "base64").toString()) as CanonicalTask,
  );
}

export function executeUndo(request: Request, rootPath: string, cachePath: string) {
  const root = readRootDescriptor(rootPath);
  return withRootWriterLock(root, () => {
    let completed: BatchIntent | undefined;
    const outcome = withCacheTransaction(cachePath, root, (database) => {
      let authority = synchronizeAuthority(database, root);
      requireWriteContext(request, authority);
      const input = parseUndo(request.command, request.args);
      const receipt = findReceipt(database, request);
      if (receipt) return { writeContext: authority.writeContext, result: receipt };
      if (readPending(root))
        throw new CommandError("RECOVERY_PENDING", "root has an unfinished intent");
      const snapshot = readCanonicalRoot(root.rootPath);
      if (snapshot.rootIdentity !== root.rootIdentity)
        throw new CommandError("STALE_WRITE_CONTEXT", "physical root changed during observation");
      refuseDescriptorConflicts(snapshot.rootPath);
      if (!request.readOnly && !request.dryRun) requireUndoBudget(database, snapshot.tasks.length);
      authority = synchronizeAuthority(database, root, snapshot);
      requireWriteContext(request, authority);
      if (input.kind !== "operation")
        for (const reference of input.tasks) {
          if (!authority.versions.has(reference.id))
            throw new CommandError("TASK_NOT_FOUND", "batch task was not found");
          if (authority.versions.get(reference.id) !== reference.expectedVersion)
            throw new CommandError("STALE_TASK_VERSION", "batch task version changed");
        }
      const at = new Date().toISOString();
      const sources = selectUndoHistory(database, authority.writeContext, input, snapshot.tasks);
      const plan = planUndo(input, snapshot.tasks, at, sources);
      for (const id of plan.removedIds) {
        if (
          snapshot.conflictFiles.some((file) =>
            file.relativePath.startsWith(`tasks/${id}.sync-conflict-`),
          )
        )
          throw new CommandError(
            "OPERATION_UNAVAILABLE",
            "creation has conflict evidence requiring inspection",
          );
        const bytes = readRegularFile(path.join(root.rootPath, "tasks", `${id}.json`));
        if (
          !sources.some(
            (source) =>
              source.command === "task.create" &&
              bytes.equals(Buffer.from(`${JSON.stringify(source.after)}\n`)),
          )
        )
          throw new CommandError("OPERATION_UNAVAILABLE", "creation bytes changed since capture");
      }
      if (request.dryRun || request.readOnly)
        return {
          writeContext: authority.writeContext,
          result: {
            ...undoResult(request.command, plan, authority),
            dryRun: request.dryRun,
            readOnly: request.readOnly,
          },
        };
      if (plan.affectedIds.length === 0) {
        const result = undoResult(request.command, plan, authority);
        storeReceipt(database, request, result);
        return { writeContext: authority.writeContext, result };
      }
      requireUndoBudget(database, snapshot.tasks.length);
      const files = snapshot.tasks.map((task) => {
        const before = readRegularFile(path.join(root.rootPath, "tasks", `${task.id}.json`));
        if (
          exactHash(before) !==
          snapshot.files.find((file) => file.relativePath === `tasks/${task.id}.json`)!.sha256
        )
          throw new CommandError("STALE_FILE", "batch task changed before staging");
        const next = plan.tasks.find((next) => next.id === task.id);
        const nextBytes = !next
          ? null
          : JSON.stringify(next) === JSON.stringify(task)
            ? before.toString("base64")
            : Buffer.from(`${JSON.stringify(next)}\n`).toString("base64");
        return { taskId: task.id, beforeBytes: before.toString("base64"), nextBytes };
      });
      const intent = parseBatchIntent(
        {
          format: "taskdb.pending-batch",
          version: 1,
          root,
          cachePath: localPathOutsideRoot(cachePath, root.rootPath),
          request,
          operationId: randomUUID(),
          at,
          sources,
          files,
          guards: snapshot.files,
        },
        root,
      );
      guardBatch(intent, false);
      persistUndoArchive(intent);
      guardBatch(intent, false);
      persistPending(root, intent);
      const result = commitUndo(database, intent);
      completed = intent;
      return { writeContext: authority.writeContext, result };
    });
    if (completed) {
      retireBatchStages(completed);
      retirePending(root);
    }
    return outcome;
  });
}
