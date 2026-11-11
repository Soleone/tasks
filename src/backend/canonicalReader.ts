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

export function exactHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

type ObservedFile = { stamp: string; sha256: string; task: CanonicalTask | null };

// Reading and hashing every file on every command made each one cost the whole folder. A file
// whose identity, size and times match the previous scan keeps that scan's hash and task. Writes
// within a few seconds of a read can share coarse timestamps, so such files are read again
// (git's "racy" rule). Tasks are frozen because scans share them.
const RACY_MS = 3_000n;
const MAX_REMEMBERED_FOLDERS = 8;
type Scan = Map<string, ObservedFile>;
const previousScans = new Map<string, Scan>();

// A new process would hash every file again, so the cache keeps the last scan between processes.
// `saved` is what the cache holds as far as this process knows, by file path.
export type SavedFile = { path: string; stamp: string; sha256: string; task: string | null };
const savedScans = new Map<string, { from?: Scan; stamps: Map<string, string> }>();

export function hasScan(rootPath: string): boolean {
  return savedScans.has(path.join(rootPath, "tasks"));
}

export function restoreScan(rootPath: string, rows: SavedFile[]): void {
  const taskDirectory = path.join(rootPath, "tasks");
  const scan: Scan = new Map();
  for (const row of rows) {
    try {
      const task =
        row.task === null
          ? null
          : frozenTask(JSON.parse(row.task), path.basename(row.path, ".json"));
      scan.set(row.path, { stamp: row.stamp, sha256: row.sha256, task });
    } catch {
      // Saved by a build with other task rules: the file itself is read instead.
    }
  }
  savedScans.set(taskDirectory, { stamps: new Map(rows.map((row) => [row.path, row.stamp])) });
  if (!previousScans.has(taskDirectory)) rememberScan(taskDirectory, scan);
}

/** What the cache must store and forget to match the latest scan; the caller saves it. */
export function scanChanges(rootPath: string): { put: SavedFile[]; drop: string[] } {
  const taskDirectory = path.join(rootPath, "tasks");
  const scan = previousScans.get(taskDirectory);
  const saved = savedScans.get(taskDirectory);
  const put: SavedFile[] = [];
  const drop: string[] = [];
  if (!scan || !saved || saved.from === scan) return { put, drop };
  for (const [filePath, file] of scan) {
    if (file.stamp === "" || saved.stamps.get(filePath) === file.stamp) continue;
    put.push({
      path: filePath,
      stamp: file.stamp,
      sha256: file.sha256,
      task: file.task && JSON.stringify(file.task),
    });
    saved.stamps.set(filePath, file.stamp);
  }
  for (const filePath of saved.stamps.keys()) {
    if (scan.get(filePath)?.stamp) continue;
    drop.push(filePath);
    saved.stamps.delete(filePath);
  }
  saved.from = scan;
  return { put, drop };
}

function frozenTask(value: unknown, id: string): CanonicalTask {
  const task = validateTask(value, id);
  Object.freeze(task.tags);
  Object.freeze(task.dependencyIds);
  return Object.freeze(task);
}

// Checking every file is most of a read on Windows (about 80 µs per file). The backend and
// Syncthing both publish by rename, which moves the folder's own times, so a process that answers
// many requests reuses its last complete read while both folders' stamps still match.
const TRUSTED_MS = 30_000;
type FolderStamp = { folders: string; settled: boolean };
type TrustedRead = FolderStamp & { at: number; snapshot: CanonicalSnapshot };
const trustedReads = new Map<string, TrustedRead>();
let trusting = false;

/** For processes that answer many requests: the app's backend, `--stdio` and the dev bridge. */
export function trustRenames(): void {
  trusting = true;
}

function folderStamp(rootPath: string): FolderStamp | undefined {
  const now = BigInt(Date.now());
  const stamps = [];
  let settled = true;
  for (const folder of [rootPath, path.join(rootPath, "tasks")]) {
    const stat = lstatSync(folder, { bigint: true, throwIfNoEntry: false });
    if (!stat?.isDirectory()) return undefined;
    const changedNs = stat.mtimeNs > stat.ctimeNs ? stat.mtimeNs : stat.ctimeNs;
    if (now - changedNs / 1_000_000n <= RACY_MS) settled = false;
    stamps.push(`${stat.dev}:${stat.ino}:${stat.mtimeNs}:${stat.ctimeNs}`);
  }
  return { folders: stamps.join("|"), settled };
}

/**
 * Two renames in one clock tick leave one stamp, so a read taken while a folder had just changed
 * is trusted only until the folder settles, then checked once more.
 */
function trustedSnapshot(rootPath: string): CanonicalSnapshot | undefined {
  const known = trustedReads.get(rootPath);
  if (!known || Date.now() - known.at >= TRUSTED_MS) return undefined;
  const now = folderStamp(rootPath);
  return now?.folders === known.folders && (known.settled || !now.settled)
    ? known.snapshot
    : undefined;
}

function observeTaskFile(
  previous: Scan | undefined,
  filePath: string,
  conflict: boolean,
): ObservedFile {
  const stat = lstatSync(filePath, { bigint: true });
  if (!stat.isFile()) invalidEntry();
  const stamp = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  const known = previous?.get(filePath);
  if (known && known.stamp === stamp) return known;
  const bytes = readRegularFile(filePath);
  const changedNs = stat.mtimeNs > stat.ctimeNs ? stat.mtimeNs : stat.ctimeNs;
  const settled = BigInt(Date.now()) - changedNs / 1_000_000n > RACY_MS;
  const task = conflict
    ? null
    : frozenTask(parseCanonicalJson(bytes), path.basename(filePath, ".json"));
  return { stamp: settled ? stamp : "", sha256: exactHash(bytes), task };
}

function rememberScan(taskDirectory: string, scan: Scan): void {
  previousScans.delete(taskDirectory);
  previousScans.set(taskDirectory, scan);
  if (previousScans.size > MAX_REMEMBERED_FOLDERS) {
    const oldest = previousScans.keys().next().value!;
    previousScans.delete(oldest);
    savedScans.delete(oldest);
    trustedReads.delete(path.dirname(oldest));
  }
}

/** A Syncthing transfer in progress (`~syncthing~` on Windows), or a stage of ours: not a task. */
export function isTransferTemporary(name: string): boolean {
  return (
    (name.startsWith(".syncthing.") || name.startsWith("~syncthing~")) && name.endsWith(".tmp")
  );
}

function observeRoot(
  rootPath: string,
  deletedTasks: readonly CanonicalTask[] = [],
): CanonicalSnapshot {
  // A writer reads here and then renames, possibly within one clock tick of an earlier read.
  trustedReads.delete(rootPath);
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
  const previous = previousScans.get(taskDirectory);
  const scan: Scan = new Map();
  const names = readdirSync(taskDirectory).sort();
  for (const name of names) {
    if (isTransferTemporary(name)) continue;
    const conflict = /^[A-Za-z0-9_-]+\.sync-conflict-.+\.json$/.test(name);
    if (!conflict && !/^[A-Za-z0-9_-]+\.json$/.test(name)) invalidEntry();
    const filePath = path.join(taskDirectory, name);
    const file = observeTaskFile(previous, filePath, conflict);
    scan.set(filePath, file);
    const observation = { relativePath: `tasks/${name}`, sha256: file.sha256 };
    files.push(observation);
    if (file.task) tasks.push(file.task);
    else conflictFiles.push(observation);
  }
  if (deletedTasks.some((deleted) => tasks.some((task) => task.id === deleted.id))) invalidEntry();
  validateGraph([...tasks, ...deletedTasks]);
  // A file rewritten after its read is no different from one rewritten just after the scan:
  // every writer guards its replacements against these hashes again.
  if (
    directoryIdentity(rootPath) !== rootIdentity ||
    directoryIdentity(taskDirectory) !== taskIdentity ||
    JSON.stringify(readdirSync(taskDirectory).sort()) !== JSON.stringify(names)
  ) {
    throw new CommandError("STALE_SCOPE", "canonical tree changed during observation");
  }
  rememberScan(taskDirectory, scan);
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
      realpathSync.native(directory),
      deletedTasks.map((task) => validateTask(task, task.id)),
    );
  } catch (error) {
    if (error instanceof CommandError) throw error;
    throw new CommandError("INVALID_STORAGE", "deletion prefix could not be read completely");
  }
}

/** Resolve an explicitly selected existing directory, without assuming or creating a schema. */
export function readPhysicalRoot(directory: string): { rootPath: string; rootIdentity: string } {
  const rootPath = realpathSync.native(directory);
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
  const rootPath = realpathSync.native(directory);
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
    let snapshot = trustedSnapshot(rootPath);
    if (!snapshot) {
      const stamp = trusting ? folderStamp(rootPath) : undefined;
      snapshot = observeRoot(rootPath);
      if (stamp) trustedReads.set(rootPath, { ...stamp, at: Date.now(), snapshot });
    }
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
    return observeRoot(realpathSync.native(directory));
  } catch (error) {
    if (error instanceof CommandError) throw error;
    throw new CommandError("INVALID_STORAGE", "canonical root could not be read completely");
  }
}
