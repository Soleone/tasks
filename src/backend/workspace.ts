import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { SCHEMA_VERSION, openDatabase, withTransaction } from "./database.js";
import { CommandError } from "./errors.js";
import type { ProtocolRequest } from "./protocol.js";

type Row = Record<string, unknown>;

type Snapshot = {
  formatVersion: 1;
  schemaVersion: 1;
  exportedAt: string;
  categories: Row[];
  tags: Row[];
  tasks: Row[];
  taskTags: Row[];
  activity: Row[];
  commandReceipts: Row[];
};

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(row: Row, field: string): string {
  const value = row[field];
  if (typeof value !== "string") {
    throw new CommandError("INVALID_SNAPSHOT", `snapshot field ${field} is not text`);
  }
  return value;
}

function numberValue(row: Row, field: string): number {
  const value = row[field];
  if (typeof value !== "number") {
    throw new CommandError("INVALID_SNAPSHOT", `snapshot field ${field} is not numeric`);
  }
  return value;
}

function requiredPath(args: Row, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new CommandError("INVALID_ARGUMENT", `${name} is required`);
  }
  return value;
}

export function backupWorkspace(database: DatabaseSync, request: ProtocolRequest): Record<string, unknown> {
  const destinationPath = requiredPath(request.args, "destinationPath");
  if (request.readOnly || request.dryRun) {
    return { destinationPath, dryRun: true, readOnly: Boolean(request.readOnly) };
  }
  mkdirSync(path.dirname(destinationPath), { recursive: true });
  if (existsSync(destinationPath)) {
    throw new CommandError("BACKUP_EXISTS", `backup destination already exists: ${destinationPath}`);
  }
  const escapedPath = destinationPath.replaceAll("'", "''");
  database.exec(`VACUUM INTO '${escapedPath}'`);
  return { destinationPath };
}

function readSnapshot(sourcePath: string): Snapshot {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(sourcePath, "utf8"));
  } catch (error) {
    throw new CommandError("INVALID_SNAPSHOT", error instanceof Error ? error.message : "could not read snapshot");
  }
  if (!isRecord(value) || value.formatVersion !== 1 || value.schemaVersion !== SCHEMA_VERSION) {
    throw new CommandError("UNSUPPORTED_SNAPSHOT", "snapshot format or schema version is not supported");
  }

  const arrays = ["categories", "tags", "tasks", "taskTags", "activity", "commandReceipts"] as const;
  for (const name of arrays) {
    if (!Array.isArray(value[name]) || !value[name].every(isRecord)) {
      throw new CommandError("INVALID_SNAPSHOT", `snapshot field ${name} must be an array of objects`);
    }
  }
  return value as unknown as Snapshot;
}

export function exportWorkspace(database: DatabaseSync, request: ProtocolRequest): Record<string, unknown> {
  const snapshot: Snapshot = {
    formatVersion: 1,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    categories: database.prepare("SELECT * FROM categories ORDER BY slug ASC").all() as Row[],
    tags: database.prepare("SELECT * FROM tags ORDER BY slug ASC").all() as Row[],
    tasks: database.prepare("SELECT * FROM tasks ORDER BY id ASC").all() as Row[],
    taskTags: database.prepare("SELECT * FROM task_tags ORDER BY task_id ASC, tag_id ASC").all() as Row[],
    activity: database.prepare("SELECT * FROM activity ORDER BY seq ASC").all() as Row[],
    commandReceipts: database.prepare("SELECT * FROM command_receipts ORDER BY idempotency_key ASC").all() as Row[],
  };
  const destinationPath = request.args.destinationPath;
  if (typeof destinationPath === "string" && destinationPath.trim() !== "" && !request.readOnly && !request.dryRun) {
    mkdirSync(path.dirname(destinationPath), { recursive: true });
    writeFileSync(destinationPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  }
  return {
    snapshot,
    destinationPath: typeof destinationPath === "string" && destinationPath.trim() !== "" ? destinationPath : null,
    ...(request.readOnly || request.dryRun ? { dryRun: true, readOnly: Boolean(request.readOnly) } : {}),
  };
}

export function restoreWorkspace(request: ProtocolRequest): Record<string, unknown> {
  const sourcePath = requiredPath(request.args, "sourcePath");
  const destinationPath = requiredPath(request.args, "destinationPath");
  const snapshot = readSnapshot(sourcePath);
  if (request.readOnly || request.dryRun) {
    return {
      destinationPath,
      taskCount: snapshot.tasks.length,
      activityCount: snapshot.activity.length,
      dryRun: true,
      readOnly: Boolean(request.readOnly),
    };
  }
  if (path.resolve(sourcePath) === path.resolve(destinationPath)) {
    throw new CommandError("INVALID_ARGUMENT", "restore destination must differ from the snapshot path");
  }
  if (existsSync(destinationPath)) {
    throw new CommandError("DESTINATION_EXISTS", `restore destination already exists: ${destinationPath}`);
  }

  const restored = openDatabase(destinationPath);
  try {
    withTransaction(restored, () => {
      for (const row of snapshot.categories) {
        restored
          .prepare("INSERT INTO categories (id, slug, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
          .run(stringValue(row, "id"), stringValue(row, "slug"), stringValue(row, "label"), stringValue(row, "created_at"), stringValue(row, "updated_at"));
      }
      for (const row of snapshot.tags) {
        restored
          .prepare("INSERT INTO tags (id, slug, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
          .run(stringValue(row, "id"), stringValue(row, "slug"), stringValue(row, "label"), stringValue(row, "created_at"), stringValue(row, "updated_at"));
      }
      for (const row of snapshot.tasks) {
        restored
          .prepare(
            "INSERT INTO tasks (id, title, description_markdown, status, category_id, version, created_at, updated_at, completed_at, canceled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            stringValue(row, "id"),
            stringValue(row, "title"),
            stringValue(row, "description_markdown"),
            stringValue(row, "status"),
            row.category_id === null ? null : stringValue(row, "category_id"),
            numberValue(row, "version"),
            stringValue(row, "created_at"),
            stringValue(row, "updated_at"),
            row.completed_at === null ? null : stringValue(row, "completed_at"),
            row.canceled_at === null ? null : stringValue(row, "canceled_at"),
          );
      }
      for (const row of snapshot.taskTags) {
        restored.prepare("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)").run(stringValue(row, "task_id"), stringValue(row, "tag_id"));
      }
      for (const row of snapshot.activity) {
        restored
          .prepare(
            "INSERT INTO activity (seq, task_id, request_id, action, actor_kind, actor_label, created_at, details_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            numberValue(row, "seq"),
            stringValue(row, "task_id"),
            stringValue(row, "request_id"),
            stringValue(row, "action"),
            stringValue(row, "actor_kind"),
            stringValue(row, "actor_label"),
            stringValue(row, "created_at"),
            stringValue(row, "details_json"),
          );
      }
      for (const row of snapshot.commandReceipts) {
        restored
          .prepare("INSERT INTO command_receipts (idempotency_key, command, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?)")
          .run(stringValue(row, "idempotency_key"), stringValue(row, "command"), stringValue(row, "request_hash"), stringValue(row, "response_json"), stringValue(row, "created_at"));
      }
    });
  } catch (error) {
    restored.close();
    throw error;
  }
  restored.close();
  return { destinationPath, taskCount: snapshot.tasks.length, activityCount: snapshot.activity.length };
}
