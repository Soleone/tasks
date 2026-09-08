import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { executeCommand } from "./commands.js";
import { openDatabase } from "./database.js";
import { type ProtocolRequest, type TaskRecord } from "./protocol.js";
import { classifyTaskText, TaskTextError } from "./taskText.js";

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

    const completed = executeCommand(
      request("task.complete", { id: createdTask.id, expectedVersion: 2 }, { idempotencyKey: "complete-1" }),
      databasePath,
    );
    assert.equal(task(completed).status, "done");
    const reopened = executeCommand(
      request("task.reopen", { id: createdTask.id, expectedVersion: 3 }, { idempotencyKey: "reopen-1" }),
      databasePath,
    );
    assert.equal(task(reopened).status, "open");
    const canceled = executeCommand(
      request("task.cancel", { id: createdTask.id, expectedVersion: 4 }, { idempotencyKey: "cancel-1" }),
      databasePath,
    );
    assert.equal(task(canceled).status, "canceled");

    const repeatedCancel = executeCommand(
      request("task.cancel", { id: createdTask.id, expectedVersion: 5 }, { idempotencyKey: "cancel-noop" }),
      databasePath,
    );
    assert.equal(repeatedCancel.changed, false);
    const activities = executeCommand(request("activity.list", { taskId: createdTask.id }), databasePath);
    assert.equal((activities.activity as unknown[]).length, 5);
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
