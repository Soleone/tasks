import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { executeCommand } from "./commands.js";
import { openDatabase } from "./database.js";
import { type ProtocolRequest, type TaskRecord } from "./protocol.js";
import { classifyTaskText, stripClassificationTokens, TaskTextError } from "./taskText.js";

type Result = Record<string, unknown>;

function request(
  command: ProtocolRequest["command"],
  args: Record<string, unknown> = {},
  options: Partial<Pick<ProtocolRequest, "idempotencyKey" | "readOnly" | "dryRun">> = {},
): ProtocolRequest {
  return {
    version: 1,
    requestId: `${command}-${Math.random().toString(36).slice(2)}`,
    command,
    args,
    actor: { kind: "agent", label: "test" },
    ...options,
  };
}

function task(result: Result): TaskRecord {
  return result.task as TaskRecord;
}

function countRows(databasePath: string, table: string): number {
  const database = new DatabaseSync(databasePath);
  try {
    const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
    return row.count;
  } finally {
    database.close();
  }
}

function cleanDirectory(directory: string): void {
  rmSync(directory, { recursive: true, force: true });
}

test("classification respects boundaries, code, URLs, headings, and one category", () => {
  assert.deepEqual(classifyTaskText("Prepare @Todo-App launch #Planning #planning #product"), {
    category: { slug: "todo-app", label: "Todo-App" },
    tags: [
      { slug: "planning", label: "Planning" },
      { slug: "product", label: "product" },
    ],
  });
  assert.deepEqual(classifyTaskText("# Heading\nEmail me@example.com\nSee https://example.com/#anchor\n`@code #ignored`\n- #real"), {
    category: null,
    tags: [{ slug: "real", label: "real" }],
  });
  assert.throws(
    () => classifyTaskText("Choose @one and @two"),
    (error: unknown) => error instanceof TaskTextError && error.code === "MULTIPLE_CATEGORIES",
  );
  assert.equal(stripClassificationTokens("Prepare @Todo-App launch #Planning #product"), "Prepare launch");
  assert.equal(stripClassificationTokens("See https://example.com/#anchor and `#ignored` #real"), "See https://example.com/#anchor and `#ignored`");
});

test("task mutations persist classification, activity, and optimistic versions", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-m1-mutations-"));
  const databasePath = path.join(directory, "tasks.db");

  try {
    const created = executeCommand(
      request("task.create", { title: "Prepare @todo-app launch #planning #product" }, { idempotencyKey: "create-1" }),
      databasePath,
    );
    const createdTask = task(created);
    assert.equal(createdTask.category?.slug, "todo-app");
    assert.deepEqual(createdTask.tags.map((tag) => tag.slug), ["planning", "product"]);

    const updated = executeCommand(
      request(
        "task.update",
        { id: createdTask.id, title: "Prepare the launch", expectedVersion: 1 },
        { idempotencyKey: "update-1" },
      ),
      databasePath,
    );
    assert.equal(task(updated).version, 2);
    assert.equal(task(updated).category, null);
    assert.deepEqual(task(updated).tags, []);

    assert.throws(
      () =>
        executeCommand(
          request(
            "task.update",
            { id: createdTask.id, title: "stale", expectedVersion: 1 },
            { idempotencyKey: "update-stale" },
          ),
          databasePath,
        ),
      /STALE_TASK_VERSION/,
    );

    const started = executeCommand(
      request("task.start", { id: createdTask.id, expectedVersion: 2 }, { idempotencyKey: "start-1" }),
      databasePath,
    );
    assert.equal(task(started).status, "in_progress");
    const paused = executeCommand(
      request("task.pause", { id: createdTask.id, expectedVersion: 3 }, { idempotencyKey: "pause-1" }),
      databasePath,
    );
    assert.equal(task(paused).status, "paused");
    const completed = executeCommand(
      request("task.complete", { id: createdTask.id, expectedVersion: 4 }, { idempotencyKey: "complete-1" }),
      databasePath,
    );
    assert.equal(task(completed).status, "done");
    const reopened = executeCommand(
      request("task.reopen", { id: createdTask.id, expectedVersion: 5 }, { idempotencyKey: "reopen-1" }),
      databasePath,
    );
    assert.equal(task(reopened).status, "open");
    const canceled = executeCommand(
      request("task.cancel", { id: createdTask.id, expectedVersion: 6 }, { idempotencyKey: "cancel-1" }),
      databasePath,
    );
    assert.equal(task(canceled).status, "canceled");

    const repeatedCancel = executeCommand(
      request("task.cancel", { id: createdTask.id, expectedVersion: 7 }, { idempotencyKey: "cancel-noop" }),
      databasePath,
    );
    assert.equal(repeatedCancel.changed, false);
    const activities = executeCommand(request("activity.list", { taskId: createdTask.id }), databasePath);
    assert.equal((activities.activity as unknown[]).length, 7);
  } finally {
    cleanDirectory(directory);
  }
});

test("idempotency replays the original result and rejects key reuse", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-m1-idempotency-"));
  const databasePath = path.join(directory, "tasks.db");

  try {
    const first = executeCommand(
      request("task.create", { title: "Capture #one" }, { idempotencyKey: "same-key" }),
      databasePath,
    );
    const replayRequest = request("task.create", { title: "Capture #one" }, { idempotencyKey: "same-key" });
    const replay = executeCommand(replayRequest, databasePath);
    assert.deepEqual(replay, first);
    assert.equal(countRows(databasePath, "tasks"), 1);
    assert.equal(countRows(databasePath, "activity"), 1);
    assert.equal(countRows(databasePath, "command_receipts"), 1);

    assert.throws(
      () => executeCommand(request("task.create", { title: "Different" }, { idempotencyKey: "same-key" }), databasePath),
      /IDEMPOTENCY_KEY_REUSED/,
    );
  } finally {
    cleanDirectory(directory);
  }
});

test("read-only and dry-run mutations leave every table unchanged", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-m1-preview-"));
  const databasePath = path.join(directory, "tasks.db");

  try {
    const created = executeCommand(
      request("task.create", { title: "Existing #tag" }, { idempotencyKey: "create-preview-base" }),
      databasePath,
    );
    const createdTask = task(created);
    const tables = ["tasks", "categories", "tags", "task_tags", "activity", "command_receipts"];
    const before = tables.map((tableName) => countRows(databasePath, tableName));

    const preview = executeCommand(
      request("task.create", { title: "Preview @work #later" }, { idempotencyKey: "preview-create", dryRun: true }),
      databasePath,
    );
    assert.equal(preview.dryRun, true);
    const readOnly = executeCommand(
      request(
        "task.update",
        { id: createdTask.id, title: "Would change", expectedVersion: createdTask.version },
        { idempotencyKey: "preview-update", readOnly: true },
      ),
      databasePath,
    );
    assert.equal(readOnly.dryRun, true);
    assert.deepEqual(tables.map((tableName) => countRows(databasePath, tableName)), before);
  } finally {
    cleanDirectory(directory);
  }
});

test("delete protects versions, previews, cancels, and replays receipts", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-delete-"));
  const databasePath = path.join(directory, "tasks.db");
  try {
    const created = task(executeCommand(request("task.create", { title: "Delete @work #tag" }, { idempotencyKey: "create" }), databasePath));
    const args = { id: created.id, expectedVersion: created.version };
    const before = executeCommand(request("workspace.export"), databasePath).snapshot as Record<string, unknown>;
    for (const options of [{ dryRun: true }, { readOnly: true }]) {
      assert.equal(executeCommand(request("task.delete", args, { ...options, idempotencyKey: `preview-${Object.keys(options)[0]}` }), databasePath).dryRun, true);
      const after = executeCommand(request("workspace.export"), databasePath).snapshot as Record<string, unknown>;
      assert.deepEqual({ ...after, exportedAt: null }, { ...before, exportedAt: null });
    }
    assert.throws(() => executeCommand(request("task.delete", args), databasePath), /IDEMPOTENCY_REQUIRED/);
    assert.throws(() => executeCommand(request("task.delete", { id: created.id }, { idempotencyKey: "missing-version" }), databasePath), /EXPECTED_VERSION_REQUIRED/);
    assert.throws(() => executeCommand(request("task.delete", { ...args, expectedVersion: 2 }, { idempotencyKey: "stale" }), databasePath), /STALE_TASK_VERSION/);

    // A receipt failure must roll back the status change.
    const database = openDatabase(databasePath);
    database.exec("CREATE TRIGGER reject_delete_receipt BEFORE INSERT ON command_receipts WHEN NEW.command = 'task.delete' BEGIN SELECT RAISE(ABORT, 'receipt failed'); END;");
    database.close();
    const deletion = request("task.delete", args, { idempotencyKey: "delete" });
    assert.throws(() => executeCommand(deletion, databasePath), /receipt failed/);
    assert.deepEqual(task(executeCommand(request("task.get", { id: created.id }), databasePath)), created);
    assert.equal(countRows(databasePath, "activity"), 1);
    assert.equal(countRows(databasePath, "task_tags"), 1);
    const unlocked = openDatabase(databasePath);
    unlocked.exec("DROP TRIGGER reject_delete_receipt");
    unlocked.close();

    const result = executeCommand(deletion, databasePath);
    assert.equal(task(result).status, "canceled");
    assert.equal(result.changed, true);
    assert.deepEqual(executeCommand(deletion, databasePath), result);
    assert.equal(executeCommand(request("task.list"), databasePath).total, 1);
    assert.equal(countRows(databasePath, "task_tags"), 1);
    assert.equal(countRows(databasePath, "activity"), 2);
    assert.equal(task(executeCommand(request("task.get", { id: created.id }), databasePath)).status, "canceled");
    const repeatedDelete = executeCommand(
      request("task.delete", { id: created.id, expectedVersion: 2 }, { idempotencyKey: "another-delete" }),
      databasePath,
    );
    assert.equal(repeatedDelete.changed, false);
    assert.equal(countRows(databasePath, "command_receipts"), 3);
    assert.throws(() => executeCommand(request("task.delete", { ...args, expectedVersion: 2 }, { idempotencyKey: "delete" }), databasePath), /IDEMPOTENCY_KEY_REUSED/);
  } finally {
    cleanDirectory(directory);
  }
});

test("backup, JSON export, and restore preserve canonical records", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-m1-portability-"));
  const databasePath = path.join(directory, "tasks.db");
  const backupPath = path.join(directory, "backups", "tasks.sqlite");
  const exportPath = path.join(directory, "exports", "tasks.json");
  const restoredPath = path.join(directory, "restored", "tasks.db");

  try {
    const created = executeCommand(
      request("task.create", { title: "Restore @home #backup" }, { idempotencyKey: "portable-create" }),
      databasePath,
    );
    const createdTask = task(created);
    executeCommand(request("workspace.backup", { destinationPath: backupPath }), databasePath);
    assert.equal(existsSync(backupPath), true);
    assert.equal(countRows(backupPath, "tasks"), 1);

    executeCommand(request("workspace.export", { destinationPath: exportPath }), databasePath);
    const snapshot = JSON.parse(readFileSync(exportPath, "utf8")) as { formatVersion: number; tasks: unknown[] };
    assert.equal(snapshot.formatVersion, 1);
    assert.equal(snapshot.tasks.length, 1);

    const restored = executeCommand(
      request(
        "workspace.restore",
        { sourcePath: exportPath, destinationPath: restoredPath },
        { idempotencyKey: "restore-1" },
      ),
      databasePath,
    );
    assert.equal(restored.taskCount, 1);
    const restoredTask = executeCommand(request("task.get", { id: createdTask.id }), restoredPath);
    assert.deepEqual(task(restoredTask), createdTask);
    assert.equal(countRows(restoredPath, "activity"), 1);
  } finally {
    cleanDirectory(directory);
  }
});

test("schema migration adds the paused task status to existing workspaces", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-schema-migration-"));
  const databasePath = path.join(directory, "tasks.db");
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO schema_meta (key, value) VALUES ('schema_version', '1');
    CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      description_markdown TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'done', 'canceled')),
      category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      version INTEGER NOT NULL CHECK (version > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      canceled_at TEXT
    );
    INSERT INTO tasks (id, title, description_markdown, status, category_id, version, created_at, updated_at, completed_at, canceled_at)
      VALUES ('legacy', 'Legacy task', '', 'open', NULL, 1, 'now', 'now', NULL, NULL);
  `);
  legacy.close();

  try {
    const migrated = openDatabase(databasePath);
    const schema = migrated.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get() as { value: string };
    const table = migrated.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get() as { sql: string };
    const foreignKeys = migrated.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    assert.equal(schema.value, "2");
    assert.match(table.sql, /paused/);
    assert.equal(foreignKeys.foreign_keys, 1);
    migrated.close();

    const paused = executeCommand(
      request("task.pause", { id: "legacy", expectedVersion: 1 }, { idempotencyKey: "migrate-pause" }),
      databasePath,
    );
    assert.equal(task(paused).status, "paused");
  } finally {
    cleanDirectory(directory);
  }
});

test("newer schemas are rejected before writes", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-m1-schema-"));
  const databasePath = path.join(directory, "tasks.db");
  const database = new DatabaseSync(databasePath);
  database.exec("CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO schema_meta VALUES ('schema_version', '99');");
  database.close();

  try {
    assert.throws(() => executeCommand(request("task.list"), databasePath), /UNSUPPORTED_SCHEMA/);
  } finally {
    cleanDirectory(directory);
  }
});

test("restore failure leaves the destination without imported task rows", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-m1-restore-failure-"));
  const databasePath = path.join(directory, "tasks.db");
  const snapshotPath = path.join(directory, "bad.json");
  const destinationPath = path.join(directory, "restored", "tasks.db");
  writeFileSync(
    snapshotPath,
    JSON.stringify({
      formatVersion: 1,
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      categories: [],
      tags: [],
      tasks: [{ id: "broken", title: "broken", description_markdown: "", status: "open", category_id: "missing", version: 1, created_at: "now", updated_at: "now", completed_at: null, canceled_at: null }],
      taskTags: [],
      activity: [],
      commandReceipts: [],
    }),
  );

  try {
    assert.throws(
      () => executeCommand(request("workspace.restore", { sourcePath: snapshotPath, destinationPath }, { idempotencyKey: "bad-restore" }), databasePath),
    );
    const restored = openDatabase(destinationPath);
    try {
      const row = restored.prepare("SELECT COUNT(*) AS count FROM tasks").get() as { count: number };
      assert.equal(row.count, 0);
    } finally {
      restored.close();
    }
  } finally {
    cleanDirectory(directory);
  }
});
