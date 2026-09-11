import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { withTransaction } from "./database.js";
import { CommandError } from "./errors.js";
import {
  type ActivityRecord,
  type Actor,
  type ClassificationToken,
  type ProtocolRequest,
  type TaskPriority,
  type TaskRecord,
  type TaskStatus,
} from "./protocol.js";
import { classifyTaskText, TaskTextError, type TaskClassification } from "./taskText.js";
import { backupWorkspace, exportTasks, exportWorkspace, restoreWorkspace, workspaceInfo } from "./workspace.js";

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
  "task.status.undo",
  "task.move",
  "task.dependency.add",
  "task.dependency.remove",
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

function priorityValue(value: unknown): TaskPriority {
  if (value === 0 || value === 1 || value === 2 || value === 3 || value === 4) {
    return value;
  }
  throw new CommandError("INVALID_STORAGE", `database contains unsupported task priority ${String(value)}`);
}

function optionalPriority(args: Row, name: string): TaskPriority | undefined {
  const value = args[name];
  if (value === undefined) {
    return undefined;
  }
  if (value === 0 || value === 1 || value === 2 || value === 3 || value === 4) {
    return value;
  }
  throw new CommandError("INVALID_ARGUMENT", `${name} must be an integer from 0 to 4`);
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

function blockedByIdsForTask(database: DatabaseSync, taskId: string): string[] {
  const rows = database
    .prepare("SELECT depends_on_id FROM task_dependencies WHERE task_id = ? ORDER BY depends_on_id ASC")
    .all(taskId) as Row[];
  return rows.map((row) => stringValue(row, "depends_on_id"));
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
    priority: row.priority === undefined ? 2 : priorityValue(row.priority),
    category: categoryFromRow(row),
    tags: tagRows.map((tag) => ({ slug: stringValue(tag, "tag_slug"), label: stringValue(tag, "tag_label") })),
    parentId: nullableStringValue(row, "parent_id"),
    blockedByIds: blockedByIdsForTask(database, taskId),
    version: numberValue(row, "version"),
    createdAt: stringValue(row, "created_at"),
    updatedAt: stringValue(row, "updated_at"),
    completedAt: nullableStringValue(row, "completed_at"),
    canceledAt: nullableStringValue(row, "canceled_at"),
  };
}

function parentIdValue(row: Row): string | null {
  const value = row["parent_id"];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new CommandError("INVALID_STORAGE", "database field parent_id is not nullable text");
  }
  return value;
}

function requireParentTask(database: DatabaseSync, parentId: string): void {
  const row = database.prepare("SELECT id FROM tasks WHERE id = ?").get(parentId) as Row | undefined;
  if (!row) {
    throw new CommandError("PARENT_NOT_FOUND", `parent task ${parentId} was not found`);
  }
}

function collectParentChain(database: DatabaseSync, startId: string): string[] {
  const chain: string[] = [];
  let current: string | null = startId;
  while (current !== null) {
    if (chain.includes(current)) break;
    chain.push(current);
    const row = database.prepare("SELECT parent_id FROM tasks WHERE id = ?").get(current) as Row | undefined;
    if (!row) break;
    current = parentIdValue(row);
  }
  return chain;
}

function collectDescendantIds(database: DatabaseSync, rootId: string): Set<string> {
  const descendants = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    const rows = database.prepare("SELECT id FROM tasks WHERE parent_id = ?").all(current) as Row[];
    for (const row of rows) {
      const childId = stringValue(row, "id");
      if (childId === rootId || descendants.has(childId)) continue;
      descendants.add(childId);
      queue.push(childId);
    }
  }
  return descendants;
}

function reachesThroughDependencies(database: DatabaseSync, startId: string, targetId: string): boolean {
  const visited = new Set<string>();
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    if (current === targetId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const rows = database.prepare("SELECT depends_on_id FROM task_dependencies WHERE task_id = ?").all(current) as Row[];
    for (const row of rows) {
      const next = stringValue(row, "depends_on_id");
      if (!visited.has(next)) queue.push(next);
    }
  }
  return false;
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

function previewTask(input: PreparedTask, status: TaskStatus = "open", priority: TaskPriority = 2): TaskRecord {
  const now = new Date().toISOString();
  return {
    id: "preview",
    title: input.title,
    descriptionMarkdown: input.descriptionMarkdown,
    status,
    priority,
    category: input.classification.category,
    tags: input.classification.tags,
    parentId: null,
    blockedByIds: [],
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
  const priority = optionalPriority(request.args, "priority") ?? 2;
  const parentArg = request.args.parentId;
  let parentId: string | null = null;
  if (parentArg !== undefined && parentArg !== null) {
    if (typeof parentArg !== "string" || parentArg.trim() === "") {
      throw new CommandError("INVALID_ARGUMENT", "parentId must be a non-empty string");
    }
    parentId = parentArg;
    requireParentTask(database, parentId);
  }
  if (request.readOnly || request.dryRun) {
    return taskResult({ ...previewTask(input, "open", priority), parentId, priority }, { dryRun: true, readOnly: Boolean(request.readOnly) });
  }

  const now = new Date().toISOString();
  return withTransaction(database, () => {
    const id = randomUUID();
    database
      .prepare(
        `INSERT INTO tasks
          (id, title, description_markdown, status, category_id, parent_id, priority, version, created_at, updated_at, completed_at, canceled_at)
         VALUES (?, ?, ?, 'open', NULL, ?, ?, 1, ?, ?, NULL, NULL)`,
      )
      .run(id, input.title, input.descriptionMarkdown, parentId, priority, now, now);
    upsertClassification(database, id, input.classification, now);
    insertActivity(database, id, request, "created", { title: input.title, priority, ...(parentId ? { parentId } : {}) }, now);
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
    !classificationMatches(current, input.classification) ||
    (request.args.priority !== undefined && optionalPriority(request.args, "priority") !== current.priority);
  const nextPriority = optionalPriority(request.args, "priority") ?? current.priority;
  if (request.readOnly || request.dryRun) {
    return taskResult({ ...current, title: input.title, descriptionMarkdown: input.descriptionMarkdown, priority: nextPriority }, {
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
      .prepare("UPDATE tasks SET title = ?, description_markdown = ?, priority = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
      .run(input.title, input.descriptionMarkdown, nextPriority, now, current.id, version);
    upsertClassification(database, current.id, input.classification, now);
    insertActivity(
      database,
      current.id,
      request,
      "updated",
      {
        before: { title: current.title, descriptionMarkdown: current.descriptionMarkdown, priority: current.priority },
        after: { title: input.title, descriptionMarkdown: input.descriptionMarkdown, priority: nextPriority },
      },
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
  if (request.command === "task.start" && !["open", "in_progress", "paused", "done"].includes(current.status)) {
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
      {
        from: current.status,
        to: target,
        beforeCompletedAt: current.completedAt,
        beforeCanceledAt: current.canceledAt,
        afterCompletedAt: completedAt,
        afterCanceledAt: canceledAt,
        ...(request.command === "task.delete" ? { source: "delete" } : {}),
      },
      now,
    );
    const task = requireTask(database, current.id);
    const result = taskResult(task, { changed: true });
    recordReceipt(database, request, context, result, now);
    return result;
  });
}

const STATUS_UNDO_ACTIONS = new Set(["start", "pause", "complete", "reopen", "cancel"]);

function statusFromDetail(value: unknown): TaskStatus | null {
  if (value === "open" || value === "in_progress" || value === "paused" || value === "done" || value === "canceled") {
    return value;
  }
  return null;
}

function undoStatus(database: DatabaseSync, request: ProtocolRequest): Record<string, unknown> {
  const context = mutationContext(database, request);
  if (context.replay) {
    return context.replay;
  }

  const current = requireTask(database, taskId(request.args));
  const version = expectedVersion(request.args);
  if (version !== current.version) {
    throw new CommandError("STALE_TASK_VERSION", `task ${current.id} is at version ${current.version}`);
  }

  const latest = database
    .prepare(
      `SELECT seq, action, details_json FROM activity WHERE task_id = ? ORDER BY seq DESC LIMIT 1`,
    )
    .get(current.id) as Row | undefined;
  if (!latest) {
    throw new CommandError("UNDO_UNAVAILABLE", `task ${current.id} has no status change to undo`);
  }
  const action = stringValue(latest, "action");
  if (!STATUS_UNDO_ACTIONS.has(action)) {
    throw new CommandError("UNDO_UNAVAILABLE", `task ${current.id} has no status change to undo`);
  }
  let details: Row = {};
  try {
    const parsed = JSON.parse(stringValue(latest, "details_json"));
    if (isRecord(parsed)) details = parsed;
  } catch {
    throw new CommandError("UNDO_UNAVAILABLE", `task ${current.id} has no status change to undo`);
  }
  const from = statusFromDetail(details.from);
  const to = statusFromDetail(details.to);
  const undoneSeq = numberValue(latest, "seq");
  if (!from || !to || to !== current.status) {
    throw new CommandError("UNDO_UNAVAILABLE", `task ${current.id} changed after the last status change`);
  }

  const beforeCompleted = typeof details.beforeCompletedAt === "string" || details.beforeCompletedAt === null
    ? (details.beforeCompletedAt as string | null)
    : undefined;
  const beforeCanceled = typeof details.beforeCanceledAt === "string" || details.beforeCanceledAt === null
    ? (details.beforeCanceledAt as string | null)
    : undefined;
  const now = new Date().toISOString();
  const restoredCompletedAt = beforeCompleted !== undefined
    ? beforeCompleted
    : from === "done"
      ? now
      : null;
  const restoredCanceledAt = beforeCanceled !== undefined
    ? beforeCanceled
    : from === "canceled"
      ? now
      : null;

  const preview: TaskRecord = {
    ...current,
    status: from,
    version: current.version + 1,
    updatedAt: now,
    completedAt: restoredCompletedAt,
    canceledAt: restoredCanceledAt,
  };
  if (request.readOnly || request.dryRun) {
    return taskResult(preview, { dryRun: true, readOnly: Boolean(request.readOnly), changed: true, undoneSeq });
  }

  return withTransaction(database, () => {
    database
      .prepare(
        "UPDATE tasks SET status = ?, version = version + 1, updated_at = ?, completed_at = ?, canceled_at = ? WHERE id = ? AND version = ?",
      )
      .run(from, now, restoredCompletedAt, restoredCanceledAt, current.id, version);
    insertActivity(
      database,
      current.id,
      request,
      "undone",
      { from: current.status, to: from, undoneSeq, undoneAction: action },
      now,
    );
    const restored = requireTask(database, current.id);
    const result = taskResult(restored, { changed: true, undoneSeq });
    recordReceipt(database, request, context, result, now);
    return result;
  });
}

function moveTask(database: DatabaseSync, request: ProtocolRequest): Record<string, unknown> {
  const context = mutationContext(database, request);
  if (context.replay) {
    return context.replay;
  }

  const current = requireTask(database, taskId(request.args));
  const version = expectedVersion(request.args);
  if (version !== current.version) {
    throw new CommandError("STALE_TASK_VERSION", `task ${current.id} is at version ${current.version}`);
  }

  const parentArg = request.args.parentId;
  if (parentArg === undefined) {
    throw new CommandError("INVALID_ARGUMENT", "parentId is required");
  }
  let parentId: string | null;
  if (parentArg === null) {
    parentId = null;
  } else {
    if (typeof parentArg !== "string" || parentArg.trim() === "") {
      throw new CommandError("INVALID_ARGUMENT", "parentId must be null or a non-empty string");
    }
    parentId = parentArg;
  }
  if (parentId !== null) {
    if (parentId === current.id) {
      throw new CommandError("INVALID_PARENT", "a task cannot be its own parent");
    }
    requireParentTask(database, parentId);
    const descendants = collectDescendantIds(database, current.id);
    if (descendants.has(parentId)) {
      throw new CommandError("PARENT_CYCLE", "a task cannot move under its own descendant");
    }
    if (collectParentChain(database, parentId).includes(current.id)) {
      throw new CommandError("PARENT_CYCLE", "this move would create a parent cycle");
    }
  }

  const changed = current.parentId !== parentId;
  if (request.readOnly || request.dryRun) {
    return taskResult({ ...current, parentId }, { dryRun: true, readOnly: Boolean(request.readOnly), changed });
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
      .prepare("UPDATE tasks SET parent_id = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
      .run(parentId, now, current.id, version);
    insertActivity(database, current.id, request, "moved", { before: { parentId: current.parentId }, after: { parentId } }, now);
    const task = requireTask(database, current.id);
    const result = taskResult(task, { changed: true });
    recordReceipt(database, request, context, result, now);
    return result;
  });
}

function addDependency(database: DatabaseSync, request: ProtocolRequest): Record<string, unknown> {
  const context = mutationContext(database, request);
  if (context.replay) {
    return context.replay;
  }

  const current = requireTask(database, taskId(request.args));
  const version = expectedVersion(request.args);
  if (version !== current.version) {
    throw new CommandError("STALE_TASK_VERSION", `task ${current.id} is at version ${current.version}`);
  }

  const dependsArg = request.args.dependsOnId;
  if (typeof dependsArg !== "string" || dependsArg.trim() === "") {
    throw new CommandError("INVALID_ARGUMENT", "dependsOnId is required");
  }
  const dependsOnId = dependsArg;
  if (dependsOnId === current.id) {
    throw new CommandError("INVALID_DEPENDENCY", "a task cannot depend on itself");
  }
  requireTask(database, dependsOnId);
  const existing = database
    .prepare("SELECT 1 AS found FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?")
    .get(current.id, dependsOnId) as Row | undefined;
  const changed = !existing;
  if (changed && reachesThroughDependencies(database, dependsOnId, current.id)) {
    throw new CommandError("DEPENDENCY_CYCLE", "this dependency would create a cycle");
  }

  if (request.readOnly || request.dryRun) {
    return taskResult(
      { ...current, blockedByIds: changed ? [...current.blockedByIds, dependsOnId].sort() : current.blockedByIds },
      { dryRun: true, readOnly: Boolean(request.readOnly), changed },
    );
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
    database.prepare("INSERT INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)").run(current.id, dependsOnId);
    database
      .prepare("UPDATE tasks SET version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
      .run(now, current.id, version);
    insertActivity(database, current.id, request, "dependency.added", { dependsOnId }, now);
    const task = requireTask(database, current.id);
    const result = taskResult(task, { changed: true });
    recordReceipt(database, request, context, result, now);
    return result;
  });
}

function removeDependency(database: DatabaseSync, request: ProtocolRequest): Record<string, unknown> {
  const context = mutationContext(database, request);
  if (context.replay) {
    return context.replay;
  }

  const current = requireTask(database, taskId(request.args));
  const version = expectedVersion(request.args);
  if (version !== current.version) {
    throw new CommandError("STALE_TASK_VERSION", `task ${current.id} is at version ${current.version}`);
  }

  const dependsArg = request.args.dependsOnId;
  if (typeof dependsArg !== "string" || dependsArg.trim() === "") {
    throw new CommandError("INVALID_ARGUMENT", "dependsOnId is required");
  }
  const dependsOnId = dependsArg;
  const existing = database
    .prepare("SELECT 1 AS found FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?")
    .get(current.id, dependsOnId) as Row | undefined;
  const changed = Boolean(existing);

  if (request.readOnly || request.dryRun) {
    return taskResult(
      { ...current, blockedByIds: current.blockedByIds.filter((id) => id !== dependsOnId) },
      { dryRun: true, readOnly: Boolean(request.readOnly), changed },
    );
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
    database.prepare("DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?").run(current.id, dependsOnId);
    database
      .prepare("UPDATE tasks SET version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
      .run(now, current.id, version);
    insertActivity(database, current.id, request, "dependency.removed", { dependsOnId }, now);
    const task = requireTask(database, current.id);
    const result = taskResult(task, { changed: true });
    recordReceipt(database, request, context, result, now);
    return result;
  });
}

function listCategories(database: DatabaseSync): Record<string, unknown> {
  const rows = database
    .prepare(
      `SELECT categories.slug, categories.label, COUNT(tasks.id) AS task_count
       FROM categories
       JOIN tasks ON tasks.category_id = categories.id
       GROUP BY categories.id, categories.slug, categories.label
       ORDER BY categories.label COLLATE NOCASE ASC, categories.slug ASC`,
    )
    .all() as Row[];
  return {
    categories: rows.map((row) => ({
      slug: stringValue(row, "slug"),
      label: stringValue(row, "label"),
      taskCount: numberValue(row, "task_count"),
    })),
  };
}

function listTags(database: DatabaseSync): Record<string, unknown> {
  const rows = database
    .prepare(
      `SELECT tags.slug, tags.label, COUNT(task_tags.task_id) AS task_count
       FROM tags
       JOIN task_tags ON task_tags.tag_id = tags.id
       GROUP BY tags.id, tags.slug, tags.label
       ORDER BY tags.label COLLATE NOCASE ASC, tags.slug ASC`,
    )
    .all() as Row[];
  return {
    tags: rows.map((row) => ({
      slug: stringValue(row, "slug"),
      label: stringValue(row, "label"),
      taskCount: numberValue(row, "task_count"),
    })),
  };
}

function normalizeSlug(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CommandError("INVALID_ARGUMENT", `${field} must be a non-empty string`);
  }
  return value.trim().toLowerCase();
}

function normalizeTagSlug(value: unknown): string {
  const slug = normalizeSlug(value, "tags");
  if (!/^[a-z][a-z0-9_-]*$/.test(slug)) {
    throw new CommandError("INVALID_ARGUMENT", "tags must start with a letter and contain only letters, numbers, underscores, and hyphens");
  }
  return slug;
}

function escapeLikePattern(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
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

  const unblockedArgument = request.args.unblocked;
  if (unblockedArgument !== undefined && typeof unblockedArgument !== "boolean") {
    throw new CommandError("INVALID_ARGUMENT", "unblocked must be a boolean");
  }
  const categoryArgument = request.args.category;
  const categorySlug = categoryArgument === undefined ? undefined : normalizeSlug(categoryArgument, "category");
  let priorityFilter: number | undefined;
  if (request.args.priority !== undefined) {
    const priorityArgument = request.args.priority;
    if (typeof priorityArgument !== "number" || !Number.isInteger(priorityArgument) || priorityArgument < 0 || priorityArgument > 4) {
      throw new CommandError("INVALID_ARGUMENT", "priority must be an integer from 0 to 4");
    }
    priorityFilter = priorityArgument;
  }
  let tagSlugs: string[] = [];
  if (request.args.tags !== undefined) {
    const tagsArgument = request.args.tags;
    const rawTags = Array.isArray(tagsArgument) ? tagsArgument : [tagsArgument];
    if (rawTags.length === 0) {
      throw new CommandError("INVALID_ARGUMENT", "tags must be a non-empty string or array of strings");
    }
    tagSlugs = rawTags.map(normalizeTagSlug);
    tagSlugs = [...new Set(tagSlugs)].sort();
  }
  let searchPattern: string | undefined;
  if (request.args.search !== undefined) {
    const searchArgument = request.args.search;
    if (typeof searchArgument !== "string" || searchArgument.trim() === "") {
      throw new CommandError("INVALID_ARGUMENT", "search must be a non-empty string");
    }
    const trimmed = searchArgument.trim().slice(0, 200);
    searchPattern = `%${escapeLikePattern(trimmed)}%`;
  }
  const sortArgument = request.args.sort ?? "updated";
  if (sortArgument !== "created" && sortArgument !== "updated") {
    throw new CommandError("INVALID_ARGUMENT", "sort must be created or updated");
  }
  const directionArgument = request.args.direction ?? "desc";
  if (directionArgument !== "asc" && directionArgument !== "desc") {
    throw new CommandError("INVALID_ARGUMENT", "direction must be asc or desc");
  }
  // Both values are allow-listed above, so interpolation is safe.
  const orderBy = sortArgument === "created" ? "tasks.created_at" : "tasks.updated_at";
  const orderDirection = directionArgument === "asc" ? "ASC" : "DESC";
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (statuses.length > 0) {
    conditions.push(`tasks.status IN (${statuses.map(() => "?").join(", ")})`);
    params.push(...statuses as string[]);
  }
  if (priorityFilter !== undefined) {
    conditions.push("tasks.priority = ?");
    params.push(priorityFilter);
  }
  if (unblockedArgument === true) {
    conditions.push("NOT EXISTS (SELECT 1 FROM task_dependencies WHERE task_dependencies.task_id = tasks.id)");
  }
  if (categorySlug !== undefined) {
    conditions.push("categories.slug = ?");
    params.push(categorySlug);
  }
  for (const tagSlug of tagSlugs) {
    conditions.push(`EXISTS (SELECT 1 FROM task_tags JOIN tags ON tags.id = task_tags.tag_id WHERE task_tags.task_id = tasks.id AND tags.slug = ?)`);
    params.push(tagSlug);
  }
  if (searchPattern !== undefined) {
    conditions.push(`(tasks.title LIKE ? ESCAPE '\\' OR tasks.description_markdown LIKE ? ESCAPE '\\')`);
    params.push(searchPattern, searchPattern);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = database
    .prepare(
      `SELECT tasks.*, categories.slug AS category_slug, categories.label AS category_label
       FROM tasks LEFT JOIN categories ON categories.id = tasks.category_id
       ${where}
       ORDER BY ${orderBy} ${orderDirection}, tasks.id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Row[];
  const totalRow = database
    .prepare(`SELECT COUNT(*) AS count FROM tasks LEFT JOIN categories ON categories.id = tasks.category_id ${where}`)
    .get(...params) as Row;
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

/** Every task in capture order, for exports that must not paginate. */
export function readAllTasks(database: DatabaseSync): TaskRecord[] {
  const rows = database
    .prepare(
      `SELECT tasks.*, categories.slug AS category_slug, categories.label AS category_label
       FROM tasks LEFT JOIN categories ON categories.id = tasks.category_id
       ORDER BY tasks.created_at ASC, tasks.id ASC`,
    )
    .all() as Row[];
  return rows.map((row) => taskFromRow(database, row));
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

export function executeTaskCommand(database: DatabaseSync, databasePath: string, request: ProtocolRequest): Record<string, unknown> {
  switch (request.command) {
    case "task.create":
      return createTask(database, request);
    case "task.list":
      return listTasks(database, request);
    case "category.list":
      return listCategories(database);
    case "tag.list":
      return listTags(database);
    case "task.get":
      return getTask(database, request);
    case "task.update":
      return updateTask(database, request);
    case "task.move":
      return moveTask(database, request);
    case "task.dependency.add":
      return addDependency(database, request);
    case "task.dependency.remove":
      return removeDependency(database, request);
    case "task.delete":
    case "task.start":
    case "task.pause":
    case "task.complete":
    case "task.reopen":
    case "task.cancel":
      return transitionTask(database, request);
    case "task.status.undo":
      return undoStatus(database, request);
    case "activity.list":
      return listActivity(database, request);
    case "workspace.info":
      return workspaceInfo(database, databasePath);
    case "workspace.backup":
      return backupWorkspace(database, request);
    case "workspace.export":
      return exportWorkspace(database, request);
    case "workspace.exportTasks":
      return exportTasks(databasePath, readAllTasks(database), request);
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
