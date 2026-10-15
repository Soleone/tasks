import { linkSync, lstatSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { canonicalJson } from "./canonicalJson.js";
import { CommandError } from "./errors.js";
import { parseCanonicalJson } from "./strictJson.js";
import { readCanonicalRoot, readRegularFile } from "./canonicalReader.js";
import type { CanonicalSnapshot, FileObservation } from "./canonicalReader.js";
import { directoryIdentity, guardCopySource } from "./copyFiles.js";
import { buildCreatedTask, parseCreate } from "./createInputs.js";
import { retirePending, syncDirectory, localDomain, writeDurableFile } from "./localDomain.js";
import { isRecord, parseRequest } from "./protocol.js";
import type { Request } from "./protocol.js";
import { localPathOutsideRoot } from "./queryCache.js";
import type { RootBinding } from "./queryCache.js";
import { validateTask } from "./taskModel.js";
import { exactHash } from "./updateJournal.js";

export type CreateIntent = {
  format: "taskdb.pending-create"; version: 1; root: RootBinding; cachePath: string;
  request: Request; operationId: string; at: string; taskId: string; taskDirectoryIdentity: string;
  nextBytes: string; guards: FileObservation[];
};
type CreateProgress = { operationId: string; stageIdentity: string | null; publicationStarted: boolean; published: boolean };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function conflict(): never { throw new CommandError("RECOVERY_CONFLICT", "capture has missing, divergent or uncertain publication evidence; preserve it for inspection"); }
function stagePath(intent: CreateIntent): string { return path.join(intent.root.rootPath, "tasks", `.syncthing.taskdb-create-${intent.operationId}.tmp`); }
function targetPath(intent: CreateIntent): string { return path.join(intent.root.rootPath, "tasks", `${intent.taskId}.json`); }
function progressPath(intent: CreateIntent): string { return path.join(localDomain(intent.root), `create-${intent.operationId}.progress.json`); }
function fileIdentity(file: string): string {
  const stat = lstatSync(file, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()) conflict();
  return `${stat.dev}:${stat.ino}`;
}

export function parseCreateIntent(value: unknown, root: RootBinding): CreateIntent {
  try {
    if (!isRecord(value)) conflict();
    const intent = value as unknown as CreateIntent;
    if (intent.format !== "taskdb.pending-create" || intent.version !== 1 || intent.root.rootPath !== root.rootPath || intent.root.rootIdentity !== root.rootIdentity
      || !uuid.test(intent.taskId) || !uuid.test(intent.operationId) || !/^\d+:\d+$/.test(intent.taskDirectoryIdentity)) conflict();
    if (!path.isAbsolute(root.rootPath) || !/^\d+:\d+$/.test(root.rootIdentity) || !path.isAbsolute(intent.cachePath)) conflict();
    const request = parseRequest(intent.request);
    if (request.command !== "task.create" || request.readOnly || request.dryRun || !request.writeContext || !request.idempotencyKey) conflict();
    const input = parseCreate(request.args);
    if (typeof intent.nextBytes !== "string" || Buffer.from(intent.nextBytes, "base64").toString("base64") !== intent.nextBytes) conflict();
    const next = validateTask(parseCanonicalJson(Buffer.from(intent.nextBytes, "base64")), intent.taskId);
    if (next.createdAt !== intent.at || next.updatedAt !== intent.at || next.status !== "open" || next.closedAt !== null || next.dependencyIds.length !== 0
      || canonicalJson({ title: next.title, description: next.description, priority: next.priority, category: next.category, tags: next.tags, parentId: next.parentId }) !== canonicalJson(input)) conflict();
    if (!Array.isArray(intent.guards) || !intent.guards.some(file => file.relativePath === "workspace.json") || new Set(intent.guards.map(file => file.relativePath)).size !== intent.guards.length) conflict();
    for (const file of intent.guards) {
      if ((file.relativePath !== "workspace.json" && !/^tasks\/(?:[A-Za-z0-9_-]+|[A-Za-z0-9_-]+\.sync-conflict-[^/\\]+)\.json$/.test(file.relativePath))
        || typeof file.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(file.sha256)
        || (file.relativePath.startsWith("tasks/") && path.basename(file.relativePath).split(".")[0].toLowerCase() === intent.taskId)) conflict();
    }
    localPathOutsideRoot(intent.cachePath, root.rootPath);
    localDomain(root);
    return { ...intent, request };
  } catch { return conflict(); }
}

function readProgress(intent: CreateIntent): CreateProgress {
  const file = progressPath(intent);
  // Even a complete older record cannot authorize a publication whose next progress is unpublished.
  if (lstatSync(`${file}.preparing`, { throwIfNoEntry: false })) conflict();
  if (!lstatSync(file, { throwIfNoEntry: false })) conflict();
  const progress = parseCanonicalJson(readRegularFile(file)) as CreateProgress;
  if (progress.operationId !== intent.operationId || (progress.stageIdentity !== null && !/^\d+:\d+$/.test(progress.stageIdentity)) || typeof progress.publicationStarted !== "boolean"
    || typeof progress.published !== "boolean" || (progress.published && !progress.publicationStarted) || (progress.publicationStarted && progress.stageIdentity === null)) conflict();
  return progress;
}

function saveProgress(intent: CreateIntent, progress: CreateProgress): void {
  const file = progressPath(intent);
  writeDurableFile(`${file}.preparing`, Buffer.from(`${JSON.stringify(progress)}\n`));
  renameSync(`${file}.preparing`, file);
  syncDirectory(localDomain(intent.root));
}

/** Before pending publication, persist the record whose later loss must never look like a fresh capture. */
export function prepareCreateProgress(intent: CreateIntent): void {
  const progress: CreateProgress = { operationId: intent.operationId, stageIdentity: null, publicationStarted: false, published: false };
  writeDurableFile(progressPath(intent), Buffer.from(`${JSON.stringify(progress)}\n`));
  syncDirectory(localDomain(intent.root));
}

function guardCreate(intent: CreateIntent, progress: CreateProgress, startingPublication = false): CanonicalSnapshot {
  const snapshot = readCanonicalRoot(intent.root.rootPath);
  if (snapshot.rootPath !== intent.root.rootPath || snapshot.rootIdentity !== intent.root.rootIdentity
    || directoryIdentity(path.join(intent.root.rootPath, "tasks")) !== intent.taskDirectoryIdentity) conflict();
  const target = `tasks/${intent.taskId}.json`;
  const otherFiles = snapshot.files.filter(file => file.relativePath !== target);
  if (otherFiles.length !== intent.guards.length || intent.guards.some(file => !otherFiles.some(actual => actual.relativePath === file.relativePath && actual.sha256 === file.sha256))) conflict();
  const actual = snapshot.files.find(file => file.relativePath === target);
  if (actual) {
    if (!progress.publicationStarted || actual.sha256 !== exactHash(Buffer.from(intent.nextBytes, "base64")) || fileIdentity(targetPath(intent)) !== progress.stageIdentity) conflict();
  } else if ((progress.publicationStarted && !startingPublication) || progress.published) conflict();
  const expected = buildCreatedTask(parseCreate(intent.request.args), { id: intent.taskId, at: intent.at }, snapshot.tasks.filter(task => task.id !== intent.taskId));
  if (canonicalJson(expected) !== canonicalJson(parseCanonicalJson(Buffer.from(intent.nextBytes, "base64")))) conflict();
  const stage = stagePath(intent);
  if (lstatSync(stage, { throwIfNoEntry: false })) {
    if (progress.stageIdentity === null || fileIdentity(stage) !== progress.stageIdentity || !readRegularFile(stage).equals(Buffer.from(intent.nextBytes, "base64"))) conflict();
  } else if (progress.stageIdentity !== null) conflict();
  guardCopySource(snapshot);
  return snapshot;
}

export function guardCreateIntent(intent: CreateIntent): CanonicalSnapshot {
  try { return guardCreate(intent, readProgress(intent)); } catch { return conflict(); }
}

export function applyCreateJournal(intent: CreateIntent): CanonicalSnapshot {
  try {
    const progress = readProgress(intent);
    guardCreate(intent, progress);
    const stage = stagePath(intent);
    if (progress.stageIdentity === null) {
      writeDurableFile(stage, Buffer.from(intent.nextBytes, "base64"));
      progress.stageIdentity = fileIdentity(stage);
      syncDirectory(path.dirname(stage));
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
    syncDirectory(path.dirname(stage));
    const snapshot = guardCreate(intent, progress);
    progress.published = true;
    saveProgress(intent, progress);
    guardCreate(intent, progress);
    return snapshot;
  } catch { return conflict(); }
}

/** Receipt-proven retirement removes only this operation's private files, never its task. */
export function retireCreate(intent: CreateIntent): void {
  try {
    if (lstatSync(`${progressPath(intent)}.preparing`, { throwIfNoEntry: false })) conflict();
    const progress = lstatSync(progressPath(intent), { throwIfNoEntry: false }) ? readProgress(intent) : undefined;
    const stage = stagePath(intent);
    if (lstatSync(stage, { throwIfNoEntry: false })) {
      if (!progress?.published || fileIdentity(stage) !== progress.stageIdentity || !readRegularFile(stage).equals(Buffer.from(intent.nextBytes, "base64"))) conflict();
      unlinkSync(stage);
      syncDirectory(path.dirname(stage));
    }
    if (progress) { unlinkSync(progressPath(intent)); syncDirectory(localDomain(intent.root)); }
    retirePending(intent.root);
  } catch { return conflict(); }
}
