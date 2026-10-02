import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { CommandError } from "./errors.js";
import { readV2CanonicalRoot, readV2RegularFile, readV2RootDescriptor } from "./v2CanonicalReader.js";
import type { V2CanonicalSnapshot, V2FileObservation } from "./v2CanonicalReader.js";
import { syncV2Directory, v2LocalDomain, withV2RootWriterLock, writeV2DurableFile } from "./v2LocalDomain.js";
import { exactV2Hash, readV2Pending } from "./v2UpdateJournal.js";

type CopyDestination = { directory: string; parentIdentity: string; identity: string | null };
export type V2CopyStageReport = {
  operationId: string;
  state: "verified_stage";
  sourceDirectory: string;
  destinationDirectory: string;
  stageDirectory: string;
  taskCount: number;
  conflictCount: number;
  files: V2FileObservation[];
  intentPath: string;
  completionPath: string;
};

function directoryIdentity(directory: string): string {
  const stat = lstatSync(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new CommandError("INVALID_ARGUMENT", "copy requires an authorized physical directory");
  return `${stat.dev}:${stat.ino}`;
}

function containsDirectory(parent: string, directory: string): boolean {
  const relative = path.relative(parent, directory);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function inspectCopyDestination(sourceDirectory: string, destinationDirectory: string): CopyDestination {
  if (destinationDirectory.trim() === "") throw new CommandError("INVALID_ARGUMENT", "destinationDirectory must be explicit");
  const selected = path.resolve(destinationDirectory);
  const entry = lstatSync(selected, { throwIfNoEntry: false });
  if (!entry && lstatSync(path.dirname(selected), { throwIfNoEntry: false }) === undefined) {
    throw new CommandError("INVALID_ARGUMENT", "copy destination parent must already exist");
  }
  // The parent must already exist; this primitive never authorizes implicit ancestor creation.
  const directory = entry ? realpathSync(selected) : path.join(realpathSync(path.dirname(selected)), path.basename(selected));
  if (containsDirectory(sourceDirectory, directory) || containsDirectory(directory, sourceDirectory)) {
    throw new CommandError("INVALID_ARGUMENT", "source and destination must be disjoint");
  }
  const parentIdentity = directoryIdentity(path.dirname(directory));
  if (!entry) return { directory, parentIdentity, identity: null };
  const stat = lstatSync(directory, { bigint: true });
  if (!stat.isDirectory() || readdirSync(directory).length !== 0) {
    throw new CommandError("DESTINATION_NOT_EMPTY", "copy destination must be absent or explicitly empty");
  }
  return { directory, parentIdentity, identity: directoryIdentity(directory) };
}

function guardCopyDestination(sourceDirectory: string, expected: CopyDestination): void {
  const current = inspectCopyDestination(sourceDirectory, expected.directory);
  if (current.directory !== expected.directory || current.identity !== expected.identity || current.parentIdentity !== expected.parentIdentity) {
    throw new CommandError("STALE_SCOPE", "copy destination binding changed");
  }
}

function guardCopySource(expected: V2CanonicalSnapshot): void {
  if (readdirSync(expected.rootPath).some(name => /^workspace\.sync-conflict-.+\.json$/.test(name))) {
    throw new CommandError("INVALID_CANONICAL", "descriptor conflict copies require explicit inspection before staging");
  }
  const current = readV2CanonicalRoot(expected.rootPath);
  if (current.rootIdentity !== expected.rootIdentity || current.files.length !== expected.files.length
    || current.files.some((file, index) => file.relativePath !== expected.files[index].relativePath)) {
    throw new CommandError("STALE_SCOPE", "copy source membership or binding changed");
  }
  if (current.files.some((file, index) => file.sha256 !== expected.files[index].sha256)) {
    throw new CommandError("STALE_FILE", "copy source bytes changed");
  }
}

function verifyCopyStage(source: V2CanonicalSnapshot, stageDirectory: string): void {
  const taskNames = source.files.filter(file => file.relativePath.startsWith("tasks/")).map(file => path.basename(file.relativePath)).sort();
  if (JSON.stringify(readdirSync(stageDirectory).sort()) !== JSON.stringify(["tasks", "workspace.json"])
    || JSON.stringify(readdirSync(path.join(stageDirectory, "tasks")).sort()) !== JSON.stringify(taskNames)) {
    throw new CommandError("RECOVERY_CONFLICT", "staged copy has unexpected or missing entries");
  }
  const staged = readV2CanonicalRoot(stageDirectory);
  if (JSON.stringify(staged.files) !== JSON.stringify(source.files)
    || JSON.stringify(staged.tasks) !== JSON.stringify(source.tasks)
    || JSON.stringify(staged.conflictFiles) !== JSON.stringify(source.conflictFiles)) {
    throw new CommandError("RECOVERY_CONFLICT", "staged copy differs from its verified source");
  }
}

/** Builds a verified, private stage only. No publication, selection switch, receipts or automatic recovery. */
export function stageV2CanonicalCopy(sourceDirectory: string, destinationDirectory: string): V2CopyStageReport {
  if (process.platform !== "linux") throw new CommandError("UNSUPPORTED_COMMAND", "canonical copy staging requires the tested Linux filesystem boundary");
  const root = readV2RootDescriptor(sourceDirectory);
  return withV2RootWriterLock(root, () => {
    if (readV2Pending(root)) throw new CommandError("RECOVERY_PENDING", "unfinished source update must be reconciled before copying");
    const source = readV2CanonicalRoot(root.rootPath);
    if (source.rootIdentity !== root.rootIdentity) throw new CommandError("STALE_SCOPE", "physical source changed before copying");
    const destination = inspectCopyDestination(source.rootPath, destinationDirectory);
    const operationId = randomUUID();
    const stageDirectory = path.join(path.dirname(destination.directory), `.${path.basename(destination.directory)}.taskdb-copy-${operationId}.stage`);
    const intentPath = path.join(v2LocalDomain(root), `copy-stage-${operationId}.intent.json`);
    const completionPath = path.join(v2LocalDomain(root), `copy-stage-${operationId}.verified.json`);
    const report: V2CopyStageReport = {
      operationId, state: "verified_stage", sourceDirectory: source.rootPath, destinationDirectory: destination.directory,
      stageDirectory, taskCount: source.tasks.length, conflictCount: source.conflictFiles.length,
      files: source.files, intentPath, completionPath,
    };
    guardCopySource(source);
    guardCopyDestination(source.rootPath, destination);
    syncV2Directory(path.dirname(destination.directory));
    writeV2DurableFile(intentPath, Buffer.from(`${JSON.stringify({
      format: "taskdb.canonical-copy-stage", version: 1, operationId, source: root,
      destination, stageDirectory, files: source.files, taskCount: source.tasks.length, conflictCount: source.conflictFiles.length,
    })}\n`));
    syncV2Directory(path.dirname(intentPath));
    guardCopySource(source);
    guardCopyDestination(source.rootPath, destination);
    mkdirSync(stageDirectory, { mode: 0o700 });
    syncV2Directory(path.dirname(stageDirectory));
    mkdirSync(path.join(stageDirectory, "tasks"), { mode: 0o700 });
    syncV2Directory(stageDirectory);
    const stageIdentity = directoryIdentity(stageDirectory);
    const taskDirectoryIdentity = directoryIdentity(path.join(stageDirectory, "tasks"));
    // The descriptor is last, so earlier file prefixes cannot appear to be a complete schema-2 root.
    const files = [...source.files.filter(file => file.relativePath !== "workspace.json"), ...source.files.filter(file => file.relativePath === "workspace.json")];
    for (const file of files) {
      if (directoryIdentity(stageDirectory) !== stageIdentity || directoryIdentity(path.join(stageDirectory, "tasks")) !== taskDirectoryIdentity) {
        throw new CommandError("STALE_SCOPE", "private stage binding changed");
      }
      const bytes = readV2RegularFile(path.join(source.rootPath, file.relativePath));
      if (exactV2Hash(bytes) !== file.sha256) throw new CommandError("STALE_FILE", "source changed before its staged copy");
      writeV2DurableFile(path.join(stageDirectory, file.relativePath), bytes);
      syncV2Directory(path.dirname(path.join(stageDirectory, file.relativePath)));
    }
    if (directoryIdentity(stageDirectory) !== stageIdentity || directoryIdentity(path.join(stageDirectory, "tasks")) !== taskDirectoryIdentity) {
      throw new CommandError("STALE_SCOPE", "private stage binding changed");
    }
    verifyCopyStage(source, stageDirectory);
    guardCopySource(source);
    guardCopyDestination(source.rootPath, destination);
    writeV2DurableFile(completionPath, Buffer.from(`${JSON.stringify(report)}\n`));
    syncV2Directory(path.dirname(completionPath));
    // Retained evidence belongs to this private backup stage, not a successful-request receipt ledger.
    return report;
  });
}
