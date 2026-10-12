import { linkSync, lstatSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { canonicalJson } from "./canonicalJson.js";
import { CommandError } from "./errors.js";
import { parseV2CanonicalJson } from "./v2CanonicalJson.js";
import { readV2CanonicalRoot, readV2RegularFile } from "./v2CanonicalReader.js";
import type { V2CanonicalSnapshot, V2FileObservation } from "./v2CanonicalReader.js";
import { directoryIdentity, guardCopySource } from "./v2CopyFiles.js";
import { buildV2CreatedTask, parseV2Create } from "./v2CreateInputs.js";
import { retireV2Pending, syncV2Directory, v2LocalDomain, writeV2DurableFile } from "./v2LocalDomain.js";
import { isV2Record, parseV2Request } from "./v2Protocol.js";
import type { V2Request } from "./v2Protocol.js";
import { localPathOutsideV2Root } from "./v2QueryCache.js";
import type { V2RootBinding } from "./v2QueryCache.js";
import { validateV2Task } from "./v2TaskModel.js";
import { exactV2Hash } from "./v2UpdateJournal.js";

export type V2CreateIntent = {
  format: "taskdb.pending-create"; version: 1; root: V2RootBinding; cachePath: string;
  request: V2Request; operationId: string; at: string; taskId: string; taskDirectoryIdentity: string;
  nextBytes: string; guards: V2FileObservation[];
};
type CreateProgress = { operationId: string; stageIdentity: string | null; publicationStarted: boolean; published: boolean };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function conflict(): never { throw new CommandError("RECOVERY_CONFLICT", "capture has missing, divergent or uncertain publication evidence; preserve it for inspection"); }
function stagePath(intent: V2CreateIntent): string { return path.join(intent.root.rootPath, "tasks", `.syncthing.taskdb-create-${intent.operationId}.tmp`); }
function targetPath(intent: V2CreateIntent): string { return path.join(intent.root.rootPath, "tasks", `${intent.taskId}.json`); }
function progressPath(intent: V2CreateIntent): string { return path.join(v2LocalDomain(intent.root), `create-${intent.operationId}.progress.json`); }
function fileIdentity(file: string): string {
  const stat = lstatSync(file, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()) conflict();
  return `${stat.dev}:${stat.ino}`;
}

export function parseV2CreateIntent(value: unknown, root: V2RootBinding): V2CreateIntent {
  try {
    if (!isV2Record(value)) conflict();
    const intent = value as unknown as V2CreateIntent;
    if (intent.format !== "taskdb.pending-create" || intent.version !== 1 || intent.root.rootPath !== root.rootPath || intent.root.rootIdentity !== root.rootIdentity
      || !uuid.test(intent.taskId) || !uuid.test(intent.operationId) || !/^\d+:\d+$/.test(intent.taskDirectoryIdentity)) conflict();
    if (!path.isAbsolute(root.rootPath) || !/^\d+:\d+$/.test(root.rootIdentity) || !path.isAbsolute(intent.cachePath)) conflict();
    const request = parseV2Request(intent.request);
    if (request.command !== "task.create" || request.readOnly || request.dryRun || !request.writeContext || !request.idempotencyKey) conflict();
    const input = parseV2Create(request.args);
    if (typeof intent.nextBytes !== "string" || Buffer.from(intent.nextBytes, "base64").toString("base64") !== intent.nextBytes) conflict();
    const next = validateV2Task(parseV2CanonicalJson(Buffer.from(intent.nextBytes, "base64")), intent.taskId);
    if (next.createdAt !== intent.at || next.updatedAt !== intent.at || next.status !== "open" || next.closedAt !== null || next.dependencyIds.length !== 0
      || canonicalJson({ title: next.title, description: next.description, priority: next.priority, category: next.category, tags: next.tags, parentId: next.parentId }) !== canonicalJson(input)) conflict();
    if (!Array.isArray(intent.guards) || !intent.guards.some(file => file.relativePath === "workspace.json") || new Set(intent.guards.map(file => file.relativePath)).size !== intent.guards.length) conflict();
    for (const file of intent.guards) {
      if ((file.relativePath !== "workspace.json" && !/^tasks\/(?:[A-Za-z0-9_-]+|[A-Za-z0-9_-]+\.sync-conflict-[^/\\]+)\.json$/.test(file.relativePath))
        || typeof file.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(file.sha256)
        || (file.relativePath.startsWith("tasks/") && path.basename(file.relativePath).split(".")[0].toLowerCase() === intent.taskId)) conflict();
    }
    localPathOutsideV2Root(intent.cachePath, root.rootPath);
    v2LocalDomain(root);
    return { ...intent, request };
  } catch { return conflict(); }
}

function readProgress(intent: V2CreateIntent): CreateProgress {
  const file = progressPath(intent);
  // Even a complete older record cannot authorize a publication whose next progress is unpublished.
  if (lstatSync(`${file}.preparing`, { throwIfNoEntry: false })) conflict();
  if (!lstatSync(file, { throwIfNoEntry: false })) conflict();
  const progress = parseV2CanonicalJson(readV2RegularFile(file)) as CreateProgress;
  if (progress.operationId !== intent.operationId || (progress.stageIdentity !== null && !/^\d+:\d+$/.test(progress.stageIdentity)) || typeof progress.publicationStarted !== "boolean"
    || typeof progress.published !== "boolean" || (progress.published && !progress.publicationStarted) || (progress.publicationStarted && progress.stageIdentity === null)) conflict();
  return progress;
}

function saveProgress(intent: V2CreateIntent, progress: CreateProgress): void {
  const file = progressPath(intent);
  writeV2DurableFile(`${file}.preparing`, Buffer.from(`${JSON.stringify(progress)}\n`));
  renameSync(`${file}.preparing`, file);
  syncV2Directory(v2LocalDomain(intent.root));
}

/** Before pending publication, persist the record whose later loss must never look like a fresh capture. */
export function prepareV2CreateProgress(intent: V2CreateIntent): void {
  const progress: CreateProgress = { operationId: intent.operationId, stageIdentity: null, publicationStarted: false, published: false };
  writeV2DurableFile(progressPath(intent), Buffer.from(`${JSON.stringify(progress)}\n`));
  syncV2Directory(v2LocalDomain(intent.root));
}

function guardCreate(intent: V2CreateIntent, progress: CreateProgress, startingPublication = false): V2CanonicalSnapshot {
  const snapshot = readV2CanonicalRoot(intent.root.rootPath);
  if (snapshot.rootPath !== intent.root.rootPath || snapshot.rootIdentity !== intent.root.rootIdentity
    || directoryIdentity(path.join(intent.root.rootPath, "tasks")) !== intent.taskDirectoryIdentity) conflict();
  const target = `tasks/${intent.taskId}.json`;
  const otherFiles = snapshot.files.filter(file => file.relativePath !== target);
  if (otherFiles.length !== intent.guards.length || intent.guards.some(file => !otherFiles.some(actual => actual.relativePath === file.relativePath && actual.sha256 === file.sha256))) conflict();
  const actual = snapshot.files.find(file => file.relativePath === target);
  if (actual) {
    if (!progress.publicationStarted || actual.sha256 !== exactV2Hash(Buffer.from(intent.nextBytes, "base64")) || fileIdentity(targetPath(intent)) !== progress.stageIdentity) conflict();
  } else if ((progress.publicationStarted && !startingPublication) || progress.published) conflict();
  const expected = buildV2CreatedTask(parseV2Create(intent.request.args), { id: intent.taskId, at: intent.at }, snapshot.tasks.filter(task => task.id !== intent.taskId));
  if (canonicalJson(expected) !== canonicalJson(parseV2CanonicalJson(Buffer.from(intent.nextBytes, "base64")))) conflict();
  const stage = stagePath(intent);
  if (lstatSync(stage, { throwIfNoEntry: false })) {
    if (progress.stageIdentity === null || fileIdentity(stage) !== progress.stageIdentity || !readV2RegularFile(stage).equals(Buffer.from(intent.nextBytes, "base64"))) conflict();
  } else if (progress.stageIdentity !== null) conflict();
  guardCopySource(snapshot);
  return snapshot;
}

export function guardV2Create(intent: V2CreateIntent): V2CanonicalSnapshot {
  try { return guardCreate(intent, readProgress(intent)); } catch { return conflict(); }
}

export function applyV2CreateJournal(intent: V2CreateIntent): V2CanonicalSnapshot {
  try {
    const progress = readProgress(intent);
    guardCreate(intent, progress);
    const stage = stagePath(intent);
    if (progress.stageIdentity === null) {
      writeV2DurableFile(stage, Buffer.from(intent.nextBytes, "base64"));
      progress.stageIdentity = fileIdentity(stage);
      syncV2Directory(path.dirname(stage));
      guardCreate(intent, progress);
      saveProgress(intent, progress);
    }
    guardCreate(intent, progress);
    if (!progress.publicationStarted) {
      // Persist before the possible link. A later unexplained absence cannot be guessed to be pre-publication.
      progress.publicationStarted = true;
      saveProgress(intent, progress);
      guardCreate(intent, progress, true);
      linkSync(stage, targetPath(intent));
    }
    // A crash can follow the link but precede its directory flush. Reflush owned publication on recovery.
    syncV2Directory(path.dirname(stage));
    const snapshot = guardCreate(intent, progress);
    progress.published = true;
    saveProgress(intent, progress);
    guardCreate(intent, progress);
    return snapshot;
  } catch { return conflict(); }
}

/** Receipt-proven retirement removes only this operation's private files, never its task. */
export function retireV2Create(intent: V2CreateIntent): void {
  try {
    if (lstatSync(`${progressPath(intent)}.preparing`, { throwIfNoEntry: false })) conflict();
    const progress = lstatSync(progressPath(intent), { throwIfNoEntry: false }) ? readProgress(intent) : undefined;
    const stage = stagePath(intent);
    if (lstatSync(stage, { throwIfNoEntry: false })) {
      if (!progress?.published || fileIdentity(stage) !== progress.stageIdentity || !readV2RegularFile(stage).equals(Buffer.from(intent.nextBytes, "base64"))) conflict();
      unlinkSync(stage);
      syncV2Directory(path.dirname(stage));
    }
    if (progress) { unlinkSync(progressPath(intent)); syncV2Directory(v2LocalDomain(intent.root)); }
    retireV2Pending(intent.root);
  } catch { return conflict(); }
}
