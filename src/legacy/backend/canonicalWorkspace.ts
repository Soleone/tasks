import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  watch,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { withTransaction } from "./database.js";
import { CommandError } from "../../backend/errors.js";
import { contentHash, requestHash } from "./requestHash.js";
import { classifyTaskText, TaskTextError, type TaskClassification } from "../../backend/taskText.js";
import type { ProtocolRequest, TaskStatus } from "./protocol.js";
import { APP_NAME } from "../../backend/branding.js";

type Row = Record<string, unknown>;
type ParentId = string | null;

type CanonicalSync = {
  revision: number;
  modifiedBy: string;
  basedOnHash: string | null;
  contentHash: string;
};

export type CanonicalWorkspaceFile = {
  format: "tasks.workspace";
  formatVersion: 1;
  workspaceId: string;
  schemaVersion: 1;
};

export type CanonicalTaskFile = {
  format: "tasks.task";
  formatVersion: 1;
  workspaceId: string;
  id: string;
  title: string;
  descriptionMarkdown: string;
  status: TaskStatus;
  priority: 0 | 1 | 2 | 3 | 4;
  parentId: string | null;
  dependencyIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  canceledAt: string | null;
  sync: CanonicalSync;
};

export type CanonicalOrderFile = {
  format: "tasks.sibling-order";
  formatVersion: 1;
  workspaceId: string;
  parentId: string | null;
  taskIds: string[];
  sync: CanonicalSync;
};

export type CanonicalAffected = {
  taskIds?: string[];
  deletedTaskIds?: string[];
  orderParentIds?: ParentId[];
  deletedOrderParentIds?: ParentId[];
};

type FileKind = "workspace" | "task" | "order";

type FileReplacement = {
  relativePath: string;
  kind: Exclude<FileKind, "workspace">;
  previousContent: string | null;
  content: string | null;
};

type PendingOperation = {
  format: "tasks.pending-operation";
  formatVersion: 1;
  operationId: string;
  workspaceId: string;
  command: ProtocolRequest["command"];
  idempotencyKey: string;
  requestHash: string;
  responseJson: string;
  replacements: FileReplacement[];
};

type FileCandidate = {
  kind: Exclude<FileKind, "workspace">;
  relativePath: string;
  absolutePath: string;
  canonicalPath: string;
  sourcePath: string;
  content: string;
  size: number;
  mtimeMs: number;
  record: CanonicalTaskFile | CanonicalOrderFile;
  conflict: boolean;
};

type ScanResult = {
  candidates: FileCandidate[];
  skipped: number;
};

type ApplyCounts = {
  tasks: number;
  orders: number;
  conflicts: number;
};

type ApplyResult = ApplyCounts & {
  appliedPaths: string[];
  rejectedPaths: string[];
};

type SyncResult = ApplyCounts & {
  bootstrapped: boolean;
  skipped: number;
  cacheGeneration: number;
};

type PreviousFile = {
  content: string | null;
  revision: number;
  contentHash: string | null;
};

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const CACHE_VERSION_STRIDE = 1_000_000;
const LOCK_TIMEOUT_MS = 1_000;
const STALE_LOCK_MS = 30_000;
function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function commandError(code: string, message: string): CommandError {
  return new CommandError(code, message);
}

function stringValue(row: Row, field: string): string {
  const value = row[field];
  if (typeof value !== "string") {
    throw commandError("INVALID_STORAGE", `database field ${field} is not text`);
  }
  return value;
}

function nullableStringValue(row: Row, field: string): string | null {
  const value = row[field];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw commandError("INVALID_STORAGE", `database field ${field} is not nullable text`);
  }
  return value;
}

function numberValue(row: Row, field: string): number {
  const value = row[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw commandError("INVALID_STORAGE", `database field ${field} is not numeric`);
  }
  return value;
}

function statusValue(value: unknown): TaskStatus {
  if (value === "open" || value === "in_progress" || value === "paused" || value === "done" || value === "canceled") {
    return value;
  }
  throw commandError("INVALID_CANONICAL", `unsupported task status ${String(value)}`);
}

function priorityValue(value: unknown): 0 | 1 | 2 | 3 | 4 {
  if (value === 0 || value === 1 || value === 2 || value === 3 || value === 4) return value;
  throw commandError("INVALID_CANONICAL", `unsupported task priority ${String(value)}`);
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/");
}

function taskRelativePath(id: string): string {
  if (!SAFE_ID.test(id)) throw commandError("INVALID_CANONICAL", `task id ${id} cannot be used as a file name`);
  return `tasks/${id}.json`;
}

function orderRelativePath(parentId: ParentId): string {
  if (parentId === null) return "order/root.json";
  if (!SAFE_ID.test(parentId)) throw commandError("INVALID_CANONICAL", `parent id ${parentId} cannot be used as a file name`);
  return `order/${parentId}.json`;
}

const scopedCanonicalRoots = new Map<string, string>();

/** Runs one synchronous source command with its configured canonical root, without mutating process.env. */
export function withCanonicalRootPath<T>(databasePath: string, rootPath: string, operation: () => T): T {
  const key = path.resolve(databasePath);
  const previous = scopedCanonicalRoots.get(key);
  scopedCanonicalRoots.set(key, path.resolve(rootPath));
  try {
    return operation();
  } finally {
    if (previous === undefined) scopedCanonicalRoots.delete(key);
    else scopedCanonicalRoots.set(key, previous);
  }
}

export function canonicalRootPath(databasePath: string, environment: Record<string, string | undefined> = process.env): string {
  const scopedRoot = scopedCanonicalRoots.get(path.resolve(databasePath));
  if (scopedRoot !== undefined) return scopedRoot;

  const override = environment.TASKS_SYNC_ROOT?.trim();
  return path.resolve(override === undefined || override === "" ? path.join(path.dirname(databasePath), "sync") : override);
}

export function localStateDirectory(databasePath: string): string {
  return path.join(path.dirname(path.resolve(databasePath)), ".tasks-local");
}

export function pendingOperationPath(databasePath: string): string {
  return path.join(localStateDirectory(databasePath), "pending-operation.json");
}

export function workspaceLockPath(databasePath: string): string {
  return path.join(localStateDirectory(databasePath), "workspace.lock");
}

function sleep(milliseconds: number): void {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, milliseconds);
}

function staleLock(lockPath: string): boolean {
  let modifiedAt: number;
  try {
    modifiedAt = statSync(lockPath).mtimeMs;
  } catch (error) {
    if (isMissing(error)) return true;
    throw error;
  }
  const lockAge = Date.now() - modifiedAt;
  if (lockAge <= STALE_LOCK_MS) return false;
  const content = readText(lockPath);
  if (content !== null) {
    try {
      const value = JSON.parse(content) as unknown;
      if (isRecord(value) && typeof value.pid === "number" && Number.isInteger(value.pid) && value.pid > 0) {
        try {
          process.kill(value.pid, 0);
          return false;
        } catch (error) {
          if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EPERM") return false;
          if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  return true;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function flushFile(filePath: string): void {
  const descriptor = openSync(filePath, "r+");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function flushDirectory(directory: string): void {
  try {
    const descriptor = openSync(directory, "r");
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  } catch (error) {
    // Directory fsync is unavailable on some Windows filesystems. The file
    // itself is still flushed before the atomic rename.
    const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code !== "EISDIR" && code !== "EPERM" && code !== "EINVAL" && code !== "ENOTSUP" && code !== "ENOTSUPP") throw error;
  }
}

function writeAtomic(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    flushFile(temporaryPath);
    renameSync(temporaryPath, filePath);
    flushDirectory(path.dirname(filePath));
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch (cleanupError) {
      if (!isMissing(cleanupError)) throw cleanupError;
    }
    throw error;
  }
}

function removeFile(filePath: string): void {
  try {
    unlinkSync(filePath);
    flushDirectory(path.dirname(filePath));
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

export type CanonicalWorkspaceWatcher = {
  close: () => void;
};

function isCanonicalSyncPath(relativePath: string): boolean {
  return relativePath === "workspace.json"
    || /^tasks\/[^/]+\.json$/.test(relativePath)
    || /^order\/(?:root|[^/]+)\.json$/.test(relativePath);
}

export function watchCanonicalWorkspace(
  databasePath: string,
  onChange: (relativePaths: string[]) => void,
  debounceMs = 150,
): CanonicalWorkspaceWatcher {
  const root = canonicalRootPath(databasePath);
  mkdirSync(path.join(root, "tasks"), { recursive: true });
  mkdirSync(path.join(root, "order"), { recursive: true });
  const changedPaths = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watchers = [root, path.join(root, "tasks"), path.join(root, "order")].map((directory) => watch(directory, (_event, fileName) => {
    if (fileName === null) return;
    const relativePath = normalizeRelativePath(path.relative(root, path.join(directory, fileName.toString())));
    if (!isCanonicalSyncPath(relativePath)) return;
    changedPaths.add(relativePath);
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      const paths = [...changedPaths].sort();
      changedPaths.clear();
      if (paths.length > 0) onChange(paths);
    }, debounceMs);
  }));
  for (const watcher of watchers) watcher.on("error", () => watcher.close());
  return {
    close: () => {
      if (timer !== undefined) clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
    },
  };
}

export function withWorkspaceLock<T>(databasePath: string, action: () => T): T {
  const lockPath = workspaceLockPath(databasePath);
  mkdirSync(path.dirname(lockPath), { recursive: true });
  const startedAt = Date.now();
  let descriptor: number | undefined;
  while (descriptor === undefined) {
    try {
      descriptor = openSync(lockPath, "wx", 0o600);
      writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`);
      fsyncSync(descriptor);
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      descriptor = undefined;
      if (!error || !(error instanceof Error) || !("code" in error) || (error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      if (staleLock(lockPath)) {
        removeFile(lockPath);
        continue;
      }
      if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
        throw commandError("WORKSPACE_BUSY", `another ${APP_NAME} process is updating the workspace`);
      }
      sleep(25);
    }
  }

  try {
    return action();
  } finally {
    closeSync(descriptor);
    removeFile(lockPath);
  }
}

function deviceId(databasePath: string): string {
  const configured = process.env.TASKS_DEVICE_ID?.trim();
  if (configured !== undefined && configured !== "") return configured;
  const devicePath = path.join(localStateDirectory(databasePath), "device.json");
  try {
    const value = JSON.parse(readFileSync(devicePath, "utf8")) as unknown;
    if (isRecord(value) && typeof value.deviceId === "string" && value.deviceId !== "") return value.deviceId;
  } catch (error) {
    if (!isMissing(error) && !(error instanceof SyntaxError)) throw error;
  }
  const id = randomUUID();
  writeAtomic(devicePath, `${JSON.stringify({ deviceId: id }, null, 2)}\n`);
  return id;
}

function readText(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

function parseJson(text: string, filePath: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw commandError("INVALID_CANONICAL", `${filePath} is not complete JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function workspaceFile(root: string): string {
  return path.join(root, "workspace.json");
}

function storedWorkspaceId(database: DatabaseSync): string | undefined {
  const row = database.prepare("SELECT value FROM cache_meta WHERE key = 'workspace_id'").get() as Row | undefined;
  return typeof row?.value === "string" && row.value !== "" ? row.value : undefined;
}

function prepareSyncRoot(database: DatabaseSync, root: string): void {
  const row = database.prepare("SELECT value FROM cache_meta WHERE key = 'sync_root'").get() as Row | undefined;
  const previousRoot = typeof row?.value === "string" ? row.value : undefined;
  if (previousRoot === root) return;
  withTransaction(database, () => {
    database.exec("DELETE FROM sync_files; DELETE FROM sync_conflicts;");
    database
      .prepare("INSERT INTO cache_meta (key, value) VALUES ('sync_root', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(root);
  });
}

function rememberWorkspaceId(database: DatabaseSync, workspaceId: string): void {
  database
    .prepare("INSERT INTO cache_meta (key, value) VALUES ('workspace_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(workspaceId);
}

function readWorkspace(root: string, workspaceIdHint?: string): { record: CanonicalWorkspaceFile; created: boolean } {
  mkdirSync(root, { recursive: true });
  const filePath = workspaceFile(root);
  const content = readText(filePath);
  if (content === null) {
    const hasCanonicalRecords = listDirectory(path.join(root, "tasks")).length > 0 || listDirectory(path.join(root, "order")).length > 0;
    if (hasCanonicalRecords) {
      throw commandError("INVALID_CANONICAL", `${filePath} is missing while canonical records are present`);
    }
    const record: CanonicalWorkspaceFile = {
      format: "tasks.workspace",
      formatVersion: 1,
      workspaceId: workspaceIdHint ?? randomUUID(),
      schemaVersion: 1,
    };
    writeAtomic(filePath, `${JSON.stringify(record, null, 2)}\n`);
    return { record, created: true };
  }

  const value = parseJson(content, filePath);
  if (!isRecord(value)
    || value.format !== "tasks.workspace"
    || value.formatVersion !== 1
    || typeof value.workspaceId !== "string"
    || value.workspaceId.trim() === ""
    || value.schemaVersion !== 1) {
    throw commandError("INVALID_CANONICAL", `${filePath} does not contain a supported workspace record`);
  }
  return { record: value as unknown as CanonicalWorkspaceFile, created: false };
}

function workspaceForDatabase(database: DatabaseSync, root: string): { record: CanonicalWorkspaceFile; created: boolean } {
  prepareSyncRoot(database, root);
  const hint = storedWorkspaceId(database);
  const workspace = readWorkspace(root, hint);
  if (hint !== undefined && workspace.record.workspaceId !== hint) {
    throw commandError("INVALID_CANONICAL", "canonical workspace identity does not match this local cache");
  }
  if (hint === undefined) rememberWorkspaceId(database, workspace.record.workspaceId);
  return workspace;
}

function canonicalWithoutHash(record: CanonicalTaskFile | CanonicalOrderFile): Row {
  const { sync, ...content } = record;
  return { ...content, sync: { revision: sync.revision, modifiedBy: sync.modifiedBy, basedOnHash: sync.basedOnHash } };
}

function syncRecord(
  previousRevision: number,
  previousHash: string | null,
  modifiedBy: string,
): Omit<CanonicalSync, "contentHash"> {
  return {
    revision: previousRevision + 1,
    modifiedBy,
    basedOnHash: previousHash,
  };
}

function taskRecordFromDatabase(
  database: DatabaseSync,
  taskId: string,
  workspaceId: string,
  sync: Omit<CanonicalSync, "contentHash">,
): CanonicalTaskFile {
  const row = database.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Row | undefined;
  if (!row) throw commandError("TASK_NOT_FOUND", `task ${taskId} was not found while writing canonical state`);
  const dependencies = database
    .prepare("SELECT depends_on_id FROM task_dependencies WHERE task_id = ? ORDER BY depends_on_id ASC")
    .all(taskId) as Row[];
  const content: Omit<CanonicalTaskFile, "sync"> = {
    format: "tasks.task",
    formatVersion: 1,
    workspaceId,
    id: stringValue(row, "id"),
    title: stringValue(row, "title"),
    descriptionMarkdown: stringValue(row, "description_markdown"),
    status: statusValue(row.status),
    priority: priorityValue(row.priority),
    parentId: nullableStringValue(row, "parent_id"),
    dependencyIds: dependencies.map((dependency) => stringValue(dependency, "depends_on_id")),
    createdAt: stringValue(row, "created_at"),
    updatedAt: stringValue(row, "updated_at"),
    completedAt: nullableStringValue(row, "completed_at"),
    canceledAt: nullableStringValue(row, "canceled_at"),
  };
  const withoutHash = { ...content, sync } as CanonicalTaskFile;
  return { ...withoutHash, sync: { ...sync, contentHash: contentHash(withoutHash) } };
}

function orderRecordFromDatabase(
  database: DatabaseSync,
  parentId: ParentId,
  workspaceId: string,
  sync: Omit<CanonicalSync, "contentHash">,
): CanonicalOrderFile {
  const rows = database
    .prepare("SELECT id FROM tasks WHERE parent_id IS ? ORDER BY position ASC, id ASC")
    .all(parentId) as Row[];
  const content: Omit<CanonicalOrderFile, "sync"> = {
    format: "tasks.sibling-order",
    formatVersion: 1,
    workspaceId,
    parentId,
    taskIds: rows.map((row) => stringValue(row, "id")),
  };
  const withoutHash = { ...content, sync } as CanonicalOrderFile;
  return { ...withoutHash, sync: { ...sync, contentHash: contentHash(withoutHash) } };
}

function serialise(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function fileMetadata(database: DatabaseSync, relativePath: string, kind: FileKind, recordId: string | null, filePath: string, record: CanonicalTaskFile | CanonicalOrderFile | CanonicalWorkspaceFile): void {
  const stats = statSync(filePath);
  const sync = "sync" in record ? record.sync : undefined;
  database
    .prepare(
      `INSERT INTO sync_files (canonical_path, kind, record_id, size, mtime_ms, content_hash, revision, modified_by, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(canonical_path) DO UPDATE SET
         kind = excluded.kind,
         record_id = excluded.record_id,
         size = excluded.size,
         mtime_ms = excluded.mtime_ms,
         content_hash = excluded.content_hash,
         revision = excluded.revision,
         modified_by = excluded.modified_by,
         last_seen_at = excluded.last_seen_at`,
    )
    .run(
      normalizeRelativePath(relativePath),
      kind,
      recordId,
      stats.size,
      stats.mtimeMs,
      sync?.contentHash ?? (kind === "workspace" ? contentHash(record) : null),
      sync?.revision ?? null,
      sync?.modifiedBy ?? null,
      new Date().toISOString(),
    );
}

function previousFile(
  database: DatabaseSync,
  filePath: string,
  relativePath: string,
  kind: Exclude<FileKind, "workspace">,
  workspaceId: string,
): PreviousFile {
  const content = readText(filePath);
  const metadata = database.prepare("SELECT revision, content_hash FROM sync_files WHERE canonical_path = ?").get(relativePath) as Row | undefined;
  const metadataRevision = metadata?.revision === null || metadata?.revision === undefined ? 0 : numberValue(metadata, "revision");
  const metadataHash = typeof metadata?.content_hash === "string" ? metadata.content_hash : null;
  if (content === null) {
    return { content: null, revision: metadataRevision, contentHash: metadataHash };
  }

  const value = parseJson(content, filePath);
  const record = kind === "task"
    ? validateTaskRecord(value, workspaceId, relativePath.slice("tasks/".length, -5), true)
    : validateOrderRecord(
      value,
      workspaceId,
      relativePath === "order/root.json" ? "root" : relativePath.slice("order/".length, -5),
      true,
    );
  return {
    content,
    revision: record.sync.revision,
    contentHash: record.sync.contentHash,
  };
}

function buildReplacement(
  database: DatabaseSync,
  root: string,
  workspaceId: string,
  id: string,
  kind: Exclude<FileKind, "workspace">,
  parentId: ParentId,
  modifiedBy: string,
): FileReplacement | null {
  const relativePath = kind === "task" ? taskRelativePath(id) : orderRelativePath(parentId);
  const absolutePath = path.join(root, relativePath);
  const previous = previousFile(database, absolutePath, relativePath, kind, workspaceId);
  const sync = syncRecord(previous.revision, previous.contentHash, modifiedBy);
  const record = kind === "task"
    ? taskRecordFromDatabase(database, id, workspaceId, sync)
    : orderRecordFromDatabase(database, parentId, workspaceId, sync);
  const content = serialise(record);
  if (previous.content === content) return null;
  return { relativePath, kind, previousContent: previous.content, content };
}

function allParentIds(database: DatabaseSync): ParentId[] {
  const rows = database.prepare("SELECT DISTINCT parent_id FROM tasks").all() as Row[];
  const values = rows.map((row) => nullableStringValue(row, "parent_id"));
  return values.sort((left, right) => {
    if (left === null) return -1;
    if (right === null) return 1;
    return left.localeCompare(right);
  });
}

function bootstrapCanonicalWorkspace(database: DatabaseSync, databasePath: string, root: string, workspace: CanonicalWorkspaceFile): void {
  mkdirSync(path.join(root, "tasks"), { recursive: true });
  mkdirSync(path.join(root, "order"), { recursive: true });
  const modifiedBy = deviceId(databasePath);
  const replacements: Array<{ relativePath: string; kind: FileKind; recordId: string | null; record: CanonicalTaskFile | CanonicalOrderFile | CanonicalWorkspaceFile; content: string }> = [];
  const taskRows = database.prepare("SELECT id FROM tasks ORDER BY id ASC").all() as Row[];
  for (const row of taskRows) {
    const id = stringValue(row, "id");
    const sync = syncRecord(0, null, modifiedBy);
    const record = taskRecordFromDatabase(database, id, workspace.workspaceId, sync);
    replacements.push({ relativePath: taskRelativePath(id), kind: "task", recordId: id, record, content: serialise(record) });
  }
  for (const parentId of allParentIds(database)) {
    const sync = syncRecord(0, null, modifiedBy);
    const record = orderRecordFromDatabase(database, parentId, workspace.workspaceId, sync);
    replacements.push({ relativePath: orderRelativePath(parentId), kind: "order", recordId: parentId, record, content: serialise(record) });
  }
  if (!replacements.some((replacement) => replacement.relativePath === "order/root.json")) {
    const record: CanonicalOrderFile = {
      format: "tasks.sibling-order",
      formatVersion: 1,
      workspaceId: workspace.workspaceId,
      parentId: null,
      taskIds: [],
      sync: { ...syncRecord(0, null, modifiedBy), contentHash: "" },
    };
    record.sync.contentHash = contentHash(canonicalWithoutHash(record));
    replacements.push({ relativePath: "order/root.json", kind: "order", recordId: null, record, content: serialise(record) });
  }

  for (const replacement of replacements) {
    const absolutePath = path.join(root, replacement.relativePath);
    writeAtomic(absolutePath, replacement.content);
  }
  withTransaction(database, () => {
    fileMetadata(database, "workspace.json", "workspace", null, workspaceFile(root), workspace);
    rememberWorkspaceId(database, workspace.workspaceId);
    for (const replacement of replacements) {
      fileMetadata(database, replacement.relativePath, replacement.kind, replacement.recordId, path.join(root, replacement.relativePath), replacement.record);
    }
  });
}

function repairMissingCanonicalFiles(database: DatabaseSync, databasePath: string, root: string, workspace: CanonicalWorkspaceFile): void {
  const taskCount = numberValue(database.prepare("SELECT COUNT(*) AS count FROM tasks").get() as Row, "count");
  const importedTaskMetadata = numberValue(
    database.prepare("SELECT COUNT(*) AS count FROM sync_files WHERE kind = 'task'").get() as Row,
    "count",
  );
  if (taskCount === 0 || importedTaskMetadata > 0) return;

  mkdirSync(path.join(root, "tasks"), { recursive: true });
  mkdirSync(path.join(root, "order"), { recursive: true });
  const modifiedBy = deviceId(databasePath);
  const records: Array<{ relativePath: string; kind: Exclude<FileKind, "workspace">; recordId: string | null; record: CanonicalTaskFile | CanonicalOrderFile }> = [];
  const taskRows = database.prepare("SELECT id FROM tasks ORDER BY id ASC").all() as Row[];
  for (const row of taskRows) {
    const id = stringValue(row, "id");
    const relativePath = taskRelativePath(id);
    if (existsSync(path.join(root, relativePath))) continue;
    const record = taskRecordFromDatabase(database, id, workspace.workspaceId, syncRecord(0, null, modifiedBy));
    records.push({ relativePath, kind: "task", recordId: id, record });
  }
  for (const parentId of allParentIds(database)) {
    const relativePath = orderRelativePath(parentId);
    if (existsSync(path.join(root, relativePath))) continue;
    const record = orderRecordFromDatabase(database, parentId, workspace.workspaceId, syncRecord(0, null, modifiedBy));
    records.push({ relativePath, kind: "order", recordId: parentId, record });
  }
  if (!existsSync(path.join(root, "order/root.json"))) {
    const record: CanonicalOrderFile = {
      format: "tasks.sibling-order",
      formatVersion: 1,
      workspaceId: workspace.workspaceId,
      parentId: null,
      taskIds: [],
      sync: { ...syncRecord(0, null, modifiedBy), contentHash: "" },
    };
    record.sync.contentHash = contentHash(canonicalWithoutHash(record));
    records.push({ relativePath: "order/root.json", kind: "order", recordId: null, record });
  }
  for (const record of records) writeAtomic(path.join(root, record.relativePath), serialise(record.record));
  if (records.length === 0) return;
  withTransaction(database, () => {
    fileMetadata(database, "workspace.json", "workspace", null, workspaceFile(root), workspace);
    for (const record of records) {
      fileMetadata(database, record.relativePath, record.kind, record.recordId, path.join(root, record.relativePath), record.record);
    }
  });
}

function validateSync(value: unknown, filePath: string): CanonicalSync {
  if (!isRecord(value)
    || typeof value.revision !== "number"
    || !Number.isInteger(value.revision)
    || value.revision < 1
    || typeof value.modifiedBy !== "string"
    || value.modifiedBy.trim() === ""
    || (value.basedOnHash !== null && (typeof value.basedOnHash !== "string" || value.basedOnHash.trim() === ""))
    || typeof value.contentHash !== "string"
    || !/^[a-f0-9]{64}$/.test(value.contentHash)) {
    throw commandError("INVALID_CANONICAL", `${filePath} has invalid sync metadata`);
  }
  return value as unknown as CanonicalSync;
}

function validateTaskRecord(value: unknown, expectedWorkspaceId: string, expectedId: string, checkPath: boolean): CanonicalTaskFile {
  if (!isRecord(value)
    || value.format !== "tasks.task"
    || value.formatVersion !== 1
    || (expectedWorkspaceId !== "" && value.workspaceId !== expectedWorkspaceId)
    || typeof value.workspaceId !== "string"
    || typeof value.id !== "string"
    || value.id.trim() === ""
    || (checkPath && value.id !== expectedId)
    || typeof value.title !== "string"
    || value.title.trim() === ""
    || value.title.length > 1000
    || typeof value.descriptionMarkdown !== "string"
    || value.descriptionMarkdown.length > 10000
    || (value.parentId !== null && typeof value.parentId !== "string")
    || !Array.isArray(value.dependencyIds)
    || !value.dependencyIds.every((id) => typeof id === "string" && id !== "")
    || typeof value.createdAt !== "string"
    || typeof value.updatedAt !== "string"
    || (value.completedAt !== null && typeof value.completedAt !== "string")
    || (value.canceledAt !== null && typeof value.canceledAt !== "string")) {
    throw commandError("INVALID_CANONICAL", "task file has invalid fields");
  }
  if (!SAFE_ID.test(value.id)) throw commandError("INVALID_CANONICAL", `task id ${value.id} cannot be used as a file name`);
  if (value.parentId !== null && !SAFE_ID.test(value.parentId)) throw commandError("INVALID_CANONICAL", `parent id ${value.parentId} cannot be used as a file name`);
  if (value.dependencyIds.some((id) => !SAFE_ID.test(id))) throw commandError("INVALID_CANONICAL", "dependency id cannot be used as a file name");
  if (value.dependencyIds.includes(value.id) || new Set(value.dependencyIds).size !== value.dependencyIds.length) {
    throw commandError("INVALID_CANONICAL", `task ${value.id} has invalid dependency ids`);
  }
  const status = statusValue(value.status);
  const priority = priorityValue(value.priority);
  if ((status === "done") !== (value.completedAt !== null) || (status === "canceled") !== (value.canceledAt !== null)) {
    throw commandError("INVALID_CANONICAL", `task ${value.id} has inconsistent terminal timestamps`);
  }
  const sync = validateSync(value.sync, "task");
  const record = value as unknown as CanonicalTaskFile;
  if (contentHash(canonicalWithoutHash(record)) !== sync.contentHash) {
    throw commandError("INVALID_CANONICAL", `task ${value.id} has an invalid content hash`);
  }
  return { ...record, status, priority, dependencyIds: [...value.dependencyIds], sync };
}

function validateOrderRecord(value: unknown, expectedWorkspaceId: string, expectedParentId: string, checkPath: boolean): CanonicalOrderFile {
  if (!isRecord(value)
    || value.format !== "tasks.sibling-order"
    || value.formatVersion !== 1
    || (expectedWorkspaceId !== "" && value.workspaceId !== expectedWorkspaceId)
    || typeof value.workspaceId !== "string"
    || (value.parentId !== null && typeof value.parentId !== "string")
    || (checkPath && (expectedParentId === "root" ? value.parentId !== null : value.parentId !== expectedParentId))
    || !Array.isArray(value.taskIds)
    || !value.taskIds.every((id) => typeof id === "string" && SAFE_ID.test(id))) {
    throw commandError("INVALID_CANONICAL", "order file has invalid fields");
  }
  if (value.parentId !== null && !SAFE_ID.test(value.parentId)) {
    throw commandError("INVALID_CANONICAL", `parent id ${value.parentId} cannot be used as a file name`);
  }
  if (new Set(value.taskIds).size !== value.taskIds.length) {
    throw commandError("INVALID_CANONICAL", "order file contains duplicate task ids");
  }
  const sync = validateSync(value.sync, "order");
  const record = value as unknown as CanonicalOrderFile;
  if (contentHash(canonicalWithoutHash(record)) !== sync.contentHash) {
    throw commandError("INVALID_CANONICAL", "order file has an invalid content hash");
  }
  return { ...record, taskIds: [...value.taskIds], sync };
}

function canonicalFileName(name: string): boolean {
  return name.endsWith(".json") && SAFE_ID.test(name.slice(0, -5));
}

function listDirectory(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

function metadataMatches(database: DatabaseSync, relativePath: string, size: number, mtimeMs: number): boolean {
  const row = database.prepare("SELECT size, mtime_ms, content_hash FROM sync_files WHERE canonical_path = ?").get(relativePath) as Row | undefined;
  return row !== undefined
    && numberValue(row, "size") === size
    && numberValue(row, "mtime_ms") === mtimeMs
    && typeof row.content_hash === "string"
    && row.content_hash !== "";
}

function candidateFromFile(
  root: string,
  workspaceId: string,
  kind: Exclude<FileKind, "workspace">,
  name: string,
): FileCandidate | null {
  const relativePath = normalizeRelativePath(path.join(kind === "task" ? "tasks" : "order", name));
  const absolutePath = path.join(root, relativePath);
  const stats = statSync(absolutePath);
  const content = readText(absolutePath);
  if (content === null) return null;
  let record: CanonicalTaskFile | CanonicalOrderFile;
  try {
    const value = parseJson(content, absolutePath);
    if (kind === "task") {
      const expectedId = canonicalFileName(name) ? name.slice(0, -5) : "";
      record = validateTaskRecord(value, workspaceId, expectedId, canonicalFileName(name));
    } else {
      const expectedParentId = name === "root.json" ? "root" : canonicalFileName(name) ? name.slice(0, -5) : "";
      record = validateOrderRecord(value, workspaceId, expectedParentId, name === "root.json" || canonicalFileName(name));
    }
  } catch (error) {
    if (error instanceof CommandError) return null;
    throw error;
  }
  const conflict = kind === "task" ? !canonicalFileName(name) : name !== "root.json" && !canonicalFileName(name);
  const canonicalPath = kind === "task"
    ? taskRelativePath((record as CanonicalTaskFile).id)
    : orderRelativePath((record as CanonicalOrderFile).parentId);
  return {
    kind,
    relativePath,
    absolutePath,
    canonicalPath,
    sourcePath: relativePath,
    content,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    record,
    conflict,
  };
}

type ForcedOrderScopes = boolean | Set<ParentId>;

function orderNameMatchesScope(name: string, parentId: ParentId): boolean {
  const stem = parentId === null ? "root" : parentId;
  return name === `${stem}.json` || name.startsWith(`${stem}.sync-conflict-`);
}

function forceOrderForScope(name: string, forceOrders: ForcedOrderScopes): boolean {
  if (forceOrders === true) return true;
  if (forceOrders === false) return false;
  for (const parentId of forceOrders) {
    if (orderNameMatchesScope(name, parentId)) return true;
  }
  return false;
}

function scanCanonicalFiles(
  database: DatabaseSync,
  root: string,
  workspaceId: string,
  force = false,
  forceOrders: ForcedOrderScopes = false,
): ScanResult {
  const candidates: FileCandidate[] = [];
  let skipped = 0;
  for (const kind of ["task", "order"] as const) {
    const directory = path.join(root, kind === "task" ? "tasks" : "order");
    for (const name of listDirectory(directory)) {
      const relativePath = normalizeRelativePath(path.join(kind === "task" ? "tasks" : "order", name));
      const forceThisOrder = kind === "order" && forceOrderForScope(name, forceOrders);
      if (!force && !forceThisOrder) {
        try {
          const stats = statSync(path.join(root, relativePath));
          if (metadataMatches(database, relativePath, stats.size, stats.mtimeMs)) continue;
        } catch (error) {
          if (isMissing(error)) continue;
          throw error;
        }
      }
      const candidate = candidateFromFile(root, workspaceId, kind, name);
      if (candidate) candidates.push(candidate);
      else skipped += 1;
    }
  }
  return { candidates, skipped };
}

function taskExists(database: DatabaseSync, id: string): boolean {
  return database.prepare("SELECT 1 AS found FROM tasks WHERE id = ?").get(id) !== undefined;
}

function dependencyIdsFromDatabase(database: DatabaseSync, taskId: string): string[] {
  const rows = database.prepare("SELECT depends_on_id FROM task_dependencies WHERE task_id = ? ORDER BY depends_on_id ASC").all(taskId) as Row[];
  return rows.map((row) => stringValue(row, "depends_on_id"));
}

function classificationFor(record: CanonicalTaskFile): TaskClassification {
  try {
    return classifyTaskText(record.title);
  } catch (error) {
    if (error instanceof TaskTextError) throw commandError(error.code, error.message);
    throw error;
  }
}

function upsertClassification(database: DatabaseSync, taskId: string, classification: TaskClassification, now: string): void {
  let categoryId: string | null = null;
  if (classification.category) {
    const existing = database.prepare("SELECT id FROM categories WHERE slug = ?").get(classification.category.slug) as Row | undefined;
    categoryId = existing ? stringValue(existing, "id") : randomUUID();
    if (!existing) {
      database
        .prepare("INSERT INTO categories (id, slug, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run(categoryId, classification.category.slug, classification.category.label, now, now);
    }
  }
  database.prepare("UPDATE tasks SET category_id = ? WHERE id = ?").run(categoryId, taskId);
  database.prepare("DELETE FROM task_tags WHERE task_id = ?").run(taskId);
  for (const tag of classification.tags) {
    const existing = database.prepare("SELECT id FROM tags WHERE slug = ?").get(tag.slug) as Row | undefined;
    const tagId = existing ? stringValue(existing, "id") : randomUUID();
    if (!existing) {
      database
        .prepare("INSERT INTO tags (id, slug, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run(tagId, tag.slug, tag.label, now, now);
    }
    database.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)").run(taskId, tagId);
  }
}

function taskMatchesCanonical(database: DatabaseSync, row: Row, record: CanonicalTaskFile): boolean {
  return stringValue(row, "title") === record.title
    && stringValue(row, "description_markdown") === record.descriptionMarkdown
    && statusValue(row.status) === record.status
    && priorityValue(row.priority) === record.priority
    && nullableStringValue(row, "parent_id") === record.parentId
    && stringValue(row, "created_at") === record.createdAt
    && stringValue(row, "updated_at") === record.updatedAt
    && nullableStringValue(row, "completed_at") === record.completedAt
    && nullableStringValue(row, "canceled_at") === record.canceledAt
    && JSON.stringify(dependencyIdsFromDatabase(database, record.id)) === JSON.stringify([...record.dependencyIds].sort());
}

function parentWouldCycle(database: DatabaseSync, taskId: string, parentId: string | null): boolean {
  const seen = new Set<string>();
  let current = parentId;
  while (current !== null) {
    if (current === taskId || seen.has(current)) return true;
    seen.add(current);
    const row = database.prepare("SELECT parent_id FROM tasks WHERE id = ?").get(current) as Row | undefined;
    if (!row) return false;
    current = nullableStringValue(row, "parent_id");
  }
  return false;
}

function dependencyReaches(database: DatabaseSync, startId: string, targetId: string, skipSourceId: string): boolean {
  const visited = new Set<string>();
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    if (current === targetId) return true;
    if (current === skipSourceId || visited.has(current)) continue;
    visited.add(current);
    const rows = database.prepare("SELECT depends_on_id FROM task_dependencies WHERE task_id = ?").all(current) as Row[];
    for (const row of rows) queue.push(stringValue(row, "depends_on_id"));
  }
  return false;
}

function applyTaskCandidate(database: DatabaseSync, record: CanonicalTaskFile, freshVersion: number | undefined): boolean {
  if (record.parentId !== null && !taskExists(database, record.parentId)) return false;
  if (record.dependencyIds.some((id) => !taskExists(database, id))) return false;
  if (parentWouldCycle(database, record.id, record.parentId)) {
    throw commandError("INVALID_CANONICAL", `task ${record.id} would create a parent cycle`);
  }
  if (record.dependencyIds.some((id) => dependencyReaches(database, id, record.id, record.id))) {
    throw commandError("INVALID_CANONICAL", `task ${record.id} would create a dependency cycle`);
  }
  const classification = classificationFor(record);
  const current = database.prepare("SELECT * FROM tasks WHERE id = ?").get(record.id) as Row | undefined;
  const now = new Date().toISOString();
  if (current && taskMatchesCanonical(database, current, record)) {
    upsertClassification(database, record.id, classification, now);
    return true;
  }
  if (!current) {
    database
      .prepare(
        `INSERT INTO tasks
          (id, title, description_markdown, status, category_id, parent_id, position, priority, version, created_at, updated_at, completed_at, canceled_at)
         VALUES (?, ?, ?, ?, NULL, ?, 0, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.title,
        record.descriptionMarkdown,
        record.status,
        record.parentId,
        record.priority,
        freshVersion ?? 1,
        record.createdAt,
        record.updatedAt,
        record.completedAt,
        record.canceledAt,
      );
  } else {
    database
      .prepare(
        `UPDATE tasks
         SET title = ?, description_markdown = ?, status = ?, parent_id = ?, position = 0, priority = ?, version = version + 1,
             created_at = ?, updated_at = ?, completed_at = ?, canceled_at = ?
         WHERE id = ?`,
      )
      .run(
        record.title,
        record.descriptionMarkdown,
        record.status,
        record.parentId,
        record.priority,
        record.createdAt,
        record.updatedAt,
        record.completedAt,
        record.canceledAt,
        record.id,
      );
  }
  database.prepare("DELETE FROM task_dependencies WHERE task_id = ?").run(record.id);
  const dependencyInsert = database.prepare("INSERT INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)");
  for (const dependencyId of record.dependencyIds) dependencyInsert.run(record.id, dependencyId);
  upsertClassification(database, record.id, classification, now);
  return true;
}

function fallbackSiblingIds(database: DatabaseSync, parentId: ParentId): string[] {
  const rows = database
    .prepare("SELECT id FROM tasks WHERE parent_id IS ? ORDER BY updated_at DESC, id ASC")
    .all(parentId) as Row[];
  return rows.map((row) => stringValue(row, "id"));
}

function applyOrderCandidate(database: DatabaseSync, record: CanonicalOrderFile, requireComplete = false): boolean {
  if (record.parentId !== null && !taskExists(database, record.parentId)) return false;
  const rows = database.prepare("SELECT id, parent_id FROM tasks WHERE parent_id IS ?").all(record.parentId) as Row[];
  const knownIds = new Set(rows.map((row) => stringValue(row, "id")));
  for (const id of record.taskIds) {
    if (knownIds.has(id)) continue;
    if (taskExists(database, id)) {
      throw commandError("INVALID_CANONICAL", `order for ${record.parentId ?? "root"} contains task ${id} from another scope`);
    }
    if (requireComplete) {
      throw commandError("INVALID_CANONICAL", `order for ${record.parentId ?? "root"} contains unknown task ${id}`);
    }
  }
  const listed = record.taskIds.filter((id) => knownIds.has(id));
  const listedSet = new Set(listed);
  const missing = fallbackSiblingIds(database, record.parentId).filter((id) => !listedSet.has(id));
  const finalIds = [...missing, ...listed];
  const update = database.prepare("UPDATE tasks SET position = ? WHERE id = ?");
  finalIds.forEach((id, index) => update.run(index, id));
  return true;
}

function recordConflict(database: DatabaseSync, workspaceId: string, candidate: FileCandidate): void {
  const record = candidate.record;
  database
    .prepare(
      `INSERT INTO sync_conflicts
        (canonical_path, source_path, kind, workspace_id, content_hash, based_on_hash, revision, modified_by, record_json, detected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_path, content_hash) DO NOTHING`,
    )
    .run(
      candidate.canonicalPath,
      candidate.sourcePath,
      candidate.kind,
      workspaceId,
      record.sync.contentHash,
      record.sync.basedOnHash,
      record.sync.revision,
      record.sync.modifiedBy,
      candidate.content,
      new Date().toISOString(),
    );
}

function cacheGeneration(database: DatabaseSync): number {
  const row = database.prepare("SELECT value FROM cache_meta WHERE key = 'cache_generation'").get() as Row | undefined;
  const value = row?.value;
  const generation = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw commandError("INVALID_STORAGE", "cache generation is invalid");
  }
  return generation;
}

function setCacheGeneration(database: DatabaseSync, generation: number): void {
  database
    .prepare("INSERT INTO cache_meta (key, value) VALUES ('cache_generation', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(String(generation));
}

function freshVersionForGeneration(generation: number): number {
  return generation * CACHE_VERSION_STRIDE + 1;
}

export function invalidateCacheGeneration(database: DatabaseSync): number {
  const nextGeneration = cacheGeneration(database) + 1;
  withTransaction(database, () => {
    setCacheGeneration(database, nextGeneration);
    database.prepare("UPDATE tasks SET version = ?").run(freshVersionForGeneration(nextGeneration));
  });
  return nextGeneration;
}

function applyCandidates(
  database: DatabaseSync,
  workspaceId: string,
  candidates: FileCandidate[],
  freshVersion: number | undefined,
  requireCompleteOrders = false,
): ApplyResult {
  let tasks = 0;
  let orders = 0;
  let conflicts = 0;
  const appliedPaths: string[] = [];
  const rejectedPaths: string[] = [];
  for (const candidate of candidates.filter((item) => item.conflict)) {
    recordConflict(database, workspaceId, candidate);
    conflicts += 1;
    appliedPaths.push(candidate.relativePath);
  }

  let pendingTasks = candidates.filter((candidate) => candidate.kind === "task" && !candidate.conflict);
  const rounds = pendingTasks.length;
  const fallbackParents = new Set<ParentId>();
  for (let attempt = 0; attempt < rounds && pendingTasks.length > 0; attempt += 1) {
    const deferred: FileCandidate[] = [];
    let appliedThisRound = 0;
    for (const candidate of pendingTasks) {
      const previous = database
        .prepare("SELECT parent_id FROM tasks WHERE id = ?")
        .get((candidate.record as CanonicalTaskFile).id) as Row | undefined;
      const previousParent = previous ? nullableStringValue(previous, "parent_id") : null;
      let applied = false;
      try {
        applied = applyTaskCandidate(database, candidate.record as CanonicalTaskFile, freshVersion);
      } catch (error) {
        if (error instanceof CommandError && error.code === "MULTIPLE_CATEGORIES") {
          rejectedPaths.push(candidate.relativePath);
          continue;
        }
        throw error;
      }
      if (applied) {
        tasks += 1;
        appliedThisRound += 1;
        fallbackParents.add(previousParent);
        fallbackParents.add((candidate.record as CanonicalTaskFile).parentId);
        appliedPaths.push(candidate.relativePath);
      } else {
        deferred.push(candidate);
      }
    }
    pendingTasks = deferred;
    if (appliedThisRound === 0) break;
  }

  const updateFallbackPosition = database.prepare("UPDATE tasks SET position = ? WHERE id = ?");
  for (const parentId of fallbackParents) {
    fallbackSiblingIds(database, parentId).forEach((id, position) => updateFallbackPosition.run(position, id));
  }

  for (const candidate of candidates.filter((item) => item.kind === "order" && !item.conflict)) {
    try {
      if (applyOrderCandidate(database, candidate.record as CanonicalOrderFile, requireCompleteOrders)) {
        orders += 1;
        appliedPaths.push(candidate.relativePath);
      }
    } catch (error) {
      if (error instanceof CommandError && error.code === "INVALID_CANONICAL") {
        rejectedPaths.push(candidate.relativePath);
        continue;
      }
      throw error;
    }
  }
  return { tasks, orders, conflicts, appliedPaths, rejectedPaths };
}

function recordCandidateMetadata(database: DatabaseSync, candidate: FileCandidate): void {
  fileMetadata(
    database,
    candidate.relativePath,
    candidate.kind,
    candidate.kind === "task" ? (candidate.record as CanonicalTaskFile).id : (candidate.record as CanonicalOrderFile).parentId,
    candidate.absolutePath,
    candidate.record,
  );
}

function validateReplacementPath(relativePath: string, kind: FileReplacement["kind"]): void {
  if (relativePath !== normalizeRelativePath(relativePath)) {
    throw commandError("INVALID_STORAGE", "pending canonical replacement path is not normalized");
  }
  const pattern = kind === "task"
    ? /^tasks\/[A-Za-z0-9_-]+\.json$/
    : /^order\/(?:root|[A-Za-z0-9_-]+)\.json$/;
  if (!pattern.test(relativePath)) throw commandError("INVALID_STORAGE", "pending canonical replacement path is invalid");
}

function pendingValue(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") throw commandError("INVALID_STORAGE", `pending operation ${field} is invalid`);
  return value;
}

function readPending(databasePath: string): PendingOperation | null {
  const filePath = pendingOperationPath(databasePath);
  const content = readText(filePath);
  if (content === null) return null;
  const value = parseJson(content, filePath);
  if (!isRecord(value)
    || value.format !== "tasks.pending-operation"
    || value.formatVersion !== 1
    || typeof value.operationId !== "string"
    || typeof value.workspaceId !== "string"
    || typeof value.command !== "string"
    || typeof value.idempotencyKey !== "string"
    || typeof value.requestHash !== "string"
    || typeof value.responseJson !== "string"
    || !Array.isArray(value.replacements)) {
    throw commandError("INVALID_STORAGE", "pending canonical operation is invalid");
  }
  const replacements: FileReplacement[] = [];
  for (const replacement of value.replacements) {
    if (!isRecord(replacement)
      || (replacement.kind !== "task" && replacement.kind !== "order")
      || typeof replacement.relativePath !== "string"
      || (replacement.content !== null && typeof replacement.content !== "string")
      || (replacement.previousContent !== null && typeof replacement.previousContent !== "string")) {
      throw commandError("INVALID_STORAGE", "pending canonical replacement is invalid");
    }
    validateReplacementPath(replacement.relativePath, replacement.kind);
    replacements.push(replacement as unknown as FileReplacement);
  }
  return {
    format: "tasks.pending-operation",
    formatVersion: 1,
    operationId: pendingValue(value.operationId, "operationId"),
    workspaceId: pendingValue(value.workspaceId, "workspaceId"),
    command: value.command as ProtocolRequest["command"],
    idempotencyKey: pendingValue(value.idempotencyKey, "idempotencyKey"),
    requestHash: pendingValue(value.requestHash, "requestHash"),
    responseJson: pendingValue(value.responseJson, "responseJson"),
    replacements,
  };
}

function writePending(databasePath: string, operation: PendingOperation): void {
  writeAtomic(pendingOperationPath(databasePath), serialise(operation));
}

function clearPending(databasePath: string): void {
  removeFile(pendingOperationPath(databasePath));
}

function candidateFromReplacement(root: string, workspaceId: string, replacement: FileReplacement): FileCandidate {
  validateReplacementPath(replacement.relativePath, replacement.kind);
  if (replacement.content === null) {
    throw commandError("INVALID_STORAGE", "deleted canonical records cannot be imported");
  }
  const absolutePath = path.join(root, replacement.relativePath);
  const value = parseJson(replacement.content, absolutePath);
  const record = replacement.kind === "task"
    ? validateTaskRecord(value, workspaceId, replacement.relativePath.slice("tasks/".length, -5), true)
    : validateOrderRecord(
      value,
      workspaceId,
      replacement.relativePath === "order/root.json" ? "root" : replacement.relativePath.slice("order/".length, -5),
      true,
    );
  const stats = statSync(absolutePath);
  return {
    kind: replacement.kind,
    relativePath: replacement.relativePath,
    absolutePath,
    canonicalPath: replacement.relativePath,
    sourcePath: replacement.relativePath,
    content: replacement.content,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    record,
    conflict: false,
  };
}

function restorePendingVersions(database: DatabaseSync, responseJson: string): void {
  const value = parseJson(responseJson, "pending response");
  if (!isRecord(value)) return;
  const records: Row[] = [];
  if (isRecord(value.task)) records.push(value.task);
  if (Array.isArray(value.tasks)) records.push(...value.tasks.filter(isRecord));
  for (const record of records) {
    if (typeof record.id !== "string" || typeof record.version !== "number" || !Number.isInteger(record.version) || record.version < 1) continue;
    database.prepare("UPDATE tasks SET version = ? WHERE id = ? AND version < ?").run(record.version, record.id, record.version);
  }
}

function restorePendingReceipt(database: DatabaseSync, pending: PendingOperation): void {
  const existing = database.prepare("SELECT request_hash, response_json FROM command_receipts WHERE idempotency_key = ?").get(pending.idempotencyKey) as Row | undefined;
  if (existing) {
    if (stringValue(existing, "request_hash") !== pending.requestHash) {
      throw commandError("IDEMPOTENCY_KEY_REUSED", "pending idempotencyKey was reused for a different request");
    }
    return;
  }
  database
    .prepare("INSERT INTO command_receipts (idempotency_key, command, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(pending.idempotencyKey, pending.command, pending.requestHash, pending.responseJson, new Date().toISOString());
}

function reconcilePendingOperation(database: DatabaseSync, databasePath: string, root: string, workspace: CanonicalWorkspaceFile): boolean {
  const pending = readPending(databasePath);
  if (!pending) return false;
  if (pending.workspaceId !== workspace.workspaceId) {
    throw commandError("INVALID_STORAGE", "pending operation belongs to another canonical workspace");
  }
  for (const replacement of pending.replacements) {
    const absolutePath = path.join(root, replacement.relativePath);
    if (replacement.content === null) {
      removeFile(absolutePath);
    } else if (readText(absolutePath) !== replacement.content) {
      writeAtomic(absolutePath, replacement.content);
    }
  }

  const candidates = pending.replacements
    .filter((replacement) => replacement.content !== null)
    .map((replacement) => candidateFromReplacement(root, workspace.workspaceId, replacement));
  withTransaction(database, () => {
    for (const replacement of pending.replacements) {
      if (replacement.content === null) {
        if (replacement.kind === "task") {
          const id = replacement.relativePath.slice("tasks/".length, -".json".length);
          database.prepare("DELETE FROM tasks WHERE id = ?").run(id);
        }
        database.prepare("DELETE FROM sync_files WHERE canonical_path = ?").run(replacement.relativePath);
      }
    }
    const applied = applyCandidates(database, workspace.workspaceId, candidates, undefined);
    if (candidates.some((candidate) => !applied.appliedPaths.includes(candidate.relativePath))) {
      throw commandError("INVALID_STORAGE", "pending canonical operation contains unresolved relationships");
    }
    for (const candidate of candidates) recordCandidateMetadata(database, candidate);
    restorePendingVersions(database, pending.responseJson);
    restorePendingReceipt(database, pending);
  });
  clearPending(databasePath);
  return true;
}

export function ensureCanonicalWorkspace(database: DatabaseSync, databasePath: string): CanonicalWorkspaceFile {
  const root = canonicalRootPath(databasePath);
  const workspace = workspaceForDatabase(database, root);
  if (workspace.created) bootstrapCanonicalWorkspace(database, databasePath, root, workspace.record);
  return workspace.record;
}

export function syncCanonicalWorkspace(database: DatabaseSync, databasePath: string): SyncResult {
  const root = canonicalRootPath(databasePath);
  const workspaceInfo = workspaceForDatabase(database, root);
  if (workspaceInfo.created) {
    bootstrapCanonicalWorkspace(database, databasePath, root, workspaceInfo.record);
    return { tasks: 0, orders: 0, conflicts: 0, bootstrapped: true, skipped: 0, cacheGeneration: cacheGeneration(database) };
  }

  const recovered = reconcilePendingOperation(database, databasePath, root, workspaceInfo.record);
  repairMissingCanonicalFiles(database, databasePath, root, workspaceInfo.record);
  let scan = scanCanonicalFiles(database, root, workspaceInfo.record.workspaceId);
  const taskCandidates = scan.candidates.filter((candidate) => candidate.kind === "task" && !candidate.conflict);
  if (taskCandidates.length > 0) {
    const affectedOrderParents = new Set<ParentId>();
    for (const candidate of taskCandidates) {
      const record = candidate.record as CanonicalTaskFile;
      affectedOrderParents.add(record.parentId);
      const current = database.prepare("SELECT parent_id FROM tasks WHERE id = ?").get(record.id) as Row | undefined;
      if (current) affectedOrderParents.add(nullableStringValue(current, "parent_id"));
    }
    const orders = scanCanonicalFiles(database, root, workspaceInfo.record.workspaceId, false, affectedOrderParents);
    scan = {
      candidates: [
        ...scan.candidates.filter((candidate) => candidate.kind === "task"),
        ...orders.candidates.filter((candidate) => candidate.kind === "order"),
      ],
      skipped: scan.skipped + orders.skipped,
    };
  }
  const taskCountRow = database.prepare("SELECT COUNT(*) AS count FROM tasks").get() as Row;
  const taskCount = numberValue(taskCountRow, "count");
  const metadataCountRow = database.prepare("SELECT COUNT(*) AS count FROM sync_files WHERE kind = 'task'").get() as Row;
  const metadataCount = numberValue(metadataCountRow, "count");
  const rebuilding = taskCount === 0 && scan.candidates.some((candidate) => candidate.kind === "task" && !candidate.conflict) && metadataCount === 0;
  let generation = cacheGeneration(database);
  if (rebuilding) generation += 1;

  let applied: ApplyResult = { tasks: 0, orders: 0, conflicts: 0, appliedPaths: [], rejectedPaths: [] };
  if (scan.candidates.length > 0 || rebuilding || recovered) {
    withTransaction(database, () => {
      if (rebuilding) setCacheGeneration(database, generation);
      applied = applyCandidates(database, workspaceInfo.record.workspaceId, scan.candidates, rebuilding ? freshVersionForGeneration(generation) : undefined);
      if (rebuilding) {
        const requiredPaths = scan.candidates.filter((candidate) => !candidate.conflict).map((candidate) => candidate.relativePath);
        if (requiredPaths.some((relativePath) => !applied.appliedPaths.includes(relativePath))) {
          throw commandError("INVALID_CANONICAL", "canonical relationships are incomplete; cache rebuild was not applied");
        }
      }
      const appliedPaths = new Set(applied.appliedPaths);
      for (const candidate of scan.candidates) {
        if (appliedPaths.has(candidate.relativePath)) recordCandidateMetadata(database, candidate);
      }
    });
  }
  return {
    tasks: applied.tasks,
    orders: applied.orders,
    conflicts: applied.conflicts,
    bootstrapped: false,
    skipped: scan.skipped + applied.rejectedPaths.length,
    cacheGeneration: generation,
  };
}

function typedReplacementRecord(
  replacement: FileReplacement,
  workspaceId: string,
): CanonicalTaskFile | CanonicalOrderFile {
  if (replacement.content === null) {
    throw commandError("INVALID_STORAGE", "deleted canonical records cannot be validated");
  }
  const record = parseJson(replacement.content, replacement.relativePath);
  return replacement.kind === "task"
    ? validateTaskRecord(record, workspaceId, replacement.relativePath.slice("tasks/".length, -5), true)
    : validateOrderRecord(
      record,
      workspaceId,
      replacement.relativePath === "order/root.json" ? "root" : replacement.relativePath.slice("order/".length, -5),
      true,
    );
}

function applyReplacementSet<T extends Record<string, unknown>>(
  database: DatabaseSync,
  databasePath: string,
  root: string,
  workspace: CanonicalWorkspaceFile,
  request: ProtocolRequest,
  result: T,
  replacements: FileReplacement[],
): PendingOperation {
  const idempotencyKey = request.idempotencyKey;
  if (!idempotencyKey) throw commandError("IDEMPOTENCY_REQUIRED", `${request.command} requires idempotencyKey`);
  const pending: PendingOperation = {
    format: "tasks.pending-operation",
    formatVersion: 1,
    operationId: randomUUID(),
    workspaceId: workspace.workspaceId,
    command: request.command,
    idempotencyKey,
    requestHash: requestHash(request),
    responseJson: JSON.stringify(result),
    replacements,
  };
  writePending(databasePath, pending);
  for (const replacement of replacements) {
    const absolutePath = path.join(root, replacement.relativePath);
    if (replacement.content === null) removeFile(absolutePath);
    else writeAtomic(absolutePath, replacement.content);
  }
  for (const replacement of replacements) {
    if (replacement.content === null) {
      database.prepare("DELETE FROM sync_files WHERE canonical_path = ?").run(replacement.relativePath);
      continue;
    }
    const record = typedReplacementRecord(replacement, workspace.workspaceId);
    fileMetadata(
      database,
      replacement.relativePath,
      replacement.kind,
      replacement.kind === "task" ? (record as CanonicalTaskFile).id : (record as CanonicalOrderFile).parentId,
      path.join(root, replacement.relativePath),
      record,
    );
  }
  return pending;
}

function rollbackReplacementSet(databasePath: string, root: string, replacements: FileReplacement[]): void {
  for (const replacement of replacements) {
    const absolutePath = path.join(root, replacement.relativePath);
    if (replacement.previousContent === null) removeFile(absolutePath);
    else writeAtomic(absolutePath, replacement.previousContent);
  }
  clearPending(databasePath);
}

function buildDeletion(
  database: DatabaseSync,
  root: string,
  workspaceId: string,
  id: string,
  kind: Exclude<FileKind, "workspace">,
  parentId: ParentId,
): FileReplacement {
  const relativePath = kind === "task" ? taskRelativePath(id) : orderRelativePath(parentId);
  const previous = previousFile(database, path.join(root, relativePath), relativePath, kind, workspaceId);
  return { relativePath, kind, previousContent: previous.content, content: null };
}

export function withCanonicalTransaction<T extends Record<string, unknown>>(
  database: DatabaseSync,
  databasePath: string,
  request: ProtocolRequest,
  affected: () => CanonicalAffected | null,
  action: () => T,
): T {
  const root = canonicalRootPath(databasePath);
  const workspace = workspaceForDatabase(database, root).record;
  const modifiedBy = deviceId(databasePath);
  let pending: PendingOperation | undefined;
  let committed = false;
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    const scope = affected();
    if (scope !== null) {
      const replacements: FileReplacement[] = [];
      const taskIds = [...new Set(scope.taskIds ?? [])];
      const deletedTaskIds = [...new Set(scope.deletedTaskIds ?? [])];
      const deletedOrderParentIds = [...new Set(scope.deletedOrderParentIds ?? [])];
      const deletedOrderSet = new Set(deletedOrderParentIds);
      const orderParentIds = [...new Set(scope.orderParentIds ?? [])].filter((parentId) => !deletedOrderSet.has(parentId));
      for (const id of deletedTaskIds) {
        replacements.push(buildDeletion(database, root, workspace.workspaceId, id, "task", null));
      }
      for (const id of taskIds) {
        const replacement = buildReplacement(database, root, workspace.workspaceId, id, "task", null, modifiedBy);
        if (replacement) replacements.push(replacement);
      }
      for (const parentId of deletedOrderParentIds) {
        replacements.push(buildDeletion(database, root, workspace.workspaceId, parentId ?? "root", "order", parentId));
      }
      for (const parentId of orderParentIds) {
        const replacement = buildReplacement(database, root, workspace.workspaceId, parentId ?? "root", "order", parentId, modifiedBy);
        if (replacement) replacements.push(replacement);
      }
      if (replacements.length > 0) {
        pending = applyReplacementSet(database, databasePath, root, workspace, request, result, replacements);
      }
    }
    database.exec("COMMIT");
    committed = true;
    if (pending) clearPending(databasePath);
    return result;
  } catch (error) {
    if (!committed) {
      try {
        database.exec("ROLLBACK");
      } catch (rollbackError) {
        if (!(rollbackError instanceof Error)) throw rollbackError;
      }
      if (pending) rollbackReplacementSet(databasePath, root, pending.replacements);
    }
    throw error;
  }
}

export function listCanonicalConflicts(database: DatabaseSync): Record<string, unknown> {
  const rows = database
    .prepare(
      `SELECT id, canonical_path, source_path, kind, workspace_id, content_hash, based_on_hash, revision, modified_by, record_json, status, detected_at
       FROM sync_conflicts
       ORDER BY id DESC`,
    )
    .all() as Row[];
  return {
    conflicts: rows.map((row) => ({
      id: numberValue(row, "id"),
      canonicalPath: stringValue(row, "canonical_path"),
      sourcePath: stringValue(row, "source_path"),
      kind: stringValue(row, "kind"),
      workspaceId: stringValue(row, "workspace_id"),
      contentHash: stringValue(row, "content_hash"),
      basedOnHash: nullableStringValue(row, "based_on_hash"),
      revision: numberValue(row, "revision"),
      modifiedBy: stringValue(row, "modified_by"),
      record: parseJson(stringValue(row, "record_json"), "sync conflict"),
      status: stringValue(row, "status"),
      detectedAt: stringValue(row, "detected_at"),
    })),
  };
}

function conflictId(args: Row): number {
  const value = args.conflictId ?? args.id;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw commandError("INVALID_ARGUMENT", "conflictId must be a positive integer");
  }
  return value;
}

function conflictResolution(args: Row): "keep-canonical" | "use-conflict" | "discard" {
  const value = args.resolution ?? args.choice ?? args.action;
  if (value === "keep-canonical" || value === "canonical") return "keep-canonical";
  if (value === "use-conflict" || value === "candidate" || value === "conflict") return "use-conflict";
  if (value === "discard") return "discard";
  throw commandError("INVALID_ARGUMENT", "resolution must be keep-canonical, use-conflict, or discard");
}

export function resolveCanonicalConflict(
  database: DatabaseSync,
  databasePath: string,
  request: ProtocolRequest,
): Record<string, unknown> {
  const context = mutationReceipt(database, request);
  if (context.replay) return context.replay;
  const id = conflictId(request.args);
  const resolution = conflictResolution(request.args);
  const row = database.prepare("SELECT * FROM sync_conflicts WHERE id = ?").get(id) as Row | undefined;
  if (!row) throw commandError("CONFLICT_NOT_FOUND", `sync conflict ${id} was not found`);
  if (stringValue(row, "status") !== "unresolved") {
    throw commandError("CONFLICT_RESOLVED", `sync conflict ${id} is already resolved`);
  }
  const root = canonicalRootPath(databasePath);
  const workspace = workspaceForDatabase(database, root).record;
  const kind = stringValue(row, "kind");
  const recordValue = parseJson(stringValue(row, "record_json"), "sync conflict");
  const record = kind === "task"
    ? validateTaskRecord(recordValue, workspace.workspaceId, "", false)
    : validateOrderRecord(recordValue, workspace.workspaceId, "", false);
  if (request.readOnly || request.dryRun) {
    return {
      conflictId: id,
      resolution,
      record,
      dryRun: true,
      readOnly: Boolean(request.readOnly),
    };
  }

  if (resolution !== "use-conflict") {
    return withTransaction(database, () => {
      database.prepare("UPDATE sync_conflicts SET status = ? WHERE id = ?").run(resolution === "discard" ? "discarded" : "resolved", id);
      const result = { conflictId: id, resolution };
      database
        .prepare("INSERT INTO command_receipts (idempotency_key, command, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(context.key, request.command, context.hash, JSON.stringify(result), new Date().toISOString());
      return result;
    });
  }

  let applied = false;
  return withCanonicalTransaction(
    database,
    databasePath,
    request,
    () => kind === "task"
      ? { taskIds: [(record as CanonicalTaskFile).id] }
      : { orderParentIds: [(record as CanonicalOrderFile).parentId] },
    () => {
      applied = kind === "task"
        ? applyTaskCandidate(database, record as CanonicalTaskFile, undefined)
        : applyOrderCandidate(database, record as CanonicalOrderFile);
      if (!applied) throw commandError("INVALID_CANONICAL", `sync conflict ${id} cannot be applied yet`);
      database.prepare("UPDATE sync_conflicts SET status = 'resolved' WHERE id = ?").run(id);
      const result = { conflictId: id, resolution };
      database
        .prepare("INSERT INTO command_receipts (idempotency_key, command, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(context.key, request.command, context.hash, JSON.stringify(result), new Date().toISOString());
      return result;
    },
  );
}

function mutationReceipt(database: DatabaseSync, request: ProtocolRequest): { hash: string; key: string; replay: Record<string, unknown> | null } {
  const key = request.idempotencyKey;
  if (!key) throw commandError("IDEMPOTENCY_REQUIRED", `${request.command} requires idempotencyKey`);
  const hash = requestHash(request);
  const row = database.prepare("SELECT request_hash, response_json FROM command_receipts WHERE idempotency_key = ?").get(key) as Row | undefined;
  if (!row) return { hash, key, replay: null };
  if (stringValue(row, "request_hash") !== hash) throw commandError("IDEMPOTENCY_KEY_REUSED", "idempotencyKey was already used for a different request");
  const result = parseJson(stringValue(row, "response_json"), "command receipt");
  if (!isRecord(result)) throw commandError("INVALID_STORAGE", "stored command receipt is not an object");
  return { hash, key, replay: result };
}

export function rebuildCanonicalCache(database: DatabaseSync, databasePath: string, request: ProtocolRequest): Record<string, unknown> {
  const context = mutationReceipt(database, request);
  if (context.replay) return context.replay;
  const root = canonicalRootPath(databasePath);
  const workspace = workspaceForDatabase(database, root).record;
  const scan = scanCanonicalFiles(database, root, workspace.workspaceId, true);
  if (scan.skipped > 0) throw commandError("INVALID_CANONICAL", "cannot rebuild from incomplete canonical files");
  const currentGeneration = cacheGeneration(database);
  const nextGeneration = currentGeneration + 1;
  if (request.readOnly || request.dryRun) {
    return {
      taskCount: scan.candidates.filter((candidate) => candidate.kind === "task" && !candidate.conflict).length,
      cacheGeneration: nextGeneration,
      dryRun: true,
      readOnly: Boolean(request.readOnly),
    };
  }

  return withTransaction(database, () => {
    database.exec("DELETE FROM task_dependencies; DELETE FROM task_tags; DELETE FROM activity; DELETE FROM operation_effects; DELETE FROM operations; DELETE FROM tasks; DELETE FROM categories; DELETE FROM tags; DELETE FROM sync_files; DELETE FROM sync_conflicts;");
    setCacheGeneration(database, nextGeneration);
    const applied = applyCandidates(database, workspace.workspaceId, scan.candidates, freshVersionForGeneration(nextGeneration), true);
    const requiredPaths = scan.candidates.filter((candidate) => !candidate.conflict).map((candidate) => candidate.relativePath);
    if (requiredPaths.some((relativePath) => !applied.appliedPaths.includes(relativePath))) {
      throw commandError("INVALID_CANONICAL", "canonical relationships are incomplete; rebuild was not applied");
    }
    for (const candidate of scan.candidates) {
      if (candidate.conflict || applied.appliedPaths.includes(candidate.relativePath)) recordCandidateMetadata(database, candidate);
    }
    const result = {
      taskCount: applied.tasks,
      orderCount: applied.orders,
      conflictCount: applied.conflicts,
      cacheGeneration: nextGeneration,
    };
    database
      .prepare("INSERT INTO command_receipts (idempotency_key, command, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(context.key, request.command, context.hash, JSON.stringify(result), new Date().toISOString());
    return result;
  });
}

export function canonicalWorkspaceStatus(database: DatabaseSync, databasePath: string): Record<string, unknown> {
  const root = canonicalRootPath(databasePath);
  const workspace = workspaceForDatabase(database, root).record;
  const taskFiles = listDirectory(path.join(root, "tasks")).filter((name) => canonicalFileName(name)).length;
  const orderFiles = listDirectory(path.join(root, "order")).filter((name) => name === "root.json" || canonicalFileName(name)).length;
  const conflicts = numberValue(database.prepare("SELECT COUNT(*) AS count FROM sync_conflicts WHERE status = 'unresolved'").get() as Row, "count");
  return {
    rootPath: root,
    workspaceId: workspace.workspaceId,
    taskFileCount: taskFiles,
    orderFileCount: orderFiles,
    unresolvedConflictCount: conflicts,
    cacheGeneration: cacheGeneration(database),
  };
}

export function archiveCanonicalWorkspace(databasePath: string, request: ProtocolRequest): Record<string, unknown> {
  const root = canonicalRootPath(databasePath);
  const workspace = readText(workspaceFile(root));
  if (workspace === null) throw commandError("INVALID_CANONICAL", "workspace.json is missing");
  const timestamp = new Date().toISOString().replaceAll(":", "").replace(".", "");
  const archiveDirectory = path.join(path.dirname(root), "archives");
  const archiveStem = `canonical-${timestamp}`;
  let archiveRoot = path.join(archiveDirectory, archiveStem);
  for (let suffix = 2; existsSync(archiveRoot) && suffix <= 1000; suffix += 1) {
    archiveRoot = path.join(archiveDirectory, `${archiveStem}-${suffix}`);
  }
  if (request.readOnly || request.dryRun) return { destinationPath: archiveRoot, dryRun: true, readOnly: Boolean(request.readOnly) };
  if (existsSync(archiveRoot)) throw commandError("ARCHIVE_EXISTS", `archive destination already exists: ${archiveRoot}`);
  mkdirSync(archiveRoot, { recursive: true });
  const copyDirectory = (relativeDirectory: string): void => {
    const sourceDirectory = path.join(root, relativeDirectory);
    const destinationDirectory = path.join(archiveRoot, relativeDirectory);
    mkdirSync(destinationDirectory, { recursive: true });
    for (const name of listDirectory(sourceDirectory)) {
      const source = path.join(sourceDirectory, name);
      writeAtomic(path.join(destinationDirectory, name), readFileSync(source, "utf8"));
    }
  };
  writeAtomic(workspaceFile(archiveRoot), workspace);
  copyDirectory("tasks");
  copyDirectory("order");
  return { destinationPath: archiveRoot };
}
