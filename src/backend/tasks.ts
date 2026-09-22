import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { readWorkspaceRevision, withTransaction } from "./database.js";
import {
  archiveCanonicalWorkspace,
  canonicalWorkspaceStatus,
  listCanonicalConflicts,
  rebuildCanonicalCache,
  resolveCanonicalConflict,
  withCanonicalTransaction,
} from "./canonicalWorkspace.js";
import { CommandError } from "./errors.js";
import { requestHash } from "./requestHash.js";
import {
  type ActivityRecord,
  type Actor,
  type ClassificationToken,
  type ProtocolRequest,
  type TaskPriority,
  type TaskRecord,
  type TaskReorderArgs,
  type TaskStatusUndoItem,
  type TaskTransitionCommand,
  type TaskTransitionItem,
  parseTaskStatusUndoManyArgs,
  parseTaskTransitionManyArgs,
  type TaskReorderPlacement,
  type TaskReorderTask,
  type TaskStatus,
} from "./protocol.js";
import { classifyTaskFields, TaskTextError, type TaskClassification } from "./taskText.js";
import { backupWorkspace, exportTasks, exportWorkspace, restoreWorkspace, workspaceInfo } from "./workspace.js";

type Row = Record<string, unknown>;
type MutationContext = {
  hash: string;
  key: string;
  replay: Record<string, unknown> | null;
};

type OperationOrigin = "desktop" | "cli" | "system";
type OperationTaskState = {
  title?: string;
  descriptionMarkdown?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  parentId?: string | null;
  dependencyIds?: string[];
  createdAt?: string;
  completedAt?: string | null;
  canceledAt?: string | null;
};
type TaskOperationEffect = {
  taskId: string;
  beforeVersion: number;
  afterVersion: number;
  restore: OperationTaskState;
  expect: OperationTaskState;
  deleteOnUndo?: boolean;
  touchUpdatedAt?: boolean;
};
type TaskOperationOrder = {
  parentId: string | null;
  beforeIds: string[];
  afterIds: string[];
};
type TaskOperationPayload = {
  version: 1;
  kind: "task";
  effects: TaskOperationEffect[];
  orders: TaskOperationOrder[];
};
type StoredOperation = {
  id: string;
  command: ProtocolRequest["command"];
  origin: OperationOrigin;
  status: "active" | "undone" | "invalidated";
  payload: TaskOperationPayload;
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
  "task.purgeCanceled",
  "task.start",
  "task.pause",
  "task.complete",
  "task.reopen",
  "task.cancel",
  "task.status.undo",
  "task.move",
  "task.reorder",
  "task.transitionMany",
  "task.status.undoMany",
  "operation.undo",
  "task.dependency.add",
  "task.dependency.remove",
  "workspace.restore",
  "workspace.rebuild",
  "workspace.conflict.resolve",
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

function operationOrigin(request: ProtocolRequest): OperationOrigin {
  if (request.actor.kind === "human") return "desktop";
  if (request.actor.kind === "agent") return "cli";
  return "system";
}

function operationResult(result: Record<string, unknown>, operationId: string): Record<string, unknown> {
  return { ...result, operationId };
}

function parseTaskOperationPayload(value: string): TaskOperationPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new CommandError("INVALID_STORAGE", "operation payload is not valid JSON");
  }
  if (!isRecord(parsed) || parsed.version !== 1 || parsed.kind !== "task" || !Array.isArray(parsed.effects) || !Array.isArray(parsed.orders)) {
    throw new CommandError("INVALID_STORAGE", "operation payload is invalid");
  }
  return parsed as unknown as TaskOperationPayload;
}

function recordOperation(
  database: DatabaseSync,
  request: ProtocolRequest,
  payload: TaskOperationPayload,
  now: string,
  operationId: string = randomUUID(),
): string {
  database
    .prepare(
      `INSERT INTO operations
        (id, group_id, origin, actor_kind, actor_label, command, request_id, idempotency_key, created_at, status, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    )
    .run(
      operationId,
      operationId,
      operationOrigin(request),
      request.actor.kind,
      request.actor.label,
      request.command,
      request.requestId,
      request.idempotencyKey ?? "",
      now,
      JSON.stringify(payload),
    );
  const insertEffect = database.prepare(
    "INSERT INTO operation_effects (operation_id, task_id, before_version, after_version) VALUES (?, ?, ?, ?)",
  );
  for (const effect of payload.effects) {
    insertEffect.run(operationId, effect.taskId, effect.beforeVersion, effect.afterVersion);
  }
  return operationId;
}

function stateValueMatches(task: TaskRecord, field: keyof OperationTaskState, expected: unknown): boolean {
  if (field === "dependencyIds") {
    return JSON.stringify([...task.dependencyIds].sort()) === JSON.stringify([...(expected as string[])].sort());
  }
  return task[field] === expected;
}

function taskStateMatches(task: TaskRecord, state: OperationTaskState): boolean {
  return (Object.keys(state) as Array<keyof OperationTaskState>).every((field) => stateValueMatches(task, field, state[field]));
}

function operationIdArg(args: Row): string {
  return requiredString(args, "operationId");
}

function readOperation(database: DatabaseSync, id: string): StoredOperation {
  const row = database
    .prepare("SELECT id, command, origin, status, payload_json FROM operations WHERE id = ?")
    .get(id) as Row | undefined;
  if (!row) throw new CommandError("OPERATION_NOT_FOUND", `operation ${id} was not found`);
  const status = stringValue(row, "status");
  if (status !== "active") {
    throw new CommandError("OPERATION_UNAVAILABLE", `operation ${id} is no longer undoable`);
  }
  const origin = stringValue(row, "origin");
  if (origin !== "desktop" && origin !== "cli" && origin !== "system") {
    throw new CommandError("INVALID_STORAGE", `operation ${id} has an invalid origin`);
  }
  return {
    id: stringValue(row, "id"),
    command: stringValue(row, "command") as ProtocolRequest["command"],
    origin,
    status: "active",
    payload: parseTaskOperationPayload(stringValue(row, "payload_json")),
  };
}

function operationPayload(effects: TaskOperationEffect[], orders: TaskOperationOrder[] = []): TaskOperationPayload {
  return { version: 1, kind: "task", effects, orders };
}

function retireOperationAfterLegacyUndo(database: DatabaseSync, taskIdValue: string, afterVersion: number, request: ProtocolRequest, now: string): void {
  const row = database
    .prepare(
      `SELECT operations.id, operations.payload_json
       FROM operations
       JOIN operation_effects ON operation_effects.operation_id = operations.id
       WHERE operations.status = 'active' AND operations.command IN ('task.start', 'task.pause', 'task.complete', 'task.reopen', 'task.cancel', 'task.delete', 'task.transitionMany')
         AND operation_effects.task_id = ? AND operation_effects.after_version = ?
       ORDER BY operations.created_at DESC, operations.id DESC LIMIT 1`,
    )
    .get(taskIdValue, afterVersion) as Row | undefined;
  if (!row) return;
  const operationId = stringValue(row, "id");
  const payload = parseTaskOperationPayload(stringValue(row, "payload_json"));
  const nextStatus = payload.effects.length === 1 ? "undone" : "invalidated";
  database
    .prepare("UPDATE operations SET status = ?, undone_at = ?, undo_request_id = ? WHERE id = ? AND status = 'active'")
    .run(nextStatus, now, request.requestId, operationId);
}

function classify(title: string, descriptionMarkdown: string): TaskClassification {
  try {
    return classifyTaskFields(title, descriptionMarkdown);
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
    classification: classify(title, descriptionMarkdown),
  };
}

function categoryFromRow(row: Row | undefined): ClassificationToken | null {
  if (!row || row.category_slug === null || row.category_slug === undefined) {
    return null;
  }
  return { slug: stringValue(row, "category_slug"), label: stringValue(row, "category_label") };
}

function dependencyIdsForTask(database: DatabaseSync, taskId: string): { dependencyIds: string[]; blockedByIds: string[] } {
  const rows = database
    .prepare(
      `SELECT task_dependencies.depends_on_id, dependencies.status AS depends_on_status
       FROM task_dependencies
       JOIN tasks AS dependencies ON dependencies.id = task_dependencies.depends_on_id
       WHERE task_dependencies.task_id = ?
       ORDER BY task_dependencies.depends_on_id ASC`,
    )
    .all(taskId) as Row[];
  const dependencies = rows.map((row) => ({
    id: stringValue(row, "depends_on_id"),
    status: statusValue(row["depends_on_status"]),
  }));
  return {
    dependencyIds: dependencies.map((dependency) => dependency.id),
    blockedByIds: dependencies.filter((dependency) => dependency.status !== "canceled").map((dependency) => dependency.id),
  };
}

function taskFromRow(database: DatabaseSync, row: Row): TaskRecord {
  const taskId = stringValue(row, "id");
  const dependencies = dependencyIdsForTask(database, taskId);
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
    dependencyIds: dependencies.dependencyIds,
    blockedByIds: dependencies.blockedByIds,
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

function siblingIds(database: DatabaseSync, parentId: string | null): string[] {
  const rows = database
    .prepare("SELECT id FROM tasks WHERE parent_id IS ? ORDER BY position ASC, id ASC")
    .all(parentId) as Row[];
  return rows.map((row) => stringValue(row, "id"));
}

function densifySiblingScope(database: DatabaseSync, parentId: string | null): void {
  const ids = siblingIds(database, parentId);
  const update = database.prepare("UPDATE tasks SET position = ? WHERE id = ?");
  ids.forEach((id, index) => update.run(index, id));
}

function insertAtSiblingStart(database: DatabaseSync, parentId: string | null): void {
  database.prepare("UPDATE tasks SET position = position + 1 WHERE parent_id IS ?").run(parentId);
}

function requireParentTask(database: DatabaseSync, parentId: string): void {
  const row = database.prepare("SELECT status FROM tasks WHERE id = ?").get(parentId) as Row | undefined;
  if (!row) {
    throw new CommandError("PARENT_NOT_FOUND", `parent task ${parentId} was not found`);
  }
  if (statusValue(row.status) === "canceled") {
    throw new CommandError("INVALID_PARENT", "a canceled task cannot be used as a parent; reopen it first");
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

function operationConflict(operationId: string, message: string): never {
  throw new CommandError("OPERATION_CONFLICT", `operation ${operationId} cannot be undone: ${message}`);
}

function hasOperationField(state: OperationTaskState, field: keyof OperationTaskState): boolean {
  return Object.prototype.hasOwnProperty.call(state, field);
}

function replaceTaskDependencies(database: DatabaseSync, taskIdValue: string, dependencyIds: string[]): void {
  const uniqueIds = [...new Set(dependencyIds)];
  for (const dependencyId of uniqueIds) {
    if (dependencyId === taskIdValue || !findTask(database, dependencyId)) {
      throw new CommandError("OPERATION_CONFLICT", `dependency ${dependencyId} cannot be restored`);
    }
    if (reachesThroughDependencies(database, dependencyId, taskIdValue)) {
      throw new CommandError("OPERATION_CONFLICT", `restoring dependency ${dependencyId} would create a cycle`);
    }
  }
  database.prepare("DELETE FROM task_dependencies WHERE task_id = ?").run(taskIdValue);
  const insert = database.prepare("INSERT INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)");
  for (const dependencyId of uniqueIds) insert.run(taskIdValue, dependencyId);
}

function validateOperation(database: DatabaseSync, operation: StoredOperation): TaskRecord[] {
  for (const order of operation.payload.orders) {
    if (JSON.stringify(siblingIds(database, order.parentId)) !== JSON.stringify(order.afterIds)) {
      operationConflict(operation.id, `sibling order for ${order.parentId ?? "root"} changed`);
    }
  }

  const tasks: TaskRecord[] = [];
  for (const effect of operation.payload.effects) {
    const current = requireTask(database, effect.taskId);
    if (!taskStateMatches(current, effect.expect)) {
      operationConflict(operation.id, `task ${effect.taskId} changed in an affected field`);
    }
    if (effect.deleteOnUndo) {
      if (current.version !== effect.afterVersion) {
        operationConflict(operation.id, `task ${effect.taskId} changed after it was created`);
      }
      const child = database.prepare("SELECT 1 AS found FROM tasks WHERE parent_id = ? LIMIT 1").get(effect.taskId) as Row | undefined;
      const relationship = database
        .prepare("SELECT 1 AS found FROM task_dependencies WHERE task_id = ? OR depends_on_id = ? LIMIT 1")
        .get(effect.taskId, effect.taskId) as Row | undefined;
      if (child || relationship) {
        operationConflict(operation.id, `task ${effect.taskId} has newer relationships`);
      }
    }
    tasks.push(current);
  }
  return tasks;
}

function applyTaskOperationEffect(database: DatabaseSync, operation: StoredOperation, effect: TaskOperationEffect, now: string): void {
  const current = requireTask(database, effect.taskId);
  if (effect.deleteOnUndo) {
    const deleted = database.prepare("DELETE FROM tasks WHERE id = ? AND version = ?").run(effect.taskId, effect.afterVersion);
    if (deleted.changes !== 1) operationConflict(operation.id, `task ${effect.taskId} changed while being removed`);
    return;
  }

  const nextTitle = hasOperationField(effect.restore, "title") ? effect.restore.title as string : current.title;
  const nextDescription = hasOperationField(effect.restore, "descriptionMarkdown")
    ? effect.restore.descriptionMarkdown as string
    : current.descriptionMarkdown;
  const nextStatus = hasOperationField(effect.restore, "status") ? effect.restore.status as TaskStatus : current.status;
  const nextPriority = hasOperationField(effect.restore, "priority") ? effect.restore.priority as TaskPriority : current.priority;
  const nextParentId = hasOperationField(effect.restore, "parentId") ? effect.restore.parentId as string | null : current.parentId;
  const nextCompletedAt = hasOperationField(effect.restore, "completedAt")
    ? effect.restore.completedAt as string | null
    : current.completedAt;
  const nextCanceledAt = hasOperationField(effect.restore, "canceledAt")
    ? effect.restore.canceledAt as string | null
    : current.canceledAt;
  const updatedAt = effect.touchUpdatedAt === false ? current.updatedAt : now;
  const updated = database
    .prepare(
      `UPDATE tasks
       SET title = ?, description_markdown = ?, status = ?, parent_id = ?, priority = ?, version = version + 1,
           updated_at = ?, completed_at = ?, canceled_at = ?
       WHERE id = ?`,
    )
    .run(nextTitle, nextDescription, nextStatus, nextParentId, nextPriority, updatedAt, nextCompletedAt, nextCanceledAt, effect.taskId);
  if (updated.changes !== 1) operationConflict(operation.id, `task ${effect.taskId} changed while being restored`);

  if (hasOperationField(effect.restore, "title") || hasOperationField(effect.restore, "descriptionMarkdown")) {
    upsertClassification(database, effect.taskId, classify(nextTitle, nextDescription), now);
  }
  if (hasOperationField(effect.restore, "dependencyIds")) {
    replaceTaskDependencies(database, effect.taskId, effect.restore.dependencyIds as string[]);
  }
}

function applyOperationOrders(database: DatabaseSync, operation: StoredOperation): void {
  for (const order of operation.payload.orders) {
    const update = database.prepare("UPDATE tasks SET position = ? WHERE id = ? AND parent_id IS ?");
    for (const [position, taskIdValue] of order.beforeIds.entries()) {
      const result = update.run(position, taskIdValue, order.parentId);
      if (result.changes !== 1) operationConflict(operation.id, `sibling order for ${order.parentId ?? "root"} changed while being restored`);
    }
  }
}

function undoOperation(database: DatabaseSync, databasePath: string, request: ProtocolRequest): Record<string, unknown> {
  const context = mutationContext(database, request);
  if (context.replay) return context.replay;
  const id = operationIdArg(request.args);
  const operation = readOperation(database, id);
  const now = new Date().toISOString();
  const previewTasks = validateOperation(database, operation);
  if (request.readOnly || request.dryRun) {
    return { operationId: id, tasks: previewTasks, changed: true, dryRun: true, readOnly: Boolean(request.readOnly) };
  }

  return withCanonicalTransaction(
    database,
    databasePath,
    request,
    () => ({
      taskIds: operation.payload.effects.filter((effect) => !effect.deleteOnUndo).map((effect) => effect.taskId),
      deletedTaskIds: operation.payload.effects.filter((effect) => effect.deleteOnUndo).map((effect) => effect.taskId),
      orderParentIds: operation.payload.orders.map((order) => order.parentId),
    }),
    () => {
      validateOperation(database, operation);
      for (const effect of operation.payload.effects) applyTaskOperationEffect(database, operation, effect, now);
      applyOperationOrders(database, operation);
      const marked = database
        .prepare("UPDATE operations SET status = 'undone', undone_at = ?, undo_request_id = ? WHERE id = ? AND status = 'active'")
        .run(now, request.requestId, id);
      if (marked.changes !== 1) throw new CommandError("OPERATION_UNAVAILABLE", `operation ${id} is no longer undoable`);
      for (const effect of operation.payload.effects.filter((candidate) => !candidate.deleteOnUndo)) {
        insertActivity(database, effect.taskId, request, "undone", { operationId: id, command: operation.command }, now);
      }
      if (operation.payload.effects.some((effect) => effect.deleteOnUndo)) {
        database.exec(`
          DELETE FROM categories WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE tasks.category_id = categories.id);
          DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM task_tags WHERE task_tags.tag_id = tags.id);
        `);
      }
      const tasks = operation.payload.effects
        .filter((effect) => !effect.deleteOnUndo)
        .map((effect) => requireTask(database, effect.taskId));
      const deletedTaskIds = operation.payload.effects
        .filter((effect) => effect.deleteOnUndo)
        .map((effect) => effect.taskId);
      const result = { operationId: id, undoneOperationId: id, tasks, deletedTaskIds, changed: true };
      recordReceipt(database, request, context, result, now);
      return result;
    },
  );
}

function ancestorTasksFor(database: DatabaseSync, tasks: TaskRecord[]): TaskRecord[] {
  const matchingIds = new Set(tasks.map((task) => task.id));
  const ancestors = new Map<string, TaskRecord>();
  for (const task of tasks) {
    const seen = new Set<string>([task.id]);
    let parentId = task.parentId;
    while (parentId !== null && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = ancestors.get(parentId) ?? findTask(database, parentId);
      if (!parent) break;
      if (!matchingIds.has(parent.id)) ancestors.set(parent.id, parent);
      parentId = parent.parentId;
    }
  }
  return [...ancestors.values()];
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
    dependencyIds: [],
    blockedByIds: [],
    version: 1,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    canceledAt: null,
  };
}

function createTask(database: DatabaseSync, databasePath: string, request: ProtocolRequest): Record<string, unknown> {
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
  const operationId = randomUUID();
  const beforeOrder = siblingIds(database, parentId);
  let id = "";
  return withCanonicalTransaction(database, databasePath, request, () => ({ taskIds: [id], orderParentIds: [parentId] }), () => {
    id = randomUUID();
    insertAtSiblingStart(database, parentId);
    database
      .prepare(
        `INSERT INTO tasks
          (id, title, description_markdown, status, category_id, parent_id, position, priority, version, created_at, updated_at, completed_at, canceled_at)
         VALUES (?, ?, ?, 'open', NULL, ?, 0, ?, 1, ?, ?, NULL, NULL)`,
      )
      .run(id, input.title, input.descriptionMarkdown, parentId, priority, now, now);
    upsertClassification(database, id, input.classification, now);
    insertActivity(database, id, request, "created", { title: input.title, priority, ...(parentId ? { parentId } : {}) }, now);
    const task = requireTask(database, id);
    const afterOrder = siblingIds(database, parentId);
    const payload = operationPayload([{
      taskId: id,
      beforeVersion: 0,
      afterVersion: task.version,
      restore: {},
      expect: {
        title: task.title,
        descriptionMarkdown: task.descriptionMarkdown,
        status: task.status,
        priority: task.priority,
        parentId: task.parentId,
        dependencyIds: task.dependencyIds,
        createdAt: task.createdAt,
        completedAt: task.completedAt,
        canceledAt: task.canceledAt,
      },
      deleteOnUndo: true,
      touchUpdatedAt: false,
    }], [{ parentId, beforeIds: beforeOrder, afterIds: afterOrder }]);
    recordOperation(database, request, payload, now, operationId);
    const result = operationResult(taskResult(task), operationId);
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

function updateTask(database: DatabaseSync, databasePath: string, request: ProtocolRequest): Record<string, unknown> {
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
    classification: classify(title.trim(), descriptionMarkdown),
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
    return withCanonicalTransaction(database, databasePath, request, () => null, () => {
      const result = taskResult(current, { changed: false });
      recordReceipt(database, request, context, result, new Date().toISOString());
      return result;
    });
  }

  const now = new Date().toISOString();
  const operationId = randomUUID();
  const restore: OperationTaskState = {};
  const expect: OperationTaskState = {};
  const classificationChanged = !classificationMatches(current, input.classification);
  if (input.title !== current.title || classificationChanged) {
    restore.title = current.title;
    expect.title = input.title;
  }
  if (input.descriptionMarkdown !== current.descriptionMarkdown || classificationChanged) {
    restore.descriptionMarkdown = current.descriptionMarkdown;
    expect.descriptionMarkdown = input.descriptionMarkdown;
  }
  if (nextPriority !== current.priority) {
    restore.priority = current.priority;
    expect.priority = nextPriority;
  }
  const operationPayloadValue = operationPayload([{
    taskId: current.id,
    beforeVersion: current.version,
    afterVersion: current.version + 1,
    restore,
    expect,
  }]);
  return withCanonicalTransaction(database, databasePath, request, () => ({ taskIds: [current.id] }), () => {
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
    recordOperation(database, request, operationPayloadValue, now, operationId);
    const result = operationResult(taskResult(task, { changed: true }), operationId);
    recordReceipt(database, request, context, result, now);
    return result;
  });
}

type TransitionPlan = {
  item: TaskTransitionItem;
  current: TaskRecord;
  target: TaskStatus;
  changed: boolean;
};

function transitionTarget(command: TaskTransitionCommand): TaskStatus {
  return command === "task.start"
    ? "in_progress"
    : command === "task.pause"
      ? "paused"
      : command === "task.complete"
        ? "done"
        : command === "task.reopen"
          ? "open"
          : "canceled";
}

function validateTransition(command: TaskTransitionCommand, current: TaskRecord): void {
  if (command === "task.start" && !["open", "in_progress", "paused", "done"].includes(current.status)) {
    throw new CommandError("INVALID_TRANSITION", `cannot start a ${current.status} task`);
  }
  if (command === "task.pause" && !["open", "in_progress", "paused"].includes(current.status)) {
    throw new CommandError("INVALID_TRANSITION", `cannot pause a ${current.status} task`);
  }
  if (command === "task.complete" && !["open", "in_progress", "paused", "done"].includes(current.status)) {
    throw new CommandError("INVALID_TRANSITION", `cannot complete a ${current.status} task`);
  }
  if (command === "task.cancel" && !["open", "in_progress", "paused", "canceled"].includes(current.status)) {
    throw new CommandError("INVALID_TRANSITION", `cannot cancel a ${current.status} task`);
  }
  if (command === "task.delete" && !["open", "in_progress", "paused", "done", "canceled"].includes(current.status)) {
    throw new CommandError("INVALID_TRANSITION", `cannot cancel a ${current.status} task`);
  }
}

function transitionPlan(database: DatabaseSync, item: TaskTransitionItem): TransitionPlan {
  const current = requireTask(database, item.id);
  if (item.expectedVersion !== current.version) {
    throw new CommandError("STALE_TASK_VERSION", `task ${current.id} is at version ${current.version}`);
  }
  validateTransition(item.command, current);
  const target = transitionTarget(item.command);
  return { item, current, target, changed: current.status !== target };
}

function transitionPreview(plan: TransitionPlan, now: string): TaskRecord {
  return {
    ...plan.current,
    status: plan.target,
    version: plan.changed ? plan.current.version + 1 : plan.current.version,
    updatedAt: plan.changed ? now : plan.current.updatedAt,
    completedAt: plan.target === "done" ? (plan.changed ? now : plan.current.completedAt) : null,
    canceledAt: plan.target === "canceled" ? (plan.changed ? now : plan.current.canceledAt) : null,
  };
}

function transitionActivity(database: DatabaseSync, plan: TransitionPlan, request: ProtocolRequest, now: string): void {
  const completedAt = plan.target === "done" ? now : null;
  const canceledAt = plan.target === "canceled" ? now : null;
  insertActivity(
    database,
    plan.current.id,
    request,
    plan.item.command === "task.delete" ? "cancel" : plan.item.command.slice("task.".length),
    {
      from: plan.current.status,
      to: plan.target,
      beforeCompletedAt: plan.current.completedAt,
      beforeCanceledAt: plan.current.canceledAt,
      afterCompletedAt: completedAt,
      afterCanceledAt: canceledAt,
      ...(plan.item.command === "task.delete" ? { source: "delete" } : {}),
    },
    now,
  );
}

function applyTransition(database: DatabaseSync, plan: TransitionPlan, request: ProtocolRequest, now: string): void {
  const completedAt = plan.target === "done" ? now : null;
  const canceledAt = plan.target === "canceled" ? now : null;
  const result = database
    .prepare(
      "UPDATE tasks SET status = ?, version = version + 1, updated_at = ?, completed_at = ?, canceled_at = ? WHERE id = ? AND version = ?",
    )
    .run(plan.target, now, completedAt, canceledAt, plan.current.id, plan.item.expectedVersion);
  if (result.changes !== 1) {
    throw new CommandError("STALE_TASK_VERSION", `task ${plan.current.id} changed while its state was being changed`);
  }
  transitionActivity(database, plan, request, now);
}

function transitionTask(database: DatabaseSync, databasePath: string, request: ProtocolRequest): Record<string, unknown> {
  const context = mutationContext(database, request);
  if (context.replay) return context.replay;

  const item: TaskTransitionItem = {
    id: taskId(request.args),
    expectedVersion: expectedVersion(request.args),
    command: request.command as TaskTransitionCommand,
  };
  const plan = transitionPlan(database, item);
  const now = new Date().toISOString();
  const operationId = plan.changed ? randomUUID() : undefined;
  const completedAt = plan.target === "done" ? now : null;
  const canceledAt = plan.target === "canceled" ? now : null;
  const payload = plan.changed ? operationPayload([{
    taskId: plan.current.id,
    beforeVersion: plan.current.version,
    afterVersion: plan.current.version + 1,
    restore: { status: plan.current.status, completedAt: plan.current.completedAt, canceledAt: plan.current.canceledAt },
    expect: { status: plan.target, completedAt, canceledAt },
  }]) : null;
  const preview = transitionPreview(plan, now);
  if (request.readOnly || request.dryRun) {
    return taskResult(preview, { dryRun: true, readOnly: Boolean(request.readOnly), changed: plan.changed });
  }
  if (!plan.changed) {
    return withCanonicalTransaction(database, databasePath, request, () => null, () => {
      const result = taskResult(plan.current, { changed: false });
      recordReceipt(database, request, context, result, now);
      return result;
    });
  }

  return withCanonicalTransaction(database, databasePath, request, () => ({ taskIds: [plan.current.id] }), () => {
    applyTransition(database, plan, request, now);
    if (!operationId || !payload) throw new CommandError("INVALID_STORAGE", "changed transition did not create an operation");
    recordOperation(database, request, payload, now, operationId);
    const result = operationResult(taskResult(requireTask(database, plan.current.id), { changed: true }), operationId);
    recordReceipt(database, request, context, result, now);
    return result;
  });
}

function transitionMany(database: DatabaseSync, databasePath: string, request: ProtocolRequest): Record<string, unknown> {
  const context = mutationContext(database, request);
  if (context.replay) return context.replay;
  const args = parseTaskTransitionManyArgs(request.args);
  const now = new Date().toISOString();
  if (request.readOnly || request.dryRun) {
    const plans = args.tasks.map((item) => transitionPlan(database, item));
    return {
      tasks: plans.map((plan) => transitionPreview(plan, now)),
      changed: plans.some((plan) => plan.changed),
      dryRun: true,
      readOnly: Boolean(request.readOnly),
    };
  }

  let plans: TransitionPlan[] = [];
  let operationId: string | undefined;
  let payload: TaskOperationPayload | undefined;
  return withCanonicalTransaction(
    database,
    databasePath,
    request,
    () => ({ taskIds: plans.filter((plan) => plan.changed).map((plan) => plan.current.id) }),
    () => {
      // Read and validate every item inside the same transaction before the
      // first UPDATE, so a stale or invalid sibling rolls back the whole batch.
      plans = args.tasks.map((item) => transitionPlan(database, item));
      const changedPlans = plans.filter((plan) => plan.changed);
      if (changedPlans.length > 0) {
        operationId = randomUUID();
        payload = operationPayload(changedPlans.map((plan) => ({
          taskId: plan.current.id,
          beforeVersion: plan.current.version,
          afterVersion: plan.current.version + 1,
          restore: { status: plan.current.status, completedAt: plan.current.completedAt, canceledAt: plan.current.canceledAt },
          expect: {
            status: plan.target,
            completedAt: plan.target === "done" ? now : null,
            canceledAt: plan.target === "canceled" ? now : null,
          },
        })));
      }
      for (const plan of plans) {
        if (plan.changed) applyTransition(database, plan, request, now);
      }
      const baseResult = {
        tasks: plans.map((plan) => requireTask(database, plan.current.id)),
        changed: changedPlans.length > 0,
      };
      const result = operationId && payload ? operationResult(baseResult, operationId) : baseResult;
      if (operationId && payload) recordOperation(database, request, payload, now, operationId);
      recordReceipt(database, request, context, result, now);
      return result;
    },
  );
}

function purgeCanceledTasks(database: DatabaseSync, databasePath: string, request: ProtocolRequest): Record<string, unknown> {
  const context = mutationContext(database, request);
  if (context.replay) return context.replay;

  const canceledRows = database
    .prepare("SELECT id, parent_id FROM tasks WHERE status = 'canceled' ORDER BY id ASC")
    .all() as Row[];
  const canceledIds = canceledRows.map((row) => stringValue(row, "id"));
  const canceledSet = new Set(canceledIds);
  const affectedTaskIds = new Set<string>();
  const orderParentIds = new Set<string | null>();
  for (const row of canceledRows) orderParentIds.add(parentIdValue(row));

  if (canceledIds.length > 0) {
    const placeholders = canceledIds.map(() => "?").join(", ");
    const childRows = database
      .prepare(`SELECT id FROM tasks WHERE status <> 'canceled' AND parent_id IN (${placeholders})`)
      .all(...canceledIds) as Row[];
    for (const row of childRows) {
      affectedTaskIds.add(stringValue(row, "id"));
      orderParentIds.add(null);
    }

    const dependencyRows = database
      .prepare(
        `SELECT DISTINCT task_dependencies.task_id
         FROM task_dependencies
         JOIN tasks ON tasks.id = task_dependencies.task_id
         WHERE tasks.status <> 'canceled'
           AND task_dependencies.depends_on_id IN (${placeholders})`,
      )
      .all(...canceledIds) as Row[];
    for (const row of dependencyRows) affectedTaskIds.add(stringValue(row, "task_id"));
  }

  if (request.readOnly || request.dryRun) {
    return { deletedCount: canceledIds.length, dryRun: true, readOnly: Boolean(request.readOnly) };
  }

  if (canceledIds.length === 0) {
    return withCanonicalTransaction(database, databasePath, request, () => null, () => {
      const result = { deletedCount: 0 };
      recordReceipt(database, request, context, result, new Date().toISOString());
      return result;
    });
  }

  const deletedOrderParentIds = [...canceledSet];
  return withCanonicalTransaction(
    database,
    databasePath,
    request,
    () => ({
      taskIds: [...affectedTaskIds],
      deletedTaskIds: canceledIds,
      orderParentIds: [...orderParentIds],
      deletedOrderParentIds,
    }),
    () => {
      const deleted = database.prepare("DELETE FROM tasks WHERE status = 'canceled'").run();
      if (deleted.changes !== canceledIds.length) {
        throw new CommandError("TASK_PURGE_FAILED", "canceled tasks changed while they were being purged");
      }
      database.exec(`
        DELETE FROM categories WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE tasks.category_id = categories.id);
        DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM task_tags WHERE task_tags.tag_id = tags.id);
      `);
      for (const parentId of orderParentIds) {
        if (parentId === null || !canceledSet.has(parentId)) densifySiblingScope(database, parentId);
      }
      const result = { deletedCount: canceledIds.length };
      recordReceipt(database, request, context, result, new Date().toISOString());
      return result;
    },
  );
}

const STATUS_UNDO_ACTIONS = new Set(["start", "pause", "complete", "reopen", "cancel"]);

function statusFromDetail(value: unknown): TaskStatus | null {
  if (value === "open" || value === "in_progress" || value === "paused" || value === "done" || value === "canceled") {
    return value;
  }
  return null;
}

function undoStatus(database: DatabaseSync, databasePath: string, request: ProtocolRequest): Record<string, unknown> {
  const context = mutationContext(database, request);
  if (context.replay) return context.replay;

  const plan = statusUndoPlan(database, {
    id: taskId(request.args),
    expectedVersion: expectedVersion(request.args),
  });
  const now = new Date().toISOString();
  const preview = undoPreview(plan, now);
  if (request.readOnly || request.dryRun) {
    return taskResult(preview, { dryRun: true, readOnly: Boolean(request.readOnly), changed: true, undoneSeq: plan.undoneSeq });
  }

  return withCanonicalTransaction(database, databasePath, request, () => ({ taskIds: [plan.current.id] }), () => {
    applyStatusUndo(database, plan, request, now);
    const result = taskResult(requireTask(database, plan.current.id), { changed: true, undoneSeq: plan.undoneSeq });
    recordReceipt(database, request, context, result, now);
    return result;
  });
}

type StatusUndoPlan = {
  item: TaskStatusUndoItem;
  current: TaskRecord;
  action: string;
  from: TaskStatus;
  to: TaskStatus;
  undoneSeq: number;
  beforeCompletedAt: string | null | undefined;
  beforeCanceledAt: string | null | undefined;
};

function statusUndoPlan(database: DatabaseSync, item: TaskStatusUndoItem): StatusUndoPlan {
  const current = requireTask(database, item.id);
  if (item.expectedVersion !== current.version) {
    throw new CommandError("STALE_TASK_VERSION", `task ${current.id} is at version ${current.version}`);
  }
  const latest = database
    .prepare("SELECT seq, action, details_json FROM activity WHERE task_id = ? ORDER BY seq DESC LIMIT 1")
    .get(current.id) as Row | undefined;
  if (!latest) throw new CommandError("UNDO_UNAVAILABLE", `task ${current.id} has no status change to undo`);
  const action = stringValue(latest, "action");
  if (!STATUS_UNDO_ACTIONS.has(action)) throw new CommandError("UNDO_UNAVAILABLE", `task ${current.id} has no status change to undo`);
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
  const beforeCompletedAt = typeof details.beforeCompletedAt === "string" || details.beforeCompletedAt === null
    ? details.beforeCompletedAt as string | null
    : undefined;
  const beforeCanceledAt = typeof details.beforeCanceledAt === "string" || details.beforeCanceledAt === null
    ? details.beforeCanceledAt as string | null
    : undefined;
  return { item, current, action, from, to, undoneSeq, beforeCompletedAt, beforeCanceledAt };
}

function undoPreview(plan: StatusUndoPlan, now: string): TaskRecord {
  return {
    ...plan.current,
    status: plan.from,
    version: plan.current.version + 1,
    updatedAt: now,
    completedAt: plan.beforeCompletedAt !== undefined ? plan.beforeCompletedAt : plan.from === "done" ? now : null,
    canceledAt: plan.beforeCanceledAt !== undefined ? plan.beforeCanceledAt : plan.from === "canceled" ? now : null,
  };
}

function applyStatusUndo(database: DatabaseSync, plan: StatusUndoPlan, request: ProtocolRequest, now: string): void {
  const restoredCompletedAt = plan.beforeCompletedAt !== undefined ? plan.beforeCompletedAt : plan.from === "done" ? now : null;
  const restoredCanceledAt = plan.beforeCanceledAt !== undefined ? plan.beforeCanceledAt : plan.from === "canceled" ? now : null;
  const result = database
    .prepare(
      "UPDATE tasks SET status = ?, version = version + 1, updated_at = ?, completed_at = ?, canceled_at = ? WHERE id = ? AND version = ?",
    )
    .run(plan.from, now, restoredCompletedAt, restoredCanceledAt, plan.current.id, plan.item.expectedVersion);
  if (result.changes !== 1) {
    throw new CommandError("STALE_TASK_VERSION", `task ${plan.current.id} changed while its state was being undone`);
  }
  retireOperationAfterLegacyUndo(database, plan.current.id, plan.item.expectedVersion, request, now);
  insertActivity(
    database,
    plan.current.id,
    request,
    "undone",
    { from: plan.current.status, to: plan.from, undoneSeq: plan.undoneSeq, undoneAction: plan.action },
    now,
  );
}

function undoStatusMany(database: DatabaseSync, databasePath: string, request: ProtocolRequest): Record<string, unknown> {
  const context = mutationContext(database, request);
  if (context.replay) return context.replay;
  const args = parseTaskStatusUndoManyArgs(request.args);
  const now = new Date().toISOString();
  if (request.readOnly || request.dryRun) {
    const plans = args.tasks.map((item) => statusUndoPlan(database, item));
    return {
      tasks: plans.map((plan) => undoPreview(plan, now)),
      changed: true,
      dryRun: true,
      readOnly: Boolean(request.readOnly),
    };
  }

  let plans: StatusUndoPlan[] = [];
  return withCanonicalTransaction(
    database,
    databasePath,
    request,
    () => ({ taskIds: plans.map((plan) => plan.current.id) }),
    () => {
      plans = args.tasks.map((item) => statusUndoPlan(database, item));
      for (const plan of plans) applyStatusUndo(database, plan, request, now);
      const result = { tasks: plans.map((plan) => requireTask(database, plan.current.id)), changed: true };
      recordReceipt(database, request, context, result, now);
      return result;
    },
  );
}

function moveTask(database: DatabaseSync, databasePath: string, request: ProtocolRequest): Record<string, unknown> {
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
    return withCanonicalTransaction(database, databasePath, request, () => null, () => {
      const result = taskResult(current, { changed: false });
      recordReceipt(database, request, context, result, new Date().toISOString());
      return result;
    });
  }

  const now = new Date().toISOString();
  const operationId = randomUUID();
  const orderParents = [...new Set([current.parentId, parentId])];
  const beforeOrders = orderParents.map((orderParentId) => ({ parentId: orderParentId, ids: siblingIds(database, orderParentId) }));
  const payload = operationPayload([{
    taskId: current.id,
    beforeVersion: current.version,
    afterVersion: current.version + 1,
    restore: { parentId: current.parentId },
    expect: { parentId },
  }], beforeOrders.map((order) => ({ parentId: order.parentId, beforeIds: order.ids, afterIds: [] })));
  return withCanonicalTransaction(
    database,
    databasePath,
    request,
    () => ({ taskIds: [current.id], orderParentIds: [current.parentId, parentId] }),
    () => {
      const moved = database
        .prepare("UPDATE tasks SET parent_id = ?, position = 0, version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
        .run(parentId, now, current.id, version);
      if (moved.changes !== 1) {
        throw new CommandError("STALE_TASK_VERSION", `task ${current.id} changed while it was being moved`);
      }
      database
        .prepare("UPDATE tasks SET position = position + 1 WHERE parent_id IS ? AND id <> ?")
        .run(parentId, current.id);
      densifySiblingScope(database, current.parentId);
      densifySiblingScope(database, parentId);
      insertActivity(database, current.id, request, "moved", { before: { parentId: current.parentId }, after: { parentId } }, now);
      const afterOrders = orderParents.map((orderParentId) => ({ parentId: orderParentId, ids: siblingIds(database, orderParentId) }));
      const completedPayload = operationPayload(payload.effects, afterOrders.map((order) => ({
        parentId: order.parentId,
        beforeIds: beforeOrders.find((before) => before.parentId === order.parentId)?.ids ?? [],
        afterIds: order.ids,
      })));
      const task = requireTask(database, current.id);
      recordOperation(database, request, completedPayload, now, operationId);
      const result = operationResult(taskResult(task, { changed: true }), operationId);
      recordReceipt(database, request, context, result, now);
      return result;
    });
}

function addDependency(database: DatabaseSync, databasePath: string, request: ProtocolRequest): Record<string, unknown> {
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
  const dependency = requireTask(database, dependsOnId);
  const existing = database
    .prepare("SELECT 1 AS found FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?")
    .get(current.id, dependsOnId) as Row | undefined;
  const changed = !existing;
  if (changed && dependency.status === "canceled") {
    throw new CommandError("INVALID_DEPENDENCY", "a canceled task cannot be used as a blocker; reopen it first");
  }
  if (changed && reachesThroughDependencies(database, dependsOnId, current.id)) {
    throw new CommandError("DEPENDENCY_CYCLE", "this dependency would create a cycle");
  }

  if (request.readOnly || request.dryRun) {
    return taskResult(
      {
        ...current,
        dependencyIds: changed ? [...current.dependencyIds, dependsOnId].sort() : current.dependencyIds,
        blockedByIds: changed && dependency.status !== "canceled"
          ? [...current.blockedByIds, dependsOnId].sort()
          : current.blockedByIds,
      },
      { dryRun: true, readOnly: Boolean(request.readOnly), changed },
    );
  }
  if (!changed) {
    return withCanonicalTransaction(database, databasePath, request, () => null, () => {
      const result = taskResult(current, { changed: false });
      recordReceipt(database, request, context, result, new Date().toISOString());
      return result;
    });
  }

  const now = new Date().toISOString();
  const operationId = randomUUID();
  const afterDependencies = [...new Set([...current.dependencyIds, dependsOnId])].sort();
  const payload = operationPayload([{
    taskId: current.id,
    beforeVersion: current.version,
    afterVersion: current.version + 1,
    restore: { dependencyIds: current.dependencyIds },
    expect: { dependencyIds: afterDependencies },
  }]);
  return withCanonicalTransaction(database, databasePath, request, () => ({ taskIds: [current.id] }), () => {
    database.prepare("INSERT INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)").run(current.id, dependsOnId);
    database
      .prepare("UPDATE tasks SET version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
      .run(now, current.id, version);
    insertActivity(database, current.id, request, "dependency.added", { dependsOnId }, now);
    const task = requireTask(database, current.id);
    recordOperation(database, request, payload, now, operationId);
    const result = operationResult(taskResult(task, { changed: true }), operationId);
    recordReceipt(database, request, context, result, now);
    return result;
  });
}

function removeDependency(database: DatabaseSync, databasePath: string, request: ProtocolRequest): Record<string, unknown> {
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
      {
        ...current,
        dependencyIds: current.dependencyIds.filter((id) => id !== dependsOnId),
        blockedByIds: current.blockedByIds.filter((id) => id !== dependsOnId),
      },
      { dryRun: true, readOnly: Boolean(request.readOnly), changed },
    );
  }
  if (!changed) {
    return withCanonicalTransaction(database, databasePath, request, () => null, () => {
      const result = taskResult(current, { changed: false });
      recordReceipt(database, request, context, result, new Date().toISOString());
      return result;
    });
  }

  const now = new Date().toISOString();
  const operationId = randomUUID();
  const afterDependencies = current.dependencyIds.filter((id) => id !== dependsOnId);
  const payload = operationPayload([{
    taskId: current.id,
    beforeVersion: current.version,
    afterVersion: current.version + 1,
    restore: { dependencyIds: current.dependencyIds },
    expect: { dependencyIds: afterDependencies },
  }]);
  return withCanonicalTransaction(database, databasePath, request, () => ({ taskIds: [current.id] }), () => {
    database.prepare("DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?").run(current.id, dependsOnId);
    database
      .prepare("UPDATE tasks SET version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
      .run(now, current.id, version);
    insertActivity(database, current.id, request, "dependency.removed", { dependsOnId }, now);
    const task = requireTask(database, current.id);
    recordOperation(database, request, payload, now, operationId);
    const result = operationResult(taskResult(task, { changed: true }), operationId);
    recordReceipt(database, request, context, result, now);
    return result;
  });
}

type StoredSibling = {
  id: string;
  position: number;
  version: number;
};

type ReorderPlan = {
  tasks: TaskReorderTask[];
  parentId: string | null;
  siblings: StoredSibling[];
  finalIds: string[];
  changed: boolean;
};

function reorderArguments(args: Row): TaskReorderArgs {
  const rawTasks = args.tasks;
  if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
    throw new CommandError("INVALID_ARGUMENT", "tasks must be a non-empty array");
  }
  const selectedIds = new Set<string>();
  const tasks: TaskReorderTask[] = rawTasks.map((rawTask, index) => {
    if (!isRecord(rawTask)) {
      throw new CommandError("INVALID_ARGUMENT", `tasks[${index}] must be an object`);
    }
    const id = rawTask.id;
    if (typeof id !== "string" || id.trim() === "") {
      throw new CommandError("INVALID_ARGUMENT", `tasks[${index}].id must be a non-empty string`);
    }
    if (selectedIds.has(id)) {
      throw new CommandError("INVALID_ARGUMENT", "tasks must not contain duplicate ids");
    }
    selectedIds.add(id);
    const version = rawTask.expectedVersion;
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
      throw new CommandError("EXPECTED_VERSION_REQUIRED", `tasks[${index}].expectedVersion must be a positive integer`);
    }
    return { id, expectedVersion: version };
  });

  if (!isRecord(args.placement)) {
    throw new CommandError("INVALID_ARGUMENT", "placement must be an object");
  }
  const keys = Object.keys(args.placement);
  if (keys.length !== 1 || !["beforeId", "afterId", "first", "last"].includes(keys[0] ?? "")) {
    throw new CommandError("INVALID_ARGUMENT", "placement must specify exactly one of beforeId, afterId, first, or last");
  }
  const key = keys[0] as "beforeId" | "afterId" | "first" | "last";
  if (key === "beforeId" || key === "afterId") {
    const target = args.placement[key];
    if (typeof target !== "string" || target.trim() === "") {
      throw new CommandError("INVALID_ARGUMENT", `placement.${key} must be a non-empty string`);
    }
    return { tasks, placement: { [key]: target } as TaskReorderPlacement };
  }
  if (args.placement[key] !== true) {
    throw new CommandError("INVALID_ARGUMENT", `placement.${key} must be true`);
  }
  return { tasks, placement: { [key]: true } as TaskReorderPlacement };
}

function storedSiblings(database: DatabaseSync, parentId: string | null): StoredSibling[] {
  const rows = database
    .prepare("SELECT id, position, version FROM tasks WHERE parent_id IS ? ORDER BY position ASC, id ASC")
    .all(parentId) as Row[];
  return rows.map((row) => {
    const position = numberValue(row, "position");
    const version = numberValue(row, "version");
    if (!Number.isInteger(position) || position < 0 || !Number.isInteger(version) || version < 1) {
      throw new CommandError("INVALID_STORAGE", "database contains an invalid task ordering row");
    }
    return { id: stringValue(row, "id"), position, version };
  });
}

function reorderPlan(database: DatabaseSync, request: ProtocolRequest): ReorderPlan {
  const { tasks, placement } = reorderArguments(request.args);
  let parentId: string | null = null;
  let parentInitialized = false;
  for (const selected of tasks) {
    const row = database.prepare("SELECT id, parent_id, position, version FROM tasks WHERE id = ?").get(selected.id) as Row | undefined;
    if (!row) {
      throw new CommandError("TASK_NOT_FOUND", `task ${selected.id} was not found`);
    }
    const rowParentId = parentIdValue(row);
    if (parentInitialized && rowParentId !== parentId) {
      throw new CommandError("INVALID_REORDER_SCOPE", "all reordered tasks must share one parent");
    }
    parentId = rowParentId;
    parentInitialized = true;
    const currentVersion = numberValue(row, "version");
    if (selected.expectedVersion !== currentVersion) {
      throw new CommandError("STALE_TASK_VERSION", `task ${selected.id} is at version ${currentVersion}`);
    }
    const position = numberValue(row, "position");
    if (!Number.isInteger(position) || position < 0) {
      throw new CommandError("INVALID_STORAGE", `task ${selected.id} has an invalid position`);
    }
  }

  const siblings = storedSiblings(database, parentId);
  const selectedIds = new Set(tasks.map((selected) => selected.id));
  const orderedSelectedIds = siblings.filter((sibling) => selectedIds.has(sibling.id)).map((sibling) => sibling.id);
  if (orderedSelectedIds.length !== tasks.length || orderedSelectedIds.some((id, index) => id !== tasks[index]?.id)) {
    throw new CommandError("INVALID_REORDER_ORDER", "reordered tasks must be supplied in their current sibling order");
  }

  let targetId: string | undefined;
  let insertAt: number;
  if ("beforeId" in placement) {
    targetId = placement.beforeId;
    insertAt = -1;
  } else if ("afterId" in placement) {
    targetId = placement.afterId;
    insertAt = -1;
  } else {
    insertAt = "first" in placement ? 0 : siblings.length - selectedIds.size;
  }

  const remaining = siblings.filter((sibling) => !selectedIds.has(sibling.id));
  if (targetId !== undefined) {
    const target = database.prepare("SELECT id, parent_id FROM tasks WHERE id = ?").get(targetId) as Row | undefined;
    if (!target) {
      throw new CommandError("TASK_NOT_FOUND", `placement target ${targetId} was not found`);
    }
    if (selectedIds.has(targetId)) {
      throw new CommandError("INVALID_REORDER_PLACEMENT", "placement target cannot be selected");
    }
    if (parentIdValue(target) !== parentId) {
      throw new CommandError("INVALID_REORDER_SCOPE", "placement target must share the task parent");
    }
    const targetIndex = remaining.findIndex((sibling) => sibling.id === targetId);
    insertAt = "beforeId" in placement ? targetIndex : targetIndex + 1;
  }

  const finalIds = [
    ...remaining.slice(0, insertAt).map((sibling) => sibling.id),
    ...orderedSelectedIds,
    ...remaining.slice(insertAt).map((sibling) => sibling.id),
  ];
  const changed = finalIds.some((id, index) => id !== siblings[index]?.id);
  return { tasks, parentId, siblings, finalIds, changed };
}

function reorderTask(database: DatabaseSync, databasePath: string, request: ProtocolRequest): Record<string, unknown> {
  const context = mutationContext(database, request);
  if (context.replay) return context.replay;

  if (request.readOnly || request.dryRun) {
    const plan = reorderPlan(database, request);
    return {
      changed: plan.changed,
      tasks: plan.tasks.map((selected) => requireTask(database, selected.id)),
      dryRun: true,
      readOnly: Boolean(request.readOnly),
    };
  }

  let affectedParentId: string | null = null;
  let reorderChanged = false;
  return withCanonicalTransaction(
    database,
    databasePath,
    request,
    () => reorderChanged ? { orderParentIds: [affectedParentId] } : null,
    () => {
      const plan = reorderPlan(database, request);
      affectedParentId = plan.parentId;
      reorderChanged = plan.changed;
      if (!plan.changed) {
        const result = {
          changed: false,
          tasks: plan.tasks.map((selected) => requireTask(database, selected.id)),
        };
        recordReceipt(database, request, context, result, new Date().toISOString());
        return result;
      }

      const operationId = randomUUID();
      const payload = operationPayload(
        plan.tasks.map((selected) => ({
          taskId: selected.id,
          beforeVersion: selected.expectedVersion,
          afterVersion: selected.expectedVersion + 1,
          restore: {},
          expect: {},
          touchUpdatedAt: false,
        })),
        [{ parentId: plan.parentId, beforeIds: plan.siblings.map((sibling) => sibling.id), afterIds: plan.finalIds }],
      );
      const selectedById = new Map(plan.tasks.map((selected) => [selected.id, selected]));
      const beforeById = new Map(plan.siblings.map((sibling) => [sibling.id, sibling.position]));
      const updatePosition = database.prepare("UPDATE tasks SET position = ? WHERE id = ?");
      const updateSelected = database.prepare("UPDATE tasks SET position = ?, version = version + 1 WHERE id = ? AND version = ?");
      plan.finalIds.forEach((id, position) => {
        const selected = selectedById.get(id);
        if (selected) {
          const result = updateSelected.run(position, id, selected.expectedVersion);
          if (result.changes !== 1) {
            throw new CommandError("STALE_TASK_VERSION", `task ${id} changed while it was being reordered`);
          }
        } else {
          updatePosition.run(position, id);
        }
      });

      const now = new Date().toISOString();
      for (const selected of plan.tasks) {
        const beforePosition = beforeById.get(selected.id);
        const afterPosition = plan.finalIds.indexOf(selected.id);
        insertActivity(
          database,
          selected.id,
          request,
          "reordered",
          {
            before: { position: beforePosition },
            after: { position: afterPosition },
            siblingScope: { parentId: plan.parentId },
          },
          now,
        );
      }
      const result = operationResult({
        changed: true,
        tasks: plan.tasks.map((selected) => requireTask(database, selected.id)),
      }, operationId);
      recordOperation(database, request, payload, now, operationId);
      recordReceipt(database, request, context, result, now);
      return result;
    },
  );
}

function listCategories(database: DatabaseSync): Record<string, unknown> {
  const rows = database
    .prepare(
      `SELECT categories.slug, categories.label, COUNT(tasks.id) AS task_count
       FROM categories
       JOIN tasks ON tasks.category_id = categories.id AND tasks.status <> 'canceled'
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
       JOIN tasks ON tasks.id = task_tags.task_id AND tasks.status <> 'canceled'
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
  const includeAncestorsArgument = request.args.includeAncestors;
  if (includeAncestorsArgument !== undefined && typeof includeAncestorsArgument !== "boolean") {
    throw new CommandError("INVALID_ARGUMENT", "includeAncestors must be a boolean");
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
  if (sortArgument !== "created" && sortArgument !== "updated" && sortArgument !== "priority" && sortArgument !== "manual") {
    throw new CommandError("INVALID_ARGUMENT", "sort must be created, updated, priority, or manual");
  }
  const directionArgument = request.args.direction ?? "desc";
  if (directionArgument !== "asc" && directionArgument !== "desc") {
    throw new CommandError("INVALID_ARGUMENT", "direction must be asc or desc");
  }
  // Both values are allow-listed above, so interpolation is safe.
  const orderBy = sortArgument === "created" ? "tasks.created_at" : sortArgument === "priority" ? "tasks.priority" : "tasks.updated_at";
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
    conditions.push(`NOT EXISTS (
      SELECT 1
      FROM task_dependencies
      JOIN tasks AS dependencies ON dependencies.id = task_dependencies.depends_on_id
      WHERE task_dependencies.task_id = tasks.id
        AND dependencies.status <> 'canceled'
    )`);
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
  // Encode IDs and terminate each segment so a parent subtree stays together even when IDs share a prefix.
  const manualOrder = `WITH RECURSIVE task_tree(id, order_path) AS (
    SELECT root.id, printf('%020d:%s/', root.position, hex(CAST(root.id AS BLOB)))
    FROM tasks AS root
    WHERE root.parent_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM tasks AS parent WHERE parent.id = root.parent_id)
    UNION ALL
    SELECT child.id, task_tree.order_path || printf('%020d:%s/', child.position, hex(CAST(child.id AS BLOB)))
    FROM tasks AS child
    JOIN task_tree ON task_tree.id = child.parent_id
  )`;
  const rows = database
    .prepare(
      `${sortArgument === "manual" ? manualOrder : ""}
       SELECT tasks.*, categories.slug AS category_slug, categories.label AS category_label
       FROM tasks LEFT JOIN categories ON categories.id = tasks.category_id
       ${sortArgument === "manual" ? "JOIN task_tree ON task_tree.id = tasks.id" : ""}
       ${where}
       ORDER BY ${sortArgument === "manual" ? "task_tree.order_path ASC" : `${orderBy} ${sortArgument === "priority" ? (directionArgument === "desc" ? "ASC" : "DESC") : orderDirection}, tasks.id ASC`}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Row[];
  const tasks = rows.map((row) => taskFromRow(database, row));
  const totalRow = database
    .prepare(`SELECT COUNT(*) AS count FROM tasks LEFT JOIN categories ON categories.id = tasks.category_id ${where}`)
    .get(...params) as Row;
  return {
    tasks,
    contextTasks: includeAncestorsArgument === true ? ancestorTasksFor(database, tasks) : [],
    total: numberValue(totalRow, "count"),
    limit,
    offset,
    workspaceRevision: readWorkspaceRevision(database),
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

function readTaskPositions(database: DatabaseSync): Map<string, number> {
  const rows = database.prepare("SELECT id, position FROM tasks").all() as Row[];
  return new Map(rows.map((row) => [stringValue(row, "id"), numberValue(row, "position")]));
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
      return createTask(database, databasePath, request);
    case "task.list":
      return listTasks(database, request);
    case "task.reorder":
      return reorderTask(database, databasePath, request);
    case "task.transitionMany":
      return transitionMany(database, databasePath, request);
    case "task.status.undoMany":
      return undoStatusMany(database, databasePath, request);
    case "operation.undo":
      return undoOperation(database, databasePath, request);
    case "category.list":
      return listCategories(database);
    case "tag.list":
      return listTags(database);
    case "task.get":
      return getTask(database, request);
    case "task.update":
      return updateTask(database, databasePath, request);
    case "task.move":
      return moveTask(database, databasePath, request);
    case "task.dependency.add":
      return addDependency(database, databasePath, request);
    case "task.dependency.remove":
      return removeDependency(database, databasePath, request);
    case "task.delete":
      return transitionTask(database, databasePath, request);
    case "task.purgeCanceled":
      return purgeCanceledTasks(database, databasePath, request);
    case "task.start":
    case "task.pause":
    case "task.complete":
    case "task.reopen":
    case "task.cancel":
      return transitionTask(database, databasePath, request);
    case "task.status.undo":
      return undoStatus(database, databasePath, request);
    case "activity.list":
      return listActivity(database, request);
    case "workspace.info":
      return workspaceInfo(database, databasePath);
    case "workspace.backup":
      return backupWorkspace(database, request);
    case "workspace.export":
      return exportWorkspace(database, request);
    case "workspace.exportTasks":
      return exportTasks(databasePath, readAllTasks(database), readTaskPositions(database), request);
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
    case "workspace.rebuild":
      return rebuildCanonicalCache(database, databasePath, request);
    case "workspace.archive":
      return archiveCanonicalWorkspace(databasePath, request);
    case "workspace.sync":
      return canonicalWorkspaceStatus(database, databasePath);
    case "workspace.conflict.list":
      return listCanonicalConflicts(database);
    case "workspace.conflict.resolve":
      return resolveCanonicalConflict(database, databasePath, request);
    case "workspace.receive.prepare":
    case "workspace.receive.status":
    case "workspace.receive.abort":
      throw new CommandError("UNKNOWN_COMMAND", `${request.command} is handled by the workspace command path`);
    case "theme.list":
    case "theme.set":
      throw new CommandError("UNKNOWN_COMMAND", `${request.command} is handled by the theme command`);
    case "runtime.probe":
      throw new CommandError("UNKNOWN_COMMAND", "runtime.probe is handled by the runtime command");
  }
}
