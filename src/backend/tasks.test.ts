import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

test("task.list filters by status", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-list-filter-"));
  const databasePath = path.join(directory, "tasks.db");

  try {
    const open = task(executeCommand(request("task.create", { title: "Open task" }, { idempotencyKey: "create-open" }), databasePath));
    const inProgress = task(executeCommand(request("task.create", { title: "In progress task" }, { idempotencyKey: "create-in-progress" }), databasePath));
    const paused = task(executeCommand(request("task.create", { title: "Paused task" }, { idempotencyKey: "create-paused" }), databasePath));
    const canceled = task(executeCommand(request("task.create", { title: "Cancelled task" }, { idempotencyKey: "create-canceled" }), databasePath));
    executeCommand(request("task.start", { id: inProgress.id, expectedVersion: inProgress.version }, { idempotencyKey: "start-in-progress" }), databasePath);
    executeCommand(request("task.pause", { id: paused.id, expectedVersion: paused.version }, { idempotencyKey: "pause-task" }), databasePath);
    executeCommand(request("task.delete", { id: canceled.id, expectedVersion: canceled.version }, { idempotencyKey: "cancel-task" }), databasePath);

    const active = executeCommand(request("task.list", { status: ["open", "in_progress", "done"] }), databasePath);
    assert.equal(active.total, 2);
    assert.deepEqual((active.tasks as TaskRecord[]).map((item) => item.id).sort(), [open.id, inProgress.id].sort());

    const nonActive = executeCommand(request("task.list", { status: ["paused", "canceled"] }), databasePath);
    assert.equal(nonActive.total, 2);
    assert.deepEqual((nonActive.tasks as TaskRecord[]).map((item) => item.id).sort(), [paused.id, canceled.id].sort());
  } finally {
    cleanDirectory(directory);
  }
});

test("task.list filters to unblocked tasks", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-list-unblocked-"));
  const databasePath = path.join(directory, "tasks.db");

  try {
    const free = task(executeCommand(request("task.create", { title: "Free task" }, { idempotencyKey: "create-free" }), databasePath));
    const blocker = task(executeCommand(request("task.create", { title: "Blocker task" }, { idempotencyKey: "create-blocker" }), databasePath));
    const blocked = task(executeCommand(request("task.create", { title: "Blocked task" }, { idempotencyKey: "create-blocked" }), databasePath));
    executeCommand(
      request("task.dependency.add", { id: blocked.id, dependsOnId: blocker.id, expectedVersion: blocked.version }, { idempotencyKey: "add-blocker" }),
      databasePath,
    );

    const unblocked = executeCommand(request("task.list", { unblocked: true }), databasePath);
    assert.equal(unblocked.total, 2);
    assert.deepEqual((unblocked.tasks as TaskRecord[]).map((item) => item.id).sort(), [free.id, blocker.id].sort());

    const activeUnblocked = executeCommand(
      request("task.list", { status: ["open"], unblocked: true }),
      databasePath,
    );
    assert.equal(activeUnblocked.total, 2);
    assert.ok(!(activeUnblocked.tasks as TaskRecord[]).some((item) => item.id === blocked.id));
    assert.throws(
      () => executeCommand(request("task.list", { unblocked: "yes" }), databasePath),
      /unblocked must be a boolean/,
    );
  } finally {
    cleanDirectory(directory);
  }
});

test("task.list filters by project and project.list returns project entries", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-project-filter-"));
  const databasePath = path.join(directory, "tasks.db");

  try {
    const alpha = task(executeCommand(request("task.create", { title: "Alpha task @Alpha" }, { idempotencyKey: "project-alpha" }), databasePath));
    const beta = task(executeCommand(request("task.create", { title: "Beta task @Beta" }, { idempotencyKey: "project-beta" }), databasePath));
    task(executeCommand(request("task.create", { title: "Unassigned task" }, { idempotencyKey: "project-none" }), databasePath));

    const projects = executeCommand(request("project.list"), databasePath) as {
      projects: Array<{ slug: string; label: string; taskCount: number }>;
    };
    assert.deepEqual(projects.projects, [
      { slug: "alpha", label: "Alpha", taskCount: 1 },
      { slug: "beta", label: "Beta", taskCount: 1 },
    ]);

    const filtered = executeCommand(request("task.list", { project: " ALPHA " }), databasePath);
    assert.equal(filtered.total, 1);
    assert.deepEqual((filtered.tasks as TaskRecord[]).map((item) => item.id), [alpha.id]);
    assert.throws(
      () => executeCommand(request("task.list", { project: "" }), databasePath),
      /project must be a non-empty string/,
    );
    assert.equal(beta.category?.slug, "beta");
  } finally {
    cleanDirectory(directory);
  }
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
    const tables = ["tasks", "categories", "tags", "task_tags", "task_dependencies", "activity", "command_receipts"];
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
    const dependencyTable = migrated.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'task_dependencies'").get() as { sql: string };
    const foreignKeys = migrated.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    assert.equal(schema.value, "4");
    assert.match(table.sql, /paused/);
    assert.match(table.sql, /parent_id/);
    assert.match(table.sql, /priority/);
    assert.match(dependencyTable.sql, /depends_on_id/);
    assert.equal(foreignKeys.foreign_keys, 1);
    migrated.close();

    const legacyTask = task(executeCommand(request("task.get", { id: "legacy" }), databasePath));
    assert.equal(legacyTask.priority, 2);

    const paused = executeCommand(
      request("task.pause", { id: "legacy", expectedVersion: 1 }, { idempotencyKey: "migrate-pause" }),
      databasePath,
    );
    assert.equal(task(paused).status, "paused");
  } finally {
    cleanDirectory(directory);
  }
});

test("portable JSON export writes a readable file beside the database", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-m1-portable-export-"));
  const databasePath = path.join(directory, "tasks.db");

  try {
    const venue = task(
      executeCommand(
        request("task.create", { title: "Book venue @launch #planning", descriptionMarkdown: "- ask about capacity" }, { idempotencyKey: "portable-1" }),
        databasePath,
      ),
    );
    const invoicing = task(executeCommand(request("task.create", { title: "Send invoices" }, { idempotencyKey: "portable-2" }), databasePath));
    executeCommand(
      request("task.complete", { id: invoicing.id, expectedVersion: invoicing.version }, { idempotencyKey: "portable-3" }),
      databasePath,
    );

    const info = executeCommand(request("workspace.info"), databasePath);
    assert.equal(info.databasePath, databasePath);
    assert.equal(info.taskCount, 2);

    // A preview reports the payload without creating the export folder.
    const preview = executeCommand(request("workspace.exportTasks", {}, { dryRun: true }), databasePath);
    assert.equal(preview.destinationPath, null);
    assert.equal(preview.taskCount, 2);
    assert.equal(existsSync(path.join(directory, "exports")), false);

    const exported = executeCommand(request("workspace.exportTasks"), databasePath);
    const destinationPath = String(exported.destinationPath);
    assert.equal(path.dirname(destinationPath), path.join(directory, "exports"));

    const file = JSON.parse(readFileSync(destinationPath, "utf8")) as {
      format: string;
      formatVersion: number;
      exportedAt: string;
      taskCount: number;
      tasks: Result[];
    };
    assert.equal(file.format, "tasks.tasks-export");
    assert.equal(file.formatVersion, 1);
    assert.equal(file.exportedAt, exported.exportedAt);
    assert.equal(file.taskCount, 2);
    assert.deepEqual(file.tasks.find((row) => row.id === venue.id), {
      id: venue.id,
      title: venue.title,
      status: "open",
      priority: 2,
      category: "launch",
      tags: ["planning"],
      parentId: null,
      blockedByIds: [],
      notesMarkdown: "- ask about capacity",
      createdAt: venue.createdAt,
      updatedAt: venue.updatedAt,
      completedAt: null,
      canceledAt: null,
    });
    const completed = file.tasks.find((row) => row.id === invoicing.id);
    assert.equal(completed?.status, "done");
    assert.equal(completed?.category, null);
    assert.deepEqual(completed?.tags, []);
    assert.equal(typeof completed?.completedAt, "string");

    // Repeating the export adds a file instead of overwriting the first one.
    executeCommand(request("workspace.exportTasks"), databasePath);
    assert.equal(readdirSync(path.join(directory, "exports")).length, 2);
    assert.equal(existsSync(destinationPath), true);
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
      schemaVersion: 3,
      exportedAt: new Date().toISOString(),
      categories: [],
      tags: [],
      tasks: [{ id: "broken", title: "broken", description_markdown: "", status: "open", category_id: "missing", parent_id: null, version: 1, created_at: "now", updated_at: "now", completed_at: null, canceled_at: null }],
      taskTags: [],
      taskDependencies: [],
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

test("parent moves validate versions, parents, and cycles without cascading status", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-relationships-parent-"));
  const databasePath = path.join(directory, "tasks.db");
  try {
    const parent = task(executeCommand(request("task.create", { title: "Parent" }, { idempotencyKey: "parent" }), databasePath));
    const child = task(executeCommand(request("task.create", { title: "Child" }, { idempotencyKey: "child" }), databasePath));
    assert.equal(child.parentId, null);

    const moved = task(
      executeCommand(request("task.move", { id: child.id, parentId: parent.id, expectedVersion: child.version }, { idempotencyKey: "move-1" }), databasePath),
    );
    assert.equal(moved.parentId, parent.id);
    assert.equal(moved.version, child.version + 1);
    assert.equal(moved.status, child.status);

    const noop = executeCommand(request("task.move", { id: child.id, parentId: parent.id, expectedVersion: moved.version }, { idempotencyKey: "move-noop" }), databasePath);
    assert.equal(noop.changed, false);

    assert.throws(
      () => executeCommand(request("task.move", { id: child.id, parentId: parent.id, expectedVersion: child.version }, { idempotencyKey: "move-stale" }), databasePath),
      /STALE_TASK_VERSION/,
    );
    assert.throws(
      () => executeCommand(request("task.move", { id: child.id, parentId: child.id, expectedVersion: moved.version }, { idempotencyKey: "move-self" }), databasePath),
      /INVALID_PARENT/,
    );
    assert.throws(
      () => executeCommand(request("task.move", { id: parent.id, parentId: child.id, expectedVersion: parent.version }, { idempotencyKey: "move-cycle" }), databasePath),
      /PARENT_CYCLE/,
    );
    assert.throws(
      () => executeCommand(request("task.move", { id: child.id, parentId: "missing", expectedVersion: moved.version }, { idempotencyKey: "move-missing" }), databasePath),
      /PARENT_NOT_FOUND/,
    );
    assert.throws(
      () => executeCommand(request("task.move", { id: child.id, expectedVersion: moved.version }, { idempotencyKey: "move-no-parent" }), databasePath),
      /INVALID_ARGUMENT/,
    );

    const preview = executeCommand(request("task.move", { id: child.id, parentId: parent.id, expectedVersion: moved.version }, { idempotencyKey: "move-preview", dryRun: true }), databasePath);
    assert.equal(preview.dryRun, true);

    const completedParent = task(
      executeCommand(request("task.complete", { id: parent.id, expectedVersion: parent.version }, { idempotencyKey: "complete-parent" }), databasePath),
    );
    assert.equal(completedParent.status, "done");
    assert.equal(task(executeCommand(request("task.get", { id: child.id }), databasePath)).status, "open");
  } finally {
    cleanDirectory(directory);
  }
});

test("dependency links validate versions, duplicates, and cycles without cascading status", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-relationships-dependency-"));
  const databasePath = path.join(directory, "tasks.db");
  try {
    const first = task(executeCommand(request("task.create", { title: "First" }, { idempotencyKey: "first" }), databasePath));
    const second = task(executeCommand(request("task.create", { title: "Second" }, { idempotencyKey: "second" }), databasePath));
    const third = task(executeCommand(request("task.create", { title: "Third" }, { idempotencyKey: "third" }), databasePath));
    assert.deepEqual(second.blockedByIds, []);

    const blocked = task(
      executeCommand(request("task.dependency.add", { id: second.id, dependsOnId: first.id, expectedVersion: second.version }, { idempotencyKey: "block-1" }), databasePath),
    );
    assert.deepEqual(blocked.blockedByIds, [first.id]);

    const duplicate = executeCommand(request("task.dependency.add", { id: second.id, dependsOnId: first.id, expectedVersion: blocked.version }, { idempotencyKey: "block-dup" }), databasePath);
    assert.equal(duplicate.changed, false);

    assert.throws(
      () => executeCommand(request("task.dependency.add", { id: second.id, dependsOnId: second.id, expectedVersion: blocked.version }, { idempotencyKey: "block-self" }), databasePath),
      /INVALID_DEPENDENCY/,
    );
    const chain = task(
      executeCommand(request("task.dependency.add", { id: third.id, dependsOnId: second.id, expectedVersion: third.version }, { idempotencyKey: "block-2" }), databasePath),
    );
    assert.deepEqual(chain.blockedByIds, [second.id]);
    assert.throws(
      () => executeCommand(request("task.dependency.add", { id: first.id, dependsOnId: third.id, expectedVersion: first.version }, { idempotencyKey: "block-cycle" }), databasePath),
      /DEPENDENCY_CYCLE/,
    );
    assert.throws(
      () => executeCommand(request("task.dependency.add", { id: second.id, dependsOnId: first.id, expectedVersion: second.version }, { idempotencyKey: "block-stale" }), databasePath),
      /STALE_TASK_VERSION/,
    );

    const removed = task(
      executeCommand(request("task.dependency.remove", { id: second.id, dependsOnId: first.id, expectedVersion: blocked.version }, { idempotencyKey: "unblock-1" }), databasePath),
    );
    assert.deepEqual(removed.blockedByIds, []);
    const removeNoop = executeCommand(request("task.dependency.remove", { id: second.id, dependsOnId: first.id, expectedVersion: removed.version }, { idempotencyKey: "unblock-noop" }), databasePath);
    assert.equal(removeNoop.changed, false);

    const doneFirst = task(
      executeCommand(request("task.complete", { id: first.id, expectedVersion: first.version }, { idempotencyKey: "complete-first" }), databasePath),
    );
    assert.equal(doneFirst.status, "done");
    assert.equal(task(executeCommand(request("task.get", { id: second.id }), databasePath)).status, "open");

    const activities = executeCommand(request("activity.list", { taskId: second.id }), databasePath) as { activity: Array<{ action: string }> };
    assert.ok(activities.activity.some((entry) => entry.action === "dependency.added"));
    assert.ok(activities.activity.some((entry) => entry.action === "dependency.removed"));
  } finally {
    cleanDirectory(directory);
  }
});

test("relationship snapshots round-trip through export and restore", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-relationships-portability-"));
  const databasePath = path.join(directory, "tasks.db");
  const exportPath = path.join(directory, "exports", "tasks.json");
  const restoredPath = path.join(directory, "restored", "tasks.db");
  try {
    const parent = task(executeCommand(request("task.create", { title: "Parent" }, { idempotencyKey: "snap-parent" }), databasePath));
    const child = task(executeCommand(request("task.create", { title: "Child", parentId: parent.id }, { idempotencyKey: "snap-child" }), databasePath));
    const blocker = task(executeCommand(request("task.create", { title: "Blocker" }, { idempotencyKey: "snap-blocker" }), databasePath));
    const blocked = task(
      executeCommand(request("task.dependency.add", { id: child.id, dependsOnId: blocker.id, expectedVersion: child.version }, { idempotencyKey: "snap-block" }), databasePath),
    );
    assert.equal(child.parentId, parent.id);
    assert.deepEqual(blocked.blockedByIds, [blocker.id]);

    executeCommand(request("workspace.export", { destinationPath: exportPath }), databasePath);
    const restored = executeCommand(request("workspace.restore", { sourcePath: exportPath, destinationPath: restoredPath }, { idempotencyKey: "snap-restore" }), databasePath);
    assert.equal(restored.taskCount, 3);
    assert.deepEqual(task(executeCommand(request("task.get", { id: child.id }), restoredPath)), blocked);
  } finally {
    cleanDirectory(directory);
  }
});

test("priority defaults to P2, persists edits, and filters task.list", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-priority-"));
  const databasePath = path.join(directory, "tasks.db");
  try {
    const normal = task(executeCommand(request("task.create", { title: "Normal task" }, { idempotencyKey: "priority-default" }), databasePath));
    assert.equal(normal.priority, 2);
    const urgent = task(executeCommand(request("task.create", { title: "Urgent task", priority: 0 }, { idempotencyKey: "priority-p0" }), databasePath));
    assert.equal(urgent.priority, 0);
    assert.throws(() => executeCommand(request("task.create", { title: "Bad", priority: 5 }, { idempotencyKey: "priority-bad" }), databasePath), /priority must be an integer from 0 to 4/);
    assert.throws(() => executeCommand(request("task.create", { title: "Bad", priority: "P0" }, { idempotencyKey: "priority-bad-type" }), databasePath), /priority must be an integer from 0 to 4/);

    const edited = task(executeCommand(request("task.update", { id: normal.id, expectedVersion: normal.version, priority: 1 }, { idempotencyKey: "priority-edit" }), databasePath));
    assert.equal(edited.priority, 1);
    assert.equal(edited.version, normal.version + 1);
    const noop = executeCommand(request("task.update", { id: normal.id, expectedVersion: edited.version, priority: 1 }, { idempotencyKey: "priority-noop" }), databasePath);
    assert.equal(noop.changed, false);
    assert.throws(() => executeCommand(request("task.update", { id: normal.id, expectedVersion: edited.version, priority: 9 }, { idempotencyKey: "priority-bad-update" }), databasePath), /priority must be an integer from 0 to 4/);

    const preview = executeCommand(request("task.create", { title: "Preview", priority: 4 }, { idempotencyKey: "priority-preview", dryRun: true }), databasePath);
    assert.equal(task(preview).priority, 4);
    assert.equal(countRows(databasePath, "tasks"), 2);

    const p0 = executeCommand(request("task.list", { priority: 0 }), databasePath);
    assert.equal(p0.total, 1);
    assert.deepEqual((p0.tasks as TaskRecord[]).map((item) => item.id), [urgent.id]);
    const p1 = executeCommand(request("task.list", { priority: 1 }), databasePath);
    assert.equal(p1.total, 1);
    assert.throws(() => executeCommand(request("task.list", { priority: 5 }), databasePath), /priority must be an integer from 0 to 4/);
    assert.throws(() => executeCommand(request("task.list", { priority: "P0" }), databasePath), /priority must be an integer from 0 to 4/);
  } finally {
    cleanDirectory(directory);
  }
});

test("task.list filters by tags with AND semantics and tag.list reports counts", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-tag-filter-"));
  const databasePath = path.join(directory, "tasks.db");
  try {
    const both = task(executeCommand(request("task.create", { title: "Both #planning #product" }, { idempotencyKey: "tag-both" }), databasePath));
    const planning = task(executeCommand(request("task.create", { title: "Planning only #planning" }, { idempotencyKey: "tag-planning" }), databasePath));
    task(executeCommand(request("task.create", { title: "Untagged" }, { idempotencyKey: "tag-none" }), databasePath));

    const tags = executeCommand(request("tag.list"), databasePath) as { tags: Array<{ slug: string; label: string; taskCount: number }> };
    assert.deepEqual(tags.tags, [
      { slug: "planning", label: "planning", taskCount: 2 },
      { slug: "product", label: "product", taskCount: 1 },
    ]);

    const planningOnly = executeCommand(request("task.list", { tags: ["planning"] }), databasePath);
    assert.equal(planningOnly.total, 2);
    const andMatch = executeCommand(request("task.list", { tags: ["planning", "product"] }), databasePath);
    assert.equal(andMatch.total, 1);
    assert.deepEqual((andMatch.tasks as TaskRecord[]).map((item) => item.id), [both.id]);
    const singleString = executeCommand(request("task.list", { tags: " PLANNING " }), databasePath);
    assert.equal(singleString.total, 2);
    const missing = executeCommand(request("task.list", { tags: ["nope"] }), databasePath);
    assert.equal(missing.total, 0);
    assert.throws(() => executeCommand(request("task.list", { tags: [] }), databasePath), /tags must be a non-empty string/);
    assert.throws(() => executeCommand(request("task.list", { tags: [""] }), databasePath), /tags must be a non-empty string/);
    assert.throws(() => executeCommand(request("task.list", { tags: "two words" }), databasePath), /tags must start with a letter/);
    assert.throws(() => executeCommand(request("task.list", { tags: "not.valid" }), databasePath), /tags must start with a letter/);
    assert.equal(planning.tags[0]?.slug, "planning");
  } finally {
    cleanDirectory(directory);
  }
});

test("task.list searches title and description and accepts a category alias", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-search-"));
  const databasePath = path.join(directory, "tasks.db");
  try {
    const titled = task(executeCommand(request("task.create", { title: "Book venue @launch" }, { idempotencyKey: "search-title" }), databasePath));
    const noted = task(executeCommand(request("task.create", { title: "Plain task", descriptionMarkdown: "Ask about accessibility" }, { idempotencyKey: "search-notes" }), databasePath));
    task(executeCommand(request("task.create", { title: "Unrelated" }, { idempotencyKey: "search-other" }), databasePath));

    const byTitle = executeCommand(request("task.list", { search: "venue" }), databasePath);
    assert.equal(byTitle.total, 1);
    assert.deepEqual((byTitle.tasks as TaskRecord[]).map((item) => item.id), [titled.id]);
    const byNotes = executeCommand(request("task.list", { search: "accessibility" }), databasePath);
    assert.equal(byNotes.total, 1);
    assert.deepEqual((byNotes.tasks as TaskRecord[]).map((item) => item.id), [noted.id]);
    const caseInsensitive = executeCommand(request("task.list", { search: "VENUE" }), databasePath);
    assert.equal(caseInsensitive.total, 1);
    const combined = executeCommand(request("task.list", { search: "task", tags: ["nope"] }), databasePath);
    assert.equal(combined.total, 0);
    assert.throws(() => executeCommand(request("task.list", { search: "" }), databasePath), /search must be a non-empty string/);
    assert.throws(() => executeCommand(request("task.list", { search: 42 }), databasePath), /search must be a non-empty string/);

    const byCategory = executeCommand(request("task.list", { category: " LAUNCH " }), databasePath);
    assert.equal(byCategory.total, 1);
    assert.deepEqual((byCategory.tasks as TaskRecord[]).map((item) => item.id), [titled.id]);
    assert.throws(() => executeCommand(request("task.list", { project: "launch", category: "other" }), databasePath), /project and category must match/);
  } finally {
    cleanDirectory(directory);
  }
});

test("schema version 3 workspaces migrate tasks to priority P2", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-priority-migration-"));
  const databasePath = path.join(directory, "tasks.db");
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO schema_meta (key, value) VALUES ('schema_version', '3');
    CREATE TABLE categories (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, label TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE tags (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, label TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description_markdown TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL, category_id TEXT, parent_id TEXT, version INTEGER NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT, canceled_at TEXT
    );
    INSERT INTO tasks (id, title, description_markdown, status, category_id, parent_id, version, created_at, updated_at, completed_at, canceled_at)
      VALUES ('old', 'Old task', '', 'open', NULL, NULL, 1, 'now', 'now', NULL, NULL);
  `);
  legacy.close();
  try {
    const migrated = openDatabase(databasePath);
    const schema = migrated.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get() as { value: string };
    assert.equal(schema.value, "4");
    migrated.close();
    const migratedTask = task(executeCommand(request("task.get", { id: "old" }), databasePath));
    assert.equal(migratedTask.priority, 2);
  } finally {
    cleanDirectory(directory);
  }
});
