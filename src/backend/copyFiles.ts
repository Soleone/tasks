import { lstatSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { CommandError } from "./errors.js";
import { readCanonicalRoot } from "./canonicalReader.js";
import type { CanonicalSnapshot } from "./canonicalReader.js";

export type CopyDestination = { directory: string; parentIdentity: string; identity: string | null };

export function directoryIdentity(directory: string): string {
  const stat = lstatSync(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new CommandError("INVALID_ARGUMENT", "copy requires an authorized physical directory");
  return `${stat.dev}:${stat.ino}`;
}

function containsDirectory(parent: string, directory: string): boolean {
  const relative = path.relative(parent, directory);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function inspectCopyDestination(sourceDirectory: string, destinationDirectory: string): CopyDestination {
  if (destinationDirectory.trim() === "") throw new CommandError("INVALID_ARGUMENT", "destinationDirectory must be explicit");
  const selected = path.resolve(destinationDirectory);
  const entry = lstatSync(selected, { throwIfNoEntry: false });
  if (!entry && lstatSync(path.dirname(selected), { throwIfNoEntry: false }) === undefined) {
    throw new CommandError("INVALID_ARGUMENT", "copy destination parent must already exist");
  }
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

export function guardCopyDestination(sourceDirectory: string, expected: CopyDestination): void {
  const current = inspectCopyDestination(sourceDirectory, expected.directory);
  if (current.directory !== expected.directory || current.identity !== expected.identity || current.parentIdentity !== expected.parentIdentity) {
    throw new CommandError("STALE_SCOPE", "copy destination binding changed");
  }
}

export function guardCopySource(expected: CanonicalSnapshot): void {
  if (readdirSync(expected.rootPath).some(name => /^workspace\.sync-conflict-.+\.json$/.test(name))) {
    throw new CommandError("INVALID_CANONICAL", "descriptor conflict copies require explicit inspection before staging");
  }
  const current = readCanonicalRoot(expected.rootPath);
  if (current.rootIdentity !== expected.rootIdentity || current.files.length !== expected.files.length
    || current.files.some((file, index) => file.relativePath !== expected.files[index].relativePath)) {
    throw new CommandError("STALE_SCOPE", "copy source membership or binding changed");
  }
  if (current.files.some((file, index) => file.sha256 !== expected.files[index].sha256)) {
    throw new CommandError("STALE_FILE", "copy source bytes changed");
  }
}

export function verifyCopyStage(source: CanonicalSnapshot, stageDirectory: string): void {
  const taskNames = source.files.filter(file => file.relativePath.startsWith("tasks/")).map(file => path.basename(file.relativePath)).sort();
  if (JSON.stringify(readdirSync(stageDirectory).sort()) !== JSON.stringify(["tasks", "workspace.json"])
    || JSON.stringify(readdirSync(path.join(stageDirectory, "tasks")).sort()) !== JSON.stringify(taskNames)) {
    throw new CommandError("RECOVERY_CONFLICT", "staged copy has unexpected or missing entries");
  }
  const staged = readCanonicalRoot(stageDirectory);
  if (JSON.stringify(staged.files) !== JSON.stringify(source.files)
    || JSON.stringify(staged.tasks) !== JSON.stringify(source.tasks)
    || JSON.stringify(staged.conflictFiles) !== JSON.stringify(source.conflictFiles)) {
    throw new CommandError("RECOVERY_CONFLICT", "staged copy differs from its verified source");
  }
}
