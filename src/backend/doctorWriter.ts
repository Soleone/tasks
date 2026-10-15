import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { parseCanonicalJson } from "./strictJson.js";
import { CommandError } from "./errors.js";
import { readPhysicalRoot, readRootDescriptor } from "./canonicalReader.js";
import { buildDoctorPlan, doctorCloneVersions, parseDoctorInput } from "./doctorPlan.js";
import type { DoctorPlan } from "./doctorPlan.js";
import { guardDoctorSource, readDoctorSource } from "./doctorSource.js";
import type { DoctorLink } from "./doctorSource.js";
import { localDomain, withRootWriterLock } from "./localDomain.js";
import { readPending } from "./pending.js";
import { assertArgs, isRecord } from "./protocol.js";
import type { Request } from "./protocol.js";
import { synchronizeAuthority, withCacheTransaction } from "./queryCache.js";
import { findReceipt, requireWriteContext, storeReceipt } from "./receipts.js";

function planResult(plan: DoctorPlan): Record<string, unknown> {
  return { planId: plan.planId, clones: plan.clones, linkEdits: plan.linkEdits, removedConflictPaths: plan.removedConflictPaths,
    canonicalVersions: plan.input.kind === "keep-both" ? plan.input.canonicalVersions.map(choice => ({ taskId: plan.source.issues.find(issue => issue.issueId === choice.issueId)!.taskId, versionRef: choice.versionRef })) : [],
    recoveryLocation: path.join(localDomain(plan.source.root), `doctor-${plan.planId}.recovery.json`), recoveryReady: false, changed: true,
    requiresQuiescedDevice: true, applyAvailable: true };
}
function lateDoctorLinks(database: DatabaseSync, context: string, links: DoctorLink[]) {
  const late: (DoctorLink & { planId: string; taskId?: string })[] = [];
  for (const row of database.prepare("SELECT after_record FROM v2_operations WHERE context = ? AND command = 'workspace.doctor.apply'").all(context)) {
    const after = parseCanonicalJson(Buffer.from(row.after_record as string));
    if (!isRecord(after) || typeof after.planId !== "string" || !Array.isArray(after.splitReviews)) throw new CommandError("RECOVERY_CONFLICT", "local doctor history requires inspection");
    for (const review of after.splitReviews) {
      if (!isRecord(review) || typeof review.originalId !== "string" || !Array.isArray(review.reviewedIncoming)) throw new CommandError("RECOVERY_CONFLICT", "local doctor history requires inspection");
      for (const link of links.filter(link => link.fromId === review.originalId)) {
        const record = link.record;
        if ("taskId" in record && review.reviewedIncoming.some(pair => isRecord(pair) && pair.taskId === record.taskId && pair.field === link.field)) continue;
        late.push({ ...link, planId: after.planId, ...("taskId" in record ? { taskId: record.taskId } : {}) });
      }
    }
  }
  return late;
}
export function executeDoctorInspect(request: Request, rootPath: string, cachePath: string) {
  assertArgs(request.args, []);
  const root = readPhysicalRoot(rootPath);
  return withCacheTransaction(cachePath, root, database => {
    const authority = synchronizeAuthority(database, root);
    let pendingOperationId: string | null = null, pendingIssue: { code: string } | undefined;
    try { pendingOperationId = readPending(root)?.operationId ?? null; }
    catch (error) { if (!(error instanceof CommandError)) throw error;pendingIssue = { code: "RECOVERY_CONFLICT" }; }
    const source = readDoctorSource(root.rootPath);
    if (source.root.rootIdentity !== root.rootIdentity) throw new CommandError("STALE_WRITE_CONTEXT", "physical root changed during doctor inspection");
    const unreviewedIncomingLinks = lateDoctorLinks(database, authority.writeContext, source.incomingLinks);
    return { writeContext: authority.writeContext, result: { issues: [...source.issues, ...(pendingIssue ? [pendingIssue] : []), ...unreviewedIncomingLinks.map(link => ({ code: "UNREVIEWED_INCOMING_LINK", ...link }))], unreviewedIncomingLinks, versionRefs: source.versionRefs, incomingLinks: source.incomingLinks, pendingOperationId,
      canonicalIds: source.versionRefs.filter(version => version.canonical).map(version => version.taskId), applyAvailable: true } };
  });
}
export function executeDoctorPlan(request: Request, rootPath: string, cachePath: string) {
  const root = readRootDescriptor(rootPath);
  return withRootWriterLock(root, () => withCacheTransaction(cachePath, root, database => {
    const authority = synchronizeAuthority(database, root);
    requireWriteContext(request, authority);
    const input = parseDoctorInput(request.args);
    const receipt = findReceipt(database, request);
    if (receipt) return { writeContext: authority.writeContext, result: receipt };
    if (readPending(root)) throw new CommandError("RECOVERY_PENDING", "root has an unfinished intent");
    const source = readDoctorSource(root.rootPath);
    if (source.root.rootIdentity !== root.rootIdentity) throw new CommandError("STALE_WRITE_CONTEXT", "physical root changed during doctor planning");
    const allocation = { planId: randomUUID(), cloneIds: Object.fromEntries(doctorCloneVersions(input, source).map(version => [version.versionRef, randomUUID()])) };
    const plan = buildDoctorPlan(input, source, allocation);
    guardDoctorSource(source);
    const result = planResult(plan);
    if (request.dryRun || request.readOnly) return { writeContext: authority.writeContext, result: { ...result, hypothetical: true, dryRun: request.dryRun, readOnly: request.readOnly } };
    database.prepare("INSERT INTO v2_doctor_plans VALUES (?, ?, ?)").run(plan.planId, authority.writeContext, JSON.stringify(plan));
    guardDoctorSource(source);
    storeReceipt(database, request, result);
    return { writeContext: authority.writeContext, result };
  }));
}
