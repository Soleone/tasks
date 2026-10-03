import { linkSync, lstatSync, mkdirSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { CommandError } from "./errors.js";
import { parseV2CanonicalJson } from "./v2CanonicalJson.js";
import { readV2CanonicalRoot, readV2PhysicalRoot, readV2RegularFile } from "./v2CanonicalReader.js";
import { retireV2Pending, syncV2Directory, v2LocalDomain, writeV2DurableFile } from "./v2LocalDomain.js";
import { assertV2Args, isV2Record, parseV2Request } from "./v2Protocol.js";
import type { V2Request } from "./v2Protocol.js";
import { localPathOutsideV2Root } from "./v2QueryCache.js";
import type { V2RootBinding } from "./v2QueryCache.js";
import { exactV2Hash } from "./v2UpdateJournal.js";

export const V2_INIT_DESCRIPTOR = '{"schemaVersion":2}\n';
type InitMarker = { name: string; identity: string; kind: "file" | "directory"; sha256?: string };
export type V2InitBaseline = { markers: InitMarker[]; tasksIdentity: string | null };
export type V2InitIntent = {
  format: "taskdb.pending-init"; version: 1; root: V2RootBinding; cachePath: string;
  request: V2Request; operationId: string; baseline: V2InitBaseline;
};
type InitProgress = { operationId: string; tasksIdentity: string; manifestIdentity: string | null; published: boolean };
const markerNames = new Set([".stfolder", ".stignore", ".stversions"]);
const physicalIdentity = /^\d+:\d+$/;

function conflict(): never { throw new CommandError("RECOVERY_CONFLICT", "initialization has missing, divergent or unbound evidence; preserve it for inspection"); }

function entryIdentity(file: string, kind: "file" | "directory"): string {
  const stat = lstatSync(file, { bigint: true });
  if (stat.isSymbolicLink() || (kind === "file" ? !stat.isFile() : !stat.isDirectory())) conflict();
  return `${stat.dev}:${stat.ino}`;
}

function observeMarkers(root: V2RootBinding, additionalNames: string[]): InitMarker[] {
  const physical = readV2PhysicalRoot(root.rootPath);
  if (physical.rootPath !== root.rootPath || physical.rootIdentity !== root.rootIdentity) conflict();
  const markers: InitMarker[] = [];
  for (const name of readdirSync(root.rootPath).sort()) {
    if (name === "tasks" || additionalNames.includes(name)) continue;
    if (!markerNames.has(name)) throw new CommandError("INVALID_CANONICAL", "initialization requires an uninitialized empty root, with only physical transport markers");
    const file = path.join(root.rootPath, name);
    const stat = lstatSync(file);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || (name === ".stignore" && !stat.isFile()) || (name === ".stversions" && !stat.isDirectory())) conflict();
    const kind = stat.isFile() ? "file" : "directory";
    const identity = entryIdentity(file, kind);
    const sha256 = kind === "file" ? exactV2Hash(readV2RegularFile(file)) : undefined;
    if (entryIdentity(file, kind) !== identity) conflict();
    markers.push({ name, identity, kind, ...(sha256 ? { sha256 } : {}) });
  }
  return markers;
}

function emptyTasksIdentity(root: V2RootBinding): string | null {
  const directory = path.join(root.rootPath, "tasks");
  if (lstatSync(directory, { throwIfNoEntry: false }) === undefined) return null;
  const identity = entryIdentity(directory, "directory");
  if (readdirSync(directory).length !== 0) throw new CommandError("INVALID_CANONICAL", "initialization refuses existing records or partial transfers");
  if (entryIdentity(directory, "directory") !== identity) conflict();
  return identity;
}

export function inspectV2InitRoot(root: V2RootBinding): V2InitBaseline {
  const markers = observeMarkers(root, []);
  const tasksIdentity = emptyTasksIdentity(root);
  const baseline = { markers, tasksIdentity };
  if (JSON.stringify(observeMarkers(root, [])) !== JSON.stringify(markers) || emptyTasksIdentity(root) !== tasksIdentity) conflict();
  return baseline;
}

export function parseV2InitIntent(value: unknown, root: V2RootBinding): V2InitIntent {
  try {
    if (!isV2Record(value)) conflict();
    const intent = value as unknown as V2InitIntent;
    if (intent.format !== "taskdb.pending-init" || intent.version !== 1 || intent.root.rootPath !== root.rootPath || intent.root.rootIdentity !== root.rootIdentity
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(intent.operationId)) conflict();
    if (!path.isAbsolute(root.rootPath) || !physicalIdentity.test(root.rootIdentity) || !path.isAbsolute(intent.cachePath)) conflict();
    const request = parseV2Request(intent.request);
    assertV2Args(request.args, []);
    if (request.command !== "workspace.init" || request.readOnly || request.dryRun || !request.writeContext || !request.idempotencyKey) conflict();
    if (!Array.isArray(intent.baseline.markers) || (intent.baseline.tasksIdentity !== null && !physicalIdentity.test(intent.baseline.tasksIdentity))) conflict();
    const names = intent.baseline.markers.map(marker => marker.name);
    if (new Set(names).size !== names.length || JSON.stringify(names) !== JSON.stringify([...names].sort())) conflict();
    for (const marker of intent.baseline.markers) {
      if (!markerNames.has(marker.name) || !physicalIdentity.test(marker.identity) || !["file", "directory"].includes(marker.kind)
        || (marker.name === ".stignore" && marker.kind !== "file") || (marker.name === ".stversions" && marker.kind !== "directory")
        || (marker.kind === "file" ? typeof marker.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(marker.sha256) : marker.sha256 !== undefined)) conflict();
    }
    localPathOutsideV2Root(intent.cachePath, root.rootPath);
    v2LocalDomain(root);
    return { ...intent, request };
  } catch { return conflict(); }
}

function progressPath(intent: V2InitIntent): string { return path.join(v2LocalDomain(intent.root), `init-${intent.operationId}.progress.json`); }
function stagePath(intent: V2InitIntent): string { return path.join(intent.root.rootPath, `.syncthing.taskdb-init-${intent.operationId}.tmp`); }

function readProgress(intent: V2InitIntent): InitProgress | undefined {
  const file = progressPath(intent);
  if (lstatSync(file, { throwIfNoEntry: false }) === undefined) {
    if (lstatSync(`${file}.preparing`, { throwIfNoEntry: false })) conflict();
    return undefined;
  }
  const progress = parseV2CanonicalJson(readV2RegularFile(file)) as InitProgress;
  if (progress.operationId !== intent.operationId || !physicalIdentity.test(progress.tasksIdentity)
    || (progress.manifestIdentity !== null && !physicalIdentity.test(progress.manifestIdentity)) || typeof progress.published !== "boolean"
    || (progress.published && progress.manifestIdentity === null)
    || (intent.baseline.tasksIdentity !== null && progress.tasksIdentity !== intent.baseline.tasksIdentity)) conflict();
  return progress;
}

function saveProgress(intent: V2InitIntent, progress: InitProgress): void {
  const file = progressPath(intent);
  writeV2DurableFile(`${file}.preparing`, Buffer.from(`${JSON.stringify(progress)}\n`));
  renameSync(`${file}.preparing`, file);
  syncV2Directory(v2LocalDomain(intent.root));
}

function guardInit(intent: V2InitIntent, progress?: InitProgress): void {
  const stage = stagePath(intent);
  const markers = observeMarkers(intent.root, [path.basename(stage), "workspace.json"]);
  if (JSON.stringify(markers) !== JSON.stringify(intent.baseline.markers)) conflict();
  if (emptyTasksIdentity(intent.root) !== (progress?.tasksIdentity ?? intent.baseline.tasksIdentity)) conflict();
  const manifest = path.join(intent.root.rootPath, "workspace.json");
  if (lstatSync(manifest, { throwIfNoEntry: false })) {
    if (!progress?.manifestIdentity || entryIdentity(manifest, "file") !== progress.manifestIdentity
      || readV2RegularFile(manifest).toString("utf8") !== V2_INIT_DESCRIPTOR) conflict();
  } else if (progress?.published) conflict();
  if (lstatSync(stage, { throwIfNoEntry: false })) {
    if (progress?.manifestIdentity && entryIdentity(stage, "file") !== progress.manifestIdentity) conflict();
    if (!readV2RegularFile(stage).equals(Buffer.from(V2_INIT_DESCRIPTOR))) conflict();
  } else if (progress?.manifestIdentity) conflict();
}

export function applyV2InitJournal(intent: V2InitIntent) {
  try {
    let progress = readProgress(intent);
    guardInit(intent, progress);
    if (!progress) {
      const tasks = path.join(intent.root.rootPath, "tasks");
      if (intent.baseline.tasksIdentity === null) {
        mkdirSync(tasks, { mode: 0o700 });
        syncV2Directory(tasks);
        syncV2Directory(intent.root.rootPath);
      }
      progress = { operationId: intent.operationId, tasksIdentity: entryIdentity(tasks, "directory"), manifestIdentity: null, published: false };
      saveProgress(intent, progress);
    }
    guardInit(intent, progress);
    const stage = stagePath(intent);
    if (!progress.manifestIdentity) {
      // Only the next exact complete file at the fixed private name can survive write-before-progress.
      if (!lstatSync(stage, { throwIfNoEntry: false })) writeV2DurableFile(stage, Buffer.from(V2_INIT_DESCRIPTOR));
      syncV2Directory(intent.root.rootPath);
      guardInit(intent, progress);
      progress.manifestIdentity = entryIdentity(stage, "file");
      saveProgress(intent, progress);
    }
    guardInit(intent, progress);
    const manifest = path.join(intent.root.rootPath, "workspace.json");
    if (!lstatSync(manifest, { throwIfNoEntry: false })) {
      // Same-directory hard link publishes atomically without replacing an arriving descriptor.
      linkSync(stage, manifest);
      syncV2Directory(intent.root.rootPath);
    }
    guardInit(intent, progress);
    progress.published = true;
    saveProgress(intent, progress);
    const snapshot = readV2CanonicalRoot(intent.root.rootPath);
    guardInit(intent, progress);
    if (snapshot.rootIdentity !== intent.root.rootIdentity || snapshot.tasks.length !== 0) conflict();
    return snapshot;
  } catch { return conflict(); }
}

/** Called only after a durable original/recovery receipt; never modifies canonical files. */
export function retireV2Init(intent: V2InitIntent): void {
  try {
    const stage = stagePath(intent);
    const progress = readProgress(intent);
    if (lstatSync(stage, { throwIfNoEntry: false })) {
      if (!progress?.published || entryIdentity(stage, "file") !== progress.manifestIdentity || !readV2RegularFile(stage).equals(Buffer.from(V2_INIT_DESCRIPTOR))) conflict();
      unlinkSync(stage);
      syncV2Directory(intent.root.rootPath);
    }
    if (progress) {
      unlinkSync(progressPath(intent));
      syncV2Directory(v2LocalDomain(intent.root));
    }
    if (lstatSync(`${progressPath(intent)}.preparing`, { throwIfNoEntry: false })) conflict();
    retireV2Pending(intent.root);
  } catch { return conflict(); }
}
