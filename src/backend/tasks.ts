import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { withTransaction } from "./database.js";
import { CommandError } from "./errors.js";
import {
  type ActivityRecord,
  type Actor,
  type ClassificationToken,
  type ProtocolRequest,
  type TaskRecord,
  type TaskStatus,
} from "./protocol.js";
import { classifyTaskText, TaskTextError, type TaskClassification } from "./taskText.js";
import { backupWorkspace, exportWorkspace, restoreWorkspace } from "./workspace.js";

type Row = Record<string, unknown>;
type MutationContext = {
  hash: string;
  key: string;
  replay: Record<string, unknown> | null;
};

type PreparedTask = {
  title: string;
  descriptionMarkdown: string;
  classification: TaskClassification;
};

const mutationCommands = new Set<ProtocolRequest["command"]>([
  "task.create",
  "task.update",
  "task.delete",
  "task.start",
  "task.pause",
  "task.complete",
  "task.reopen",
  "task.cancel",
  "workspace.restore",
]);

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(row: Row, field: string): string {
  const value = row[field];
  if (typeof value !== "string") {
    throw new CommandError("INVALID_STORAGE", `database field ${field} is not text`);
  }
  return value;
}

function nullableStringValue(row: Row, field: string): string | null {
  const value = row[field];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new CommandError("INVALID_STORAGE", `database field ${field} is not nullable text`);
  }
  return value;
}

function numberValue(row: Row, field: string): number {
  const value = row[field];
  if (typeof value !== "number") {
    throw new CommandError("INVALID_STORAGE", `database field ${field} is not numeric`);
  }
  return value;
}

function statusValue(value: unknown): TaskStatus {
  if (value === "open" || value === "in_progress" || value === "paused" || value === "done" || value === "canceled") {
    return value;
  }
  throw new CommandError("INVALID_STORAGE", `database contains unsupported task status ${String(value)}`);
}

function optionalString(args: Row, name: string): string | undefined {
  const value = args[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new CommandError("INVALID_ARGUMENT", `${name} must be a string`);
  }
  return value;
}

function requiredString(args: Row, name: string): string {
  const value = optionalString(args, name);
  if (value === undefined || value.trim() === "") {
    throw new CommandError("INVALID_ARGUMENT", `${name} is required`);
  }
  return value;
}

function optionalInteger(args: Row, name: string, defaultValue: number): number {
  const value = args[name];
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new CommandError("INVALID_ARGUMENT", `${name} must be an integer`);
  }
  return value;
}

function expectedVersion(args: Row): number {
  const value = args.expectedVersion;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new CommandError("EXPECTED_VERSION_REQUIRED", "expectedVersion must be a positive integer");
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Row).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

function requestHash(request: ProtocolRequest): string {
  const payload = {
    actor: request.actor,
    args: request.args,
    command: request.command,
    dryRun: Boolean(request.dryRun),
    readOnly: Boolean(request.readOnly),
  };
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function mutationContext(database: DatabaseSync, request: ProtocolRequest): MutationContext {
  if (!mutationCommands.has(request.command)) {
    throw new CommandError("NOT_MUTATION", `${request.command} is not a mutation`);
  }
  const key = request.idempotencyKey;
  if (!key) {
    throw new CommandError("IDEMPOTENCY_REQUIRED", `${request.command} requires idempotencyKey`);
  }

  const hash = requestHash(request);
  const row = database.prepare("SELECT request_hash, response_json FROM command_receipts WHERE idempotency_key = ?").get(key) as
    | Row
    | undefined;
  if (!row) {
    return { hash, key, replay: null };
  }

  if (stringValue(row, "request_hash") !== hash) {
    throw new CommandError("IDEMPOTENCY_KEY_REUSED", "idempotencyKey was already used for a different request");
  }

  const response = JSON.parse(stringValue(row, "response_json"));
  if (!isRecord(response)) {
    throw new CommandError("INVALID_STORAGE", "stored command receipt is not an object");
  }
  return { hash, key, replay: response };
}

function recordReceipt(database: DatabaseSync, request: ProtocolRequest, context: MutationContext, result: Record<string, unknown>, now: string): void {
  database
    .prepare(
      "INSERT INTO command_receipts (idempotency_key, command, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(context.key, request.command, context.hash, JSON.stringify(result), now);
}

function classify(text: string): TaskClassification {
  try {
    return classifyTaskText(text);
  } catch (error) {
    if (error instanceof TaskTextError) {
      throw new CommandError(error.code, error.message);
    }
    throw error;
  }
}

function taskInput(args: Row): PreparedTask {
  const title = requiredString(args, "title").trim();
  const descriptionMarkdown = optionalString(args, "descriptionMarkdown") ?? "";
  if (title.length > 1000) {
    throw new CommandError("INVALID_ARGUMENT", "title must be 1000 characters or fewer");
  }
  if (descriptionMarkdown.length > 10000) {
    throw new CommandError("INVALID_ARGUMENT", "descriptionMarkdown must be 10000 characters or fewer");
  }

  return {
    title,
    descriptionMarkdown,
    classification: classify(`${title}\n${descriptionMarkdown}`),
  };
}

function categoryFromRow(row: Row | undefined): ClassificationToken | null {
  if (!row || row.category_slug === null || row.category_slug === undefined) {
    return null;
  }
  return { slug: stringValue(row, "category_slug"), label: stringValue(row, "category_label") };
}

function taskFromRow(database: DatabaseSync, row: Row): TaskRecord {
  const taskId = stringValue(row, "id");
  const tagRows = database
    .prepare(
      `SELECT tags.slug AS tag_slug, tags.label AS tag_label
       FROM task_tags
       JOIN tags ON tags.id = task_tags.tag_id
       WHERE task_tags.task_id = ?
       ORDER BY tags.slug ASC`,
    )
    .all(taskId) as Row[];

  return {
    id: taskId,
    title: stringValue(row, "title"),
    descriptionMarkdown: stringValue(row, "description_markdown"),
    status: statusValue(row.status),
    category: categoryFromRow(row),
    tags: tagRows.map((tag) => ({ slug: stringValue(tag, "tag_slug"), label: stringValue(tag, "tag_label") })),
    version: numberValue(row, "version"),
    createdAt: stringValue(row, "created_at"),
    updatedAt: stringValue(row, "updated_at"),
    completedAt: nullableStringValue(row, "completed_at"),
    canceledAt: nullableStringValue(row, "canceled_at"),
  };
}

function findTask(database: DatabaseSync, taskId: string): TaskRecord | null {
  const row = database
    .prepare(
      `SELECT tasks.*, categories.slug AS category_slug, categories.label AS category_label
       FROM tasks
       LEFT JOIN categories ON categories.id = tasks.category_id
       WHERE tasks.id = ?`,
    )
    .get(taskId) as Row | undefined;
  return row ? taskFromRow(database, row) : null;
}

function requireTask(database: DatabaseSync, taskId: string): TaskRecord {
  const task = findTask(database, taskId);
  if (!task) {
    throw new CommandError("TASK_NOT_FOUND", `task ${taskId} was not found`);
  }
  return task;
}

function taskId(args: Row): string {
  return requiredString(args, "id");
}

function upsertClassification(
  database: DatabaseSync,
  taskIdValue: string,
  classification: TaskClassification,
  now: string,
): void {
  let categoryId: string | null = null;
  if (classification.category) {
    const category = classification.category;
    const existing = database.prepare("SELECT id FROM categories WHERE slug = ?").get(category.slug) as Row | undefined;
    categoryId = existing ? stringValue(existing, "id") : randomUUID();
    if (!existing) {
      database
        .prepare("INSERT INTO categories (id, slug, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run(categoryId, category.slug, category.label, now, now);
    }
  }
  database.prepare("UPDATE tasks SET category_id = ? WHERE id = ?").run(categoryId, taskIdValue);

  database.prepare("DELETE FROM task_tags WHERE task_id = ?").run(taskIdValue);
  for (const tag of classification.tags) {
    const existing = database.prepare("SELECT id FROM tags WHERE slug = ?").get(tag.slug) as Row | undefined;
    const tagId = existing ? stringValue(existing, "id") : randomUUID();
    if (!existing) {
      database
        .prepare("INSERT INTO tags (id, slug, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run(tagId, tag.slug, tag.label, now, now);
    }
    database.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)").run(taskIdValue, tagId);
  }
}

function insertActivity(
  database: DatabaseSync,
  taskIdValue: string,
  request: ProtocolRequest,
  action: string,
  details: Record<string, unknown>,
  now: string,
): void {
  database
    .prepare(
      "INSERT INTO activity (task_id, request_id, action, actor_kind, actor_label, created_at, details_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(taskIdValue, request.requestId, action, request.actor.kind, request.actor.label, now, JSON.stringify(details));
}

function taskResult(task: TaskRecord, extras: Record<string, unknown> = {}): Record<string, unknown> {
  return { task, ...extras };
}

function previewTask(input: PreparedTask, status: TaskStatus = "open"): TaskRecord {
  const now = new Date().toISOString();
  return {
    id: "preview",
    title: input.title,
    descriptionMarkdown: input.descriptionMarkdown,
    status,
    category: input.classification.category,
    tags: input.classification.tags,
    version: 1,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    canceledAt: null,
  };
}

function createTask(database: DatabaseSync, request: ProtocolRequest): Record<string, unknown> {
  const context = mutationContext(database, request);
  if (context.replay) {
    return context.replay;
  }

  const input = taskInput(request.args);
  if (request.readOnly || request.dryRun) {
    return taskResult(previewTask(input), { dryRun: true, readOnly: Boolean(request.readOnly) });
  }

  const now = new Date().toISOString();
  return withTransaction(database, () => {
    const id = randomUUID();
    database
      .prepare(
        `INSERT INTO tasks
          (id, title, description_markdown, status, category_id, version, created_at, updated_at, completed_at, canceled_at)
         VALUES (?, ?, ?, 'open', NULL, 1, ?, ?, NULL, NULL)`,
      )
      .run(id, input.title, input.descriptionMarkdown, now, now);
    upsertClassification(database, id, input.classification, now);
    insertActivity(database, id, request, "created", { title: input.title }, now);
    const task = requireTask(database, id);
    const result = taskResult(task);
    recordReceipt(database, request, context, result, now);
    return result;
  });
}

function classificationMatches(task: TaskRecord, classification: TaskClassification): boolean {
  const categoryMatches = task.category?.slug === classification.category?.slug;
  const taskTags = task.tags.map((tag) => tag.slug).sort();
  const nextTags = classification.tags.map((tag) => tag.slug).sort();
  return categoryMatches && JSON.stringify(taskTags) === JSON.stringify(nextTags);
}

function updateTask(database: DatabaseSync, request: ProtocolRequest): Record<string, unknown> {
  const context = mutationContext(database, request);
  if (context.replay) {
    return context.replay;
  }

  const current = requireTask(database, taskId(request.args));
  const version = expectedVersion(request.args);
  if (version !== current.version) {
    throw new CommandError("STALE_TASK_VERSION", `task ${current.id} is at version ${current.version}`);
  }

  const title = optionalString(request.args, "title") ?? current.title;
  const descriptionMarkdown = optionalString(request.args, "descriptionMarkdown") ?? current.descriptionMarkdown;
  const input: PreparedTask = {
    title: title.trim(),
    descriptionMarkdown,
    classification: classify(`${title.trim()}\n${descriptionMarkdown}`),
  };
  if (input.title === "") {
    throw new CommandError("INVALID_ARGUMENT", "title must be a non-empty string");
  }
  if (input.title.length > 1000) {
    throw new CommandError("INVALID_ARGUMENT", "title must be 1000 characters or fewer");
  }
  if (input.descriptionMarkdown.length > 10000) {
    throw new CommandError("INVALID_ARGUMENT", "descriptionMarkdown must be 10000 characters or fewer");
  }
  const changed =
    input.title !== current.title ||
    input.descriptionMarkdown !== current.descriptionMarkdown ||
    !classificationMatches(current, input.classification);
  if (request.readOnly || request.dryRun) {
    return taskResult({ ...current, title: input.title, descriptionMarkdown: input.descriptionMarkdown }, {
      dryRun: true,
      readOnly: Boolean(request.readOnly),
      changed,
    });
  }
  if (!changed) {
    return withTransaction(database, () => {
      const result = taskResult(current, { changed: false });
      recordReceipt(database, request, context, result, new Date().toISOString());
      return result;
    });
  }

  const now = new Date().toISOString();
  return withTransaction(database, () => {
    database
      .prepare("UPDATE tasks SET title = ?, description_markdown = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
      .run(input.title, input.descriptionMarkdown, now, current.id, version);
    upsertClassification(database, current.id, input.classification, now);
    insertActivity(
      database,
      current.id,
      request,
      "updated",
      { before: { title: current.title, descriptionMarkdown: current.descriptionMarkdown }, after: { title: input.title, descriptionMarkdown: input.descriptionMarkdown } },
      now,
    );
    const task = requireTask(database, current.id);
    const result = taskResult(task, { changed: true });
    recordReceipt(database, request, context, result, now);
    return result;
  });
}

function transitionTask(database: DatabaseSync, request: ProtocolRequest): Record<string, unknown> {
  const context = mutationContext(database, request);
  if (context.replay) {
    return context.replay;
  }

  const current = requireTask(database, taskId(request.args));
  const version = expectedVersion(request.args);
  if (version !== current.version) {
    throw new CommandError("STALE_TASK_VERSION", `task ${current.id} is at version ${current.version}`);
  }

  const target = request.command === "task.start"
    ? "in_progress"
    : request.command === "task.pause"
      ? "paused"
      : request.command === "task.complete"
        ? "done"
        : request.command === "task.reopen"
          ? "open"
          : "canceled";
  const changed = current.status !== target;
  if (request.command === "task.start" && !["open", "in_progress", "paused"].includes(current.status)) {
    throw new CommandError("INVALID_TRANSITION", `cannot start a ${current.status} task`);
  }
  if (request.command === "task.pause" && !["open", "in_progress", "paused"].includes(current.status)) {
    throw new CommandError("INVALID_TRANSITION", `cannot pause a ${current.status} task`);
  }
  if (request.command === "task.complete" && !["open", "in_progress", "paused", "done"].includes(current.status)) {
    throw new CommandError("INVALID_TRANSITION", `cannot complete a ${current.status} task`);
  }
  if (request.command === "task.cancel" && !["open", "in_progress", "paused", "canceled"].includes(current.status)) {
    throw new CommandError("INVALID_TRANSITION", `cannot cancel a ${current.status} task`);
  }
  if (request.command === "task.delete" && !["open", "in_progress", "paused", "done", "canceled"].includes(current.status)) {
    throw new CommandError("INVALID_TRANSITION", `cannot cancel a ${current.status} task`);
  }

  const preview = {
    ...current,
    status: target as TaskStatus,
    version: changed ? current.version + 1 : current.version,
    updatedAt: changed ? new Date().toISOString() : current.updatedAt,
    completedAt: target === "done" ? (changed ? new Date().toISOString() : current.completedAt) : null,
    canceledAt: target === "canceled" ? (changed ? new Date().toISOString() : current.canceledAt) : null,
  };
  if (request.readOnly || request.dryRun) {
    return taskResult(preview, { dryRun: true, readOnly: Boolean(request.readOnly), changed });
  }
  if (!changed) {
    return withTransaction(database, () => {
      const result = taskResult(current, { changed: false });
      recordReceipt(database, request, context, result, new Date().toISOString());
      return result;
    });
  }

  const now = new Date().toISOString();
  const completedAt = target === "done" ? now : null;
  const canceledAt = target === "canceled" ? now : null;
  return withTransaction(database, () => {
    database
      .prepare(
        "UPDATE tasks SET status = ?, version = version + 1, updated_at = ?, completed_at = ?, canceled_at = ? WHERE id = ? AND version = ?",
      )
      .run(target, now, completedAt, canceledAt, current.id, version);
    insertActivity(
      database,
      current.id,
      request,
      request.command === "task.delete" ? "cancel" : request.command.slice("task.".length),
      { from: current.status, to: target, ...(request.command === "task.delete" ? { source: "delete" } : {}) },
      now,
    );
    const task = requireTask(database, current.id);
    const result = taskResult(task, { changed: true });
    recordReceipt(database, request, context, result, now);
    return result;
  });
}

function listTasks(database: DatabaseSync, request: ProtocolRequest): Record<string, unknown> {
  const limit = Math.min(Math.max(optionalInteger(request.args, "limit", 50), 1), 100);
  const offset = Math.max(optionalInteger(request.args, "offset", 0), 0);
  const statusArgument = request.args.status;
  const statuses = statusArgument === undefined
    ? []
    : Array.isArray(statusArgument)
      ? statusArgument
      : [statusArgument];
  for (const status of statuses) {
    if (status !== "open" && status !== "in_progress" && status !== "paused" && status !== "done" && status !== "canceled") {
      throw new CommandError("INVALID_ARGUMENT", "status contains an unsupported task status");
    }
  }

  const where = statuses.length > 0 ? `WHERE tasks.status IN (${statuses.map(() => "?").join(", ")})` : "";
  const params = statuses as string[];
  const rows = database
    .prepare(
      `SELECT tasks.*, categories.slug AS category_slug, categories.label AS category_label
       FROM tasks LEFT JOIN categories ON categories.id = tasks.category_id
       ${where}
       ORDER BY tasks.updated_at DESC, tasks.id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Row[];
  const totalRow = database.prepare(`SELECT COUNT(*) AS count FROM tasks ${where}`).get(...params) as Row;
  return {
    tasks: rows.map((row) => taskFromRow(database, row)),
    total: numberValue(totalRow, "count"),
    limit,
    offset,
  };
}

function getTask(database: DatabaseSync, request: ProtocolRequest): Record<string, unknown> {
  return { task: requireTask(database, taskId(request.args)) };
}

function listActivity(database: DatabaseSync, request: ProtocolRequest): Record<string, unknown> {
  const limit = Math.min(Math.max(optionalInteger(request.args, "limit", 50), 1), 100);
  const taskFilter = optionalString(request.args, "taskId");
  const rows = database
    .prepare(
      `SELECT seq, task_id, request_id, action, actor_kind, actor_label, created_at, details_json
       FROM activity
       ${taskFilter ? "WHERE task_id = ?" : ""}
       ORDER BY seq DESC LIMIT ?`,
    )
    .all(...(taskFilter ? [taskFilter, limit] : [limit])) as Row[];
  const activity: ActivityRecord[] = rows.map((row) => {
    let details: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(stringValue(row, "details_json"));
      if (isRecord(parsed)) {
        details = parsed;
      }
    } catch {
      throw new CommandError("INVALID_STORAGE", `activity ${String(row.seq)} has invalid details`);
    }
    return {
      seq: numberValue(row, "seq"),
      taskId: stringValue(row, "task_id"),
      requestId: stringValue(row, "request_id"),
      action: stringValue(row, "action"),
      actor: { kind: stringValue(row, "actor_kind") as Actor["kind"], label: stringValue(row, "actor_label") },
      createdAt: stringValue(row, "created_at"),
      details,
    };
  });
  return { activity, limit };
}

export function executeTaskCommand(database: DatabaseSync, request: ProtocolRequest): Record<string, unknown> {
  switch (request.command) {
    case "task.create":
      return createTask(database, request);
    case "task.list":
      return listTasks(database, request);
    case "task.get":
      return getTask(database, request);
    case "task.update":
      return updateTask(database, request);
    case "task.delete":
    case "task.start":
    case "task.pause":
    case "task.complete":
    case "task.reopen":
    case "task.cancel":
      return transitionTask(database, request);
    case "activity.list":
      return listActivity(database, request);
    case "workspace.backup":
      return backupWorkspace(database, request);
    case "workspace.export":
      return exportWorkspace(database, request);
    case "workspace.restore": {
      const context = mutationContext(database, request);
      if (context.replay) {
        return context.replay;
      }
      const result = restoreWorkspace(request);
      if (request.readOnly || request.dryRun) {
        return result;
      }
      const now = new Date().toISOString();
      withTransaction(database, () => recordReceipt(database, request, context, result, now));
      return result;
    }
    case "theme.list":
    case "theme.set":
      throw new CommandError("UNKNOWN_COMMAND", `${request.command} is handled by the theme command`);
    case "runtime.probe":
      throw new CommandError("UNKNOWN_COMMAND", "runtime.probe is handled by the runtime command");
  }
}
