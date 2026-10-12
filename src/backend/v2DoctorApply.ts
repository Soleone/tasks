import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { CommandError } from "./errors.js";
import { readV2RootDescriptor } from "./v2CanonicalReader.js";
import { applyV2DoctorJournal, doctorIntentWrites, parseV2DoctorIntent, parseV2RetainedDoctorPlan, persistV2DoctorArchive, prepareV2DoctorProgress, retireV2DoctorStages, v2DoctorRecoveryLocation } from "./v2DoctorJournal.js";
import type { V2DoctorIntent } from "./v2DoctorJournal.js";
import { guardV2DoctorSource } from "./v2DoctorSource.js";
import { persistV2Pending, retireV2Pending, withV2RootWriterLock } from "./v2LocalDomain.js";
import { readV2Pending } from "./v2Pending.js";
import { assertV2Args } from "./v2Protocol.js";
import type { V2Request } from "./v2Protocol.js";
import { localPathOutsideV2Root, synchronizeV2Authority, withV2CacheTransaction } from "./v2QueryCache.js";
import { findV2Receipt, requireV2WriteContext, storeV2Receipt } from "./v2Receipts.js";
function requireDoctorBudget(database: DatabaseSync, count: number): void {
  const state = database.prepare("SELECT counter, revision FROM v2_query_state WHERE singleton = 1").get()!;
  if (!Number.isSafeInteger((state.counter as number) + count * 3 + 8) || !Number.isSafeInteger((state.revision as number) + 3)) throw new CommandError("UNSUPPORTED_COMMAND", "explicit fresh-cache authority is required before doctor apply");
}
export function commitV2Doctor(database: DatabaseSync, intent: V2DoctorIntent): Record<string, unknown> {
  requireDoctorBudget(database, intent.plan.nextTasks.length);
  const snapshot = applyV2DoctorJournal(intent), authority = synchronizeV2Authority(database, intent.root, snapshot);
  const splitIds = intent.plan.input.kind === "keep-both" ? intent.plan.input.issueIds.map(id => intent.plan.source.issues.find(issue => issue.issueId === id)!.taskId!) : [];
  const repairedIds = [...new Set([...splitIds, ...intent.writes.map(write => write.taskId)])].sort();
  const before = intent.plan.source.versionRefs.filter(version => version.canonical && repairedIds.includes(version.taskId)).map(version => version.task!);
  const after = snapshot.tasks.filter(task => repairedIds.includes(task.id));
  const splitReviews = splitIds.map(originalId => ({ originalId, reviewedIncoming: snapshot.tasks.flatMap(task => [
    ...(task.parentId === originalId ? [{ taskId: task.id, field: "parentId" }] : []),
    ...(task.dependencyIds.includes(originalId) ? [{ taskId: task.id, field: "dependencyIds" }] : []),
  ]) }));
  database.prepare("INSERT INTO v2_operations VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(intent.operationId, authority.writeContext, repairedIds[0], intent.request.command, JSON.stringify(intent.request.actor), intent.at, JSON.stringify({ tasks: before }), JSON.stringify({ planId: intent.plan.planId, tasks: after, splitReviews }));
  const member = database.prepare("INSERT INTO v2_operation_members VALUES (?, ?)");for (const id of repairedIds) member.run(intent.operationId, id);
  const result = { planId: intent.plan.planId, operationId: intent.operationId, repairedIds, removedConflictPaths: intent.plan.removedConflictPaths, recoveryLocation: v2DoctorRecoveryLocation(intent.plan), recoveryReady: true, changed: true };
  if (authority.writeContext === intent.request.writeContext) storeV2Receipt(database, intent.request, result);
  database.prepare("DELETE FROM v2_doctor_plans WHERE id = ? AND context = ?").run(intent.plan.planId, authority.writeContext);
  return result;
}
export function executeV2DoctorApply(request: V2Request, rootPath: string, cachePath: string) {
  const root = readV2RootDescriptor(rootPath);
  return withV2RootWriterLock(root, () => {
    let completed: V2DoctorIntent | undefined;
    const outcome = withV2CacheTransaction(cachePath, root, database => {
      const authority = synchronizeV2Authority(database, root);requireV2WriteContext(request, authority);assertV2Args(request.args, ["planId"]);
      if (typeof request.args.planId !== "string" || !request.args.planId) throw new CommandError("INVALID_ARGUMENT", "retained planId is required");
      const receipt = findV2Receipt(database, request);if (receipt) return { writeContext: authority.writeContext, result: receipt };
      if (readV2Pending(root)) throw new CommandError("RECOVERY_PENDING", "root has an unfinished intent");
      const row = database.prepare("SELECT payload FROM v2_doctor_plans WHERE id = ? AND context = ?").get(request.args.planId, authority.writeContext);
      if (!row || database.prepare("SELECT 1 FROM v2_operations WHERE context = ? AND command = 'workspace.doctor.apply' AND json_extract(after_record, '$.planId') = ?").get(authority.writeContext, request.args.planId)) throw new CommandError("STALE_REPAIR_PLAN", "retained repair plan is unavailable or already applied");
      const plan = parseV2RetainedDoctorPlan(Buffer.from(row.payload as string), root);
      try { guardV2DoctorSource(plan.source); } catch { throw new CommandError("STALE_REPAIR_PLAN", "repair source bytes, scope or bindings changed"); }
      const at = new Date().toISOString(), writes = doctorIntentWrites(plan, at);
      if (request.dryRun || request.readOnly) return { writeContext: authority.writeContext, result: { planId: plan.planId, repairedIds: writes.map(write => write.taskId), removedConflictPaths: plan.removedConflictPaths, changed: true, recoveryLocation: v2DoctorRecoveryLocation(plan), recoveryReady: false, hypothetical: true, dryRun: request.dryRun, readOnly: request.readOnly } };
      requireDoctorBudget(database, plan.nextTasks.length);
      const intent = parseV2DoctorIntent({ format: "taskdb.pending-doctor", version: 1, root, cachePath: localPathOutsideV2Root(cachePath, root.rootPath), request, operationId: randomUUID(), at, plan, writes }, root);
      guardV2DoctorSource(plan.source);persistV2DoctorArchive(intent);prepareV2DoctorProgress(intent);guardV2DoctorSource(plan.source);
      persistV2Pending(root, intent);
      const result = commitV2Doctor(database, intent);completed = intent;
      return { writeContext: authority.writeContext, result };
    });
    if (completed) { retireV2DoctorStages(completed);retireV2Pending(root); }
    return outcome;
  });
}
