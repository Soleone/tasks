import { linkSync, lstatSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { canonicalJson } from "./canonicalJson.js";
import { CommandError } from "./errors.js";
import { parseCanonicalJson } from "./strictJson.js";
import { readCanonicalRoot, readRegularFile } from "./canonicalReader.js";
import type { CanonicalSnapshot } from "./canonicalReader.js";
import { buildDoctorPlan, parseDoctorInput } from "./doctorPlan.js";
import type { DoctorPlan } from "./doctorPlan.js";
import { readDoctorSource, restoreDoctorSource } from "./doctorSource.js";
import { syncDirectory, localDomain, writeDurableFile } from "./localDomain.js";
import { assertArgs, isRecord, parseRequest } from "./protocol.js";
import type { Request } from "./protocol.js";
import { localPathOutsideRoot } from "./queryCache.js";
import type { RootBinding } from "./queryCache.js";
import { isTimestamp } from "./taskModel.js";

export type DoctorWrite = { taskId: string; beforeBytes: string | null; nextBytes: string };
export type DoctorIntent = { format: "taskdb.pending-doctor"; version: 1; root: RootBinding; cachePath: string; request: Request; operationId: string; at: string; plan: DoctorPlan; writes: DoctorWrite[] };
type Publication = { stageIdentity: string | null; started: boolean; published: boolean };
type Progress = { operationId: string; writes: Publication[] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function conflict(): never { throw new CommandError("RECOVERY_CONFLICT", "doctor has missing, divergent or uncertain publication/cleanup evidence; preserve it for inspection"); }
function fileIdentity(file: string): string {
  const stat = lstatSync(file, { bigint: true });if (!stat.isFile() || stat.isSymbolicLink()) conflict();return `${stat.dev}:${stat.ino}`;
}
function stagePath(intent: DoctorIntent, index: number): string { return path.join(intent.root.rootPath, "tasks", `.syncthing.taskdb-doctor-${intent.operationId}-${index}.tmp`); }
function publicationPath(intent: DoctorIntent, index: number): string { return path.join(intent.root.rootPath, "tasks", `.syncthing.taskdb-doctor-publish-${intent.operationId}-${index}.tmp`); }
function quarantinePath(intent: DoctorIntent, index: number): string { return path.join(intent.root.rootPath, "tasks", `.syncthing.taskdb-doctor-conflict-${intent.operationId}-${index}.tmp`); }
function progressPath(intent: DoctorIntent): string { return path.join(localDomain(intent.root), `doctor-${intent.operationId}.progress.json`); }
export function doctorRecoveryLocation(plan: DoctorPlan): string { return path.join(localDomain(plan.source.root), `doctor-${plan.planId}.recovery.json`); }
export function parseRetainedDoctorPlan(value: unknown, root: RootBinding): DoctorPlan {
  try {
    const decoded = value instanceof Uint8Array ? parseCanonicalJson(value) : value;
    if (!isRecord(decoded)) throw Error("missing plan");
    const saved = decoded as unknown as DoctorPlan;
    const source = restoreDoctorSource(saved.source);
    if (!uuid.test(saved.planId) || saved.allocation.planId !== saved.planId || source.root.rootPath !== root.rootPath || source.root.rootIdentity !== root.rootIdentity) throw Error("wrong plan binding");
    const rebuilt = buildDoctorPlan(parseDoctorInput(saved.input), source, saved.allocation);
    if (canonicalJson(saved) !== canonicalJson(rebuilt)) throw Error("divergent plan");
    return rebuilt;
  } catch { throw new CommandError("STALE_REPAIR_PLAN", "retained repair plan or its fixed source witnesses are unavailable"); }
}
export function doctorIntentWrites(plan: DoctorPlan, at: string): DoctorWrite[] {
  return plan.nextTasks.map(task => {
    const before = plan.source.files.find(file => file.relativePath === `tasks/${task.id}.json`);
    const next = plan.editedIds.includes(task.id) ? { ...task, updatedAt: at } : task;
    const identical = before && canonicalJson(parseCanonicalJson(Buffer.from(before.beforeBytes, "base64"))) === canonicalJson(next);
    return { taskId: task.id, beforeBytes: before?.beforeBytes ?? null, nextBytes: identical ? before!.beforeBytes : Buffer.from(`${JSON.stringify(next, null, 2)}\n`).toString("base64") };
  }).filter(file => file.beforeBytes !== file.nextBytes).sort((a, b) => a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0);
}
export function parseDoctorIntent(value: unknown, root: RootBinding): DoctorIntent {
  try {
    if (!isRecord(value)) conflict();
    const intent = value as unknown as DoctorIntent;
    if (intent.format !== "taskdb.pending-doctor" || intent.version !== 1 || intent.root.rootPath !== root.rootPath || intent.root.rootIdentity !== root.rootIdentity || !uuid.test(intent.operationId)
      || !path.isAbsolute(intent.cachePath) || !isTimestamp(intent.at)) conflict();
    const request = parseRequest(intent.request);assertArgs(request.args, ["planId"]);
    if (request.command !== "workspace.doctor.apply" || request.dryRun || request.readOnly || !request.idempotencyKey || !request.writeContext || request.args.planId !== intent.plan.planId) conflict();
    const plan = parseRetainedDoctorPlan(intent.plan, root);
    const privateNames = intent.writes?.flatMap((_, index) => [path.basename(stagePath(intent, index)), path.basename(publicationPath(intent, index))]).concat(plan.removedConflictPaths.map((_, index) => path.basename(quarantinePath(intent, index))));
    if (privateNames?.some(name => plan.source.taskEntries.includes(name))) conflict();
    if (canonicalJson(intent.writes) !== canonicalJson(doctorIntentWrites(plan, intent.at)) || !intent.writes.length) conflict();
    localPathOutsideRoot(intent.cachePath, root.rootPath);localDomain(root);
    return { ...intent, request, plan };
  } catch { return conflict(); }
}
function archiveBytes(intent: DoctorIntent): Buffer { return Buffer.from(`${JSON.stringify({ ...intent, format: "taskdb.doctor-recovery" })}\n`); }
function verifyArchive(intent: DoctorIntent): void { if (!readRegularFile(doctorRecoveryLocation(intent.plan)).equals(archiveBytes(intent))) conflict(); }
export function persistDoctorArchive(intent: DoctorIntent): void {
  const location = doctorRecoveryLocation(intent.plan);writeDurableFile(location, archiveBytes(intent));syncDirectory(path.dirname(location));verifyArchive(intent);
}
export function prepareDoctorProgress(intent: DoctorIntent): void {
  const progress: Progress = { operationId: intent.operationId, writes: intent.writes.map(() => ({ stageIdentity: null, started: false, published: false })) };
  writeDurableFile(progressPath(intent), Buffer.from(`${JSON.stringify(progress)}\n`));syncDirectory(localDomain(intent.root));
}
function readProgress(intent: DoctorIntent): Progress {
  if (lstatSync(`${progressPath(intent)}.preparing`, { throwIfNoEntry: false })) conflict();
  const progress = parseCanonicalJson(readRegularFile(progressPath(intent))) as Progress;
  if (progress.operationId !== intent.operationId || !Array.isArray(progress.writes) || progress.writes.length !== intent.writes.length) conflict();
  for (const state of progress.writes) if ((state.stageIdentity !== null && !/^\d+:\d+$/.test(state.stageIdentity)) || typeof state.started !== "boolean" || typeof state.published !== "boolean" || (state.started && state.stageIdentity === null) || (state.published && !state.started)) conflict();
  return progress;
}
function saveProgress(intent: DoctorIntent, progress: Progress): void {
  const file = progressPath(intent);writeDurableFile(`${file}.preparing`, Buffer.from(`${JSON.stringify(progress)}\n`));renameSync(`${file}.preparing`, file);syncDirectory(localDomain(intent.root));
}
function verifyPrivateStages(intent: DoctorIntent, progress: Progress): void {
  for (const [index, write] of intent.writes.entries()) {
    const state = progress.writes[index];
    for (const file of [stagePath(intent, index), publicationPath(intent, index)]) {
      if (!lstatSync(file, { throwIfNoEntry: false })) { if (file === stagePath(intent, index) && state.stageIdentity !== null) conflict();continue; }
      if (!readRegularFile(file).equals(Buffer.from(write.nextBytes, "base64")) || (state.stageIdentity !== null && fileIdentity(file) !== state.stageIdentity)
        || (file === publicationPath(intent, index) && !state.started)) conflict();
    }
  }
}
function verifyQuarantine(intent: DoctorIntent, index: number): void {
  const original = intent.plan.source.files.find(file => file.relativePath === intent.plan.removedConflictPaths[index])!;
  const file = quarantinePath(intent, index);
  if (fileIdentity(file) !== original.identity || !readRegularFile(file).equals(Buffer.from(original.beforeBytes, "base64"))) conflict();
}
function guardDoctor(intent: DoctorIntent, progress: Progress, startingPublication = -1): ReturnType<typeof readDoctorSource> {
  verifyArchive(intent);verifyPrivateStages(intent, progress);
  const actual = readDoctorSource(intent.root.rootPath), original = intent.plan.source;
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
function verifyOutputs(intent: DoctorIntent): CanonicalSnapshot {
  const snapshot = readCanonicalRoot(intent.root.rootPath);
  for (const write of intent.writes) if (!readRegularFile(path.join(intent.root.rootPath, "tasks", `${write.taskId}.json`)).equals(Buffer.from(write.nextBytes, "base64"))) conflict();
  return snapshot;
}
export function applyDoctorJournal(intent: DoctorIntent): CanonicalSnapshot {
  try {
    const progress = readProgress(intent);guardDoctor(intent, progress);
    for (const [index, write] of intent.writes.entries()) {
      const state = progress.writes[index], stage = stagePath(intent, index), target = path.join(intent.root.rootPath, "tasks", `${write.taskId}.json`);
      guardDoctor(intent, progress);
      if (state.published) continue;
      if (state.stageIdentity === null) {
        if (!lstatSync(stage, { throwIfNoEntry: false })) writeDurableFile(stage, Buffer.from(write.nextBytes, "base64"));
        syncDirectory(path.dirname(stage));guardDoctor(intent, progress);state.stageIdentity = fileIdentity(stage);saveProgress(intent, progress);
      }
      if (!state.started) {
        state.started = true;saveProgress(intent, progress);guardDoctor(intent, progress, index);
        if (write.beforeBytes === null) linkSync(stage, target);
        else { linkSync(stage, publicationPath(intent, index));renameSync(publicationPath(intent, index), target); }
        syncDirectory(path.dirname(target));
      } else if (write.beforeBytes !== null && fileIdentity(target) !== state.stageIdentity) {
        guardDoctor(intent, progress);
        if (!lstatSync(publicationPath(intent, index), { throwIfNoEntry: false })) linkSync(stage, publicationPath(intent, index));
        renameSync(publicationPath(intent, index), target);syncDirectory(path.dirname(target));
      }
      guardDoctor(intent, progress);state.published = true;saveProgress(intent, progress);
    }
    guardDoctor(intent, progress);verifyOutputs(intent);
    for (const [index, relative] of intent.plan.removedConflictPaths.entries()) {
      const source = guardDoctor(intent, progress);
      if (!source.files.some(file => file.relativePath === relative)) continue;
      renameSync(path.join(intent.root.rootPath, relative), quarantinePath(intent, index));syncDirectory(path.join(intent.root.rootPath, "tasks"));
    }
    guardDoctor(intent, progress);
    return verifyOutputs(intent);
  } catch { return conflict(); }
}
/** Historical success only retires its exact private evidence, never canonical files. */
export function retireDoctorStages(intent: DoctorIntent): void {
  try {
    verifyArchive(intent);
    const hasProgress = lstatSync(progressPath(intent), { throwIfNoEntry: false });
    if (lstatSync(`${progressPath(intent)}.preparing`, { throwIfNoEntry: false })) conflict();
    const progress = hasProgress ? readProgress(intent) : undefined;
    const stages = intent.writes.flatMap((write, index) => [stagePath(intent, index), publicationPath(intent, index)].filter(file => lstatSync(file, { throwIfNoEntry: false })).map(file => {
      if (!progress?.writes[index].published || fileIdentity(file) !== progress.writes[index].stageIdentity || !readRegularFile(file).equals(Buffer.from(write.nextBytes, "base64"))) conflict();return file;
    }));
    const quarantines = intent.plan.removedConflictPaths.map((_, index) => index).filter(index => lstatSync(quarantinePath(intent, index), { throwIfNoEntry: false }));
    for (const index of quarantines) verifyQuarantine(intent, index);
    for (const file of [...stages, ...quarantines.map(index => quarantinePath(intent, index))]) { unlinkSync(file);syncDirectory(path.dirname(file)); }
    if (progress) { unlinkSync(progressPath(intent));syncDirectory(localDomain(intent.root)); }
  } catch { return conflict(); }
}
