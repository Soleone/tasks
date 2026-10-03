import { lstatSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { CommandError } from "./errors.js";
import { parseV2CanonicalJson } from "./v2CanonicalJson.js";
import { readV2CanonicalDeletionPrefix, readV2CanonicalRoot, readV2RegularFile } from "./v2CanonicalReader.js";
import type { V2CanonicalSnapshot } from "./v2CanonicalReader.js";
import { directoryIdentity } from "./v2CopyFiles.js";
import { syncV2Directory, v2LocalDomain, writeV2DurableFile } from "./v2LocalDomain.js";
import { assertV2Args, isV2Record, parseV2Request } from "./v2Protocol.js";
import type { V2Request } from "./v2Protocol.js";
import { planV2Purge } from "./v2PurgePlan.js";
import { localPathOutsideV2Root } from "./v2QueryCache.js";
import type { V2RootBinding } from "./v2QueryCache.js";
import { isV2Timestamp, validateV2Graph, validateV2Manifest, validateV2Task } from "./v2TaskModel.js";
import type { V2CanonicalTask } from "./v2TaskModel.js";
import { exactV2Hash } from "./v2UpdateJournal.js";

export type V2PurgeFile = { relativePath: string; beforeBytes: string; identity: string };
export type V2PurgeIntent = { format: "taskdb.pending-purge"; version: 1; root: V2RootBinding; taskDirectoryIdentity: string; cachePath: string; request: V2Request; operationId: string; at: string; purgedIds: string[]; files: V2PurgeFile[] };
function conflict(): never { throw new CommandError("RECOVERY_CONFLICT", "purge has missing, divergent or unproven deletion evidence; preserve it for inspection"); }
export function v2PurgeFileIdentity(filePath: string): string {
  const stat = lstatSync(filePath, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()) conflict();
  return `${stat.dev}:${stat.ino}`;
}
function quarantinePath(intent: V2PurgeIntent, index: number): string {
  return path.join(intent.root.rootPath, "tasks", `.syncthing.taskdb-purge-${intent.operationId}-${index}.tmp`);
}
export function purgeIntentTasks(intent: V2PurgeIntent): V2CanonicalTask[] {
  return intent.files.filter(file => /^tasks\/[A-Za-z0-9_-]+\.json$/.test(file.relativePath)).map(file => validateV2Task(parseV2CanonicalJson(Buffer.from(file.beforeBytes, "base64")), path.basename(file.relativePath, ".json")));
}
export function parseV2PurgeIntent(value: unknown, root: V2RootBinding): V2PurgeIntent {
  try {
    if (!isV2Record(value)) conflict();
    const intent = value as unknown as V2PurgeIntent;
    if (intent.format !== "taskdb.pending-purge" || intent.version !== 1 || intent.root.rootPath !== root.rootPath || intent.root.rootIdentity !== root.rootIdentity
      || !/^\d+:\d+$/.test(intent.taskDirectoryIdentity) || !path.isAbsolute(intent.cachePath) || !isV2Timestamp(intent.at)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(intent.operationId)) conflict();
    const request = parseV2Request(intent.request);
    if (request.command !== "task.purgeCanceled" || request.dryRun || request.readOnly || !request.writeContext || !request.idempotencyKey) conflict();
    assertV2Args(request.args, []);
    if (!Array.isArray(intent.files) || new Set(intent.files.map(file => file.relativePath)).size !== intent.files.length) conflict();
    for (const file of intent.files) {
      if ((file.relativePath !== "workspace.json" && !/^tasks\/(?:[A-Za-z0-9_-]+|[A-Za-z0-9_-]+\.sync-conflict-[^/\\]+)\.json$/.test(file.relativePath))
        || !/^\d+:\d+$/.test(file.identity) || typeof file.beforeBytes !== "string" || Buffer.from(file.beforeBytes, "base64").toString("base64") !== file.beforeBytes) conflict();
    }
    const descriptor = intent.files.find(file => file.relativePath === "workspace.json");
    if (!descriptor) conflict();
    validateV2Manifest(parseV2CanonicalJson(Buffer.from(descriptor.beforeBytes, "base64")));
    const purgedIds = planV2Purge(purgeIntentTasks(intent));
    if (!purgedIds.length || JSON.stringify(purgedIds) !== JSON.stringify(intent.purgedIds)) conflict();
    localPathOutsideV2Root(intent.cachePath, root.rootPath);
    v2LocalDomain(root);
    return { ...intent, request };
  } catch { return conflict(); }
}

export function v2PurgeRecoveryLocation(intent: V2PurgeIntent): string {
  return path.join(v2LocalDomain(intent.root), `purge-${intent.operationId}.recovery.json`);
}
function archiveBytes(intent: V2PurgeIntent): Buffer {
  return Buffer.from(`${JSON.stringify({ format: "taskdb.purge-recovery", version: 1, operationId: intent.operationId, root: intent.root, taskDirectoryIdentity: intent.taskDirectoryIdentity, cachePath: intent.cachePath, request: intent.request, at: intent.at, purgedIds: intent.purgedIds, files: intent.files })}\n`);
}
function verifyArchive(intent: V2PurgeIntent): void {
  if (!readV2RegularFile(v2PurgeRecoveryLocation(intent)).equals(archiveBytes(intent))) conflict();
}
export function persistV2PurgeArchive(intent: V2PurgeIntent): void {
  const location = v2PurgeRecoveryLocation(intent);
  writeV2DurableFile(location, archiveBytes(intent));
  syncV2Directory(path.dirname(location));
  verifyArchive(intent);
}
function verifyQuarantine(intent: V2PurgeIntent, index: number): void {
  const before = intent.files.find(file => file.relativePath === `tasks/${intent.purgedIds[index]}.json`)!;
  const retained = quarantinePath(intent, index);
  if (v2PurgeFileIdentity(retained) !== before.identity || !readV2RegularFile(retained).equals(Buffer.from(before.beforeBytes, "base64"))) conflict();
}

export function guardV2Purge(intent: V2PurgeIntent, recovery: boolean): V2CanonicalSnapshot {
  try {
    const fail = (code: string): never => { throw new CommandError(recovery ? "RECOVERY_CONFLICT" : code, "purge baseline changed"); };
    if (directoryIdentity(path.join(intent.root.rootPath, "tasks")) !== intent.taskDirectoryIdentity
      || readdirSync(intent.root.rootPath).some(name => /^workspace\.sync-conflict-.+\.json$/.test(name))) fail("STALE_SCOPE");
    const originals = purgeIntentTasks(intent), deleted: V2CanonicalTask[] = [];
    for (const [index, id] of intent.purgedIds.entries()) {
      const target = path.join(intent.root.rootPath, "tasks", `${id}.json`);
      const quarantined = lstatSync(quarantinePath(intent, index), { throwIfNoEntry: false });
      const present = lstatSync(target, { throwIfNoEntry: false });
      if (quarantined) { verifyQuarantine(intent, index); if (present || !recovery) conflict(); }
      if (!present) {
        if (!recovery || !quarantined) fail("STALE_SCOPE");
        deleted.push(originals.find(task => task.id === id)!);
      } else if (v2PurgeFileIdentity(target) !== intent.files.find(file => file.relativePath === `tasks/${id}.json`)!.identity) fail("STALE_FILE");
    }
    const snapshot = deleted.length ? readV2CanonicalDeletionPrefix(intent.root.rootPath, deleted) : readV2CanonicalRoot(intent.root.rootPath);
    if (snapshot.rootPath !== intent.root.rootPath || snapshot.rootIdentity !== intent.root.rootIdentity) fail("STALE_SCOPE");
    const actual = new Map(snapshot.files.map(file => [file.relativePath, file.sha256]));
    if ([...actual.keys()].some(name => !intent.files.some(file => file.relativePath === name))) fail("STALE_SCOPE");
    for (const file of intent.files) {
      const hash = actual.get(file.relativePath);
      if (hash === undefined && deleted.some(task => file.relativePath === `tasks/${task.id}.json`)) continue;
      if (hash === undefined) fail("STALE_SCOPE");
      if (hash !== exactV2Hash(Buffer.from(file.beforeBytes, "base64"))) fail("STALE_FILE");
    }
    if (recovery) verifyArchive(intent);
    return snapshot;
  } catch (error) { if (recovery) return conflict(); throw error; }
}

export function applyV2PurgeJournal(intent: V2PurgeIntent): V2CanonicalSnapshot {
  for (const [index, id] of intent.purgedIds.entries()) {
    const snapshot = guardV2Purge(intent, true);
    if (!snapshot.tasks.some(task => task.id === id)) continue;
    const target = path.join(intent.root.rootPath, "tasks", `${id}.json`);
    // Retaining the original inode proves our atomic absence, unlike a pre-unlink marker.
    renameSync(target, quarantinePath(intent, index));
    syncV2Directory(path.dirname(target));
  }
  const verified = guardV2Purge(intent, true);
  validateV2Graph(verified.tasks);
  if (verified.tasks.some(task => intent.purgedIds.includes(task.id))) conflict();
  return verified;
}
export function retireV2PurgeQuarantines(intent: V2PurgeIntent): void {
  try {
    verifyArchive(intent);
    const remaining = intent.purgedIds.map((_, index) => index).filter(index => lstatSync(quarantinePath(intent, index), { throwIfNoEntry: false }));
    for (const index of remaining) verifyQuarantine(intent, index);
    for (const index of remaining) {
      unlinkSync(quarantinePath(intent, index));
      syncV2Directory(path.join(intent.root.rootPath, "tasks"));
    }
  } catch { return conflict(); }
}
