import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { CommandError } from "./errors.js";
import { parseCanonicalJson } from "./strictJson.js";
import { compareTasks, validateGraph, validateManifest, validateTask } from "./taskModel.js";
import type { CanonicalTask } from "./taskModel.js";

export type FileObservation = { relativePath: string; sha256: string };
export type CanonicalSnapshot = {
  rootPath: string;
  rootIdentity: string;
  tasks: CanonicalTask[];
  files: FileObservation[];
  conflictFiles: FileObservation[];
};

function invalidEntry(): never {
  throw new CommandError(
    "INVALID_CANONICAL",
    "canonical tree has a missing, unexpected or escaping entry",
  );
}

function directoryIdentity(directory: string): string {
  const stat = lstatSync(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) invalidEntry();
  return `${stat.dev}:${stat.ino}`;
}

export function readRegularFile(filePath: string): Buffer {
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

function observeRoot(
  rootPath: string,
  deletedTasks: readonly CanonicalTask[] = [],
): CanonicalSnapshot {
  const rootIdentity = directoryIdentity(rootPath);
  const manifestPath = path.join(rootPath, "workspace.json");
  const taskDirectory = path.join(rootPath, "tasks");
  if (!existsSync(manifestPath)) invalidEntry();
  const manifestBytes = readRegularFile(manifestPath);
  validateManifest(parseCanonicalJson(manifestBytes));
  if (!existsSync(taskDirectory)) invalidEntry();
  const taskIdentity = directoryIdentity(taskDirectory);
  const orderDirectory = path.join(rootPath, "order");
  if (existsSync(orderDirectory)) {
    directoryIdentity(orderDirectory);
    if (readdirSync(orderDirectory).length > 0) invalidEntry();
  }
  const files = [{ relativePath: "workspace.json", sha256: exactHash(manifestBytes) }];
  const conflictFiles: FileObservation[] = [];
  const tasks: CanonicalTask[] = [];
  const names = readdirSync(taskDirectory).sort();
  for (const name of names) {
    // Syncthing transfer temporaries are not published task documents.
    if (name.startsWith(".syncthing.") && name.endsWith(".tmp")) continue;
    const conflict = /^[A-Za-z0-9_-]+\.sync-conflict-.+\.json$/.test(name);
    if (!conflict && !/^[A-Za-z0-9_-]+\.json$/.test(name)) invalidEntry();
    const bytes = readRegularFile(path.join(taskDirectory, name));
    const observation = { relativePath: `tasks/${name}`, sha256: exactHash(bytes) };
    files.push(observation);
    if (conflict) {
      conflictFiles.push(observation);
      continue;
    }
    tasks.push(validateTask(parseCanonicalJson(bytes), name.slice(0, -5)));
  }
  if (deletedTasks.some((deleted) => tasks.some((task) => task.id === deleted.id))) invalidEntry();
  validateGraph([...tasks, ...deletedTasks]);
  if (
    directoryIdentity(rootPath) !== rootIdentity ||
    directoryIdentity(taskDirectory) !== taskIdentity ||
    JSON.stringify(readdirSync(taskDirectory).sort()) !== JSON.stringify(names)
  ) {
    throw new CommandError("STALE_SCOPE", "canonical tree changed during observation");
  }
  for (const observation of files) {
    if (
      exactHash(readRegularFile(path.join(rootPath, observation.relativePath))) !==
      observation.sha256
    ) {
      throw new CommandError("STALE_FILE", "canonical bytes changed during observation");
    }
  }
  tasks.sort((left, right) => {
    const leftParent = left.parentId ?? "";
    const rightParent = right.parentId ?? "";
    return leftParent === rightParent
      ? compareTasks(left, right)
      : leftParent < rightParent
        ? -1
        : 1;
  });
  return { rootPath, rootIdentity, tasks, files, conflictFiles };
}

/** Only purge recovery calls this after proving each absent preimage's bound quarantine. */
export function readCanonicalDeletionPrefix(
  directory: string,
  deletedTasks: readonly CanonicalTask[],
): CanonicalSnapshot {
  try {
    return observeRoot(
      realpathSync(directory),
      deletedTasks.map((task) => validateTask(task, task.id)),
    );
  } catch (error) {
    if (error instanceof CommandError) throw error;
    throw new CommandError("INVALID_STORAGE", "deletion prefix could not be read completely");
  }
}

/** Resolve an explicitly selected existing directory, without assuming or creating a schema. */
export function readPhysicalRoot(directory: string): { rootPath: string; rootIdentity: string } {
  const rootPath = realpathSync(directory);
  return { rootPath, rootIdentity: directoryIdentity(rootPath) };
}

export function readRootDescriptor(directory: string): { rootPath: string; rootIdentity: string } {
  const root = readPhysicalRoot(directory);
  validateManifest(parseCanonicalJson(readRegularFile(path.join(root.rootPath, "workspace.json"))));
  return root;
}

// Syncthing never syncs `.syncthing.*.tmp`, so a stage left by a crash stays on this device.
export const INIT_STAGE = ".syncthing.taskdb-init.tmp";
const transportMarkers = new Set([".stfolder", ".stignore", ".stversions"]);

function notInitRoot(message: string): never {
  throw new CommandError("INVALID_CANONICAL", message);
}

/**
 * Accepts only an empty root: Syncthing's own markers, an empty `tasks` folder and the stage of
 * an interrupted init, so retrying after a crash just runs init again.
 */
export function assertInitRoot(rootPath: string): void {
  for (const name of readdirSync(rootPath)) {
    const stat = lstatSync(path.join(rootPath, name));
    if (name === "tasks") {
      if (!stat.isDirectory() || readdirSync(path.join(rootPath, name)).length !== 0)
        notInitRoot("initialization refuses existing records or partial transfers");
    } else if (name === INIT_STAGE) {
      if (!stat.isFile()) notInitRoot("initialization found an unexpected stage");
    } else if (
      !transportMarkers.has(name) ||
      stat.isSymbolicLink() ||
      (name === ".stignore" ? !stat.isFile() : !stat.isDirectory() && !stat.isFile()) ||
      (name === ".stversions" && !stat.isDirectory())
    )
      notInitRoot(
        "initialization requires an uninitialized empty root, with only physical transport markers",
      );
  }
}

export type RootInspection = {
  rootPath: string;
  rootIdentity: string;
  state: "empty" | "ready" | "incomplete" | "unsupported";
  schemaVersion: number | null;
  issues: { code: string; message: string }[];
  snapshot?: CanonicalSnapshot;
};

export function inspectCanonicalRoot(directory: string): RootInspection {
  const rootPath = realpathSync(directory);
  const rootIdentity = directoryIdentity(rootPath);
  const base = { rootPath, rootIdentity };
  let schemaVersion: number | null = null;
  try {
    const manifestPath = path.join(rootPath, "workspace.json");
    if (!existsSync(manifestPath)) {
      assertInitRoot(rootPath);
      return { ...base, state: "empty", schemaVersion, issues: [] };
    }
    const manifest = parseCanonicalJson(readRegularFile(manifestPath));
    if (
      manifest !== null &&
      typeof manifest === "object" &&
      !Array.isArray(manifest) &&
      Number.isSafeInteger((manifest as Record<string, unknown>).schemaVersion)
    ) {
      schemaVersion = (manifest as { schemaVersion: number }).schemaVersion;
    }
    validateManifest(manifest);
    const snapshot = observeRoot(rootPath);
    if (snapshot.rootIdentity !== rootIdentity)
      throw new CommandError("STALE_SCOPE", "root changed during inspection");
    const issues = snapshot.conflictFiles.map(() => ({
      code: "CONFLICT_COPY",
      message: "raw conflict copy requires reviewed repair",
    }));
    return { ...base, state: "ready", schemaVersion, issues, snapshot };
  } catch (error) {
    const code = error instanceof CommandError ? error.code : "INVALID_STORAGE";
    const message =
      error instanceof CommandError ? error.message : "root could not be inspected completely";
    return {
      ...base,
      state: code === "UNSUPPORTED_SCHEMA" ? "unsupported" : "incomplete",
      schemaVersion,
      issues: [{ code, message }],
    };
  }
}

/** Read-only Node observation, not an API projection, writer lock, journal or distributed snapshot. */
export function readCanonicalRoot(directory: string): CanonicalSnapshot {
  try {
    return observeRoot(realpathSync(directory));
  } catch (error) {
    if (error instanceof CommandError) throw error;
    throw new CommandError("INVALID_STORAGE", "canonical root could not be read completely");
  }
}
