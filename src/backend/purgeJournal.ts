import { lstatSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { CommandError } from "./errors.js";
import { parseCanonicalJson } from "./strictJson.js";
import { readCanonicalDeletionPrefix, readCanonicalRoot, readRegularFile } from "./canonicalReader.js";
import type { CanonicalSnapshot } from "./canonicalReader.js";
import { directoryIdentity } from "./copyFiles.js";
import { syncDirectory, localDomain, writeDurableFile } from "./localDomain.js";
import { assertArgs, isRecord, parseRequest } from "./protocol.js";
import type { Request } from "./protocol.js";
import { planPurge } from "./purgePlan.js";
import { localPathOutsideRoot } from "./queryCache.js";
import type { RootBinding } from "./queryCache.js";
import { isTimestamp, validateGraph, validateManifest, validateTask } from "./taskModel.js";
import type { CanonicalTask } from "./taskModel.js";
import { exactHash } from "./updateJournal.js";

export type PurgeFile = { relativePath: string; beforeBytes: string; identity: string };
export type PurgeIntent = { format: "taskdb.pending-purge"; version: 1; root: RootBinding; taskDirectoryIdentity: string; cachePath: string; request: Request; operationId: string; at: string; purgedIds: string[]; files: PurgeFile[] };
function conflict(): never { throw new CommandError("RECOVERY_CONFLICT", "purge has missing, divergent or unproven deletion evidence; preserve it for inspection"); }
export function purgeFileIdentity(filePath: string): string {
  const stat = lstatSync(filePath, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()) conflict();
  return `${stat.dev}:${stat.ino}`;
}
function quarantinePath(intent: PurgeIntent, index: number): string {
  return path.join(intent.root.rootPath, "tasks", `.syncthing.taskdb-purge-${intent.operationId}-${index}.tmp`);
}
export function purgeIntentTasks(intent: PurgeIntent): CanonicalTask[] {
  return intent.files.filter(file => /^tasks\/[A-Za-z0-9_-]+\.json$/.test(file.relativePath)).map(file => validateTask(parseCanonicalJson(Buffer.from(file.beforeBytes, "base64")), path.basename(file.relativePath, ".json")));
}
export function parsePurgeIntent(value: unknown, root: RootBinding): PurgeIntent {
  try {
    if (!isRecord(value)) conflict();
    const intent = value as unknown as PurgeIntent;
    if (intent.format !== "taskdb.pending-purge" || intent.version !== 1 || intent.root.rootPath !== root.rootPath || intent.root.rootIdentity !== root.rootIdentity
      || !/^\d+:\d+$/.test(intent.taskDirectoryIdentity) || !path.isAbsolute(intent.cachePath) || !isTimestamp(intent.at)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(intent.operationId)) conflict();
    const request = parseRequest(intent.request);
    if (request.command !== "task.purgeCanceled" || request.dryRun || request.readOnly || !request.writeContext || !request.idempotencyKey) conflict();
    assertArgs(request.args, []);
    if (!Array.isArray(intent.files) || new Set(intent.files.map(file => file.relativePath)).size !== intent.files.length) conflict();
    for (const file of intent.files) {
      if ((file.relativePath !== "workspace.json" && !/^tasks\/(?:[A-Za-z0-9_-]+|[A-Za-z0-9_-]+\.sync-conflict-[^/\\]+)\.json$/.test(file.relativePath))
        || !/^\d+:\d+$/.test(file.identity) || typeof file.beforeBytes !== "string" || Buffer.from(file.beforeBytes, "base64").toString("base64") !== file.beforeBytes) conflict();
    }
    const descriptor = intent.files.find(file => file.relativePath === "workspace.json");
    if (!descriptor) conflict();
    validateManifest(parseCanonicalJson(Buffer.from(descriptor.beforeBytes, "base64")));
    const purgedIds = planPurge(purgeIntentTasks(intent));
    if (!purgedIds.length || JSON.stringify(purgedIds) !== JSON.stringify(intent.purgedIds)) conflict();
    localPathOutsideRoot(intent.cachePath, root.rootPath);
    localDomain(root);
    return { ...intent, request };
  } catch { return conflict(); }
}

export function purgeRecoveryLocation(intent: PurgeIntent): string {
  return path.join(localDomain(intent.root), `purge-${intent.operationId}.recovery.json`);
}
function archiveBytes(intent: PurgeIntent): Buffer {
  return Buffer.from(`${JSON.stringify({ format: "taskdb.purge-recovery", version: 1, operationId: intent.operationId, root: intent.root, taskDirectoryIdentity: intent.taskDirectoryIdentity, cachePath: intent.cachePath, request: intent.request, at: intent.at, purgedIds: intent.purgedIds, files: intent.files })}\n`);
}
function verifyArchive(intent: PurgeIntent): void {
  if (!readRegularFile(purgeRecoveryLocation(intent)).equals(archiveBytes(intent))) conflict();
}
export function persistPurgeArchive(intent: PurgeIntent): void {
  const location = purgeRecoveryLocation(intent);
  writeDurableFile(location, archiveBytes(intent));
  syncDirectory(path.dirname(location));
  verifyArchive(intent);
}
function verifyQuarantine(intent: PurgeIntent, index: number): void {
  const before = intent.files.find(file => file.relativePath === `tasks/${intent.purgedIds[index]}.json`)!;
  const retained = quarantinePath(intent, index);
  if (purgeFileIdentity(retained) !== before.identity || !readRegularFile(retained).equals(Buffer.from(before.beforeBytes, "base64"))) conflict();
}

export function guardPurge(intent: PurgeIntent, recovery: boolean): CanonicalSnapshot {
  try {
    const fail = (code: string): never => { throw new CommandError(recovery ? "RECOVERY_CONFLICT" : code, "purge baseline changed"); };
    if (directoryIdentity(path.join(intent.root.rootPath, "tasks")) !== intent.taskDirectoryIdentity
      || readdirSync(intent.root.rootPath).some(name => /^workspace\.sync-conflict-.+\.json$/.test(name))) fail("STALE_SCOPE");
    const originals = purgeIntentTasks(intent), deleted: CanonicalTask[] = [];
    for (const [index, id] of intent.purgedIds.entries()) {
      const target = path.join(intent.root.rootPath, "tasks", `${id}.json`);
      const quarantined = lstatSync(quarantinePath(intent, index), { throwIfNoEntry: false });
      const present = lstatSync(target, { throwIfNoEntry: false });
      if (quarantined) { verifyQuarantine(intent, index); if (present || !recovery) conflict(); }
      if (!present) {
        if (!recovery || !quarantined) fail("STALE_SCOPE");
        deleted.push(originals.find(task => task.id === id)!);
      } else if (purgeFileIdentity(target) !== intent.files.find(file => file.relativePath === `tasks/${id}.json`)!.identity) fail("STALE_FILE");
    }
    const snapshot = deleted.length ? readCanonicalDeletionPrefix(intent.root.rootPath, deleted) : readCanonicalRoot(intent.root.rootPath);
    if (snapshot.rootPath !== intent.root.rootPath || snapshot.rootIdentity !== intent.root.rootIdentity) fail("STALE_SCOPE");
    const actual = new Map(snapshot.files.map(file => [file.relativePath, file.sha256]));
    if ([...actual.keys()].some(name => !intent.files.some(file => file.relativePath === name))) fail("STALE_SCOPE");
    for (const file of intent.files) {
      const hash = actual.get(file.relativePath);
      if (hash === undefined && deleted.some(task => file.relativePath === `tasks/${task.id}.json`)) continue;
      if (hash === undefined) fail("STALE_SCOPE");
      if (hash !== exactHash(Buffer.from(file.beforeBytes, "base64"))) fail("STALE_FILE");
    }
    if (recovery) verifyArchive(intent);
    return snapshot;
  } catch (error) { if (recovery) return conflict(); throw error; }
}

export function applyPurgeJournal(intent: PurgeIntent): CanonicalSnapshot {
  for (const [index, id] of intent.purgedIds.entries()) {
    const snapshot = guardPurge(intent, true);
    if (!snapshot.tasks.some(task => task.id === id)) continue;
    const target = path.join(intent.root.rootPath, "tasks", `${id}.json`);
    // Retaining the original inode proves our atomic absence, unlike a pre-unlink marker.
    renameSync(target, quarantinePath(intent, index));
    syncDirectory(path.dirname(target));
  }
  const verified = guardPurge(intent, true);
  validateGraph(verified.tasks);
  if (verified.tasks.some(task => intent.purgedIds.includes(task.id))) conflict();
  return verified;
}
export function retirePurgeQuarantines(intent: PurgeIntent): void {
  try {
    verifyArchive(intent);
    const remaining = intent.purgedIds.map((_, index) => index).filter(index => lstatSync(quarantinePath(intent, index), { throwIfNoEntry: false }));
    for (const index of remaining) verifyQuarantine(intent, index);
    for (const index of remaining) {
      unlinkSync(quarantinePath(intent, index));
      syncDirectory(path.join(intent.root.rootPath, "tasks"));
    }
  } catch { return conflict(); }
}
