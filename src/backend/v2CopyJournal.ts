import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { CommandError } from "./errors.js";
import { parseV2CanonicalJson } from "./v2CanonicalJson.js";
import { readV2CanonicalRoot, readV2RegularFile, readV2RootDescriptor } from "./v2CanonicalReader.js";
import type { V2CanonicalSnapshot } from "./v2CanonicalReader.js";
import { directoryIdentity, guardCopyDestination, guardCopySource, verifyCopyStage } from "./v2CopyFiles.js";
import type { CopyDestination } from "./v2CopyFiles.js";
import { pendingV2Path, persistV2Pending, retireV2Pending, syncV2Directory, v2LocalDomain, withV2RootWriterLock, writeV2DurableFile } from "./v2LocalDomain.js";
import { assertV2Args, isV2Record, parseV2Request } from "./v2Protocol.js";
import type { V2Request } from "./v2Protocol.js";
import { localPathOutsideV2Root } from "./v2QueryCache.js";
import type { V2RootBinding } from "./v2QueryCache.js";
import { validateV2Graph, validateV2Manifest, validateV2Task } from "./v2TaskModel.js";
import { exactV2Hash } from "./v2UpdateJournal.js";
import { guardV2MigrationSource, migrationCompletion, parseV2MigrationEvidence, persistV2MigrationRecovery, verifyV2MigrationRecovery } from "./v2MigrationJournal.js";
import type { V2MigrationEvidence } from "./v2MigrationJournal.js";

export type CopyFile = { relativePath: string; sha256: string; bytes: string };
export type V2CopyIntent = {
  format: "taskdb.pending-copy"; version: 1; root: V2RootBinding; source: V2RootBinding;
  cachePath: string; request: V2Request; operationId: string;
  destination: CopyDestination; stageDirectory: string; files: CopyFile[]; migration?: V2MigrationEvidence;
};
type CopyProgress = { operationId: string; stageIdentity: string; tasksIdentity: string; written: string[] };

function conflict(): never { throw new CommandError("RECOVERY_CONFLICT", "copy has missing, divergent or invalid evidence"); }

export function parseV2CopyArgs(request: V2Request): { sourceDirectory?: string; destinationDirectory: string } {
  assertV2Args(request.args, request.command === "workspace.restore" ? ["sourceDirectory", "destinationDirectory"] : ["destinationDirectory"]);
  const destination = request.args.destinationDirectory;
  const source = request.args.sourceDirectory;
  if (typeof destination !== "string" || destination.trim() === "" || (request.command === "workspace.restore" && (typeof source !== "string" || source.trim() === ""))) {
    throw new CommandError("INVALID_ARGUMENT", "copy requires explicit directory arguments");
  }
  return { destinationDirectory: destination, ...(typeof source === "string" ? { sourceDirectory: source } : {}) };
}

function validateCopyFiles(files: CopyFile[]): void {
  const tasks = [];
  for (const file of files) {
    if (file.relativePath === "workspace.json") { validateV2Manifest(parseV2CanonicalJson(Buffer.from(file.bytes, "base64"))); continue; }
    if (!/^[A-Za-z0-9_-]+\.sync-conflict-.+\.json$/.test(path.basename(file.relativePath))) {
      tasks.push(validateV2Task(parseV2CanonicalJson(Buffer.from(file.bytes, "base64")), path.basename(file.relativePath, ".json")));
    }
  }
  validateV2Graph(tasks);
}

export function parseV2CopyIntent(value: unknown, root: V2RootBinding): V2CopyIntent {
  try {
    if (!isV2Record(value)) conflict();
    const intent = value as unknown as V2CopyIntent;
    if (intent.format !== "taskdb.pending-copy" || intent.version !== 1 || intent.root.rootPath !== root.rootPath || intent.root.rootIdentity !== root.rootIdentity
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(intent.operationId)) conflict();
    for (const binding of [intent.root, intent.source]) if (!path.isAbsolute(binding.rootPath) || typeof binding.rootIdentity !== "string" || !/^\d+:\d+$/.test(binding.rootIdentity)) conflict();
    const request = parseV2Request(intent.request);
    if (!["workspace.archive", "workspace.restore", "workspace.migrateV1"].includes(request.command) || request.readOnly || request.dryRun || !request.writeContext || !request.idempotencyKey) conflict();
    parseV2CopyArgs(request);
    if (request.command !== "workspace.restore" && (intent.source.rootPath !== root.rootPath || intent.source.rootIdentity !== root.rootIdentity)) conflict();
    if (!path.isAbsolute(intent.cachePath) || !path.isAbsolute(intent.destination.directory) || !/^\d+:\d+$/.test(intent.destination.parentIdentity)
      || (intent.destination.identity !== null && !/^\d+:\d+$/.test(intent.destination.identity))) conflict();
    const stage = path.join(path.dirname(intent.destination.directory), `.${path.basename(intent.destination.directory)}.taskdb-copy-${intent.operationId}.stage`);
    if (intent.stageDirectory !== stage || !Array.isArray(intent.files) || !intent.files.some(file => file.relativePath === "workspace.json")
      || new Set(intent.files.map(file => file.relativePath)).size !== intent.files.length) conflict();
    for (const file of intent.files) {
      if (file.relativePath !== "workspace.json" && !/^tasks\/(?:[A-Za-z0-9_-]+|[A-Za-z0-9_-]+\.sync-conflict-.+)\.json$/.test(file.relativePath)) conflict();
      if (file.relativePath.includes("\\") || file.relativePath.split("/").length > 2 || typeof file.bytes !== "string"
        || Buffer.from(file.bytes, "base64").toString("base64") !== file.bytes || file.sha256 !== exactV2Hash(Buffer.from(file.bytes, "base64"))) conflict();
    }
    validateCopyFiles(intent.files);
    if (request.command === "workspace.migrateV1") parseV2MigrationEvidence(intent.migration, root, intent.files);
    else if (intent.migration !== undefined) conflict();
    for (const binding of [root, intent.source]) {
      localPathOutsideV2Root(intent.destination.directory, binding.rootPath);
      localPathOutsideV2Root(binding.rootPath, intent.destination.directory);
      localPathOutsideV2Root(stage, binding.rootPath);
      localPathOutsideV2Root(intent.cachePath, binding.rootPath);
      localPathOutsideV2Root(v2LocalDomain(root), binding.rootPath);
    }
    localPathOutsideV2Root(intent.cachePath, intent.destination.directory);
    localPathOutsideV2Root(v2LocalDomain(root), intent.destination.directory);
    return { ...intent, request };
  } catch { return conflict(); }
}

function evidencePaths(intent: V2CopyIntent) {
  const domain = v2LocalDomain(intent.root);
  return { progress: path.join(domain, `copy-${intent.operationId}.progress.json`), verified: path.join(domain, `copy-${intent.operationId}.verified.json`) };
}

function readCopyProgress(intent: V2CopyIntent): CopyProgress | undefined {
  const file = evidencePaths(intent).progress;
  if (existsSync(`${file}.preparing`)) conflict();
  if (!existsSync(file)) return undefined;
  try {
    const progress = parseV2CanonicalJson(readV2RegularFile(file)) as CopyProgress;
    if (progress.operationId !== intent.operationId || !/^\d+:\d+$/.test(progress.stageIdentity) || !/^\d+:\d+$/.test(progress.tasksIdentity)
      || !Array.isArray(progress.written) || progress.written.length > orderedCopyFiles(intent).length
      || progress.written.some((name, index) => name !== orderedCopyFiles(intent)[index].relativePath)) conflict();
    return progress;
  } catch { return conflict(); }
}

function persistCopyProgress(intent: V2CopyIntent, progress: CopyProgress): void {
  const file = evidencePaths(intent).progress;
  writeV2DurableFile(`${file}.preparing`, Buffer.from(`${JSON.stringify(progress)}\n`));
  renameSync(`${file}.preparing`, file);
  syncV2Directory(path.dirname(file));
}

function orderedCopyFiles(intent: V2CopyIntent): CopyFile[] {
  return [...intent.files.filter(file => file.relativePath !== "workspace.json"), ...intent.files.filter(file => file.relativePath === "workspace.json")];
}

function guardPartialStage(intent: V2CopyIntent, progress: CopyProgress): string[] {
  if (directoryIdentity(intent.stageDirectory) !== progress.stageIdentity || directoryIdentity(path.join(intent.stageDirectory, "tasks")) !== progress.tasksIdentity) conflict();
  const names = readdirSync(intent.stageDirectory).filter(name => name !== "tasks");
  names.push(...readdirSync(path.join(intent.stageDirectory, "tasks")).map(name => `tasks/${name}`));
  const actual = new Set(names);
  const next = orderedCopyFiles(intent)[progress.written.length];
  const allowed = [...progress.written, ...(next && actual.has(next.relativePath) ? [next.relativePath] : [])];
  if (actual.size !== allowed.length || allowed.some(name => !actual.has(name))) conflict();
  for (const name of allowed) {
    const file = intent.files.find(file => file.relativePath === name)!;
    if (exactV2Hash(readV2RegularFile(path.join(intent.stageDirectory, name))) !== file.sha256) conflict();
  }
  return allowed;
}

function guardSource(intent: V2CopyIntent): V2CanonicalSnapshot {
  if (intent.migration) return guardV2MigrationSource(intent);
  if (readV2RootDescriptor(intent.root.rootPath).rootIdentity !== intent.root.rootIdentity) conflict();
  const source = readV2CanonicalRoot(intent.source.rootPath);
  if (source.rootIdentity !== intent.source.rootIdentity || JSON.stringify(source.files) !== JSON.stringify(intent.files.map(({ relativePath, sha256 }) => ({ relativePath, sha256 })))) conflict();
  guardCopySource(source);
  return source;
}

function verifyPublishedCopy(intent: V2CopyIntent, progress: CopyProgress): V2CanonicalSnapshot {
  if (intent.migration) verifyV2MigrationRecovery(intent);
  if (progress.written.length !== intent.files.length || !readV2RegularFile(evidencePaths(intent).verified).equals(verifiedCopyBytes(intent, progress))) conflict();
  if (existsSync(intent.stageDirectory) || directoryIdentity(intent.destination.directory) !== progress.stageIdentity
    || directoryIdentity(path.join(intent.destination.directory, "tasks")) !== progress.tasksIdentity) conflict();
  const source = guardSource(intent);
  verifyCopyStage(source, intent.destination.directory);
  syncV2Directory(path.dirname(intent.destination.directory));
  return source;
}

function verifiedCopyBytes(intent: V2CopyIntent, progress: CopyProgress): Buffer {
  return Buffer.from(`${JSON.stringify({ operationId: intent.operationId, stageIdentity: progress.stageIdentity, files: intent.files.map(({ relativePath, sha256 }) => ({ relativePath, sha256 })), ...(intent.migration ? { completion: migrationCompletion(intent) } : {}) })}\n`);
}

function copyTarget(intent: V2CopyIntent, progress: CopyProgress) {
  return { format: "taskdb.pending-copy-target", version: 1, root: { rootPath: intent.destination.directory, rootIdentity: progress.stageIdentity }, owner: intent.root, operationId: intent.operationId };
}

function reserveCopyTarget(intent: V2CopyIntent, progress: CopyProgress): void {
  const target = copyTarget(intent, progress);
  const file = pendingV2Path(target.root);
  if (existsSync(file)) {
    if (!readV2RegularFile(file).equals(Buffer.from(`${JSON.stringify(target)}\n`))) conflict();
  } else persistV2Pending(target.root, target);
}

function recordVerifiedCopy(intent: V2CopyIntent, progress: CopyProgress): void {
  const file = evidencePaths(intent).verified;
  const bytes = verifiedCopyBytes(intent, progress);
  if (existsSync(file)) { if (!readV2RegularFile(file).equals(bytes)) conflict(); }
  else writeV2DurableFile(file, bytes);
  syncV2Directory(path.dirname(file));
}

/** Only exact durable prefixes may resume; unknown directories/partial documents are preserved for inspection. */
export function applyV2CopyJournal(intent: V2CopyIntent): Record<string, unknown> {
  try {
    let progress = readCopyProgress(intent);
    if (progress && !existsSync(intent.stageDirectory)) {
      const target = copyTarget(intent, progress);
      if (!readV2RegularFile(pendingV2Path(target.root)).equals(Buffer.from(`${JSON.stringify(target)}\n`))) conflict();
      const source = withV2RootWriterLock(target.root, () => verifyPublishedCopy(intent, progress!));
      return { destinationDirectory: intent.destination.directory, taskCount: source.tasks.length, changed: true, operationId: intent.operationId, ...(intent.migration ? migrationCompletion(intent) : {}) };
    }
    guardSource(intent);
    guardCopyDestination(intent.source.rootPath, intent.destination);
    if (intent.migration) {
      if (progress) verifyV2MigrationRecovery(intent);
      else persistV2MigrationRecovery(intent);
    }
    if (!progress) {
      if (existsSync(intent.stageDirectory)) conflict();
      mkdirSync(intent.stageDirectory, { mode: 0o700 });
      syncV2Directory(path.dirname(intent.stageDirectory));
      mkdirSync(path.join(intent.stageDirectory, "tasks"), { mode: 0o700 });
      syncV2Directory(intent.stageDirectory);
      progress = { operationId: intent.operationId, stageIdentity: directoryIdentity(intent.stageDirectory), tasksIdentity: directoryIdentity(path.join(intent.stageDirectory, "tasks")), written: [] };
      persistCopyProgress(intent, progress);
    }
    const written = guardPartialStage(intent, progress);
    for (const file of orderedCopyFiles(intent)) {
      guardSource(intent);
      guardCopyDestination(intent.source.rootPath, intent.destination);
      guardPartialStage(intent, progress);
      if (progress.written.includes(file.relativePath)) continue;
      if (!written.includes(file.relativePath)) writeV2DurableFile(path.join(intent.stageDirectory, file.relativePath), Buffer.from(file.bytes, "base64"));
      syncV2Directory(path.dirname(path.join(intent.stageDirectory, file.relativePath)));
      progress.written.push(file.relativePath);
      persistCopyProgress(intent, progress);
    }
    const source = guardSource(intent);
    verifyCopyStage(source, intent.stageDirectory);
    recordVerifiedCopy(intent, progress);
    // Lock the future physical root before it becomes selectable, including across different selected caches.
    return withV2RootWriterLock({ rootPath: intent.destination.directory, rootIdentity: progress.stageIdentity }, () => {
      guardSource(intent);
      guardCopyDestination(intent.source.rootPath, intent.destination);
      guardPartialStage(intent, progress!);
      reserveCopyTarget(intent, progress!);
      renameSync(intent.stageDirectory, intent.destination.directory);
      const verified = verifyPublishedCopy(intent, progress!);
      return { destinationDirectory: intent.destination.directory, taskCount: verified.tasks.length, changed: true, operationId: intent.operationId, ...(intent.migration ? migrationCompletion(intent) : {}) };
    });
  } catch (error) {
    if (error instanceof CommandError && error.code === "MIGRATION_CONFLICT") throw error;
    return conflict();
  }
}

export function retireV2Copy(intent: V2CopyIntent): void {
  const progress = readCopyProgress(intent);
  if (progress) {
    const target = copyTarget(intent, progress);
    const file = pendingV2Path(target.root);
    if (existsSync(file)) {
      if (!readV2RegularFile(file).equals(Buffer.from(`${JSON.stringify(target)}\n`))) conflict();
      withV2RootWriterLock(target.root, () => retireV2Pending(target.root));
    }
  }
  for (const file of Object.values(evidencePaths(intent))) {
    if (lstatSync(file, { throwIfNoEntry: false })) unlinkSync(file);
  }
  syncV2Directory(v2LocalDomain(intent.root));
  retireV2Pending(intent.root);
}
