import {
  PROTOCOL_VERSION,
  ProtocolError,
  parseTaskTransitionManyArgs,
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
import { classifyTaskFields, TaskTextError } from "../backend/taskText";
import { androidStorage, type AndroidStorageResponse, type AndroidTaskInput } from "./androidStorage";
import { AndroidCanonicalError, syncAndroidWorkspace, writeAndroidCreatedTask, writeAndroidUpdatedTasks } from "./androidCanonicalWorkspace";
import { sortAndroidTasks } from "./androidTaskSort";
import { exportAndroidTaskDocument } from "./androidWorkspace";

const VALID_STATUSES = new Set<TaskStatus>(["open", "in_progress", "paused", "done", "canceled"]);

type AndroidSnapshot = {
  tasks: TaskRecord[];
  workspaceRevision: number;
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
  if (error instanceof AndroidEngineError || error instanceof AndroidCanonicalError || error instanceof ProtocolError) {
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

function textClassification(title: string, descriptionMarkdown: string): ReturnType<typeof classifyTaskFields> {
  try {
    return classifyTaskFields(title, descriptionMarkdown);
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

function asSnapshot(response: AndroidStorageResponse): AndroidSnapshot {
  if (!Array.isArray(response.tasks) || typeof response.workspaceRevision !== "number") {
    throw new AndroidEngineError("INVALID_STORAGE", "Android storage returned an invalid task snapshot");
  }
  return {
    tasks: response.tasks as TaskRecord[],
    workspaceRevision: response.workspaceRevision,
  };
}

async function snapshot(): Promise<AndroidSnapshot> {
  await syncAndroidWorkspace();
  return asSnapshot(await androidStorage({ operation: "readSnapshot" }));
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

  const classification = textClassification(title, descriptionMarkdown);
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
  const task: TaskRecord = { ...preview, id, createdAt: now, updatedAt: now };
  const result = { task, operationId };
  let committed = false;
  try {
    const staged = await writeAndroidCreatedTask(task, {
      operationId,
      idempotencyKey: request.idempotencyKey ?? "",
      requestHash: hash,
      responseJson: JSON.stringify(result),
      createdAt: now,
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
      version: 1,
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
  await androidStorage({ operation: "updateTask", transactionId: transaction, task, expectedVersion: before.version, tagIds });
  await androidStorage({ operation: "insertActivity", transactionId: transaction, taskId: after.id,
    requestId: request.requestId, action: command === "task.delete" ? "cancel" : command.slice(5),
    actorKind: request.actor.kind, actorLabel: request.actor.label, createdAt: now,
    detailsJson: JSON.stringify({ from: before.status, to: after.status }) });
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
    const parsed = textClassification(title, descriptionMarkdown);
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
    if (changed) await persistTaskUpdate(before, after, request, transaction, now, request.command);
    await writeReceipt(request, hash, transaction, result, now);
    await androidStorage({ operation: "commit", transactionId: transaction });
    committed = true;
    if (staged && operationId) await androidStorage({ operation: "completePendingWrite", operationId });
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
    await writeReceipt(request, hash, transaction, saved, now);
    await androidStorage({ operation: "commit", transactionId: transaction });
    committed = true;
    if (staged && operationId) await androidStorage({ operation: "completePendingWrite", operationId });
    return saved;
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
  const sort = request.args.sort === undefined ? "updated" : requiredText(request.args.sort, "sort");
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
  return { tasks, contextTasks, total: matches.length, limit, offset, workspaceRevision: current.workspaceRevision };
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

export async function handleAndroidRequest(request: ProtocolRequest): Promise<ProtocolResponse> {
  try {
    let result: Record<string, unknown>;
    switch (request.command) {
      case "runtime.probe":
        result = await androidStorage({ operation: "probe" });
        break;
      case "workspace.receive.status":
        result = { waiting: false };
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
      case "category.list":
        result = await listCategories();
        break;
      case "tag.list":
        result = await listTags();
        break;
      case "workspace.exportTasks":
        result = await exportPortableTasks(request);
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
