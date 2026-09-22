import {
  PROTOCOL_VERSION,
  type ProtocolRequest,
  type ProtocolResponse,
  type TaskPriority,
  type TaskRecord,
  type TaskStatus,
} from "../backend/protocol";
import { canonicalJson } from "../backend/canonicalJson";
import { classifyTaskFields, TaskTextError } from "../backend/taskText";
import { androidStorage, type AndroidStorageResponse, type AndroidTaskInput } from "./androidStorage";
import { AndroidCanonicalError, syncAndroidWorkspace, writeAndroidCreatedTask } from "./androidCanonicalWorkspace";
import { sortAndroidTasks } from "./androidTaskSort";

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
  if (error instanceof AndroidEngineError || error instanceof AndroidCanonicalError) {
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
  let committed = false;
  try {
    await writeAndroidCreatedTask(task);
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
    const result = { task, operationId };
    await writeReceipt(request, hash, transaction, result, now);
    await androidStorage({ operation: "commit", transactionId: transaction });
    committed = true;
    return result;
  } finally {
    if (!committed) {
      await androidStorage({ operation: "rollback", transactionId: transaction }).catch(() => undefined);
    }
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
    if (search !== "" && !`${task.title}\n${task.descriptionMarkdown}`.toLowerCase().includes(search)) return false;
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
      case "category.list":
        result = await listCategories();
        break;
      case "tag.list":
        result = await listTags();
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
        result = { themes: [], selected: "" };
        break;
      default:
        throw new AndroidEngineError("ANDROID_COMMAND_UNSUPPORTED", `${request.command} is not implemented on Android yet`);
    }
    return { version: PROTOCOL_VERSION, requestId: request.requestId, ok: true, result };
  } catch (error) {
    return responseError(request, error);
  }
}
