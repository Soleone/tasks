import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { CommandError } from "./errors.js";
import { parseCanonicalJson } from "./strictJson.js";
import { readCanonicalRoot, readRegularFile, readRootDescriptor } from "./canonicalReader.js";
import type { CanonicalSnapshot } from "./canonicalReader.js";
import { directoryIdentity, guardCopyDestination, guardCopySource, verifyCopyStage } from "./copyFiles.js";
import type { CopyDestination } from "./copyFiles.js";
import { pendingIntentPath, persistPending, retirePending, syncDirectory, localDomain, withRootWriterLock, writeDurableFile } from "./localDomain.js";
import { assertArgs, isRecord, parseRequest } from "./protocol.js";
import type { Request } from "./protocol.js";
import { localPathOutsideRoot } from "./queryCache.js";
import type { RootBinding } from "./queryCache.js";
import { validateGraph, validateManifest, validateTask } from "./taskModel.js";
import { exactHash } from "./updateJournal.js";
import { guardMigrationSource, migrationCompletion, parseMigrationEvidence, persistMigrationRecovery, verifyMigrationRecovery } from "../migration/journal.js";
import type { MigrationEvidence } from "../migration/journal.js";

export type CopyFile = { relativePath: string; sha256: string; bytes: string };
export type CopyIntent = {
  format: "taskdb.pending-copy"; version: 1; root: RootBinding; source: RootBinding;
  cachePath: string; request: Request; operationId: string;
  destination: CopyDestination; stageDirectory: string; files: CopyFile[]; migration?: MigrationEvidence;
};
type CopyProgress = { operationId: string; stageIdentity: string; tasksIdentity: string; written: string[] };

function conflict(): never { throw new CommandError("RECOVERY_CONFLICT", "copy has missing, divergent or invalid evidence"); }

export function parseCopyArgs(request: Request): { sourceDirectory?: string; destinationDirectory: string } {
  assertArgs(request.args, request.command === "workspace.restore" ? ["sourceDirectory", "destinationDirectory"] : ["destinationDirectory"]);
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
    if (file.relativePath === "workspace.json") { validateManifest(parseCanonicalJson(Buffer.from(file.bytes, "base64"))); continue; }
    if (!/^[A-Za-z0-9_-]+\.sync-conflict-.+\.json$/.test(path.basename(file.relativePath))) {
      tasks.push(validateTask(parseCanonicalJson(Buffer.from(file.bytes, "base64")), path.basename(file.relativePath, ".json")));
    }
  }
  validateGraph(tasks);
}

export function parseCopyIntent(value: unknown, root: RootBinding): CopyIntent {
  try {
    if (!isRecord(value)) conflict();
    const intent = value as unknown as CopyIntent;
    if (intent.format !== "taskdb.pending-copy" || intent.version !== 1 || intent.root.rootPath !== root.rootPath || intent.root.rootIdentity !== root.rootIdentity
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(intent.operationId)) conflict();
    for (const binding of [intent.root, intent.source]) if (!path.isAbsolute(binding.rootPath) || typeof binding.rootIdentity !== "string" || !/^\d+:\d+$/.test(binding.rootIdentity)) conflict();
    const request = parseRequest(intent.request);
    if (!["workspace.archive", "workspace.restore", "workspace.migrate"].includes(request.command) || request.readOnly || request.dryRun || !request.writeContext || !request.idempotencyKey) conflict();
    parseCopyArgs(request);
    if (request.command !== "workspace.restore" && (intent.source.rootPath !== root.rootPath || intent.source.rootIdentity !== root.rootIdentity)) conflict();
    if (!path.isAbsolute(intent.cachePath) || !path.isAbsolute(intent.destination.directory) || !/^\d+:\d+$/.test(intent.destination.parentIdentity)
      || (intent.destination.identity !== null && !/^\d+:\d+$/.test(intent.destination.identity))) conflict();
    const stage = path.join(path.dirname(intent.destination.directory), `.${path.basename(intent.destination.directory)}.taskdb-copy-${intent.operationId}.stage`);
    if (intent.stageDirectory !== stage || !Array.isArray(intent.files) || !intent.files.some(file => file.relativePath === "workspace.json")
      || new Set(intent.files.map(file => file.relativePath)).size !== intent.files.length) conflict();
    for (const file of intent.files) {
      if (file.relativePath !== "workspace.json" && !/^tasks\/(?:[A-Za-z0-9_-]+|[A-Za-z0-9_-]+\.sync-conflict-.+)\.json$/.test(file.relativePath)) conflict();
      if (file.relativePath.includes("\\") || file.relativePath.split("/").length > 2 || typeof file.bytes !== "string"
        || Buffer.from(file.bytes, "base64").toString("base64") !== file.bytes || file.sha256 !== exactHash(Buffer.from(file.bytes, "base64"))) conflict();
    }
    validateCopyFiles(intent.files);
    if (request.command === "workspace.migrate") parseMigrationEvidence(intent.migration, root, intent.files);
    else if (intent.migration !== undefined) conflict();
    for (const binding of [root, intent.source]) {
      localPathOutsideRoot(intent.destination.directory, binding.rootPath);
      localPathOutsideRoot(binding.rootPath, intent.destination.directory);
      localPathOutsideRoot(stage, binding.rootPath);
      localPathOutsideRoot(intent.cachePath, binding.rootPath);
      localPathOutsideRoot(localDomain(root), binding.rootPath);
    }
    localPathOutsideRoot(intent.cachePath, intent.destination.directory);
    localPathOutsideRoot(localDomain(root), intent.destination.directory);
    return { ...intent, request };
  } catch { return conflict(); }
}

function evidencePaths(intent: CopyIntent) {
  const domain = localDomain(intent.root);
  return { progress: path.join(domain, `copy-${intent.operationId}.progress.json`), verified: path.join(domain, `copy-${intent.operationId}.verified.json`) };
}

function readCopyProgress(intent: CopyIntent): CopyProgress | undefined {
  const file = evidencePaths(intent).progress;
  if (existsSync(`${file}.preparing`)) conflict();
  if (!existsSync(file)) return undefined;
  try {
    const progress = parseCanonicalJson(readRegularFile(file)) as CopyProgress;
    if (progress.operationId !== intent.operationId || !/^\d+:\d+$/.test(progress.stageIdentity) || !/^\d+:\d+$/.test(progress.tasksIdentity)
      || !Array.isArray(progress.written) || progress.written.length > orderedCopyFiles(intent).length
      || progress.written.some((name, index) => name !== orderedCopyFiles(intent)[index].relativePath)) conflict();
    return progress;
  } catch { return conflict(); }
}

function persistCopyProgress(intent: CopyIntent, progress: CopyProgress): void {
  const file = evidencePaths(intent).progress;
  writeDurableFile(`${file}.preparing`, Buffer.from(`${JSON.stringify(progress)}\n`));
  renameSync(`${file}.preparing`, file);
  syncDirectory(path.dirname(file));
}

function orderedCopyFiles(intent: CopyIntent): CopyFile[] {
  return [...intent.files.filter(file => file.relativePath !== "workspace.json"), ...intent.files.filter(file => file.relativePath === "workspace.json")];
}

function guardPartialStage(intent: CopyIntent, progress: CopyProgress): string[] {
  if (directoryIdentity(intent.stageDirectory) !== progress.stageIdentity || directoryIdentity(path.join(intent.stageDirectory, "tasks")) !== progress.tasksIdentity) conflict();
  const names = readdirSync(intent.stageDirectory).filter(name => name !== "tasks");
  names.push(...readdirSync(path.join(intent.stageDirectory, "tasks")).map(name => `tasks/${name}`));
  const actual = new Set(names);
  const next = orderedCopyFiles(intent)[progress.written.length];
  const allowed = [...progress.written, ...(next && actual.has(next.relativePath) ? [next.relativePath] : [])];
  if (actual.size !== allowed.length || allowed.some(name => !actual.has(name))) conflict();
  for (const name of allowed) {
    const file = intent.files.find(file => file.relativePath === name)!;
    if (exactHash(readRegularFile(path.join(intent.stageDirectory, name))) !== file.sha256) conflict();
  }
  return allowed;
}

function guardSource(intent: CopyIntent): CanonicalSnapshot {
  if (intent.migration) return guardMigrationSource(intent);
  if (readRootDescriptor(intent.root.rootPath).rootIdentity !== intent.root.rootIdentity) conflict();
  const source = readCanonicalRoot(intent.source.rootPath);
  if (source.rootIdentity !== intent.source.rootIdentity || JSON.stringify(source.files) !== JSON.stringify(intent.files.map(({ relativePath, sha256 }) => ({ relativePath, sha256 })))) conflict();
  guardCopySource(source);
  return source;
}

function verifyPublishedCopy(intent: CopyIntent, progress: CopyProgress): CanonicalSnapshot {
  if (intent.migration) verifyMigrationRecovery(intent);
  if (progress.written.length !== intent.files.length || !readRegularFile(evidencePaths(intent).verified).equals(verifiedCopyBytes(intent, progress))) conflict();
  if (existsSync(intent.stageDirectory) || directoryIdentity(intent.destination.directory) !== progress.stageIdentity
    || directoryIdentity(path.join(intent.destination.directory, "tasks")) !== progress.tasksIdentity) conflict();
  const source = guardSource(intent);
  verifyCopyStage(source, intent.destination.directory);
  syncDirectory(path.dirname(intent.destination.directory));
  return source;
}

function verifiedCopyBytes(intent: CopyIntent, progress: CopyProgress): Buffer {
  return Buffer.from(`${JSON.stringify({ operationId: intent.operationId, stageIdentity: progress.stageIdentity, files: intent.files.map(({ relativePath, sha256 }) => ({ relativePath, sha256 })), ...(intent.migration ? { completion: migrationCompletion(intent) } : {}) })}\n`);
}

function copyTarget(intent: CopyIntent, progress: CopyProgress) {
  return { format: "taskdb.pending-copy-target", version: 1, root: { rootPath: intent.destination.directory, rootIdentity: progress.stageIdentity }, owner: intent.root, operationId: intent.operationId };
}

function reserveCopyTarget(intent: CopyIntent, progress: CopyProgress): void {
  const target = copyTarget(intent, progress);
  const file = pendingIntentPath(target.root);
  if (existsSync(file)) {
    if (!readRegularFile(file).equals(Buffer.from(`${JSON.stringify(target)}\n`))) conflict();
  } else persistPending(target.root, target);
}

function recordVerifiedCopy(intent: CopyIntent, progress: CopyProgress): void {
  const file = evidencePaths(intent).verified;
  const bytes = verifiedCopyBytes(intent, progress);
  if (existsSync(file)) { if (!readRegularFile(file).equals(bytes)) conflict(); }
  else writeDurableFile(file, bytes);
  syncDirectory(path.dirname(file));
}

/** Only exact durable prefixes may resume; unknown directories/partial documents are preserved for inspection. */
export function applyCopyJournal(intent: CopyIntent): Record<string, unknown> {
  try {
    let progress = readCopyProgress(intent);
    if (progress && !existsSync(intent.stageDirectory)) {
      const target = copyTarget(intent, progress);
      if (!readRegularFile(pendingIntentPath(target.root)).equals(Buffer.from(`${JSON.stringify(target)}\n`))) conflict();
      const source = withRootWriterLock(target.root, () => verifyPublishedCopy(intent, progress!));
      return { destinationDirectory: intent.destination.directory, taskCount: source.tasks.length, changed: true, operationId: intent.operationId, ...(intent.migration ? migrationCompletion(intent) : {}) };
    }
    guardSource(intent);
    guardCopyDestination(intent.source.rootPath, intent.destination);
    if (intent.migration) {
      if (progress) verifyMigrationRecovery(intent);
      else persistMigrationRecovery(intent);
    }
    if (!progress) {
      if (existsSync(intent.stageDirectory)) conflict();
      mkdirSync(intent.stageDirectory, { mode: 0o700 });
      syncDirectory(path.dirname(intent.stageDirectory));
      mkdirSync(path.join(intent.stageDirectory, "tasks"), { mode: 0o700 });
      syncDirectory(intent.stageDirectory);
      progress = { operationId: intent.operationId, stageIdentity: directoryIdentity(intent.stageDirectory), tasksIdentity: directoryIdentity(path.join(intent.stageDirectory, "tasks")), written: [] };
      persistCopyProgress(intent, progress);
    }
    const written = guardPartialStage(intent, progress);
    for (const file of orderedCopyFiles(intent)) {
      guardSource(intent);
      guardCopyDestination(intent.source.rootPath, intent.destination);
      guardPartialStage(intent, progress);
      if (progress.written.includes(file.relativePath)) continue;
      if (!written.includes(file.relativePath)) writeDurableFile(path.join(intent.stageDirectory, file.relativePath), Buffer.from(file.bytes, "base64"));
      syncDirectory(path.dirname(path.join(intent.stageDirectory, file.relativePath)));
      progress.written.push(file.relativePath);
      persistCopyProgress(intent, progress);
    }
    const source = guardSource(intent);
    verifyCopyStage(source, intent.stageDirectory);
    recordVerifiedCopy(intent, progress);
    // Lock the future physical root before it becomes selectable, including across different selected caches.
    return withRootWriterLock({ rootPath: intent.destination.directory, rootIdentity: progress.stageIdentity }, () => {
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

export function retireCopy(intent: CopyIntent): void {
  const progress = readCopyProgress(intent);
  if (progress) {
    const target = copyTarget(intent, progress);
    const file = pendingIntentPath(target.root);
    if (existsSync(file)) {
      if (!readRegularFile(file).equals(Buffer.from(`${JSON.stringify(target)}\n`))) conflict();
      withRootWriterLock(target.root, () => retirePending(target.root));
    }
  }
  for (const file of Object.values(evidencePaths(intent))) {
    if (lstatSync(file, { throwIfNoEntry: false })) unlinkSync(file);
  }
  syncDirectory(localDomain(intent.root));
  retirePending(intent.root);
}
