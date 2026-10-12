import { linkSync, lstatSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { canonicalJson } from "./canonicalJson.js";
import { CommandError } from "./errors.js";
import { parseV2CanonicalJson } from "./v2CanonicalJson.js";
import { readV2CanonicalRoot, readV2RegularFile } from "./v2CanonicalReader.js";
import type { V2CanonicalSnapshot } from "./v2CanonicalReader.js";
import { buildV2DoctorPlan, parseV2DoctorInput } from "./v2DoctorPlan.js";
import type { V2DoctorPlan } from "./v2DoctorPlan.js";
import { readV2DoctorSource, restoreV2DoctorSource } from "./v2DoctorSource.js";
import { syncV2Directory, v2LocalDomain, writeV2DurableFile } from "./v2LocalDomain.js";
import { assertV2Args, isV2Record, parseV2Request } from "./v2Protocol.js";
import type { V2Request } from "./v2Protocol.js";
import { localPathOutsideV2Root } from "./v2QueryCache.js";
import type { V2RootBinding } from "./v2QueryCache.js";
import { isV2Timestamp } from "./v2TaskModel.js";

export type V2DoctorWrite = { taskId: string; beforeBytes: string | null; nextBytes: string };
export type V2DoctorIntent = { format: "taskdb.pending-doctor"; version: 1; root: V2RootBinding; cachePath: string; request: V2Request; operationId: string; at: string; plan: V2DoctorPlan; writes: V2DoctorWrite[] };
type Publication = { stageIdentity: string | null; started: boolean; published: boolean };
type Progress = { operationId: string; writes: Publication[] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function conflict(): never { throw new CommandError("RECOVERY_CONFLICT", "doctor has missing, divergent or uncertain publication/cleanup evidence; preserve it for inspection"); }
function fileIdentity(file: string): string {
  const stat = lstatSync(file, { bigint: true });if (!stat.isFile() || stat.isSymbolicLink()) conflict();return `${stat.dev}:${stat.ino}`;
}
function stagePath(intent: V2DoctorIntent, index: number): string { return path.join(intent.root.rootPath, "tasks", `.syncthing.taskdb-doctor-${intent.operationId}-${index}.tmp`); }
function publicationPath(intent: V2DoctorIntent, index: number): string { return path.join(intent.root.rootPath, "tasks", `.syncthing.taskdb-doctor-publish-${intent.operationId}-${index}.tmp`); }
function quarantinePath(intent: V2DoctorIntent, index: number): string { return path.join(intent.root.rootPath, "tasks", `.syncthing.taskdb-doctor-conflict-${intent.operationId}-${index}.tmp`); }
function progressPath(intent: V2DoctorIntent): string { return path.join(v2LocalDomain(intent.root), `doctor-${intent.operationId}.progress.json`); }
export function v2DoctorRecoveryLocation(plan: V2DoctorPlan): string { return path.join(v2LocalDomain(plan.source.root), `doctor-${plan.planId}.recovery.json`); }
export function parseV2RetainedDoctorPlan(value: unknown, root: V2RootBinding): V2DoctorPlan {
  try {
    const decoded = value instanceof Uint8Array ? parseV2CanonicalJson(value) : value;
    if (!isV2Record(decoded)) throw Error("missing plan");
    const saved = decoded as unknown as V2DoctorPlan;
    const source = restoreV2DoctorSource(saved.source);
    if (!uuid.test(saved.planId) || saved.allocation.planId !== saved.planId || source.root.rootPath !== root.rootPath || source.root.rootIdentity !== root.rootIdentity) throw Error("wrong plan binding");
    const rebuilt = buildV2DoctorPlan(parseV2DoctorInput(saved.input), source, saved.allocation);
    if (canonicalJson(saved) !== canonicalJson(rebuilt)) throw Error("divergent plan");
    return rebuilt;
  } catch { throw new CommandError("STALE_REPAIR_PLAN", "retained repair plan or its fixed source witnesses are unavailable"); }
}
export function doctorIntentWrites(plan: V2DoctorPlan, at: string): V2DoctorWrite[] {
  return plan.nextTasks.map(task => {
    const before = plan.source.files.find(file => file.relativePath === `tasks/${task.id}.json`);
    const next = plan.editedIds.includes(task.id) ? { ...task, updatedAt: at } : task;
    const identical = before && canonicalJson(parseV2CanonicalJson(Buffer.from(before.beforeBytes, "base64"))) === canonicalJson(next);
    return { taskId: task.id, beforeBytes: before?.beforeBytes ?? null, nextBytes: identical ? before!.beforeBytes : Buffer.from(`${JSON.stringify(next, null, 2)}\n`).toString("base64") };
  }).filter(file => file.beforeBytes !== file.nextBytes).sort((a, b) => a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0);
}
export function parseV2DoctorIntent(value: unknown, root: V2RootBinding): V2DoctorIntent {
  try {
    if (!isV2Record(value)) conflict();
    const intent = value as unknown as V2DoctorIntent;
    if (intent.format !== "taskdb.pending-doctor" || intent.version !== 1 || intent.root.rootPath !== root.rootPath || intent.root.rootIdentity !== root.rootIdentity || !uuid.test(intent.operationId)
      || !path.isAbsolute(intent.cachePath) || !isV2Timestamp(intent.at)) conflict();
    const request = parseV2Request(intent.request);assertV2Args(request.args, ["planId"]);
    if (request.command !== "workspace.doctor.apply" || request.dryRun || request.readOnly || !request.idempotencyKey || !request.writeContext || request.args.planId !== intent.plan.planId) conflict();
    const plan = parseV2RetainedDoctorPlan(intent.plan, root);
    const privateNames = intent.writes?.flatMap((_, index) => [path.basename(stagePath(intent, index)), path.basename(publicationPath(intent, index))]).concat(plan.removedConflictPaths.map((_, index) => path.basename(quarantinePath(intent, index))));
    if (privateNames?.some(name => plan.source.taskEntries.includes(name))) conflict();
    if (canonicalJson(intent.writes) !== canonicalJson(doctorIntentWrites(plan, intent.at)) || !intent.writes.length) conflict();
    localPathOutsideV2Root(intent.cachePath, root.rootPath);v2LocalDomain(root);
    return { ...intent, request, plan };
  } catch { return conflict(); }
}
function archiveBytes(intent: V2DoctorIntent): Buffer { return Buffer.from(`${JSON.stringify({ ...intent, format: "taskdb.doctor-recovery" })}\n`); }
function verifyArchive(intent: V2DoctorIntent): void { if (!readV2RegularFile(v2DoctorRecoveryLocation(intent.plan)).equals(archiveBytes(intent))) conflict(); }
export function persistV2DoctorArchive(intent: V2DoctorIntent): void {
  const location = v2DoctorRecoveryLocation(intent.plan);writeV2DurableFile(location, archiveBytes(intent));syncV2Directory(path.dirname(location));verifyArchive(intent);
}
export function prepareV2DoctorProgress(intent: V2DoctorIntent): void {
  const progress: Progress = { operationId: intent.operationId, writes: intent.writes.map(() => ({ stageIdentity: null, started: false, published: false })) };
  writeV2DurableFile(progressPath(intent), Buffer.from(`${JSON.stringify(progress)}\n`));syncV2Directory(v2LocalDomain(intent.root));
}
function readProgress(intent: V2DoctorIntent): Progress {
  if (lstatSync(`${progressPath(intent)}.preparing`, { throwIfNoEntry: false })) conflict();
  const progress = parseV2CanonicalJson(readV2RegularFile(progressPath(intent))) as Progress;
  if (progress.operationId !== intent.operationId || !Array.isArray(progress.writes) || progress.writes.length !== intent.writes.length) conflict();
  for (const state of progress.writes) if ((state.stageIdentity !== null && !/^\d+:\d+$/.test(state.stageIdentity)) || typeof state.started !== "boolean" || typeof state.published !== "boolean" || (state.started && state.stageIdentity === null) || (state.published && !state.started)) conflict();
  return progress;
}
function saveProgress(intent: V2DoctorIntent, progress: Progress): void {
  const file = progressPath(intent);writeV2DurableFile(`${file}.preparing`, Buffer.from(`${JSON.stringify(progress)}\n`));renameSync(`${file}.preparing`, file);syncV2Directory(v2LocalDomain(intent.root));
}
function verifyPrivateStages(intent: V2DoctorIntent, progress: Progress): void {
  for (const [index, write] of intent.writes.entries()) {
    const state = progress.writes[index];
    for (const file of [stagePath(intent, index), publicationPath(intent, index)]) {
      if (!lstatSync(file, { throwIfNoEntry: false })) { if (file === stagePath(intent, index) && state.stageIdentity !== null) conflict();continue; }
      if (!readV2RegularFile(file).equals(Buffer.from(write.nextBytes, "base64")) || (state.stageIdentity !== null && fileIdentity(file) !== state.stageIdentity)
        || (file === publicationPath(intent, index) && !state.started)) conflict();
    }
  }
}
function verifyQuarantine(intent: V2DoctorIntent, index: number): void {
  const original = intent.plan.source.files.find(file => file.relativePath === intent.plan.removedConflictPaths[index])!;
  const file = quarantinePath(intent, index);
  if (fileIdentity(file) !== original.identity || !readV2RegularFile(file).equals(Buffer.from(original.beforeBytes, "base64"))) conflict();
}
function guardDoctor(intent: V2DoctorIntent, progress: Progress, startingPublication = -1): ReturnType<typeof readV2DoctorSource> {
  verifyArchive(intent);verifyPrivateStages(intent, progress);
  const actual = readV2DoctorSource(intent.root.rootPath), original = intent.plan.source;
  if (actual.issues.some(issue => ["UNREADABLE_OR_UNSAFE_ENTRY", "DESCRIPTOR_CONFLICT", "MIXED_FORMAT"].includes(issue.code)) || actual.root.rootIdentity !== intent.root.rootIdentity || actual.taskDirectoryIdentity !== original.taskDirectoryIdentity || canonicalJson(actual.rootEntries) !== canonicalJson(original.rootEntries)) conflict();
  const allowedPrivate = intent.writes.flatMap((_, index) => [path.basename(stagePath(intent, index)), path.basename(publicationPath(intent, index))]).concat(intent.plan.removedConflictPaths.map((_, index) => path.basename(quarantinePath(intent, index))));
  const expectedNames = new Set(original.taskEntries), expected = new Map(original.files.map(file => [file.relativePath, file]));
  for (const [index, write] of intent.writes.entries()) {
    const relative = `tasks/${write.taskId}.json`, file = actual.files.find(file => file.relativePath === relative), state = progress.writes[index];
    if (file && state.started && file.beforeBytes === write.nextBytes && file.identity === state.stageIdentity) {
      expected.set(relative, file);expectedNames.add(`${write.taskId}.json`);
    } else {
      if (state.published || (write.beforeBytes === null && state.started && startingPublication !== index)) conflict();
      if (write.beforeBytes === null ? !!file : !file || file.beforeBytes !== write.beforeBytes || file.identity !== expected.get(relative)!.identity) conflict();
    }
  }
  for (const [index, relative] of intent.plan.removedConflictPaths.entries()) {
    const present = actual.files.some(file => file.relativePath === relative), quarantined = lstatSync(quarantinePath(intent, index), { throwIfNoEntry: false });
    if (quarantined) { verifyQuarantine(intent, index);if (present || progress.writes.some(state => !state.published)) conflict();expected.delete(relative);expectedNames.delete(path.basename(relative)); }
    else if (!present) conflict();
  }
  if (canonicalJson(actual.taskEntries.filter(name => !allowedPrivate.includes(name))) !== canonicalJson([...expectedNames].sort()) || canonicalJson(actual.files) !== canonicalJson([...expected.values()].sort((a, b) => a.relativePath === "workspace.json" ? -1 : b.relativePath === "workspace.json" ? 1 : a.relativePath < b.relativePath ? -1 : 1))) conflict();
  return actual;
}
function verifyOutputs(intent: V2DoctorIntent): V2CanonicalSnapshot {
  const snapshot = readV2CanonicalRoot(intent.root.rootPath);
  for (const write of intent.writes) if (!readV2RegularFile(path.join(intent.root.rootPath, "tasks", `${write.taskId}.json`)).equals(Buffer.from(write.nextBytes, "base64"))) conflict();
  return snapshot;
}
export function applyV2DoctorJournal(intent: V2DoctorIntent): V2CanonicalSnapshot {
  try {
    const progress = readProgress(intent);guardDoctor(intent, progress);
    for (const [index, write] of intent.writes.entries()) {
      const state = progress.writes[index], stage = stagePath(intent, index), target = path.join(intent.root.rootPath, "tasks", `${write.taskId}.json`);
      guardDoctor(intent, progress);
      if (state.published) continue;
      if (state.stageIdentity === null) {
        if (!lstatSync(stage, { throwIfNoEntry: false })) writeV2DurableFile(stage, Buffer.from(write.nextBytes, "base64"));
        syncV2Directory(path.dirname(stage));guardDoctor(intent, progress);state.stageIdentity = fileIdentity(stage);saveProgress(intent, progress);
      }
      if (!state.started) {
        state.started = true;saveProgress(intent, progress);guardDoctor(intent, progress, index);
        if (write.beforeBytes === null) linkSync(stage, target);
        else { linkSync(stage, publicationPath(intent, index));renameSync(publicationPath(intent, index), target); }
        syncV2Directory(path.dirname(target));
      } else if (write.beforeBytes !== null && fileIdentity(target) !== state.stageIdentity) {
        guardDoctor(intent, progress);
        if (!lstatSync(publicationPath(intent, index), { throwIfNoEntry: false })) linkSync(stage, publicationPath(intent, index));
        renameSync(publicationPath(intent, index), target);syncV2Directory(path.dirname(target));
      }
      guardDoctor(intent, progress);state.published = true;saveProgress(intent, progress);
    }
    guardDoctor(intent, progress);verifyOutputs(intent);
    for (const [index, relative] of intent.plan.removedConflictPaths.entries()) {
      const source = guardDoctor(intent, progress);
      if (!source.files.some(file => file.relativePath === relative)) continue;
      renameSync(path.join(intent.root.rootPath, relative), quarantinePath(intent, index));syncV2Directory(path.join(intent.root.rootPath, "tasks"));
    }
    guardDoctor(intent, progress);
    return verifyOutputs(intent);
  } catch { return conflict(); }
}
/** Historical success only retires its exact private evidence, never canonical files. */
export function retireV2DoctorStages(intent: V2DoctorIntent): void {
  try {
    verifyArchive(intent);
    const hasProgress = lstatSync(progressPath(intent), { throwIfNoEntry: false });
    if (lstatSync(`${progressPath(intent)}.preparing`, { throwIfNoEntry: false })) conflict();
    const progress = hasProgress ? readProgress(intent) : undefined;
    const stages = intent.writes.flatMap((write, index) => [stagePath(intent, index), publicationPath(intent, index)].filter(file => lstatSync(file, { throwIfNoEntry: false })).map(file => {
      if (!progress?.writes[index].published || fileIdentity(file) !== progress.writes[index].stageIdentity || !readV2RegularFile(file).equals(Buffer.from(write.nextBytes, "base64"))) conflict();return file;
    }));
    const quarantines = intent.plan.removedConflictPaths.map((_, index) => index).filter(index => lstatSync(quarantinePath(intent, index), { throwIfNoEntry: false }));
    for (const index of quarantines) verifyQuarantine(intent, index);
    for (const file of [...stages, ...quarantines.map(index => quarantinePath(intent, index))]) { unlinkSync(file);syncV2Directory(path.dirname(file)); }
    if (progress) { unlinkSync(progressPath(intent));syncV2Directory(v2LocalDomain(intent.root)); }
  } catch { return conflict(); }
}
