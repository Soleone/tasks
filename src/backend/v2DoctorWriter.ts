import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { parseV2CanonicalJson } from "./v2CanonicalJson.js";
import { CommandError } from "./errors.js";
import { readV2PhysicalRoot, readV2RootDescriptor } from "./v2CanonicalReader.js";
import { buildV2DoctorPlan, doctorCloneVersions, parseV2DoctorInput } from "./v2DoctorPlan.js";
import type { V2DoctorPlan } from "./v2DoctorPlan.js";
import { guardV2DoctorSource, readV2DoctorSource } from "./v2DoctorSource.js";
import type { V2DoctorLink } from "./v2DoctorSource.js";
import { v2LocalDomain, withV2RootWriterLock } from "./v2LocalDomain.js";
import { readV2Pending } from "./v2Pending.js";
import { assertV2Args, isV2Record } from "./v2Protocol.js";
import type { V2Request } from "./v2Protocol.js";
import { synchronizeV2Authority, withV2CacheTransaction } from "./v2QueryCache.js";
import { findV2Receipt, requireV2WriteContext, storeV2Receipt } from "./v2Receipts.js";

function planResult(plan: V2DoctorPlan): Record<string, unknown> {
  return { planId: plan.planId, clones: plan.clones, linkEdits: plan.linkEdits, removedConflictPaths: plan.removedConflictPaths,
    canonicalVersions: plan.input.kind === "keep-both" ? plan.input.canonicalVersions.map(choice => ({ taskId: plan.source.issues.find(issue => issue.issueId === choice.issueId)!.taskId, versionRef: choice.versionRef })) : [],
    recoveryLocation: path.join(v2LocalDomain(plan.source.root), `doctor-${plan.planId}.recovery.json`), recoveryReady: false, changed: true,
    requiresQuiescedDevice: true, applyAvailable: true };
}
function lateDoctorLinks(database: DatabaseSync, context: string, links: V2DoctorLink[]) {
  const late: (V2DoctorLink & { planId: string; taskId?: string })[] = [];
  for (const row of database.prepare("SELECT after_record FROM v2_operations WHERE context = ? AND command = 'workspace.doctor.apply'").all(context)) {
    const after = parseV2CanonicalJson(Buffer.from(row.after_record as string));
    if (!isV2Record(after) || typeof after.planId !== "string" || !Array.isArray(after.splitReviews)) throw new CommandError("RECOVERY_CONFLICT", "local doctor history requires inspection");
    for (const review of after.splitReviews) {
      if (!isV2Record(review) || typeof review.originalId !== "string" || !Array.isArray(review.reviewedIncoming)) throw new CommandError("RECOVERY_CONFLICT", "local doctor history requires inspection");
      for (const link of links.filter(link => link.fromId === review.originalId)) {
        const record = link.record;
        if ("taskId" in record && review.reviewedIncoming.some(pair => isV2Record(pair) && pair.taskId === record.taskId && pair.field === link.field)) continue;
        late.push({ ...link, planId: after.planId, ...("taskId" in record ? { taskId: record.taskId } : {}) });
      }
    }
  }
  return late;
}
export function executeV2DoctorInspect(request: V2Request, rootPath: string, cachePath: string) {
  assertV2Args(request.args, []);
  const root = readV2PhysicalRoot(rootPath);
  return withV2CacheTransaction(cachePath, root, database => {
    const authority = synchronizeV2Authority(database, root);
    let pendingOperationId: string | null = null, pendingIssue: { code: string } | undefined;
    try { pendingOperationId = readV2Pending(root)?.operationId ?? null; }
    catch (error) { if (!(error instanceof CommandError)) throw error;pendingIssue = { code: "RECOVERY_CONFLICT" }; }
    const source = readV2DoctorSource(root.rootPath);
    if (source.root.rootIdentity !== root.rootIdentity) throw new CommandError("STALE_WRITE_CONTEXT", "physical root changed during doctor inspection");
    const unreviewedIncomingLinks = lateDoctorLinks(database, authority.writeContext, source.incomingLinks);
    return { writeContext: authority.writeContext, result: { issues: [...source.issues, ...(pendingIssue ? [pendingIssue] : []), ...unreviewedIncomingLinks.map(link => ({ code: "UNREVIEWED_INCOMING_LINK", ...link }))], unreviewedIncomingLinks, versionRefs: source.versionRefs, incomingLinks: source.incomingLinks, pendingOperationId,
      canonicalIds: source.versionRefs.filter(version => version.canonical).map(version => version.taskId), applyAvailable: true } };
  });
}
export function executeV2DoctorPlan(request: V2Request, rootPath: string, cachePath: string) {
  const root = readV2RootDescriptor(rootPath);
  return withV2RootWriterLock(root, () => withV2CacheTransaction(cachePath, root, database => {
    const authority = synchronizeV2Authority(database, root);
    requireV2WriteContext(request, authority);
    const input = parseV2DoctorInput(request.args);
    const receipt = findV2Receipt(database, request);
    if (receipt) return { writeContext: authority.writeContext, result: receipt };
    if (readV2Pending(root)) throw new CommandError("RECOVERY_PENDING", "root has an unfinished intent");
    const source = readV2DoctorSource(root.rootPath);
    if (source.root.rootIdentity !== root.rootIdentity) throw new CommandError("STALE_WRITE_CONTEXT", "physical root changed during doctor planning");
    const allocation = { planId: randomUUID(), cloneIds: Object.fromEntries(doctorCloneVersions(input, source).map(version => [version.versionRef, randomUUID()])) };
    const plan = buildV2DoctorPlan(input, source, allocation);
    guardV2DoctorSource(source);
    const result = planResult(plan);
    if (request.dryRun || request.readOnly) return { writeContext: authority.writeContext, result: { ...result, hypothetical: true, dryRun: request.dryRun, readOnly: request.readOnly } };
    database.prepare("INSERT INTO v2_doctor_plans VALUES (?, ?, ?)").run(plan.planId, authority.writeContext, JSON.stringify(plan));
    guardV2DoctorSource(source);
    storeV2Receipt(database, request, result);
    return { writeContext: authority.writeContext, result };
  }));
}
