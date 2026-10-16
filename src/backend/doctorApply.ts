import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { CommandError } from "./errors.js";
import { readRootDescriptor } from "./canonicalReader.js";
import {
  applyDoctorJournal,
  doctorIntentWrites,
  parseDoctorIntent,
  parseRetainedDoctorPlan,
  persistDoctorArchive,
  prepareDoctorProgress,
  retireDoctorStages,
  doctorRecoveryLocation,
} from "./doctorJournal.js";
import type { DoctorIntent } from "./doctorJournal.js";
import { guardDoctorSource } from "./doctorSource.js";
import { persistPending, retirePending, withRootWriterLock } from "./localDomain.js";
import { readPending } from "./pending.js";
import { assertArgs } from "./protocol.js";
import type { Request } from "./protocol.js";
import { localPathOutsideRoot, synchronizeAuthority, withCacheTransaction } from "./queryCache.js";
import { findReceipt, requireWriteContext, storeReceipt } from "./receipts.js";
function requireDoctorBudget(database: DatabaseSync, count: number): void {
  const state = database
    .prepare("SELECT counter, revision FROM v2_query_state WHERE singleton = 1")
    .get()!;
  if (
    !Number.isSafeInteger((state.counter as number) + count * 3 + 8) ||
    !Number.isSafeInteger((state.revision as number) + 3)
  )
    throw new CommandError(
      "UNSUPPORTED_COMMAND",
      "explicit fresh-cache authority is required before doctor apply",
    );
}
export function commitDoctor(
  database: DatabaseSync,
  intent: DoctorIntent,
): Record<string, unknown> {
  requireDoctorBudget(database, intent.plan.nextTasks.length);
  const snapshot = applyDoctorJournal(intent),
    authority = synchronizeAuthority(database, intent.root, snapshot);
  const splitIds =
    intent.plan.input.kind === "keep-both"
      ? intent.plan.input.issueIds.map(
          (id) => intent.plan.source.issues.find((issue) => issue.issueId === id)!.taskId!,
        )
      : [];
  const repairedIds = [
    ...new Set([...splitIds, ...intent.writes.map((write) => write.taskId)]),
  ].sort();
  const before = intent.plan.source.versionRefs
    .filter((version) => version.canonical && repairedIds.includes(version.taskId))
    .map((version) => version.task!);
  const after = snapshot.tasks.filter((task) => repairedIds.includes(task.id));
  const splitReviews = splitIds.map((originalId) => ({
    originalId,
    reviewedIncoming: snapshot.tasks.flatMap((task) => [
      ...(task.parentId === originalId ? [{ taskId: task.id, field: "parentId" }] : []),
      ...(task.dependencyIds.includes(originalId)
        ? [{ taskId: task.id, field: "dependencyIds" }]
        : []),
    ]),
  }));
  database
    .prepare("INSERT INTO v2_operations VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(
      intent.operationId,
      authority.writeContext,
      repairedIds[0],
      intent.request.command,
      JSON.stringify(intent.request.actor),
      intent.at,
      JSON.stringify({ tasks: before }),
      JSON.stringify({ planId: intent.plan.planId, tasks: after, splitReviews }),
    );
  const member = database.prepare("INSERT INTO v2_operation_members VALUES (?, ?)");
  for (const id of repairedIds) member.run(intent.operationId, id);
  const result = {
    planId: intent.plan.planId,
    operationId: intent.operationId,
    repairedIds,
    removedConflictPaths: intent.plan.removedConflictPaths,
    recoveryLocation: doctorRecoveryLocation(intent.plan),
    recoveryReady: true,
    changed: true,
  };
  if (authority.writeContext === intent.request.writeContext)
    storeReceipt(database, intent.request, result);
  database
    .prepare("DELETE FROM v2_doctor_plans WHERE id = ? AND context = ?")
    .run(intent.plan.planId, authority.writeContext);
  return result;
}
export function executeDoctorApply(request: Request, rootPath: string, cachePath: string) {
  const root = readRootDescriptor(rootPath);
  return withRootWriterLock(root, () => {
    let completed: DoctorIntent | undefined;
    const outcome = withCacheTransaction(cachePath, root, (database) => {
      const authority = synchronizeAuthority(database, root);
      requireWriteContext(request, authority);
      assertArgs(request.args, ["planId"]);
      if (typeof request.args.planId !== "string" || !request.args.planId)
        throw new CommandError("INVALID_ARGUMENT", "retained planId is required");
      const receipt = findReceipt(database, request);
      if (receipt) return { writeContext: authority.writeContext, result: receipt };
      if (readPending(root))
        throw new CommandError("RECOVERY_PENDING", "root has an unfinished intent");
      const row = database
        .prepare("SELECT payload FROM v2_doctor_plans WHERE id = ? AND context = ?")
        .get(request.args.planId, authority.writeContext);
      if (
        !row ||
        database
          .prepare(
            "SELECT 1 FROM v2_operations WHERE context = ? AND command = 'workspace.doctor.apply' AND json_extract(after_record, '$.planId') = ?",
          )
          .get(authority.writeContext, request.args.planId)
      )
        throw new CommandError(
          "STALE_REPAIR_PLAN",
          "retained repair plan is unavailable or already applied",
        );
      const plan = parseRetainedDoctorPlan(Buffer.from(row.payload as string), root);
      try {
        guardDoctorSource(plan.source);
      } catch {
        throw new CommandError(
          "STALE_REPAIR_PLAN",
          "repair source bytes, scope or bindings changed",
        );
      }
      const at = new Date().toISOString(),
        writes = doctorIntentWrites(plan, at);
      if (request.dryRun || request.readOnly)
        return {
          writeContext: authority.writeContext,
          result: {
            planId: plan.planId,
            repairedIds: writes.map((write) => write.taskId),
            removedConflictPaths: plan.removedConflictPaths,
            changed: true,
            recoveryLocation: doctorRecoveryLocation(plan),
            recoveryReady: false,
            hypothetical: true,
            dryRun: request.dryRun,
            readOnly: request.readOnly,
          },
        };
      requireDoctorBudget(database, plan.nextTasks.length);
      const intent = parseDoctorIntent(
        {
          format: "taskdb.pending-doctor",
          version: 1,
          root,
          cachePath: localPathOutsideRoot(cachePath, root.rootPath),
          request,
          operationId: randomUUID(),
          at,
          plan,
          writes,
        },
        root,
      );
      guardDoctorSource(plan.source);
      persistDoctorArchive(intent);
      prepareDoctorProgress(intent);
      guardDoctorSource(plan.source);
      persistPending(root, intent);
      const result = commitDoctor(database, intent);
      completed = intent;
      return { writeContext: authority.writeContext, result };
    });
    if (completed) {
      retireDoctorStages(completed);
      retirePending(root);
    }
    return outcome;
  });
}
