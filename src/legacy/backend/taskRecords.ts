import type { DatabaseSync } from "node:sqlite";
import { CommandError } from "../../backend/errors.js";
import type { ClassificationToken, TaskPriority, TaskRecord, TaskStatus } from "./protocol.js";

type Row = Record<string, unknown>;

export function stringValue(row: Row, field: string): string {
  const value = row[field];
  if (typeof value !== "string") {
    throw new CommandError("INVALID_STORAGE", `database field ${field} is not text`);
  }
  return value;
}

export function nullableStringValue(row: Row, field: string): string | null {
  const value = row[field];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new CommandError("INVALID_STORAGE", `database field ${field} is not nullable text`);
  }
  return value;
}

export function numberValue(row: Row, field: string): number {
  const value = row[field];
  if (typeof value !== "number") {
    throw new CommandError("INVALID_STORAGE", `database field ${field} is not numeric`);
  }
  return value;
}

export function priorityValue(value: unknown): TaskPriority {
  if (value === 0 || value === 1 || value === 2 || value === 3 || value === 4) return value;
  throw new CommandError("INVALID_STORAGE", `database contains unsupported task priority ${String(value)}`);
}

export function statusValue(value: unknown): TaskStatus {
  if (value === "open" || value === "in_progress" || value === "paused" || value === "done" || value === "canceled") {
    return value;
  }
  throw new CommandError("INVALID_STORAGE", `database contains unsupported task status ${String(value)}`);
}

function categoryFromRow(row: Row | undefined): ClassificationToken | null {
  if (!row || row.category_slug === null || row.category_slug === undefined) return null;
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

export function taskFromRow(database: DatabaseSync, row: Row): TaskRecord {
  const id = stringValue(row, "id");
  const dependencies = dependencyIdsForTask(database, id);
  const tagRows = database
    .prepare(
      `SELECT tags.slug AS tag_slug, tags.label AS tag_label
       FROM task_tags
       JOIN tags ON tags.id = task_tags.tag_id
       WHERE task_tags.task_id = ?
       ORDER BY tags.slug ASC`,
    )
    .all(id) as Row[];

  return {
    id,
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

export function findTask(database: DatabaseSync, taskId: string): TaskRecord | null {
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

export function requireTask(database: DatabaseSync, taskId: string): TaskRecord {
  const task = findTask(database, taskId);
  if (!task) throw new CommandError("TASK_NOT_FOUND", `task ${taskId} was not found`);
  return task;
}
