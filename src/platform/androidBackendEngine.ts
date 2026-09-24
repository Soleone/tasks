import {
  PROTOCOL_VERSION,
  ProtocolError,
  parseTaskTransitionManyArgs,
  parseTaskReorderArgs,
  type ProtocolRequest,
  type ProtocolResponse,
  type TaskPriority,
  type TaskRecord,
  type TaskStatus,
} from "../backend/protocol";
import { canonicalJson } from "../backend/canonicalJson";
import { portableTaskExport } from "../backend/taskExport";
import { builtinThemes } from "../backend/builtinThemes";
import { GILT_THEME_NAME } from "../backend/themePalette";
import { classifyTaskText, TaskTextError } from "../backend/taskText";
import { androidStorage, type AndroidImportedTask, type AndroidStorageResponse, type AndroidTaskInput } from "./androidStorage";
import { AndroidCanonicalError, parseAndroidCanonicalWorkspace, syncAndroidWorkspace, writeAndroidCreatedTask, writeAndroidDeletedTask, writeAndroidPurgedTasks, writeAndroidUpdatedTasks } from "./androidCanonicalWorkspace";
import { sortAndroidTasks } from "./androidTaskSort";
import { listAndroidSyncConflicts, type AndroidSyncConflict } from "./androidSyncConflicts";
import { exportAndroidTaskDocument, getAndroidSyncFolder, readAndroidCanonicalFiles, type AndroidCanonicalFile } from "./androidWorkspace";
import { AndroidUndoError, planAndroidUndo, type SavedOperation, type SavedOrder } from "./androidUndo";
import { AndroidSiblingOrderConflict } from "./androidSiblingOrder";

const VALID_STATUSES = new Set<TaskStatus>(["open", "in_progress", "paused", "done", "canceled"]);

type AndroidSnapshot = {
  tasks: TaskRecord[];
  workspaceRevision: number;
  unresolvedConflicts?: AndroidSyncConflict[];
  taskVersionOffset: number;
  selected: boolean;
  workspaceId: string | null;
  folderUri: string | null;
  canonicalFiles: AndroidCanonicalFile[];
  canonicalTasks: AndroidImportedTask[];
};

type AndroidReceipt = {
  requestHash: string;
  responseJson: string;
};

class AndroidEngineError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AndroidEngineError";
    this.code = code;
  }
}

function responseError(request: ProtocolRequest, error: unknown): ProtocolResponse {
  if (error instanceof AndroidEngineError || error instanceof AndroidCanonicalError || error instanceof AndroidUndoError
      || error instanceof AndroidSiblingOrderConflict || error instanceof ProtocolError) {
    return {
      version: PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: false,
      error: { code: error.code, message: error.message },
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    version: PROTOCOL_VERSION,
    requestId: request.requestId,
    ok: false,
    error: { code: "ANDROID_STORAGE", message },
  };
}

function recordValue(response: AndroidStorageResponse, field: string): unknown {
  return response[field];
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AndroidEngineError("INVALID_ARGUMENT", `${field} must be a non-empty string`);
  }
  return value;
}

function priorityValue(value: unknown): TaskPriority {
  if (value === 0 || value === 1 || value === 2 || value === 3 || value === 4) return value;
  throw new AndroidEngineError("INVALID_ARGUMENT", "priority must be an integer from 0 to 4");
}

function statusValue(value: unknown): TaskStatus {
  if (typeof value === "string" && VALID_STATUSES.has(value as TaskStatus)) return value as TaskStatus;
  throw new AndroidEngineError("INVALID_ARGUMENT", "status contains an unsupported task status");
}

function textClassification(title: string): ReturnType<typeof classifyTaskText> {
  try {
    return classifyTaskText(title);
  } catch (error) {
    if (error instanceof TaskTextError) throw new AndroidEngineError(error.code, error.message);
    throw error;
  }
}

function previewTask(
  title: string,
  descriptionMarkdown: string,
  priority: TaskPriority,
  category: TaskRecord["category"],
  tags: TaskRecord["tags"],
  parentId: string | null,
): TaskRecord {
  const now = new Date().toISOString();
  return {
    id: "preview",
    title,
    descriptionMarkdown,
    status: "open",
    priority,
    category,
    tags,
    parentId,
    dependencyIds: [],
    blockedByIds: [],
    version: 1,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    canceledAt: null,
  };
}

function asSnapshot(
  response: AndroidStorageResponse,
): Pick<AndroidSnapshot, "tasks" | "workspaceRevision" | "taskVersionOffset"> {
  if (!Array.isArray(response.tasks) || typeof response.workspaceRevision !== "number"
      || typeof response.taskVersionOffset !== "number") {
    throw new AndroidEngineError("INVALID_STORAGE", "Android storage returned an invalid task snapshot");
  }
  return {
    tasks: response.tasks as TaskRecord[],
    workspaceRevision: response.workspaceRevision,
    taskVersionOffset: response.taskVersionOffset,
  };
}

async function snapshot(): Promise<AndroidSnapshot> {
  const sync = await syncAndroidWorkspace();
  return {
    ...asSnapshot(await androidStorage({ operation: "readSnapshot" })),
    ...(sync.unresolvedConflicts ? { unresolvedConflicts: sync.unresolvedConflicts } : {}),
    selected: sync.selected,
    workspaceId: sync.workspaceId ?? null,
    folderUri: sync.folderUri ?? null,
    canonicalFiles: sync.canonicalFiles ?? [],
    canonicalTasks: sync.canonicalTasks ?? [],
  };
}

async function requestHash(request: ProtocolRequest): Promise<string> {
  const payload = {
    actor: request.actor,
    args: request.args,
    command: request.command,
    dryRun: Boolean(request.dryRun),
    readOnly: Boolean(request.readOnly),
  };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(payload)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readReceipt(request: ProtocolRequest, hash: string): Promise<ProtocolResponse | null> {
  if (!request.idempotencyKey) {
    throw new AndroidEngineError("IDEMPOTENCY_REQUIRED", `${request.command} requires idempotencyKey`);
  }
  const response = await androidStorage({ operation: "readReceipt", idempotencyKey: request.idempotencyKey });
  const receiptValue = recordValue(response, "receipt");
  if (receiptValue === null || receiptValue === undefined) return null;
  if (typeof receiptValue !== "object" || Array.isArray(receiptValue)) {
    throw new AndroidEngineError("INVALID_STORAGE", "Android command receipt is invalid");
  }
  const receipt = receiptValue as AndroidReceipt;
  if (receipt.requestHash !== hash) {
    throw new AndroidEngineError("IDEMPOTENCY_KEY_REUSED", "idempotencyKey was already used for a different request");
  }
  let result: unknown;
  try {
    result = JSON.parse(receipt.responseJson);
  } catch {
    throw new AndroidEngineError("INVALID_STORAGE", "Android command receipt is not valid JSON");
  }
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw new AndroidEngineError("INVALID_STORAGE", "Android command receipt result is invalid");
  }
  return { version: PROTOCOL_VERSION, requestId: request.requestId, ok: true, result: result as Record<string, unknown> };
}

function transactionId(): string {
  return crypto.randomUUID();
}

async function writeReceipt(
  request: ProtocolRequest,
  hash: string,
  transaction: string,
  result: Record<string, unknown>,
  createdAt: string,
): Promise<void> {
  await androidStorage({
    operation: "writeReceipt",
    transactionId: transaction,
    idempotencyKey: request.idempotencyKey ?? "",
    command: request.command,
    requestHash: hash,
    responseJson: JSON.stringify(result),
    createdAt,
  });
}

async function createTask(request: ProtocolRequest): Promise<Record<string, unknown>> {
  const title = requiredText(request.args.title, "title").trim();
  const descriptionMarkdown = request.args.descriptionMarkdown === undefined ? "" : request.args.descriptionMarkdown;
  if (typeof descriptionMarkdown !== "string") {
    throw new AndroidEngineError("INVALID_ARGUMENT", "descriptionMarkdown must be a string");
  }
  if (title.length > 1000) throw new AndroidEngineError("INVALID_ARGUMENT", "title must be 1000 characters or fewer");
  if (descriptionMarkdown.length > 10000) throw new AndroidEngineError("INVALID_ARGUMENT", "descriptionMarkdown must be 10000 characters or fewer");

  const classification = textClassification(title);
  const priority = request.args.priority === undefined ? 2 : priorityValue(request.args.priority);
  const parentIdValue = request.args.parentId;
  const parentId = parentIdValue === undefined || parentIdValue === null ? null : requiredText(parentIdValue, "parentId");
  const current = await snapshot();
  const parent = parentId === null ? undefined : current.tasks.find((task) => task.id === parentId);
  if (parentId !== null && !parent) throw new AndroidEngineError("PARENT_NOT_FOUND", `parent task ${parentId} was not found`);
  if (parent?.status === "canceled") throw new AndroidEngineError("INVALID_PARENT", "a canceled task cannot be used as a parent; reopen it first");

  const preview = previewTask(title, descriptionMarkdown, priority, classification.category, classification.tags, parentId);
  if (request.readOnly || request.dryRun) {
    return { task: preview, dryRun: true, readOnly: Boolean(request.readOnly) };
  }

  const hash = await requestHash(request);
  const replay = await readReceipt(request, hash);
  if (replay?.ok) return replay.result;

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const operationId = crypto.randomUUID();
  const transaction = transactionId();
  const version = current.taskVersionOffset + 1;
  if (!Number.isSafeInteger(version)) throw new AndroidEngineError("INVALID_STORAGE", "Android task version is out of range");
  const task: TaskRecord = { ...preview, id, version, createdAt: now, updatedAt: now };
  const result = { task, operationId };
  let committed = false;
  try {
    const staged = await writeAndroidCreatedTask(task, {
      operationId,
      idempotencyKey: request.idempotencyKey ?? "",
      requestHash: hash,
      responseJson: JSON.stringify(result),
      createdAt: now,
    }, {
      selected: current.selected,
      workspaceId: current.workspaceId,
      folderUri: current.folderUri,
      files: current.canonicalFiles,
      canonicalTasks: current.canonicalTasks,
    });
    await androidStorage({ operation: "begin", transactionId: transaction });
    let categoryId: string | null = null;
    if (classification.category) {
      const result = await androidStorage({
        operation: "ensureCategory",
        transactionId: transaction,
        id: crypto.randomUUID(),
        slug: classification.category.slug,
        label: classification.category.label,
        now,
      });
      categoryId = requiredText(recordValue(result, "id"), "category id");
    }
    const tagIds: string[] = [];
    for (const tag of classification.tags) {
      const result = await androidStorage({
        operation: "ensureTag",
        transactionId: transaction,
        id: crypto.randomUUID(),
        slug: tag.slug,
        label: tag.label,
        now,
      });
      tagIds.push(requiredText(recordValue(result, "id"), "tag id"));
    }

    await androidStorage({ operation: "shiftSiblingPositions", transactionId: transaction, parentId });
    const input: AndroidTaskInput = {
      id,
      title,
      descriptionMarkdown,
      status: "open",
      categoryId,
      parentId,
      position: 0,
      priority,
      version,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      canceledAt: null,
    };
    await androidStorage({ operation: "insertTask", transactionId: transaction, task: input });
    for (const tagId of tagIds) {
      await androidStorage({ operation: "insertTaskTag", transactionId: transaction, taskId: id, tagId });
    }
    await androidStorage({
      operation: "insertActivity",
      transactionId: transaction,
      taskId: id,
      requestId: request.requestId,
      action: "created",
      actorKind: request.actor.kind,
      actorLabel: request.actor.label,
      createdAt: now,
      detailsJson: JSON.stringify({ title, priority, ...(parentId ? { parentId } : {}) }),
    });
    await androidStorage({ operation: "writeOperation", transactionId: transaction, record: {
      id: operationId, kind: "create", before: [], after: [task], beforeOrders: [], afterOrders: [],
    } satisfies SavedOperation });
    await writeReceipt(request, hash, transaction, result, now);
    await androidStorage({ operation: "commit", transactionId: transaction });
    committed = true;
    if (staged) await androidStorage({ operation: "completePendingWrite", operationId });
    return result;
  } finally {
    if (!committed) {
      await androidStorage({ operation: "rollback", transactionId: transaction }).catch(() => undefined);
    }
  }
}

function taskVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new AndroidEngineError("INVALID_ARGUMENT", "expectedVersion must be a positive integer");
  }
  return value;
}

function requireTask(tasks: TaskRecord[], id: string): TaskRecord {
  const task = tasks.find((entry) => entry.id === id);
  if (!task) throw new AndroidEngineError("TASK_NOT_FOUND", `task ${id} was not found`);
  return task;
}

function transitionTaskRecord(before: TaskRecord, command: string, now: string): TaskRecord {
  const allowed: Record<string, TaskStatus[]> = {
    "task.start": ["open", "in_progress", "paused", "done"],
    "task.pause": ["open", "in_progress", "paused"],
    "task.complete": ["open", "in_progress", "paused", "done"],
    "task.reopen": ["open", "in_progress", "paused", "done", "canceled"],
    "task.cancel": ["open", "in_progress", "paused", "canceled"],
    "task.delete": ["open", "in_progress", "paused", "done", "canceled"],
  };
  if (!allowed[command]?.includes(before.status)) {
    throw new AndroidEngineError("INVALID_TRANSITION", `cannot ${command.slice(5)} a ${before.status} task`);
  }
  const status: TaskStatus = command === "task.start" ? "in_progress"
    : command === "task.pause" ? "paused"
      : command === "task.complete" ? "done"
        : command === "task.reopen" ? "open" : "canceled";
  if (status === before.status) return before;
  return {
    ...before, status, version: before.version + 1, updatedAt: now,
    completedAt: status === "done" ? now : null,
    canceledAt: status === "canceled" ? now : null,
  };
}

async function persistTaskUpdate(before: TaskRecord, after: TaskRecord, request: ProtocolRequest, transaction: string, now: string, command: string): Promise<void> {
  let categoryId: string | null = null;
  if (after.category) {
    const saved = await androidStorage({ operation: "ensureCategory", transactionId: transaction,
      id: crypto.randomUUID(), slug: after.category.slug, label: after.category.label, now });
    categoryId = requiredText(recordValue(saved, "id"), "category id");
  }
  const tagIds: string[] = [];
  for (const tag of after.tags) {
    const saved = await androidStorage({ operation: "ensureTag", transactionId: transaction,
      id: crypto.randomUUID(), slug: tag.slug, label: tag.label, now });
    tagIds.push(requiredText(recordValue(saved, "id"), "tag id"));
  }
  const task: AndroidTaskInput = {
    id: after.id, title: after.title, descriptionMarkdown: after.descriptionMarkdown, status: after.status,
    categoryId, parentId: after.parentId, position: 0, priority: after.priority, version: after.version,
    createdAt: after.createdAt, updatedAt: after.updatedAt, completedAt: after.completedAt, canceledAt: after.canceledAt,
  };
  await androidStorage({ operation: "updateTask", transactionId: transaction, task, expectedVersion: before.version, tagIds, dependencyIds: after.dependencyIds });
  await androidStorage({ operation: "insertActivity", transactionId: transaction, taskId: after.id,
    requestId: request.requestId, action: command === "operation.undo" ? "undo"
      : command === "task.delete" ? "cancel"
      : command === "task.dependency.add" ? "dependency.added"
        : command === "task.dependency.remove" ? "dependency.removed" : command.slice(5),
    actorKind: request.actor.kind, actorLabel: request.actor.label, createdAt: now,
    detailsJson: JSON.stringify({ from: before.status, to: after.status, beforeDependencies: before.dependencyIds, afterDependencies: after.dependencyIds }) });
}

async function saveTaskMutation(
  before: TaskRecord,
  after: TaskRecord,
  request: ProtocolRequest,
  hash: string,
  now: string,
  action: string,
  beforeOrders: SavedOrder[] = [],
  afterOrders: SavedOrder[] = [],
): Promise<Record<string, unknown>> {
  const changed = before !== after;
  if (request.dryRun || request.readOnly) {
    return { task: after, changed, dryRun: true, readOnly: Boolean(request.readOnly) };
  }
  const operationId = changed ? crypto.randomUUID() : undefined;
  const result = { task: after, changed, ...(operationId ? { operationId } : {}) };
  const transaction = transactionId();
  let committed = false;
  try {
    const staged = changed && operationId ? await writeAndroidUpdatedTasks([after], {
      operationId,
      idempotencyKey: request.idempotencyKey ?? "",
      requestHash: hash,
      responseJson: JSON.stringify(result),
      createdAt: now,
    }) : false;
    await androidStorage({ operation: "begin", transactionId: transaction });
    if (changed && operationId) {
      await persistTaskUpdate(before, after, request, transaction, now, action);
      await androidStorage({ operation: "writeOperation", transactionId: transaction, record: {
        id: operationId, kind: "mutation", before: [before], after: [after], beforeOrders, afterOrders,
      } satisfies SavedOperation });
    }
    await writeReceipt(request, hash, transaction, result, now);
    await androidStorage({ operation: "commit", transactionId: transaction });
    committed = true;
    if (staged && operationId) await androidStorage({ operation: "completePendingWrite", operationId });
    return result;
  } finally {
    if (!committed) await androidStorage({ operation: "rollback", transactionId: transaction }).catch(() => undefined);
  }
}

async function mutateTask(request: ProtocolRequest): Promise<Record<string, unknown>> {
  const id = requiredText(request.args.id, "id");
  const expectedVersion = taskVersion(request.args.expectedVersion);
  const current = await snapshot();
  const hash = await requestHash(request);
  if (!request.dryRun && !request.readOnly) {
    const replay = await readReceipt(request, hash);
    if (replay?.ok) return replay.result;
  }
  const before = requireTask(current.tasks, id);
  if (before.version !== expectedVersion) {
    throw new AndroidEngineError("STALE_TASK_VERSION", `task ${id} is at version ${before.version}`);
  }
  const now = new Date().toISOString();
  let after: TaskRecord;
  if (request.command === "task.update") {
    const title = requiredText(request.args.title, "title").trim();
    const descriptionMarkdown = request.args.descriptionMarkdown;
    if (typeof descriptionMarkdown !== "string" || title.length > 1000 || descriptionMarkdown.length > 10000) {
      throw new AndroidEngineError("INVALID_ARGUMENT", "task title or description is invalid");
    }
    const parsed = textClassification(title);
    const priority = request.args.priority === undefined ? before.priority : priorityValue(request.args.priority);
    after = { ...before, title, descriptionMarkdown, category: parsed.category, tags: parsed.tags, priority };
  } else {
    after = transitionTaskRecord(before, request.command, now);
  }
  const changed = request.command === "task.update"
    ? after.title !== before.title || after.descriptionMarkdown !== before.descriptionMarkdown || after.priority !== before.priority
    : after.status !== before.status;
  if (!changed) after = before;
  else if (request.command === "task.update") after = { ...after, version: before.version + 1, updatedAt: now };
  return saveTaskMutation(before, after, request, hash, now, request.command);
}

async function moveTask(request: ProtocolRequest): Promise<Record<string, unknown>> {
  const id = requiredText(request.args.id, "id");
  const version = taskVersion(request.args.expectedVersion);
  const parentId = request.args.parentId;
  if (parentId !== null && (typeof parentId !== "string" || parentId.trim() === "")) {
    throw new AndroidEngineError("INVALID_ARGUMENT", "parentId must be null or a non-empty string");
  }
  const current = await snapshot();
  const hash = await requestHash(request);
  if (!request.dryRun && !request.readOnly) {
    const replay = await readReceipt(request, hash);
    if (replay?.ok) return replay.result;
  }
  const before = requireTask(current.tasks, id);
  if (before.version !== version) throw new AndroidEngineError("STALE_TASK_VERSION", `task ${id} is at version ${before.version}`);
  if (parentId !== null) {
    if (parentId === id) throw new AndroidEngineError("INVALID_PARENT", "a task cannot be its own parent");
    const parent = requireTask(current.tasks, parentId);
    if (parent.status === "canceled") throw new AndroidEngineError("INVALID_PARENT", "a canceled task cannot be used as a parent; reopen it first");
    const byId = new Map(current.tasks.map((task) => [task.id, task]));
    const seen = new Set<string>();
    let ancestorId: string | null = parentId;
    while (ancestorId !== null) {
      if (ancestorId === id || seen.has(ancestorId)) throw new AndroidEngineError("PARENT_CYCLE", "this move would create a parent cycle");
      seen.add(ancestorId);
      ancestorId = byId.get(ancestorId)?.parentId ?? null;
    }
  }
  const now = new Date().toISOString();
  const after = before.parentId === parentId ? before : { ...before, parentId, version: before.version + 1, updatedAt: now };
  if (after === before) return saveTaskMutation(before, after, request, hash, now, request.command);
  const scope = (scopeParentId: string | null): SavedOrder => ({
    parentId: scopeParentId,
    taskIds: current.tasks.filter((task) => task.parentId === scopeParentId).map((task) => task.id),
  });
  const beforeOrders = [scope(before.parentId), scope(parentId)].filter((order, index, all) => all.findIndex((entry) => entry.parentId === order.parentId) === index);
  const afterOrders = beforeOrders.map((order) => ({
    parentId: order.parentId,
    taskIds: order.parentId === before.parentId
      ? order.taskIds.filter((taskId) => taskId !== id)
      : [id, ...order.taskIds],
  }));
  return saveTaskMutation(before, after, request, hash, now, request.command, beforeOrders, afterOrders);
}

async function changeDependency(request: ProtocolRequest): Promise<Record<string, unknown>> {
  const id = requiredText(request.args.id, "id");
  const dependsOnId = requiredText(request.args.dependsOnId, "dependsOnId");
  const version = taskVersion(request.args.expectedVersion);
  const current = await snapshot();
  const hash = await requestHash(request);
  if (!request.dryRun && !request.readOnly) {
    const replay = await readReceipt(request, hash);
    if (replay?.ok) return replay.result;
  }
  const before = requireTask(current.tasks, id);
  if (before.version !== version) throw new AndroidEngineError("STALE_TASK_VERSION", `task ${id} is at version ${before.version}`);
  const adding = request.command === "task.dependency.add";
  const existing = before.dependencyIds.includes(dependsOnId);
  if (adding && dependsOnId === id) throw new AndroidEngineError("INVALID_DEPENDENCY", "a task cannot depend on itself");
  if (adding && !existing) {
    const blocker = requireTask(current.tasks, dependsOnId);
    if (blocker.status === "canceled") throw new AndroidEngineError("INVALID_DEPENDENCY", "a canceled task cannot be used as a blocker; reopen it first");
    const byId = new Map(current.tasks.map((task) => [task.id, task]));
    const seen = new Set<string>();
    const reachesTask = (fromId: string): boolean => {
      if (fromId === id) return true;
      if (seen.has(fromId)) return false;
      seen.add(fromId);
      return byId.get(fromId)?.dependencyIds.some(reachesTask) ?? false;
    };
    if (reachesTask(dependsOnId)) throw new AndroidEngineError("DEPENDENCY_CYCLE", "this dependency would create a cycle");
  }
  const changed = adding ? !existing : existing;
  const now = new Date().toISOString();
  const dependencyIds = changed
    ? (adding ? [...before.dependencyIds, dependsOnId].sort() : before.dependencyIds.filter((entry) => entry !== dependsOnId))
    : before.dependencyIds;
  const blockedByIds = changed
    ? (adding ? [...before.blockedByIds, dependsOnId].sort() : before.blockedByIds.filter((entry) => entry !== dependsOnId))
    : before.blockedByIds;
  const after = changed ? { ...before, dependencyIds, blockedByIds, version: before.version + 1, updatedAt: now } : before;
  return saveTaskMutation(before, after, request, hash, now, request.command);
}

async function reorderTasks(request: ProtocolRequest): Promise<Record<string, unknown>> {
  const { tasks: selected, placement } = parseTaskReorderArgs(request.args);
  const current = await snapshot();
  const hash = await requestHash(request);
  if (!request.dryRun && !request.readOnly) {
    const replay = await readReceipt(request, hash);
    if (replay?.ok) return replay.result;
  }
  const before = selected.map((item) => {
    const task = requireTask(current.tasks, item.id);
    if (task.version !== item.expectedVersion) throw new AndroidEngineError("STALE_TASK_VERSION", `task ${item.id} is at version ${task.version}`);
    return task;
  });
  const parentId = before[0].parentId;
  if (before.some((task) => task.parentId !== parentId)) {
    throw new AndroidEngineError("INVALID_REORDER_SCOPE", "all reordered tasks must share one parent");
  }
  const siblings = current.tasks.filter((task) => task.parentId === parentId);
  const selectedIds = new Set(selected.map((task) => task.id));
  if (siblings.filter((task) => selectedIds.has(task.id)).some((task, index) => task.id !== selected[index]?.id)) {
    throw new AndroidEngineError("INVALID_REORDER_ORDER", "reordered tasks must be supplied in their current sibling order");
  }
  const remaining = siblings.filter((task) => !selectedIds.has(task.id));
  let index = "first" in placement ? 0 : remaining.length;
  if ("beforeId" in placement || "afterId" in placement) {
    const targetId = "beforeId" in placement ? placement.beforeId : placement.afterId;
    const target = requireTask(current.tasks, targetId);
    if (selectedIds.has(targetId)) throw new AndroidEngineError("INVALID_REORDER_PLACEMENT", "placement target cannot be selected");
    if (target.parentId !== parentId) throw new AndroidEngineError("INVALID_REORDER_SCOPE", "placement target must share the task parent");
    index = remaining.findIndex((task) => task.id === targetId) + ("afterId" in placement ? 1 : 0);
  }
  const finalIds = [...remaining.slice(0, index).map((task) => task.id), ...selected.map((task) => task.id), ...remaining.slice(index).map((task) => task.id)];
  const changed = siblings.some((task, position) => task.id !== finalIds[position]);
  if (request.dryRun || request.readOnly) {
    return { tasks: before, changed, dryRun: true, readOnly: Boolean(request.readOnly) };
  }
  const tasks = changed ? before.map((task) => ({ ...task, version: task.version + 1 })) : before;
  const operationId = changed ? crypto.randomUUID() : undefined;
  const result = { tasks, changed, ...(operationId ? { operationId } : {}) };
  const now = new Date().toISOString();
  const transaction = transactionId();
  let committed = false;
  try {
    const staged = operationId ? await writeAndroidUpdatedTasks(tasks, {
      operationId, idempotencyKey: request.idempotencyKey ?? "", requestHash: hash,
      responseJson: JSON.stringify(result), createdAt: now,
    }, [{ parentId, taskIds: finalIds, expectedTaskIds: siblings.map((task) => task.id) }]) : false;
    await androidStorage({ operation: "begin", transactionId: transaction });
    if (changed && operationId) {
      await androidStorage({ operation: "reorderTasks", transactionId: transaction, parentId, taskIds: finalIds, selected });
      await androidStorage({ operation: "writeOperation", transactionId: transaction, record: {
        id: operationId, kind: "reorder", before, after: tasks,
        beforeOrders: [{ parentId, taskIds: siblings.map((task) => task.id) }],
        afterOrders: [{ parentId, taskIds: finalIds }],
      } satisfies SavedOperation });
      for (const task of before) {
        await androidStorage({ operation: "insertActivity", transactionId: transaction, taskId: task.id,
          requestId: request.requestId, action: "reordered", actorKind: request.actor.kind,
          actorLabel: request.actor.label, createdAt: now,
          detailsJson: JSON.stringify({ before: siblings.findIndex((entry) => entry.id === task.id), after: finalIds.indexOf(task.id), parentId }) });
      }
    }
    await writeReceipt(request, hash, transaction, result, now);
    await androidStorage({ operation: "commit", transactionId: transaction });
    committed = true;
    if (staged && operationId) await androidStorage({ operation: "completePendingWrite", operationId });
    return result;
  } finally {
    if (!committed) await androidStorage({ operation: "rollback", transactionId: transaction }).catch(() => undefined);
  }
}

async function purgeCanceledTasks(request: ProtocolRequest): Promise<Record<string, unknown>> {
  const current = await snapshot();
  const canceled = current.tasks.filter((task) => task.status === "canceled");
  if (request.readOnly || request.dryRun) {
    return { deletedCount: canceled.length, dryRun: true, readOnly: Boolean(request.readOnly) };
  }
  const hash = await requestHash(request);
  const replay = await readReceipt(request, hash);
  if (replay?.ok) return replay.result;
  if (canceled.length === 0) {
    const result = { deletedCount: 0 };
    const now = new Date().toISOString();
    const transaction = transactionId();
    let committed = false;
    try {
      await androidStorage({ operation: "begin", transactionId: transaction });
      await writeReceipt(request, hash, transaction, result, now);
      await androidStorage({ operation: "commit", transactionId: transaction });
      committed = true;
      return result;
    } finally {
      if (!committed) await androidStorage({ operation: "rollback", transactionId: transaction }).catch(() => undefined);
    }
  }

  const now = new Date().toISOString();
  const canceledSet = new Set(canceled.map((task) => task.id));
  const affected = current.tasks
    .filter((task) => task.status !== "canceled"
      && ((task.parentId !== null && canceledSet.has(task.parentId)) || task.dependencyIds.some((id) => canceledSet.has(id))))
    .map((task) => ({
      ...task,
      parentId: task.parentId !== null && canceledSet.has(task.parentId) ? null : task.parentId,
      dependencyIds: task.dependencyIds.filter((id) => !canceledSet.has(id)),
      version: task.version + 1,
      updatedAt: now,
    }));
  const operationId = crypto.randomUUID();
  const result = { deletedCount: canceled.length, deletedTaskIds: canceled.map((task) => task.id), operationId };
  const transaction = transactionId();
  let committed = false;
  try {
    const staged = await writeAndroidPurgedTasks(canceled, affected, {
      operationId, idempotencyKey: request.idempotencyKey ?? "", requestHash: hash,
      responseJson: JSON.stringify(result), createdAt: now,
    });
    await androidStorage({ operation: "begin", transactionId: transaction });
    await androidStorage({ operation: "purgeCanceledTasks", transactionId: transaction, now });
    await writeReceipt(request, hash, transaction, result, now);
    await androidStorage({ operation: "commit", transactionId: transaction });
    committed = true;
    if (staged) await androidStorage({ operation: "completePendingWrite", operationId });
    return result;
  } finally {
    if (!committed) await androidStorage({ operation: "rollback", transactionId: transaction }).catch(() => undefined);
  }
}

async function transitionMany(request: ProtocolRequest): Promise<Record<string, unknown>> {
  const items = parseTaskTransitionManyArgs(request.args).tasks;
  const current = await snapshot();
  const hash = await requestHash(request);
  if (!request.dryRun && !request.readOnly) {
    const replay = await readReceipt(request, hash);
    if (replay?.ok) return replay.result;
  }
  const now = new Date().toISOString();
  const plans = items.map((item) => {
    const before = requireTask(current.tasks, item.id);
    if (before.version !== item.expectedVersion) {
      throw new AndroidEngineError("STALE_TASK_VERSION", `task ${item.id} is at version ${before.version}`);
    }
    return { before, after: transitionTaskRecord(before, item.command, now), command: item.command };
  });
  const changed = plans.filter((plan) => plan.before !== plan.after);
  const result = {
    tasks: plans.map((plan) => plan.after),
    changed: changed.length > 0,
    ...(request.dryRun || request.readOnly ? { dryRun: true, readOnly: Boolean(request.readOnly) } : {}),
  };
  if (request.dryRun || request.readOnly) return result;
  const operationId = changed.length > 0 ? crypto.randomUUID() : undefined;
  const saved = { ...result, ...(operationId ? { operationId } : {}) };
  const transaction = transactionId();
  let committed = false;
  try {
    const staged = operationId ? await writeAndroidUpdatedTasks(changed.map((plan) => plan.after), {
      operationId,
      idempotencyKey: request.idempotencyKey ?? "",
      requestHash: hash,
      responseJson: JSON.stringify(saved),
      createdAt: now,
    }) : false;
    await androidStorage({ operation: "begin", transactionId: transaction });
    for (const plan of changed) {
      await persistTaskUpdate(plan.before, plan.after, request, transaction, now, plan.command);
    }
    if (operationId) await androidStorage({ operation: "writeOperation", transactionId: transaction, record: {
      id: operationId, kind: "mutation", before: changed.map((plan) => plan.before), after: changed.map((plan) => plan.after),
      beforeOrders: [], afterOrders: [],
    } satisfies SavedOperation });
    await writeReceipt(request, hash, transaction, saved, now);
    await androidStorage({ operation: "commit", transactionId: transaction });
    committed = true;
    if (staged && operationId) await androidStorage({ operation: "completePendingWrite", operationId });
    return saved;
  } finally {
    if (!committed) await androidStorage({ operation: "rollback", transactionId: transaction }).catch(() => undefined);
  }
}

async function undoCreatedTask(
  request: ProtocolRequest,
  stored: SavedOperation,
  current: AndroidSnapshot,
  hash: string,
  now: string,
): Promise<Record<string, unknown>> {
  if (stored.before.length !== 0 || stored.after.length !== 1) {
    throw new AndroidUndoError("OPERATION_UNAVAILABLE", `operation ${stored.id} cannot be undone`);
  }
  const created = stored.after[0];
  const live = current.tasks.find((task) => task.id === created.id);
  if (!live || live.version !== created.version || live.title !== created.title
      || live.descriptionMarkdown !== created.descriptionMarkdown || live.status !== created.status
      || live.parentId !== created.parentId || live.updatedAt !== created.updatedAt
      || current.tasks.some((task) => task.parentId === created.id || task.dependencyIds.includes(created.id))) {
    throw new AndroidUndoError("OPERATION_CONFLICT", `task ${created.id} changed or gained relationships since creation`);
  }
  const operationId = crypto.randomUUID();
  const result = {
    operationId, undoneOperationId: stored.id, tasks: [], deletedTaskIds: [created.id], changed: true,
    ...(request.dryRun || request.readOnly ? { dryRun: true, readOnly: Boolean(request.readOnly) } : {}),
  };
  if (request.dryRun || request.readOnly) return result;
  const transaction = transactionId();
  let committed = false;
  try {
    const staged = await writeAndroidDeletedTask(live, {
      operationId, idempotencyKey: request.idempotencyKey ?? "", requestHash: hash,
      responseJson: JSON.stringify(result), createdAt: now,
    });
    await androidStorage({ operation: "begin", transactionId: transaction });
    await androidStorage({ operation: "deleteTask", transactionId: transaction, id: live.id, expectedVersion: live.version });
    await androidStorage({ operation: "clearOperation", transactionId: transaction, operationId: stored.id });
    await writeReceipt(request, hash, transaction, result, now);
    await androidStorage({ operation: "commit", transactionId: transaction });
    committed = true;
    if (staged) await androidStorage({ operation: "completePendingWrite", operationId });
    return result;
  } finally {
    if (!committed) await androidStorage({ operation: "rollback", transactionId: transaction }).catch(() => undefined);
  }
}

async function undoOperation(request: ProtocolRequest): Promise<Record<string, unknown>> {
  const undoneOperationId = requiredText(request.args.operationId, "operationId");
  const current = await snapshot();
  const hash = await requestHash(request);
  if (!request.dryRun && !request.readOnly) {
    const replay = await readReceipt(request, hash);
    if (replay?.ok) return replay.result;
  }
  const stored = (await androidStorage({ operation: "readOperation" })).operation as SavedOperation | null;
  if (!stored || stored.id !== undoneOperationId) throw new AndroidUndoError("OPERATION_UNAVAILABLE", `operation ${undoneOperationId} is no longer undoable`);
  const now = new Date().toISOString();
  if (stored.kind === "create") return undoCreatedTask(request, stored, current, hash, now);
  const plans = planAndroidUndo(stored, undoneOperationId, current.tasks, now);
  const afterOrders = new Map(stored.afterOrders.map((order) => [order.parentId, order.taskIds]));
  const orderWrites = stored.beforeOrders.map((order) => {
    const expectedTaskIds = afterOrders.get(order.parentId);
    if (!expectedTaskIds) throw new AndroidUndoError("OPERATION_CONFLICT", "saved sibling order scopes do not match");
    return { ...order, expectedTaskIds };
  });
  const operationId = crypto.randomUUID();
  const result = {
    operationId, undoneOperationId, tasks: plans.map((plan) => plan.restored), changed: true,
    ...(request.dryRun || request.readOnly ? { dryRun: true, readOnly: Boolean(request.readOnly) } : {}),
  };
  if (request.dryRun || request.readOnly) return result;
  const transaction = transactionId();
  let committed = false;
  try {
    const staged = await writeAndroidUpdatedTasks(result.tasks, {
      operationId, idempotencyKey: request.idempotencyKey ?? "", requestHash: hash,
      responseJson: JSON.stringify(result), createdAt: now,
    }, orderWrites);
    await androidStorage({ operation: "begin", transactionId: transaction });
    for (const plan of plans) {
      await persistTaskUpdate(plan.live, plan.restored, request, transaction, now, request.command);
    }
    for (const order of stored.beforeOrders) {
      await androidStorage({ operation: "setSiblingOrder", transactionId: transaction, parentId: order.parentId, taskIds: order.taskIds });
    }
    await androidStorage({ operation: "clearOperation", transactionId: transaction, operationId: undoneOperationId });
    await writeReceipt(request, hash, transaction, result, now);
    await androidStorage({ operation: "commit", transactionId: transaction });
    committed = true;
    if (staged) await androidStorage({ operation: "completePendingWrite", operationId });
    return result;
  } finally {
    if (!committed) await androidStorage({ operation: "rollback", transactionId: transaction }).catch(() => undefined);
  }
}

async function listTasks(request: ProtocolRequest): Promise<Record<string, unknown>> {
  const current = await snapshot();
  const statusArgument = request.args.status;
  const statuses = statusArgument === undefined ? [] : Array.isArray(statusArgument) ? statusArgument : [statusArgument];
  const validStatuses = statuses.map(statusValue);
  const category = request.args.category === undefined ? undefined : requiredText(request.args.category, "category").toLowerCase();
  const priority = request.args.priority === undefined ? undefined : priorityValue(request.args.priority);
  const tagValues = request.args.tags === undefined ? [] : Array.isArray(request.args.tags) ? request.args.tags : [request.args.tags];
  const tags = tagValues.map((tag) => requiredText(tag, "tags").toLowerCase());
  const search = request.args.search === undefined ? "" : requiredText(request.args.search, "search").trim().toLowerCase();
  const unblocked = request.args.unblocked === true;
  const sort = request.args.sort === undefined ? "created" : requiredText(request.args.sort, "sort");
  if (!["created", "updated", "priority", "manual"].includes(sort)) {
    throw new AndroidEngineError("INVALID_ARGUMENT", "sort must be created, updated, priority, or manual");
  }
  const direction = request.args.direction === undefined ? "desc" : requiredText(request.args.direction, "direction");
  if (direction !== "asc" && direction !== "desc") {
    throw new AndroidEngineError("INVALID_ARGUMENT", "direction must be asc or desc");
  }
  const limit = Math.min(Math.max(typeof request.args.limit === "number" ? Math.trunc(request.args.limit) : 50, 1), 100);
  const offset = Math.max(typeof request.args.offset === "number" ? Math.trunc(request.args.offset) : 0, 0);

  const matches = current.tasks.filter((task) => {
    if (validStatuses.length > 0 && !validStatuses.includes(task.status)) return false;
    if (category !== undefined && task.category?.slug !== category) return false;
    if (priority !== undefined && task.priority !== priority) return false;
    if (tags.length > 0 && !tags.every((tag) => task.tags.some((entry) => entry.slug === tag))) return false;
    if (search !== "" && !`${task.title}\n${task.descriptionMarkdown}\n${task.category?.label ?? ""}`.toLowerCase().includes(search)) return false;
    if (unblocked && task.blockedByIds.length > 0) return false;
    return true;
  });
  const matchingIds = new Set(matches.map((task) => task.id));
  const ordered = sortAndroidTasks(current.tasks, sort, direction).filter((task) => matchingIds.has(task.id));
  const tasks = ordered.slice(offset, offset + limit);
  const contextTasks: TaskRecord[] = [];
  if (request.args.includeAncestors === true) {
    const byId = new Map(current.tasks.map((task) => [task.id, task]));
    const included = new Set(tasks.map((task) => task.id));
    for (const task of tasks) {
      let parentId = task.parentId;
      while (parentId !== null && !included.has(parentId)) {
        const parent = byId.get(parentId);
        if (!parent) break;
        contextTasks.push(parent);
        included.add(parent.id);
        parentId = parent.parentId;
      }
    }
  }
  return {
    tasks,
    contextTasks,
    total: matches.length,
    limit,
    offset,
    workspaceRevision: current.workspaceRevision,
    ...(current.unresolvedConflicts ? { unresolvedConflicts: current.unresolvedConflicts } : {}),
  };
}

async function themeList(): Promise<{ themes: ReturnType<typeof builtinThemes>; selected: string }> {
  const themes = builtinThemes();
  const saved = await androidStorage({ operation: "readTheme" });
  const name = saved.name;
  return { themes, selected: typeof name === "string" && themes.some((theme) => theme.name === name) ? name : GILT_THEME_NAME };
}

async function themeSet(request: ProtocolRequest): Promise<Record<string, unknown>> {
  const { themes, selected } = await themeList();
  const name = requiredText(request.args.name, "name");
  const theme = themes.find((candidate) => candidate.name === name);
  if (!theme) throw new AndroidEngineError("UNKNOWN_THEME", `theme "${name}" is not available`);
  const changed = selected !== name;
  if (request.readOnly || request.dryRun) return { theme, selected, changed, dryRun: true, readOnly: Boolean(request.readOnly) };
  if (changed) await androidStorage({ operation: "setTheme", name });
  return { theme, selected: name, changed };
}

async function exportPortableTasks(request: ProtocolRequest): Promise<Record<string, unknown>> {
  const current = await snapshot();
  const positions = new Map<string, number>();
  const siblings = new Map<string | null, number>();
  for (const task of current.tasks) {
    const position = siblings.get(task.parentId) ?? 0;
    positions.set(task.id, position);
    siblings.set(task.parentId, position + 1);
  }
  const exportedAt = new Date().toISOString();
  if (request.readOnly || request.dryRun) {
    return { databasePath: "android-app-private", destinationPath: null, taskCount: current.tasks.length, exportedAt, dryRun: true, readOnly: Boolean(request.readOnly) };
  }
  const file = portableTaskExport(
    [...current.tasks].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)),
    positions,
    exportedAt,
  );
  const suggestedName = `tasks-${exportedAt.slice(0, 19).replaceAll(":", "")}Z.json`;
  const saved = await exportAndroidTaskDocument(`${JSON.stringify(file, null, 2)}\n`, suggestedName);
  return { databasePath: "android-app-private", ...saved, taskCount: file.taskCount, exportedAt };
}

async function listCategories(): Promise<Record<string, unknown>> {
  const current = await snapshot();
  const counts = new Map<string, { label: string; taskCount: number }>();
  for (const task of current.tasks) {
    if (task.status === "canceled" || !task.category) continue;
    const existing = counts.get(task.category.slug) ?? { label: task.category.label, taskCount: 0 };
    existing.taskCount += 1;
    counts.set(task.category.slug, existing);
  }
  return {
    categories: [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([slug, value]) => ({ slug, ...value })),
  };
}

async function listTags(): Promise<Record<string, unknown>> {
  const current = await snapshot();
  const counts = new Map<string, { label: string; taskCount: number }>();
  for (const task of current.tasks) {
    if (task.status === "canceled") continue;
    for (const tag of task.tags) {
      const existing = counts.get(tag.slug) ?? { label: tag.label, taskCount: 0 };
      existing.taskCount += 1;
      counts.set(tag.slug, existing);
    }
  }
  return {
    tags: [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([slug, value]) => ({ slug, ...value })),
  };
}

type ReceiveMarker = {
  targetWorkspaceId: string;
  startedAt: string;
  backup: Record<string, unknown>;
};

async function readReceiveMarker(): Promise<ReceiveMarker | null> {
  const response = await androidStorage({ operation: "readReceiveMarker" });
  const marker = recordValue(response, "marker");
  if (marker === null || marker === undefined) return null;
  if (typeof marker !== "object" || Array.isArray(marker)) {
    throw new AndroidEngineError("INVALID_STORAGE", "Android receive marker is invalid");
  }
  const value = marker as Record<string, unknown>;
  if (typeof value.targetWorkspaceId !== "string" || value.targetWorkspaceId.trim() === ""
      || typeof value.startedAt !== "string"
      || typeof value.backup !== "object" || value.backup === null || Array.isArray(value.backup)) {
    throw new AndroidEngineError("INVALID_STORAGE", "Android receive marker is invalid");
  }
  return value as unknown as ReceiveMarker;
}

async function readSelectedWorkspace(): Promise<Awaited<ReturnType<typeof parseAndroidCanonicalWorkspace>> | null> {
  const result = await readAndroidCanonicalFiles();
  if (!result.selected) return null;
  return parseAndroidCanonicalWorkspace(result.files);
}

async function prepareReceiveWorkspace(): Promise<Record<string, unknown>> {
  if (await readReceiveMarker()) {
    throw new AndroidEngineError("RECEIVE_PENDING", "this device is already waiting for a workspace");
  }
  const pending = recordValue(await androidStorage({ operation: "readPendingWrite" }), "pending");
  if (pending !== null && pending !== undefined) {
    throw new AndroidEngineError("PENDING_WRITE", "finish the interrupted task write before receiving a workspace");
  }
  const selected = await readSelectedWorkspace();
  if (!selected) throw new AndroidEngineError("INVALID_ARGUMENT", "select a sync folder before receiving a workspace");
  const meta = await androidStorage({ operation: "readCanonicalMeta" });
  if (recordValue(meta, "workspaceId") === selected.workspaceId) {
    throw new AndroidEngineError("INVALID_ARGUMENT", "the selected folder already belongs to this workspace");
  }
  const backup = await androidStorage({ operation: "readWorkspaceBackup" });
  const marker: ReceiveMarker = { targetWorkspaceId: selected.workspaceId, startedAt: new Date().toISOString(), backup };
  await androidStorage({ operation: "writeReceiveMarker", marker });
  const folder = await getAndroidSyncFolder();
  return {
    waiting: true,
    syncRoot: folder?.displayName ?? folder?.uri ?? undefined,
    targetWorkspaceId: selected.workspaceId,
    backupTaskCount: Array.isArray(backup.tasks) ? backup.tasks.length : 0,
  };
}

async function receiveWorkspaceStatus(): Promise<Record<string, unknown>> {
  const marker = await readReceiveMarker();
  if (!marker) return { waiting: false };
  let selected: Awaited<ReturnType<typeof parseAndroidCanonicalWorkspace>> | null = null;
  try {
    selected = await readSelectedWorkspace();
  } catch {
    selected = null;
  }
  if (!selected || selected.workspaceId !== marker.targetWorkspaceId) {
    return { waiting: true, ready: false, targetWorkspaceId: marker.targetWorkspaceId };
  }
  try {
    const replaced = await androidStorage({
      operation: "replaceCanonicalWorkspace",
      workspaceId: selected.workspaceId,
      fingerprint: selected.fingerprint,
      tasks: selected.tasks,
      receive: true,
    });
    await androidStorage({ operation: "clearReceiveMarker" });
    const revision = recordValue(replaced, "workspaceRevision");
    return {
      waiting: false,
      adopted: true,
      taskCount: selected.tasks.length,
      ...(typeof revision === "number" ? { workspaceRevision: revision } : {}),
    };
  } catch (error) {
    if (error instanceof AndroidCanonicalError || error instanceof AndroidEngineError) {
      return { waiting: true, ready: false, targetWorkspaceId: marker.targetWorkspaceId };
    }
    throw error;
  }
}

async function abortReceiveWorkspace(): Promise<Record<string, unknown>> {
  const marker = await readReceiveMarker();
  if (!marker) throw new AndroidEngineError("RECEIVE_NOT_PENDING", "this device is not waiting for a workspace");
  const restored = await androidStorage({ operation: "restoreWorkspaceBackup", backup: marker.backup });
  await androidStorage({ operation: "clearReceiveMarker" });
  const taskCount = recordValue(restored, "taskCount");
  return { waiting: false, restored: true, taskCount: typeof taskCount === "number" ? taskCount : 0 };
}

async function syncWorkspace(): Promise<Record<string, unknown>> {
  const result = await syncAndroidWorkspace();
  return {
    selected: result.selected,
    changed: result.changed,
    ...(result.workspaceId ? { workspaceId: result.workspaceId } : {}),
    ...(typeof result.taskCount === "number" ? { taskCount: result.taskCount } : {}),
    ...(typeof result.workspaceRevision === "number" ? { workspaceRevision: result.workspaceRevision } : {}),
    ...(result.unresolvedConflicts ? { unresolvedConflictCount: result.unresolvedConflicts.length } : {}),
  };
}

async function rebuildWorkspace(): Promise<Record<string, unknown>> {
  const result = await syncAndroidWorkspace({ forceRebuild: true });
  const current = await snapshot();
  return {
    rebuilt: result.selected && result.changed,
    selected: result.selected,
    changed: result.changed,
    taskCount: current.tasks.length,
    workspaceRevision: current.workspaceRevision,
    ...(result.unresolvedConflicts ? { unresolvedConflictCount: result.unresolvedConflicts.length } : {}),
  };
}

async function listConflicts(): Promise<Record<string, unknown>> {
  const result = await readAndroidCanonicalFiles();
  if (!result.selected) throw new AndroidEngineError("SYNC_FOLDER_NOT_SELECTED", "select an Android sync folder before listing conflicts");
  return { conflicts: listAndroidSyncConflicts(result.files) };
}

async function resolveConflict(request: ProtocolRequest): Promise<Record<string, unknown>> {
  const id = request.args.conflictId ?? request.args.id;
  if (typeof id !== "number" || !Number.isInteger(id) || id < 1) {
    throw new AndroidEngineError("INVALID_ARGUMENT", "conflictId must be a positive integer");
  }
  const result = await readAndroidCanonicalFiles();
  if (!result.selected) throw new AndroidEngineError("SYNC_FOLDER_NOT_SELECTED", "select an Android sync folder before resolving conflicts");
  const conflicts = listAndroidSyncConflicts(result.files);
  if (!conflicts.some((conflict) => conflict.id === id)) {
    throw new AndroidEngineError("CONFLICT_NOT_FOUND", `sync conflict ${id} was not found`);
  }
  throw new AndroidEngineError(
    "CONFLICT_RESOLUTION_UNSUPPORTED",
    "Android can detect Syncthing conflict copies but cannot resolve them; use a desktop or CLI client. The files were left unchanged.",
  );
}

async function archiveWorkspace(): Promise<Record<string, unknown>> {
  const result = await readAndroidCanonicalFiles();
  if (!result.selected) throw new AndroidEngineError("INVALID_ARGUMENT", "select a sync folder before archiving");
  const archivedAt = new Date().toISOString();
  const archive = {
    format: "tasks.archive",
    formatVersion: 1,
    archivedAt,
    files: result.files.map((file) => ({ relativePath: file.relativePath, content: file.content })),
  };
  const suggestedName = `tasks-archive-${archivedAt.slice(0, 19).replaceAll(":", "")}Z.json`;
  const saved = await exportAndroidTaskDocument(`${JSON.stringify(archive, null, 2)}\n`, suggestedName);
  return { destinationPath: saved.destinationPath, displayName: saved.displayName, fileCount: result.files.length, archivedAt };
}

async function backupWorkspace(): Promise<Record<string, unknown>> {
  const backup = await androidStorage({ operation: "readWorkspaceBackup" });
  const exportedAt = new Date().toISOString();
  const snapshot = { format: "tasks.backup", formatVersion: 1, exportedAt, ...backup };
  const suggestedName = `tasks-backup-${exportedAt.slice(0, 19).replaceAll(":", "")}Z.json`;
  const saved = await exportAndroidTaskDocument(`${JSON.stringify(snapshot, null, 2)}\n`, suggestedName);
  return { destinationPath: saved.destinationPath, displayName: saved.displayName, taskCount: Array.isArray(backup.tasks) ? backup.tasks.length : 0, exportedAt };
}

export async function handleAndroidRequest(request: ProtocolRequest): Promise<ProtocolResponse> {
  try {
    let result: Record<string, unknown>;
    if (!request.command.startsWith("workspace.receive.") && request.command !== "runtime.probe") {
      if (await readReceiveMarker()) {
        throw new AndroidEngineError("RECEIVE_PENDING", "Tasks is waiting for an incoming workspace");
      }
    }
    switch (request.command) {
      case "runtime.probe":
        result = await androidStorage({ operation: "probe" });
        break;
      case "workspace.receive.prepare":
        result = await prepareReceiveWorkspace();
        break;
      case "workspace.receive.status":
        result = await receiveWorkspaceStatus();
        break;
      case "workspace.receive.abort":
        result = await abortReceiveWorkspace();
        break;
      case "task.list":
        result = await listTasks(request);
        break;
      case "task.create":
        result = await createTask(request);
        break;
      case "task.get":
        result = { task: requireTask((await snapshot()).tasks, requiredText(request.args.id, "id")) };
        break;
      case "task.update":
      case "task.delete":
      case "task.start":
      case "task.pause":
      case "task.complete":
      case "task.reopen":
      case "task.cancel":
        result = await mutateTask(request);
        break;
      case "task.transitionMany":
        result = await transitionMany(request);
        break;
      case "task.dependency.add":
      case "task.dependency.remove":
        result = await changeDependency(request);
        break;
      case "task.move":
        result = await moveTask(request);
        break;
      case "task.reorder":
        result = await reorderTasks(request);
        break;
      case "task.purgeCanceled":
        result = await purgeCanceledTasks(request);
        break;
      case "operation.undo":
        result = await undoOperation(request);
        break;
      case "category.list":
        result = await listCategories();
        break;
      case "tag.list":
        result = await listTags();
        break;
      case "workspace.exportTasks":
        result = await exportPortableTasks(request);
        break;
      case "workspace.sync":
        result = await syncWorkspace();
        break;
      case "workspace.rebuild":
        result = await rebuildWorkspace();
        break;
      case "workspace.conflict.list":
        result = await listConflicts();
        break;
      case "workspace.conflict.resolve":
        result = await resolveConflict(request);
        break;
      case "workspace.archive":
        result = await archiveWorkspace();
        break;
      case "workspace.backup":
        result = await backupWorkspace();
        break;
      case "workspace.info": {
        const current = await snapshot();
        result = {
          databasePath: "android-app-private",
          taskCount: current.tasks.length,
          canceledTaskCount: current.tasks.filter((task) => task.status === "canceled").length,
          workspaceRevision: current.workspaceRevision,
        };
        break;
      }
      case "theme.list":
        result = await themeList();
        break;
      case "theme.set":
        result = await themeSet(request);
        break;
      default:
        throw new AndroidEngineError("ANDROID_COMMAND_UNSUPPORTED", `${request.command} is not implemented on Android yet`);
    }
    return { version: PROTOCOL_VERSION, requestId: request.requestId, ok: true, result };
  } catch (error) {
    return responseError(request, error);
  }
}
