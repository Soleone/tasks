import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { RuntimeProbeResult } from "./protocol.js";

export const SCHEMA_VERSION = 5;

function readString(value: unknown, field: string): string {
  if (typeof value !== "object" || value === null || !(field in value)) {
    throw new Error(`SQLite did not return ${field}`);
  }

  const result = (value as Record<string, unknown>)[field];
  if (typeof result !== "string") {
    throw new Error(`SQLite returned a non-string ${field}`);
  }

  return result;
}

function readNumber(value: unknown, field: string): number {
  if (typeof value !== "object" || value === null || !(field in value)) {
    throw new Error(`SQLite did not return ${field}`);
  }

  const result = (value as Record<string, unknown>)[field];
  if (typeof result !== "number") {
    throw new Error(`SQLite returned a non-number ${field}`);
  }

  return result;
}

function createSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      description_markdown TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'paused', 'done', 'canceled')),
      category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      parent_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      position INTEGER NOT NULL,
      priority INTEGER NOT NULL DEFAULT 2 CHECK (priority IN (0, 1, 2, 3, 4)),
      version INTEGER NOT NULL CHECK (version > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      canceled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS task_dependencies (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      depends_on_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, depends_on_id),
      CHECK (task_id != depends_on_id)
    );

    CREATE TABLE IF NOT EXISTS task_tags (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS activity (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor_kind TEXT NOT NULL,
      actor_label TEXT NOT NULL,
      created_at TEXT NOT NULL,
      details_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS command_receipts (
      idempotency_key TEXT PRIMARY KEY,
      command TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS tasks_updated_at_idx ON tasks (updated_at DESC, id ASC);
    CREATE INDEX IF NOT EXISTS tasks_created_at_idx ON tasks (created_at DESC, id ASC);
    CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks (status, updated_at DESC, id ASC);
    CREATE INDEX IF NOT EXISTS tasks_parent_idx ON tasks (parent_id);
    CREATE INDEX IF NOT EXISTS task_dependencies_task_idx ON task_dependencies (task_id);
    CREATE INDEX IF NOT EXISTS task_dependencies_depends_idx ON task_dependencies (depends_on_id);
    CREATE INDEX IF NOT EXISTS activity_task_idx ON activity (task_id, seq DESC);
  `);
}

function migrateTaskStatusConstraint(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE tasks_v2 (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      description_markdown TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'paused', 'done', 'canceled')),
      category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      parent_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      priority INTEGER NOT NULL DEFAULT 2 CHECK (priority IN (0, 1, 2, 3, 4)),
      version INTEGER NOT NULL CHECK (version > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      canceled_at TEXT
    );
    INSERT INTO tasks_v2 (id, title, description_markdown, status, category_id, parent_id, priority, version, created_at, updated_at, completed_at, canceled_at)
      SELECT id, title, description_markdown, status, category_id, NULL, 2, version, created_at, updated_at, completed_at, canceled_at
      FROM tasks;
    DROP TABLE tasks;
    ALTER TABLE tasks_v2 RENAME TO tasks;
  `);
}

function migrateRelationships(database: DatabaseSync): void {
  const columns = database.prepare("SELECT name FROM pragma_table_info('tasks')").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'parent_id')) {
    database.exec('ALTER TABLE tasks ADD COLUMN parent_id TEXT REFERENCES tasks(id) ON DELETE SET NULL');
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS task_dependencies (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      depends_on_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, depends_on_id),
      CHECK (task_id != depends_on_id)
    );
    CREATE INDEX IF NOT EXISTS tasks_parent_idx ON tasks (parent_id);
    CREATE INDEX IF NOT EXISTS task_dependencies_task_idx ON task_dependencies (task_id);
    CREATE INDEX IF NOT EXISTS task_dependencies_depends_idx ON task_dependencies (depends_on_id);
  `);
}

function migratePriority(database: DatabaseSync): void {
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").all() as Array<{ name: string }>;
  if (tables.length === 0) return;
  const columns = database.prepare("SELECT name FROM pragma_table_info('tasks')").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'priority')) {
    database.exec('ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 2 CHECK (priority IN (0, 1, 2, 3, 4))');
  }
  database.exec(`
    CREATE INDEX IF NOT EXISTS tasks_priority_idx ON tasks (priority, updated_at DESC, id ASC);
  `);
}

function migrateTaskOrdering(database: DatabaseSync): void {
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").all() as Array<{ name: string }>;
  if (tables.length === 0) return;
  const columns = database.prepare("SELECT name FROM pragma_table_info('tasks')").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'position')) {
    database.exec('ALTER TABLE tasks ADD COLUMN position INTEGER NOT NULL DEFAULT 0');
  }

  // The first manual order mirrors the existing Updated/newest list. The id
  // tie-break keeps migration deterministic when timestamps collide.
  database.exec(`
    UPDATE tasks
    SET position = (
      SELECT COUNT(*)
      FROM tasks AS siblings
      WHERE (siblings.parent_id = tasks.parent_id
        OR (siblings.parent_id IS NULL AND tasks.parent_id IS NULL))
        AND (siblings.updated_at > tasks.updated_at
          OR (siblings.updated_at = tasks.updated_at AND siblings.id < tasks.id))
    );
  `);
}

function ensureTaskOrderingIndex(database: DatabaseSync): void {
  database.exec("CREATE INDEX IF NOT EXISTS tasks_parent_position_idx ON tasks (parent_id, position, id)");
}

export function ensureSchema(database: DatabaseSync): void {
  database.exec("CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
  const row = database.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get() as
    | { value?: unknown }
    | undefined;
  const version = row?.value === undefined ? undefined : Number(row.value);

  if (version !== undefined && (!Number.isInteger(version) || version > SCHEMA_VERSION)) {
    throw new Error(`UNSUPPORTED_SCHEMA: database schema ${String(row?.value)} is newer than ${SCHEMA_VERSION}`);
  }
  if (version !== undefined && version !== 1 && version !== 2 && version !== 3 && version !== 4 && version !== SCHEMA_VERSION) {
    throw new Error(`UNSUPPORTED_SCHEMA: database schema ${String(row?.value)} is not supported`);
  }

  const needsVersion = version === undefined;
  const needsStatusMigration = version === 1;
  const needsRelationshipMigration = version === 1 || version === 2;
  const needsPriorityMigration = version === 1 || version === 2 || version === 3;
  const needsOrderingMigration = version === undefined || version === 1 || version === 2 || version === 3 || version === 4;
  // SQLite cannot change a table constraint in place. Foreign keys are disabled
  // only for the atomic table replacement, then restored before the connection
  // is returned to callers.
  database.exec("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE");
  try {
    if (needsStatusMigration) migrateTaskStatusConstraint(database);
    if (needsRelationshipMigration) migrateRelationships(database);
    createSchema(database);
    migratePriority(database);
    if (needsOrderingMigration) migrateTaskOrdering(database);
    ensureTaskOrderingIndex(database);
    if (needsVersion || needsStatusMigration || needsRelationshipMigration || needsPriorityMigration || needsOrderingMigration) {
      database
        .prepare("INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(String(SCHEMA_VERSION));
    }
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the original schema error.
    }
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}

export function openDatabase(databasePath: string): DatabaseSync {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 1000; PRAGMA journal_mode = WAL;");
    ensureSchema(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export function runRuntimeProbe(databasePath: string): RuntimeProbeResult {
  const database = openDatabase(databasePath);
  try {
    const journalMode = readString(database.prepare("PRAGMA journal_mode = WAL").get(), "journal_mode");
    const sqliteVersion = readString(database.prepare("SELECT sqlite_version() AS version").get(), "version");

    database.exec(
      "CREATE TABLE IF NOT EXISTS runtime_probe (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL);" +
        "CREATE VIRTUAL TABLE IF NOT EXISTS runtime_probe_fts USING fts5(value);",
    );

    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec("DELETE FROM runtime_probe; DELETE FROM runtime_probe_fts;");
      database.prepare("INSERT INTO runtime_probe (id, value) VALUES (1, ?)").run("capture a task");
      database.prepare("INSERT INTO runtime_probe_fts (value) VALUES (?)").run("capture a task");
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }

    const searchMatches = readNumber(
      database.prepare("SELECT COUNT(*) AS count FROM runtime_probe_fts WHERE runtime_probe_fts MATCH ?").get("task"),
      "count",
    );
    const probeValue = readString(database.prepare("SELECT value FROM runtime_probe WHERE id = 1").get(), "value");

    return {
      databasePath,
      nodeVersion: process.version,
      sqliteVersion,
      journalMode,
      fts5Enabled: true,
      searchMatches,
      probeValue,
    };
  } finally {
    database.close();
  }
}

export function withTransaction<T>(database: DatabaseSync, action: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the original command error.
    }
    throw error;
  }
}
