import type { DatabaseSync } from "node:sqlite";
import { readWorkspaceRevision } from "./database.js";
import { CommandError } from "../../backend/errors.js";
import { optionalInteger, optionalString, requiredString } from "./taskArguments.js";
import { findTask, numberValue, requireTask, stringValue, taskFromRow } from "./taskRecords.js";
import type { ActivityRecord, Actor, ProtocolRequest, TaskRecord } from "./protocol.js";

type Row = Record<string, unknown>;

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

export function listCategories(database: DatabaseSync): Record<string, unknown> {
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

export function listTags(database: DatabaseSync): Record<string, unknown> {
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

export function listTasks(database: DatabaseSync, request: ProtocolRequest): Record<string, unknown> {
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
  const categoryIsNull = request.args.categoryIsNull;
  if (categoryIsNull !== undefined && typeof categoryIsNull !== "boolean") {
    throw new CommandError("INVALID_ARGUMENT", "categoryIsNull must be a boolean");
  }
  if (categoryIsNull === true && categorySlug !== undefined) {
    throw new CommandError("INVALID_ARGUMENT", "categoryIsNull cannot be combined with category");
  }
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
  const sortArgument = request.args.sort ?? "created";
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
  } else if (categoryIsNull === true) {
    conditions.push("categories.id IS NULL");
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

export function getTask(database: DatabaseSync, request: ProtocolRequest): Record<string, unknown> {
  return { task: requireTask(database, requiredString(request.args, "id")) };
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

export function readTaskPositions(database: DatabaseSync): Map<string, number> {
  const rows = database.prepare("SELECT id, position FROM tasks").all() as Row[];
  return new Map(rows.map((row) => [stringValue(row, "id"), numberValue(row, "position")]));
}

export function listActivity(database: DatabaseSync, request: ProtocolRequest): Record<string, unknown> {
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
      if (isRecord(parsed)) details = parsed;
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
