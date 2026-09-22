import { canonicalJson } from "../backend/canonicalJson";
import { classifyTaskFields, TaskTextError, type TaskClassification } from "../backend/taskText";
import type { TaskPriority, TaskRecord, TaskStatus } from "../backend/protocol";
import { androidStorage, type AndroidImportedTask, type AndroidPendingWrite } from "./androidStorage";
import { getAndroidSyncFolder, readAndroidCanonicalFiles, writeAndroidCanonicalFiles, type AndroidCanonicalFile } from "./androidWorkspace";
import { filesToRecover } from "./androidPendingWrite";

type JsonRecord = Record<string, unknown>;
type ParentId = string | null;

type CanonicalSync = {
  revision: number;
  modifiedBy: string;
  basedOnHash: string | null;
  contentHash: string;
};

type CanonicalWorkspace = {
  format: "tasks.workspace";
  formatVersion: 1;
  workspaceId: string;
  schemaVersion: 1;
};

type CanonicalTask = {
  format: "tasks.task";
  formatVersion: 1;
  workspaceId: string;
  id: string;
  title: string;
  descriptionMarkdown: string;
  status: TaskStatus;
  priority: TaskPriority;
  parentId: string | null;
  dependencyIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  canceledAt: string | null;
  sync: CanonicalSync;
};

type CanonicalOrder = {
  format: "tasks.sibling-order";
  formatVersion: 1;
  workspaceId: string;
  parentId: string | null;
  taskIds: string[];
  sync: CanonicalSync;
};

type ImportedWorkspace = {
  workspaceId: string;
  fingerprint: string;
  tasks: AndroidImportedTask[];
};

export type AndroidSyncResult = {
  selected: boolean;
  changed: boolean;
  workspaceId?: string;
  taskCount?: number;
  workspaceRevision?: number;
};

export class AndroidCanonicalError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AndroidCanonicalError";
    this.code = code;
  }
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const HASH = /^[a-f0-9]{64}$/;
const STATUSES = new Set<TaskStatus>(["open", "in_progress", "paused", "done", "canceled"]);
const PRIORITIES = new Set<TaskPriority>([0, 1, 2, 3, 4]);

function invalid(message: string): never {
  throw new AndroidCanonicalError("INVALID_CANONICAL", message);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string") invalid(`${field} must be text`);
  return value;
}

function nullableStringValue(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") invalid(`${field} must be text or null`);
  return value;
}

function requiredId(value: unknown, field: string): string {
  const id = stringValue(value, field);
  if (!SAFE_ID.test(id)) invalid(`${field} cannot be used as a file name`);
  return id;
}

function parseJson(content: string, relativePath: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    invalid(`${relativePath} is not complete JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateSync(value: unknown, relativePath: string): CanonicalSync {
  if (!isRecord(value)
    || typeof value.revision !== "number"
    || !Number.isInteger(value.revision)
    || value.revision < 1
    || typeof value.modifiedBy !== "string"
    || value.modifiedBy.trim() === ""
    || (value.basedOnHash !== null && (typeof value.basedOnHash !== "string" || value.basedOnHash.trim() === ""))
    || typeof value.contentHash !== "string"
    || !HASH.test(value.contentHash)) {
    invalid(`${relativePath} has invalid sync metadata`);
  }
  return {
    revision: value.revision,
    modifiedBy: value.modifiedBy,
    basedOnHash: value.basedOnHash,
    contentHash: value.contentHash,
  };
}

function withoutHash(record: CanonicalTask | CanonicalOrder): JsonRecord {
  const { sync, ...content } = record;
  return {
    ...content,
    sync: {
      revision: sync.revision,
      modifiedBy: sync.modifiedBy,
      basedOnHash: sync.basedOnHash,
    },
  };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function validateContentHash(record: CanonicalTask | CanonicalOrder, relativePath: string): Promise<void> {
  const actual = await sha256(canonicalJson(withoutHash(record)));
  if (actual !== record.sync.contentHash) invalid(`${relativePath} has an invalid content hash`);
}

function parseWorkspace(value: unknown): CanonicalWorkspace {
  if (!isRecord(value)
    || value.format !== "tasks.workspace"
    || value.formatVersion !== 1
    || typeof value.workspaceId !== "string"
    || value.workspaceId.trim() === ""
    || value.schemaVersion !== 1) {
    invalid("workspace.json does not contain a supported workspace record");
  }
  return {
    format: "tasks.workspace",
    formatVersion: 1,
    workspaceId: value.workspaceId,
    schemaVersion: 1,
  };
}

async function parseTask(file: AndroidCanonicalFile, workspaceId: string, expectedId: string): Promise<CanonicalTask> {
  const value = parseJson(file.content, file.relativePath);
  if (!isRecord(value)
    || value.format !== "tasks.task"
    || value.formatVersion !== 1
    || value.workspaceId !== workspaceId
    || typeof value.id !== "string"
    || value.id !== expectedId
    || typeof value.title !== "string"
    || value.title.trim() === ""
    || value.title.length > 1000
    || typeof value.descriptionMarkdown !== "string"
    || value.descriptionMarkdown.length > 10000
    || (value.parentId !== null && typeof value.parentId !== "string")
    || !Array.isArray(value.dependencyIds)
    || !value.dependencyIds.every((id) => typeof id === "string" && SAFE_ID.test(id))
    || typeof value.createdAt !== "string"
    || typeof value.updatedAt !== "string"
    || (value.completedAt !== null && typeof value.completedAt !== "string")
    || (value.canceledAt !== null && typeof value.canceledAt !== "string")
    || typeof value.status !== "string"
    || !STATUSES.has(value.status as TaskStatus)
    || typeof value.priority !== "number"
    || !Number.isInteger(value.priority)
    || !PRIORITIES.has(value.priority as TaskPriority)) {
    invalid(`${file.relativePath} has invalid task fields`);
  }

  const id = requiredId(value.id, "task id");
  const parentId = nullableStringValue(value.parentId, "parentId");
  if (parentId !== null && !SAFE_ID.test(parentId)) invalid(`task ${id} has an invalid parent id`);
  const dependencyIds = [...value.dependencyIds] as string[];
  if (dependencyIds.includes(id) || new Set(dependencyIds).size !== dependencyIds.length) {
    invalid(`task ${id} has invalid dependency ids`);
  }
  if ((value.status === "done") !== (value.completedAt !== null) || (value.status === "canceled") !== (value.canceledAt !== null)) {
    invalid(`task ${id} has inconsistent terminal timestamps`);
  }

  const record = {
    format: "tasks.task" as const,
    formatVersion: 1 as const,
    workspaceId,
    id,
    title: value.title,
    descriptionMarkdown: value.descriptionMarkdown,
    status: value.status as TaskStatus,
    priority: value.priority as TaskPriority,
    parentId,
    dependencyIds,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    completedAt: value.completedAt as string | null,
    canceledAt: value.canceledAt as string | null,
    sync: validateSync(value.sync, file.relativePath),
  } satisfies CanonicalTask;
  await validateContentHash(record, file.relativePath);
  return record;
}

async function parseOrder(file: AndroidCanonicalFile, workspaceId: string, expectedParentId: ParentId): Promise<CanonicalOrder> {
  const value = parseJson(file.content, file.relativePath);
  if (!isRecord(value)
    || value.format !== "tasks.sibling-order"
    || value.formatVersion !== 1
    || value.workspaceId !== workspaceId
    || (value.parentId !== null && typeof value.parentId !== "string")
    || !Array.isArray(value.taskIds)
    || !value.taskIds.every((id) => typeof id === "string" && SAFE_ID.test(id))
    || (expectedParentId === null ? value.parentId !== null : value.parentId !== expectedParentId)) {
    invalid(`${file.relativePath} has invalid order fields`);
  }
  const taskIds = [...value.taskIds] as string[];
  if (new Set(taskIds).size !== taskIds.length) invalid(`${file.relativePath} contains duplicate task ids`);
  const parentId = nullableStringValue(value.parentId, "parentId");
  if (parentId !== null && !SAFE_ID.test(parentId)) invalid(`${file.relativePath} has an invalid parent id`);
  const record = {
    format: "tasks.sibling-order" as const,
    formatVersion: 1 as const,
    workspaceId,
    parentId,
    taskIds,
    sync: validateSync(value.sync, file.relativePath),
  } satisfies CanonicalOrder;
  await validateContentHash(record, file.relativePath);
  return record;
}

function canonicalTaskPath(relativePath: string): string | null {
  const match = /^tasks\/([A-Za-z0-9_-]+)\.json$/.exec(relativePath);
  return match?.[1] ?? null;
}

function canonicalOrderParent(relativePath: string): ParentId | undefined {
  if (relativePath === "order/root.json") return null;
  const match = /^order\/([A-Za-z0-9_-]+)\.json$/.exec(relativePath);
  return match?.[1];
}

function classification(record: CanonicalTask): TaskClassification {
  try {
    return classifyTaskFields(record.title, record.descriptionMarkdown);
  } catch (error) {
    if (error instanceof TaskTextError) {
      throw new AndroidCanonicalError(error.code, error.message);
    }
    throw error;
  }
}

function validateRelationships(tasks: CanonicalTask[]): void {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const task of tasks) {
    if (task.parentId !== null && !byId.has(task.parentId)) invalid(`task ${task.id} refers to missing parent ${task.parentId}`);
    for (const dependencyId of task.dependencyIds) {
      if (!byId.has(dependencyId)) invalid(`task ${task.id} refers to missing dependency ${dependencyId}`);
    }

    const parents = new Set<string>();
    let parentId = task.parentId;
    while (parentId !== null) {
      if (parentId === task.id || parents.has(parentId)) invalid(`task ${task.id} would create a parent cycle`);
      parents.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) invalid(`task ${id} would create a dependency cycle`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependencyId of byId.get(id)?.dependencyIds ?? []) visit(dependencyId);
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of tasks) visit(task.id);
}

function siblingIds(tasks: CanonicalTask[], parentId: ParentId): string[] {
  return tasks
    .filter((task) => task.parentId === parentId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
    .map((task) => task.id);
}

function applyOrderPositions(tasks: CanonicalTask[], orders: CanonicalOrder[]): Map<string, number> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const positions = new Map<string, number>();
  const ordersByParent = new Map<ParentId, CanonicalOrder>();
  for (const order of orders) {
    if (order.parentId !== null && !byId.has(order.parentId)) invalid(`order for ${order.parentId} refers to a missing parent`);
    ordersByParent.set(order.parentId, order);
  }

  const parentIds = new Set<ParentId>(tasks.map((task) => task.parentId));
  for (const order of orders) parentIds.add(order.parentId);
  for (const parentId of parentIds) {
    const knownSiblings = new Set(siblingIds(tasks, parentId));
    const order = ordersByParent.get(parentId);
    const listed = order?.taskIds ?? [];
    for (const id of listed) {
      const task = byId.get(id);
      if (!task) invalid(`order for ${parentId ?? "root"} contains unknown task ${id}`);
      if (task.parentId !== parentId) invalid(`order for ${parentId ?? "root"} contains task ${id} from another scope`);
    }
    const missing = [...knownSiblings].filter((id) => !listed.includes(id));
    const finalIds = [...missing, ...listed];
    finalIds.forEach((id, position) => positions.set(id, position));
  }
  return positions;
}

function orderTasksByParents(tasks: AndroidImportedTask[]): AndroidImportedTask[] {
  const remaining = [...tasks];
  const ordered: AndroidImportedTask[] = [];
  const known = new Set<string>();
  while (remaining.length > 0) {
    const ready = remaining.filter((task) => task.parentId === null || known.has(task.parentId));
    if (ready.length === 0) invalid("canonical task parents cannot be resolved");
    for (const task of ready) {
      ordered.push(task);
      known.add(task.id);
      remaining.splice(remaining.indexOf(task), 1);
    }
  }
  return ordered;
}

async function parseWorkspaceFiles(files: AndroidCanonicalFile[]): Promise<ImportedWorkspace> {
  const byPath = new Map<string, AndroidCanonicalFile>();
  for (const file of files) {
    if (byPath.has(file.relativePath)) invalid(`canonical path ${file.relativePath} appears more than once`);
    byPath.set(file.relativePath, file);
  }
  const workspaceFile = byPath.get("workspace.json");
  if (!workspaceFile) invalid("workspace.json is missing from the selected sync folder");
  const workspace = parseWorkspace(parseJson(workspaceFile.content, "workspace.json"));

  const taskRecords: CanonicalTask[] = [];
  for (const file of files) {
    const expectedId = canonicalTaskPath(file.relativePath);
    if (expectedId !== null) taskRecords.push(await parseTask(file, workspace.workspaceId, expectedId));
  }
  const orderRecords: CanonicalOrder[] = [];
  for (const file of files) {
    const expectedParentId = canonicalOrderParent(file.relativePath);
    if (expectedParentId !== undefined) orderRecords.push(await parseOrder(file, workspace.workspaceId, expectedParentId));
  }
  if (new Set(taskRecords.map((task) => task.id)).size !== taskRecords.length) invalid("canonical task ids are duplicated");
  validateRelationships(taskRecords);
  const positions = applyOrderPositions(taskRecords, orderRecords);
  const imported = orderTasksByParents(taskRecords.map((record) => {
    const parsed = classification(record);
    return {
      id: record.id,
      title: record.title,
      descriptionMarkdown: record.descriptionMarkdown,
      status: record.status,
      priority: record.priority,
      category: parsed.category,
      tags: parsed.tags,
      parentId: record.parentId,
      dependencyIds: [...record.dependencyIds],
      position: positions.get(record.id) ?? 0,
      version: record.sync.revision,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      completedAt: record.completedAt,
      canceledAt: record.canceledAt,
    } satisfies AndroidImportedTask;
  }));

  const fingerprint = await sha256(canonicalJson(files
    .map((file) => ({ relativePath: file.relativePath, content: file.content }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))));
  return { workspaceId: workspace.workspaceId, fingerprint, tasks: imported };
}

function serialise(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function androidDeviceId(): string {
  const key = "tasks.android.deviceId";
  try {
    const stored = localStorage.getItem(key);
    if (stored) return stored;
    const created = `android-${crypto.randomUUID()}`;
    localStorage.setItem(key, created);
    return created;
  } catch {
    return "android-session";
  }
}

export async function writeAndroidCreatedTask(
  task: TaskRecord,
  receipt: Pick<AndroidPendingWrite, "operationId" | "idempotencyKey" | "requestHash" | "responseJson" | "createdAt">,
): Promise<boolean> {
  const result = await readAndroidCanonicalFiles();
  if (!result.selected) return false;
  const current = await parseWorkspaceFiles(result.files);
  const filesByPath = new Map(result.files.map((file) => [file.relativePath, file]));
  const modifiedBy = androidDeviceId();
  const taskSync: CanonicalSync = {
    revision: 1,
    modifiedBy,
    basedOnHash: null,
    contentHash: "",
  };
  const canonicalTask: CanonicalTask = {
    format: "tasks.task",
    formatVersion: 1,
    workspaceId: current.workspaceId,
    id: task.id,
    title: task.title,
    descriptionMarkdown: task.descriptionMarkdown,
    status: task.status,
    priority: task.priority,
    parentId: task.parentId,
    dependencyIds: [...task.dependencyIds],
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
    canceledAt: task.canceledAt,
    sync: taskSync,
  };
  canonicalTask.sync.contentHash = await sha256(canonicalJson(withoutHash(canonicalTask)));

  const orderPath = task.parentId === null ? "order/root.json" : `order/${task.parentId}.json`;
  const previousOrderFile = filesByPath.get(orderPath);
  const previousOrder = previousOrderFile
    ? await parseOrder(previousOrderFile, current.workspaceId, task.parentId)
    : null;
  const existingIds = previousOrder?.taskIds
    ?? current.tasks
      .filter((entry) => entry.parentId === task.parentId)
      .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
      .map((entry) => entry.id);
  const orderSync: CanonicalSync = {
    revision: (previousOrder?.sync.revision ?? 0) + 1,
    modifiedBy,
    basedOnHash: previousOrder?.sync.contentHash ?? null,
    contentHash: "",
  };
  const canonicalOrder: CanonicalOrder = {
    format: "tasks.sibling-order",
    formatVersion: 1,
    workspaceId: current.workspaceId,
    parentId: task.parentId,
    taskIds: [task.id, ...existingIds.filter((id) => id !== task.id)],
    sync: orderSync,
  };
  canonicalOrder.sync.contentHash = await sha256(canonicalJson(withoutHash(canonicalOrder)));

  const folder = await getAndroidSyncFolder();
  if (!folder) invalid("the selected Android sync folder is no longer accessible");
  const pending: AndroidPendingWrite = {
    ...receipt,
    workspaceId: current.workspaceId,
    folderUri: folder.uri,
    files: [
      { relativePath: `tasks/${task.id}.json`, previousContent: null, content: serialise(canonicalTask) },
      { relativePath: orderPath, previousContent: previousOrderFile?.content ?? null, content: serialise(canonicalOrder) },
    ],
  };
  if (filesByPath.has(pending.files[0].relativePath)) invalid("new Android task id already exists in the sync folder");
  await androidStorage({ operation: "stageCanonicalWrite", pending });
  await writeAndroidCanonicalFiles(pending.files.map((file) => ({ ...file, modifiedAt: null })));
  await verifyPendingFiles(pending);
  return true;
}

export async function writeAndroidUpdatedTasks(
  tasks: TaskRecord[],
  receipt: Pick<AndroidPendingWrite, "operationId" | "idempotencyKey" | "requestHash" | "responseJson" | "createdAt">,
  orders: Array<{ parentId: ParentId; taskIds: string[] }> = [],
): Promise<boolean> {
  const result = await readAndroidCanonicalFiles();
  if (!result.selected) return false;
  const current = await parseWorkspaceFiles(result.files);
  const filesByPath = new Map(result.files.map((file) => [file.relativePath, file]));
  const files: AndroidPendingWrite["files"] = [];
  for (const task of tasks) {
    const relativePath = `tasks/${task.id}.json`;
    const previousFile = filesByPath.get(relativePath);
    if (!previousFile) invalid(`task ${task.id} is missing from the selected folder`);
    const previous = await parseTask(previousFile, current.workspaceId, task.id);
    if (previous.sync.revision !== task.version - 1) {
      throw new AndroidCanonicalError("STALE_TASK_VERSION", `task ${task.id} changed in the selected folder`);
    }
    const canonicalTask: CanonicalTask = {
      ...previous,
      title: task.title,
      descriptionMarkdown: task.descriptionMarkdown,
      status: task.status,
      priority: task.priority,
      parentId: task.parentId,
      dependencyIds: [...task.dependencyIds],
      completedAt: task.completedAt,
      canceledAt: task.canceledAt,
      updatedAt: task.updatedAt,
      sync: {
        revision: task.version,
        modifiedBy: androidDeviceId(),
        basedOnHash: previous.sync.contentHash,
        contentHash: "",
      },
    };
    canonicalTask.sync.contentHash = await sha256(canonicalJson(withoutHash(canonicalTask)));
    files.push({ relativePath, previousContent: previousFile.content, content: serialise(canonicalTask) });
    if (previous.parentId !== task.parentId) {
      for (const parentId of [previous.parentId, task.parentId]) {
        const orderPath = parentId === null ? "order/root.json" : `order/${parentId}.json`;
        const oldFile = filesByPath.get(orderPath);
        const oldOrder = oldFile ? await parseOrder(oldFile, current.workspaceId, parentId) : null;
        const siblings = current.tasks
          .filter((entry) => entry.parentId === parentId)
          .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
          .map((entry) => entry.id);
        const order: CanonicalOrder = {
          format: "tasks.sibling-order",
          formatVersion: 1,
          workspaceId: current.workspaceId,
          parentId,
          taskIds: parentId === previous.parentId
            ? siblings.filter((id) => id !== task.id)
            : [task.id, ...siblings.filter((id) => id !== task.id)],
          sync: {
            revision: (oldOrder?.sync.revision ?? 0) + 1,
            modifiedBy: androidDeviceId(),
            basedOnHash: oldOrder?.sync.contentHash ?? null,
            contentHash: "",
          },
        };
        order.sync.contentHash = await sha256(canonicalJson(withoutHash(order)));
        files.push({ relativePath: orderPath, previousContent: oldFile?.content ?? null, content: serialise(order) });
      }
    }
  }
  for (const { parentId, taskIds } of orders) {
    const siblings = current.tasks.filter((task) => task.parentId === parentId).map((task) => task.id);
    if (siblings.length !== taskIds.length || new Set(taskIds).size !== taskIds.length || taskIds.some((id) => !siblings.includes(id))) {
      throw new AndroidCanonicalError("STALE_TASK_VERSION", "sibling order changed in the selected folder");
    }
    const orderPath = parentId === null ? "order/root.json" : `order/${parentId}.json`;
    const oldFile = filesByPath.get(orderPath);
    const oldOrder = oldFile ? await parseOrder(oldFile, current.workspaceId, parentId) : null;
    const order: CanonicalOrder = {
      format: "tasks.sibling-order", formatVersion: 1, workspaceId: current.workspaceId, parentId, taskIds,
      sync: {
        revision: (oldOrder?.sync.revision ?? 0) + 1,
        modifiedBy: androidDeviceId(),
        basedOnHash: oldOrder?.sync.contentHash ?? null,
        contentHash: "",
      },
    };
    order.sync.contentHash = await sha256(canonicalJson(withoutHash(order)));
    files.push({ relativePath: orderPath, previousContent: oldFile?.content ?? null, content: serialise(order) });
  }
  const folder = await getAndroidSyncFolder();
  if (!folder) invalid("the selected Android sync folder is no longer accessible");
  const pending: AndroidPendingWrite = { ...receipt, workspaceId: current.workspaceId, folderUri: folder.uri, files };
  await androidStorage({ operation: "stageCanonicalWrite", pending });
  await writeAndroidCanonicalFiles(files.map((file) => ({ ...file, modifiedAt: null })));
  await verifyPendingFiles(pending);
  return true;
}

async function verifyPendingFiles(pending: AndroidPendingWrite): Promise<void> {
  const selected = await getAndroidSyncFolder();
  if (selected?.uri !== pending.folderUri) invalid("reselect the original Android sync folder to recover the pending write");
  const result = await readAndroidCanonicalFiles();
  if (!result.selected) invalid("the Android sync folder is no longer accessible");
  const files = new Map(result.files.map((file) => [file.relativePath, file.content]));
  for (const file of pending.files) {
    if (files.get(file.relativePath) !== file.content) invalid(`Android did not persist ${file.relativePath}; retry recovery before editing`);
  }
}

async function recoverPendingWrite(): Promise<void> {
  const response = await androidStorage({ operation: "readPendingWrite" });
  const pending = response.pending as AndroidPendingWrite | null;
  if (!pending) return;
  const selected = await getAndroidSyncFolder();
  if (selected?.uri !== pending.folderUri) {
    throw new AndroidCanonicalError("PENDING_WRITE_FOLDER", "reselect the original Android sync folder to recover the interrupted task write");
  }
  const result = await readAndroidCanonicalFiles();
  if (!result.selected) invalid("the Android sync folder is unavailable during write recovery");
  const workspace = result.files.find((file) => file.relativePath === "workspace.json");
  if (!workspace || parseWorkspace(parseJson(workspace.content, "workspace.json")).workspaceId !== pending.workspaceId) {
    invalid("the Android sync folder changed workspace during write recovery");
  }
  let missing: AndroidPendingWrite["files"];
  try {
    missing = filesToRecover(pending, result.files);
  } catch (error) {
    throw new AndroidCanonicalError("PENDING_WRITE_CONFLICT", `${error instanceof Error ? error.message : String(error)}; resolve it before continuing`);
  }
  if (missing.length > 0) {
    await writeAndroidCanonicalFiles(missing.map((file) => ({ ...file, modifiedAt: null })));
  }
  await verifyPendingFiles(pending);
  await androidStorage({ operation: "completePendingWrite", operationId: pending.operationId });
}

export async function parseAndroidCanonicalWorkspace(files: AndroidCanonicalFile[]): Promise<ImportedWorkspace> {
  return parseWorkspaceFiles(files);
}

export async function syncAndroidWorkspace(): Promise<AndroidSyncResult> {
  await recoverPendingWrite();
  const result = await readAndroidCanonicalFiles();
  if (!result.selected) return { selected: false, changed: false };

  const imported = await parseWorkspaceFiles(result.files);
  const meta = await androidStorage({ operation: "readCanonicalMeta" });
  const previousWorkspaceId = meta.workspaceId;
  const previousFingerprint = meta.fingerprint;
  if (typeof previousWorkspaceId === "string" && previousWorkspaceId !== imported.workspaceId) {
    throw new AndroidCanonicalError(
      "WORKSPACE_ID_MISMATCH",
      "the selected Android sync folder belongs to a different Tasks workspace",
    );
  }
  if (previousFingerprint === imported.fingerprint && meta.cacheVersion === "2") {
    return {
      selected: true,
      changed: false,
      workspaceId: imported.workspaceId,
      taskCount: imported.tasks.length,
    };
  }

  const replaced = await androidStorage({
    operation: "replaceCanonicalWorkspace",
    workspaceId: imported.workspaceId,
    fingerprint: imported.fingerprint,
    tasks: imported.tasks,
  });
  return {
    selected: true,
    changed: true,
    workspaceId: imported.workspaceId,
    taskCount: imported.tasks.length,
    workspaceRevision: typeof replaced.workspaceRevision === "number" ? replaced.workspaceRevision : undefined,
  };
}
