import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { CommandError } from "./errors.js";
import { parseV2CanonicalJson } from "./v2CanonicalJson.js";
import { compareV2Tasks, validateV2Graph, validateV2Manifest, validateV2Task } from "./v2TaskModel.js";
import type { V2CanonicalTask } from "./v2TaskModel.js";

export type V2FileObservation = { relativePath: string; sha256: string };
export type V2CanonicalSnapshot = {
  rootPath: string;
  tasks: V2CanonicalTask[];
  files: V2FileObservation[];
  conflictFiles: V2FileObservation[];
};

function invalidEntry(): never {
  throw new CommandError("INVALID_CANONICAL", "v2 canonical tree has a missing, unexpected or escaping entry");
}

function directoryIdentity(directory: string): string {
  const stat = lstatSync(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) invalidEntry();
  return `${stat.dev}:${stat.ino}`;
}

function regularFileBytes(filePath: string): Buffer {
  const observed = lstatSync(filePath, { bigint: true });
  if (!observed.isFile()) invalidEntry();
  const descriptor = openSync(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile()) invalidEntry();
    if (opened.dev !== observed.dev || opened.ino !== observed.ino) {
      throw new CommandError("STALE_FILE", "canonical file changed before opening");
    }
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function exactHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function observeRoot(rootPath: string): V2CanonicalSnapshot {
  const rootIdentity = directoryIdentity(rootPath);
  const manifestPath = path.join(rootPath, "workspace.json");
  const taskDirectory = path.join(rootPath, "tasks");
  if (!existsSync(manifestPath)) invalidEntry();
  const manifestBytes = regularFileBytes(manifestPath);
  validateV2Manifest(parseV2CanonicalJson(manifestBytes));
  if (!existsSync(taskDirectory)) invalidEntry();
  const taskIdentity = directoryIdentity(taskDirectory);
  const orderDirectory = path.join(rootPath, "order");
  if (existsSync(orderDirectory)) {
    directoryIdentity(orderDirectory);
    if (readdirSync(orderDirectory).length > 0) invalidEntry();
  }
  const files = [{ relativePath: "workspace.json", sha256: exactHash(manifestBytes) }];
  const conflictFiles: V2FileObservation[] = [];
  const tasks: V2CanonicalTask[] = [];
  const names = readdirSync(taskDirectory).sort();
  for (const name of names) {
    // Syncthing transfer temporaries are not published task documents.
    if (name.startsWith(".syncthing.") && name.endsWith(".tmp")) continue;
    const conflict = /^[A-Za-z0-9_-]+\.sync-conflict-.+\.json$/.test(name);
    if (!conflict && !/^[A-Za-z0-9_-]+\.json$/.test(name)) invalidEntry();
    const bytes = regularFileBytes(path.join(taskDirectory, name));
    const observation = { relativePath: `tasks/${name}`, sha256: exactHash(bytes) };
    files.push(observation);
    if (conflict) { conflictFiles.push(observation); continue; }
    tasks.push(validateV2Task(parseV2CanonicalJson(bytes), name.slice(0, -5)));
  }
  validateV2Graph(tasks);
  if (directoryIdentity(rootPath) !== rootIdentity || directoryIdentity(taskDirectory) !== taskIdentity
    || JSON.stringify(readdirSync(taskDirectory).sort()) !== JSON.stringify(names)) {
    throw new CommandError("STALE_SCOPE", "canonical tree changed during observation");
  }
  for (const observation of files) {
    if (exactHash(regularFileBytes(path.join(rootPath, observation.relativePath))) !== observation.sha256) {
      throw new CommandError("STALE_FILE", "canonical bytes changed during observation");
    }
  }
  tasks.sort((left, right) => {
    const leftParent = left.parentId ?? "";
    const rightParent = right.parentId ?? "";
    return leftParent === rightParent ? compareV2Tasks(left, right) : leftParent < rightParent ? -1 : 1;
  });
  return { rootPath, tasks, files, conflictFiles };
}

/** Read-only Node observation, not an API projection, writer lock, journal or distributed snapshot. */
export function readV2CanonicalRoot(directory: string): V2CanonicalSnapshot {
  try {
    return observeRoot(realpathSync(directory));
  } catch (error) {
    if (error instanceof CommandError) throw error;
    throw new CommandError("INVALID_STORAGE", "v2 canonical root could not be read completely");
  }
}
