import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

function siblingPositions(databasePath: string, parentId: string | null = null): Array<{ id: string; position: number; version: number }> {
  const database = new DatabaseSync(databasePath);
  try {
    return (database
      .prepare("SELECT id, position, version FROM tasks WHERE parent_id IS ? ORDER BY position ASC, id ASC")
      .all(parentId) as Array<{ id: string; position: number; version: number }>).map((row) => ({
        id: row.id,
        position: row.position,
        version: row.version,
      }));
  } finally {
    database.close();
  }
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

test("task categories come from titles while tags include descriptions", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-title-category-"));
  const databasePath = path.join(directory, "tasks.db");

  try {
    const created = task(executeCommand(request("task.create", {
      title: "Ship it @release #title",
      descriptionMarkdown: "Notes mention @not-a-category and #description",
    }, { idempotencyKey: "title-category" }), databasePath));
    assert.deepEqual(created.category, { slug: "release", label: "release" });
    assert.deepEqual(created.tags, [
      { slug: "description", label: "description" },
      { slug: "title", label: "title" },
    ]);
  } finally {
    cleanDirectory(directory);
  }
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

test("task list exposes a revision that changes with workspace writes", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-workspace-revision-"));
  const databasePath = path.join(directory, "tasks.db");

  try {
    const empty = executeCommand(request("task.list"), databasePath) as { workspaceRevision: number };
    const created = task(executeCommand(
      request("task.create", { title: "Revision task" }, { idempotencyKey: "revision-create" }),
      databasePath,
    ));
    const afterCreate = executeCommand(request("workspace.info"), databasePath) as { workspaceRevision: number };
    const listedAfterCreate = executeCommand(request("task.list"), databasePath) as { workspaceRevision: number };
    assert.ok(afterCreate.workspaceRevision > empty.workspaceRevision);
    assert.equal(listedAfterCreate.workspaceRevision, afterCreate.workspaceRevision);

    executeCommand(
      request(
        "task.update",
        { id: created.id, title: created.title, descriptionMarkdown: created.descriptionMarkdown, expectedVersion: created.version },
        { idempotencyKey: "revision-no-op" },
      ),
      databasePath,
    );
    const afterNoOp = executeCommand(request("workspace.info"), databasePath) as { workspaceRevision: number };
    assert.equal(afterNoOp.workspaceRevision, afterCreate.workspaceRevision);

    executeCommand(
      request(
        "task.update",
        { id: created.id, title: "Revision task updated", expectedVersion: created.version },
        { idempotencyKey: "revision-update" },
      ),
      databasePath,
    );
    const afterUpdate = executeCommand(request("workspace.info"), databasePath) as { workspaceRevision: number };
    assert.ok(afterUpdate.workspaceRevision > afterNoOp.workspaceRevision);
  } finally {
    cleanDirectory(directory);
  }
});

test("task.list can include filtered-out parent context without changing matches", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-list-context-"));
  const databasePath = path.join(directory, "tasks.db");

  try {
    const parent = task(executeCommand(request("task.create", { title: "Completed parent" }, { idempotencyKey: "context-parent" }), databasePath));
    const child = task(executeCommand(request("task.create", { title: "Active child", parentId: parent.id }, { idempotencyKey: "context-child" }), databasePath));
    executeCommand(
      request("task.complete", { id: parent.id, expectedVersion: parent.version }, { idempotencyKey: "context-complete" }),
      databasePath,
    );
    const canceledParent = task(executeCommand(request("task.create", { title: "Canceled parent" }, { idempotencyKey: "canceled-context-parent" }), databasePath));
    const canceledChild = task(executeCommand(request("task.create", { title: "Active canceled child", parentId: canceledParent.id }, { idempotencyKey: "canceled-context-child" }), databasePath));
    executeCommand(
      request("task.delete", { id: canceledParent.id, expectedVersion: canceledParent.version }, { idempotencyKey: "canceled-context-delete" }),
      databasePath,
    );

    const active = executeCommand(
      request("task.list", { status: ["open"], includeAncestors: true }),
      databasePath,
    );
    assert.equal(active.total, 2);
    assert.deepEqual((active.tasks as TaskRecord[]).map((item) => item.id).sort(), [child.id, canceledChild.id].sort());
    assert.deepEqual((active.contextTasks as TaskRecord[]).map((item) => item.id).sort(), [parent.id, canceledParent.id].sort());

    const withoutContext = executeCommand(request("task.list", { status: ["open"] }), databasePath);
    assert.deepEqual(withoutContext.contextTasks, []);
    assert.throws(
      () => executeCommand(request("task.list", { includeAncestors: "yes" }), databasePath),
      /includeAncestors must be a boolean/,
    );
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

test("canceled dependencies no longer block readiness", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-canceled-dependency-"));
  const databasePath = path.join(directory, "tasks.db");

  try {
    const blocker = task(executeCommand(request("task.create", { title: "Canceled blocker" }, { idempotencyKey: "canceled-blocker" }), databasePath));
    const blocked = task(executeCommand(request("task.create", { title: "Dependent task" }, { idempotencyKey: "canceled-dependent" }), databasePath));
    const linked = task(
      executeCommand(
        request("task.dependency.add", { id: blocked.id, dependsOnId: blocker.id, expectedVersion: blocked.version }, { idempotencyKey: "canceled-link" }),
        databasePath,
      ),
    );
    assert.deepEqual(linked.dependencyIds, [blocker.id]);
    assert.deepEqual(linked.blockedByIds, [blocker.id]);

    const canceled = task(
      executeCommand(request("task.delete", { id: blocker.id, expectedVersion: blocker.version }, { idempotencyKey: "canceled-blocker-delete" }), databasePath),
    );
    assert.equal(canceled.status, "canceled");

    const afterCancel = task(executeCommand(request("task.get", { id: blocked.id }), databasePath));
    assert.deepEqual(afterCancel.dependencyIds, [blocker.id]);
    assert.deepEqual(afterCancel.blockedByIds, []);
    const unblocked = executeCommand(request("task.list", { status: ["open"], unblocked: true }), databasePath);
    assert.ok((unblocked.tasks as TaskRecord[]).some((item) => item.id === blocked.id));

    const another = task(executeCommand(request("task.create", { title: "Another task" }, { idempotencyKey: "canceled-another" }), databasePath));
    assert.throws(
      () => executeCommand(
        request("task.dependency.add", { id: another.id, dependsOnId: blocker.id, expectedVersion: another.version }, { idempotencyKey: "canceled-link-rejected" }),
        databasePath,
      ),
      /a canceled task cannot be used as a blocker/,
    );

    const reopened = task(
      executeCommand(request("task.reopen", { id: blocker.id, expectedVersion: canceled.version }, { idempotencyKey: "canceled-blocker-reopen" }), databasePath),
    );
    assert.equal(reopened.status, "open");
    const afterReopen = task(executeCommand(request("task.get", { id: blocked.id }), databasePath));
    assert.deepEqual(afterReopen.blockedByIds, [blocker.id]);
    const blockedAgain = executeCommand(request("task.list", { status: ["open"], unblocked: true }), databasePath);
    assert.ok(!(blockedAgain.tasks as TaskRecord[]).some((item) => item.id === blocked.id));
  } finally {
    cleanDirectory(directory);
  }
});

test("task.list filters by category and category.list returns category entries", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-category-filter-"));
  const databasePath = path.join(directory, "tasks.db");

  try {
    const alpha = task(executeCommand(request("task.create", { title: "Alpha task @Alpha" }, { idempotencyKey: "category-alpha" }), databasePath));
    const beta = task(executeCommand(request("task.create", { title: "Beta task @Beta" }, { idempotencyKey: "category-beta" }), databasePath));
    task(executeCommand(request("task.create", { title: "Unassigned task" }, { idempotencyKey: "category-none" }), databasePath));

    const categories = executeCommand(request("category.list"), databasePath) as {
      categories: Array<{ slug: string; label: string; taskCount: number }>;
    };
    assert.deepEqual(categories.categories, [
      { slug: "alpha", label: "Alpha", taskCount: 1 },
      { slug: "beta", label: "Beta", taskCount: 1 },
    ]);

    const filtered = executeCommand(request("task.list", { category: " ALPHA " }), databasePath);
    assert.equal(filtered.total, 1);
    assert.deepEqual((filtered.tasks as TaskRecord[]).map((item) => item.id), [alpha.id]);
    assert.throws(
      () => executeCommand(request("task.list", { category: "" }), databasePath),
      /category must be a non-empty string/,
    );
    assert.equal(beta.category?.slug, "beta");
  } finally {
    cleanDirectory(directory);
  }
});

test("category and tag lists omit labels used only by canceled tasks", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-classification-status-filter-"));
  const databasePath = path.join(directory, "tasks.db");

  try {
    const live = task(executeCommand(request("task.create", { title: "Live @Keep #keep" }, { idempotencyKey: "classification-live" }), databasePath));
    const canceledOnly = task(executeCommand(request("task.create", { title: "Canceled @Gone #gone" }, { idempotencyKey: "classification-canceled" }), databasePath));
    executeCommand(request("task.delete", { id: canceledOnly.id, expectedVersion: canceledOnly.version }, { idempotencyKey: "classification-delete" }), databasePath);

    const categories = executeCommand(request("category.list"), databasePath) as {
      categories: Array<{ slug: string; label: string; taskCount: number }>;
    };
    assert.deepEqual(categories.categories, [{ slug: "keep", label: "Keep", taskCount: 1 }]);

    const tags = executeCommand(request("tag.list"), databasePath) as {
      tags: Array<{ slug: string; label: string; taskCount: number }>;
    };
    assert.deepEqual(tags.tags, [{ slug: "keep", label: "keep", taskCount: 1 }]);
    assert.equal(live.category?.slug, "keep");
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
    const restarted = executeCommand(
      request("task.start", { id: createdTask.id, expectedVersion: 5 }, { idempotencyKey: "restart-1" }),
      databasePath,
    );
    assert.equal(task(restarted).status, "in_progress");
    const reopened = executeCommand(
      request("task.reopen", { id: createdTask.id, expectedVersion: 6 }, { idempotencyKey: "reopen-1" }),
      databasePath,
    );
    assert.equal(task(reopened).status, "open");
    const canceled = executeCommand(
      request("task.cancel", { id: createdTask.id, expectedVersion: 7 }, { idempotencyKey: "cancel-1" }),
      databasePath,
    );
    assert.equal(task(canceled).status, "canceled");

    const repeatedCancel = executeCommand(
      request("task.cancel", { id: createdTask.id, expectedVersion: 8 }, { idempotencyKey: "cancel-noop" }),
      databasePath,
    );
    assert.equal(repeatedCancel.changed, false);
    const activities = executeCommand(request("activity.list", { taskId: createdTask.id }), databasePath);
    assert.equal((activities.activity as unknown[]).length, 8);
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

test("purging canceled tasks removes rows, relationships, classifications, and canonical files", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-purge-canceled-"));
  const databasePath = path.join(directory, "tasks.db");
  try {
    const canceledParent = task(
      executeCommand(request("task.create", { title: "Gone @gone #gone" }, { idempotencyKey: "purge-parent" }), databasePath),
    );
    const child = task(
      executeCommand(
        request("task.create", { title: "Keep child", parentId: canceledParent.id }, { idempotencyKey: "purge-child" }),
        databasePath,
      ),
    );
    const dependent = task(
      executeCommand(request("task.create", { title: "Keep dependent" }, { idempotencyKey: "purge-dependent" }), databasePath),
    );
    executeCommand(
      request(
        "task.dependency.add",
        { id: dependent.id, dependsOnId: canceledParent.id, expectedVersion: dependent.version },
        { idempotencyKey: "purge-link" },
      ),
      databasePath,
    );
    const canceledOnly = task(
      executeCommand(request("task.create", { title: "Also gone @other #other" }, { idempotencyKey: "purge-other" }), databasePath),
    );
    executeCommand(
      request("task.delete", { id: canceledParent.id, expectedVersion: canceledParent.version }, { idempotencyKey: "purge-cancel-parent" }),
      databasePath,
    );
    executeCommand(
      request("task.delete", { id: canceledOnly.id, expectedVersion: canceledOnly.version }, { idempotencyKey: "purge-cancel-other" }),
      databasePath,
    );

    const root = path.join(directory, "sync");
    assert.equal(existsSync(path.join(root, "tasks", `${canceledParent.id}.json`)), true);
    assert.equal(existsSync(path.join(root, "tasks", `${canceledOnly.id}.json`)), true);
    assert.equal(existsSync(path.join(root, "order", `${canceledParent.id}.json`)), true);
    const infoBefore = executeCommand(request("workspace.info"), databasePath);
    assert.equal(infoBefore.canceledTaskCount, 2);

    const purged = executeCommand(request("task.purgeCanceled", {}, { idempotencyKey: "purge-canceled" }), databasePath);
    assert.deepEqual(purged, { deletedCount: 2 });
    assert.deepEqual(executeCommand(request("task.purgeCanceled", {}, { idempotencyKey: "purge-canceled" }), databasePath), purged);
    assert.equal(countRows(databasePath, "tasks"), 2);
    assert.equal(countRows(databasePath, "task_dependencies"), 0);
    assert.equal(countRows(databasePath, "categories"), 0);
    assert.equal(countRows(databasePath, "tags"), 0);
    assert.equal(existsSync(path.join(root, "tasks", `${canceledParent.id}.json`)), false);
    assert.equal(existsSync(path.join(root, "tasks", `${canceledOnly.id}.json`)), false);
    assert.equal(existsSync(path.join(root, "order", `${canceledParent.id}.json`)), false);
    assert.equal(existsSync(path.join(root, "tasks", `${child.id}.json`)), true);
    assert.equal(task(executeCommand(request("task.get", { id: child.id }), databasePath)).parentId, null);
    assert.deepEqual(task(executeCommand(request("task.get", { id: dependent.id }), databasePath)).dependencyIds, []);
    assert.equal(executeCommand(request("workspace.info"), databasePath).canceledTaskCount, 0);
    assert.throws(() => executeCommand(request("task.get", { id: canceledParent.id }), databasePath), /TASK_NOT_FOUND/);
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
    const restoredTask = task(executeCommand(request("task.get", { id: createdTask.id }), restoredPath));
    assert.deepEqual({ ...restoredTask, version: createdTask.version }, createdTask);
    assert.ok(restoredTask.version > 1_000_000);
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
    INSERT INTO tasks (id, title, description_markdown, status, category_id, version, created_at, updated_at, completed_at, canceled_at) VALUES
      ('legacy', 'Legacy task', '', 'open', NULL, 1, '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', NULL, NULL),
      ('legacy-old', 'Older legacy task', '', 'open', NULL, 1, '2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, NULL);
  `);
  legacy.close();

  try {
    const migrated = openDatabase(databasePath);
    const schema = migrated.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get() as { value: string };
    const table = migrated.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get() as { sql: string };
    const dependencyTable = migrated.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'task_dependencies'").get() as { sql: string };
    const foreignKeys = migrated.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    assert.equal(schema.value, "6");
    assert.match(table.sql, /paused/);
    assert.match(table.sql, /parent_id/);
    assert.match(table.sql, /priority/);
    assert.match(dependencyTable.sql, /depends_on_id/);
    assert.equal(foreignKeys.foreign_keys, 1);
    migrated.close();

    assert.deepEqual(siblingPositions(databasePath), [
      { id: "legacy", position: 0, version: 1 },
      { id: "legacy-old", position: 1, version: 1 },
    ]);
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
    assert.equal(file.formatVersion, 2);
    assert.equal(file.exportedAt, exported.exportedAt);
    assert.equal(file.taskCount, 2);
    assert.deepEqual(file.tasks.find((row) => row.id === venue.id), {
      id: venue.id,
      siblingOrder: 1,
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

    const canceledParent = task(executeCommand(request("task.create", { title: "Canceled parent" }, { idempotencyKey: "canceled-parent" }), databasePath));
    const canceledParentResult = task(
      executeCommand(request("task.delete", { id: canceledParent.id, expectedVersion: canceledParent.version }, { idempotencyKey: "cancel-parent" }), databasePath),
    );
    assert.equal(canceledParentResult.status, "canceled");
    assert.throws(
      () => executeCommand(request("task.create", { title: "Child of canceled", parentId: canceledParent.id }, { idempotencyKey: "canceled-child" }), databasePath),
      /a canceled task cannot be used as a parent/,
    );
    assert.throws(
      () => executeCommand(request("task.move", { id: child.id, parentId: canceledParent.id, expectedVersion: child.version }, { idempotencyKey: "move-under-canceled" }), databasePath),
      /a canceled task cannot be used as a parent/,
    );

    const retainedParent = task(executeCommand(request("task.create", { title: "Retained parent" }, { idempotencyKey: "retained-parent" }), databasePath));
    const retainedChild = task(executeCommand(request("task.create", { title: "Retained child", parentId: retainedParent.id }, { idempotencyKey: "retained-child" }), databasePath));
    executeCommand(request("task.delete", { id: retainedParent.id, expectedVersion: retainedParent.version }, { idempotencyKey: "cancel-retained-parent" }), databasePath);
    assert.equal(task(executeCommand(request("task.get", { id: retainedChild.id }), databasePath)).parentId, retainedParent.id);

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

    const detached = task(
      executeCommand(request("task.move", { id: child.id, parentId: null, expectedVersion: moved.version }, { idempotencyKey: "move-remove-parent" }), databasePath),
    );
    assert.equal(detached.parentId, null);
    assert.equal(detached.version, moved.version + 1);
    assert.equal(detached.status, child.status);
    assert.throws(
      () => executeCommand(request("task.move", { id: child.id, parentId: "missing", expectedVersion: detached.version }, { idempotencyKey: "move-missing" }), databasePath),
      /PARENT_NOT_FOUND/,
    );
    assert.throws(
      () => executeCommand(request("task.move", { id: child.id, expectedVersion: detached.version }, { idempotencyKey: "move-no-parent" }), databasePath),
      /INVALID_ARGUMENT/,
    );

    const preview = executeCommand(request("task.move", { id: child.id, parentId: parent.id, expectedVersion: detached.version }, { idempotencyKey: "move-preview", dryRun: true }), databasePath);
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
    const positioned = openDatabase(databasePath);
    try {
      positioned.prepare("UPDATE tasks SET position = ? WHERE id = ?").run(0, blocker.id);
      positioned.prepare("UPDATE tasks SET position = ? WHERE id = ?").run(1, parent.id);
      positioned.prepare("UPDATE tasks SET position = ? WHERE id = ?").run(0, child.id);
    } finally {
      positioned.close();
    }
    assert.equal(child.parentId, parent.id);
    assert.deepEqual(blocked.blockedByIds, [blocker.id]);

    executeCommand(request("workspace.export", { destinationPath: exportPath }), databasePath);
    const restored = executeCommand(request("workspace.restore", { sourcePath: exportPath, destinationPath: restoredPath }, { idempotencyKey: "snap-restore" }), databasePath);
    assert.equal(restored.taskCount, 3);
    const restoredChild = task(executeCommand(request("task.get", { id: child.id }), restoredPath));
    assert.deepEqual({ ...restoredChild, version: blocked.version }, blocked);
    assert.ok(restoredChild.version > 1_000_000);
    const restoredSiblingPositions = siblingPositions(restoredPath);
    assert.deepEqual(restoredSiblingPositions.map(({ id, position }) => ({ id, position })), siblingPositions(databasePath).map(({ id, position }) => ({ id, position })));
    assert.ok(restoredSiblingPositions.every(({ version }) => version > 1_000_000));
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

test("task.list searches title, description, and category", () => {
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
  } finally {
    cleanDirectory(directory);
  }
});

test("task.list sorts by created and updated with direction", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-sort-"));
  const databasePath = path.join(directory, "tasks.db");
  try {
    const oldest = task(executeCommand(request("task.create", { title: "Oldest" }, { idempotencyKey: "sort-oldest" }), databasePath));
    const middle = task(executeCommand(request("task.create", { title: "Middle" }, { idempotencyKey: "sort-middle" }), databasePath));
    const newest = task(executeCommand(request("task.create", { title: "Newest" }, { idempotencyKey: "sort-newest" }), databasePath));
    // Pin timestamps so the order is deterministic: created and updated run opposite ways.
    const database = new DatabaseSync(databasePath);
    try {
      const stamp = database.prepare("UPDATE tasks SET created_at = ?, updated_at = ? WHERE id = ?");
      stamp.run("2026-01-01T00:00:00.000Z", "2026-03-03T00:00:00.000Z", oldest.id);
      stamp.run("2026-01-02T00:00:00.000Z", "2026-03-02T00:00:00.000Z", middle.id);
      stamp.run("2026-01-03T00:00:00.000Z", "2026-03-01T00:00:00.000Z", newest.id);
      database.prepare("UPDATE tasks SET priority = ? WHERE id = ?").run(4, oldest.id);
      database.prepare("UPDATE tasks SET priority = ? WHERE id = ?").run(0, middle.id);
      database.prepare("UPDATE tasks SET priority = ? WHERE id = ?").run(2, newest.id);
    } finally {
      database.close();
    }
    const ids = (result: Result): string[] => (result.tasks as TaskRecord[]).map((item) => item.id);
    assert.deepEqual(ids(executeCommand(request("task.list"), databasePath)), [oldest.id, middle.id, newest.id]);
    assert.deepEqual(ids(executeCommand(request("task.list", { sort: "updated", direction: "asc" }), databasePath)), [newest.id, middle.id, oldest.id]);
    assert.deepEqual(ids(executeCommand(request("task.list", { sort: "created" }), databasePath)), [newest.id, middle.id, oldest.id]);
    assert.deepEqual(ids(executeCommand(request("task.list", { sort: "created", direction: "asc" }), databasePath)), [oldest.id, middle.id, newest.id]);
    assert.deepEqual(ids(executeCommand(request("task.list", { sort: "priority" }), databasePath)), [middle.id, newest.id, oldest.id]);
    assert.deepEqual(ids(executeCommand(request("task.list", { sort: "priority", direction: "asc" }), databasePath)), [oldest.id, newest.id, middle.id]);
    assert.throws(() => executeCommand(request("task.list", { direction: "sideways" }), databasePath), /direction must be asc or desc/);
  } finally {
    cleanDirectory(directory);
  }
});

test("manual ordering supports explicit placements, dense positions, and task versions", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-manual-reorder-"));
  const databasePath = path.join(directory, "tasks.db");
  try {
    const created = ["A", "B", "C", "D"].map((title) =>
      task(executeCommand(request("task.create", { title }, { idempotencyKey: `manual-create-${title}` }), databasePath)),
    );
    const byTitle = new Map(created.map((item) => [item.title, item]));
    const database = new DatabaseSync(databasePath);
    try {
      database.prepare("UPDATE tasks SET position = ? WHERE id = ?").run(0, byTitle.get("A")!.id);
      database.prepare("UPDATE tasks SET position = ? WHERE id = ?").run(1, byTitle.get("B")!.id);
      database.prepare("UPDATE tasks SET position = ? WHERE id = ?").run(2, byTitle.get("C")!.id);
      database.prepare("UPDATE tasks SET position = ? WHERE id = ?").run(3, byTitle.get("D")!.id);
    } finally {
      database.close();
    }

    const ids = (result: Result): string[] => (result.tasks as TaskRecord[]).map((item) => item.title);
    assert.deepEqual(ids(executeCommand(request("task.list", { sort: "manual" }), databasePath)), ["A", "B", "C", "D"]);
    assert.deepEqual(
      ids(executeCommand(request("task.reorder", {
        tasks: [{ id: byTitle.get("C")?.id, expectedVersion: 1 }],
        placement: { beforeId: byTitle.get("A")?.id },
      }, { idempotencyKey: "manual-before" }), databasePath)),
      ["C"],
    );
    assert.deepEqual(ids(executeCommand(request("task.list", { sort: "manual" }), databasePath)), ["C", "A", "B", "D"]);
    assert.equal(siblingPositions(databasePath).every((row, index) => row.position === index), true);
    assert.equal(task(executeCommand(request("task.get", { id: byTitle.get("C")?.id }), databasePath)).version, 2);
    const afterReorder = task(executeCommand(request("task.get", { id: byTitle.get("C")?.id }), databasePath));

    executeCommand(request("task.reorder", {
      tasks: [{ id: byTitle.get("C")?.id, expectedVersion: 2 }],
      placement: { afterId: byTitle.get("D")?.id },
    }, { idempotencyKey: "manual-after" }), databasePath);
    assert.deepEqual(ids(executeCommand(request("task.list", { sort: "manual" }), databasePath)), ["A", "B", "D", "C"]);
    executeCommand(request("task.reorder", {
      tasks: [{ id: byTitle.get("D")?.id, expectedVersion: 1 }],
      placement: { first: true },
    }, { idempotencyKey: "manual-first" }), databasePath);
    assert.deepEqual(ids(executeCommand(request("task.list", { sort: "manual" }), databasePath)), ["D", "A", "B", "C"]);
    executeCommand(request("task.reorder", {
      tasks: [{ id: byTitle.get("D")?.id, expectedVersion: 2 }],
      placement: { last: true },
    }, { idempotencyKey: "manual-last" }), databasePath);
    assert.deepEqual(ids(executeCommand(request("task.list", { sort: "manual" }), databasePath)), ["A", "B", "C", "D"]);

    const multi = executeCommand(request("task.reorder", {
      tasks: [
        { id: byTitle.get("B")?.id, expectedVersion: 1 },
        { id: byTitle.get("C")?.id, expectedVersion: 3 },
      ],
      placement: { first: true },
    }, { idempotencyKey: "manual-multi" }), databasePath);
    assert.equal(multi.changed, true);
    assert.deepEqual(ids(executeCommand(request("task.list", { sort: "manual" }), databasePath)), ["B", "C", "A", "D"]);
    assert.deepEqual(siblingPositions(databasePath).map((row) => row.position), [0, 1, 2, 3]);

    const noOpBefore = siblingPositions(databasePath);
    const noOpTask = task(executeCommand(request("task.get", { id: byTitle.get("B")?.id }), databasePath));
    const noOp = executeCommand(request("task.reorder", {
      tasks: [{ id: noOpTask.id, expectedVersion: noOpTask.version }],
      placement: { first: true },
    }, { idempotencyKey: "manual-noop" }), databasePath);
    assert.equal(noOp.changed, false);
    assert.deepEqual(siblingPositions(databasePath), noOpBefore);
    assert.deepEqual(task(executeCommand(request("task.get", { id: afterReorder.id }), databasePath)).updatedAt, afterReorder.updatedAt);

    assert.throws(() => executeCommand(request("task.reorder", {
      tasks: [
        { id: byTitle.get("C")?.id, expectedVersion: 4 },
        { id: byTitle.get("B")?.id, expectedVersion: 2 },
      ],
      placement: { last: true },
    }, { idempotencyKey: "manual-wrong-order" }), databasePath), /INVALID_REORDER_ORDER/);
    assert.throws(() => executeCommand(request("task.reorder", {
      tasks: [{ id: byTitle.get("B")?.id, expectedVersion: 1 }],
      placement: { beforeId: byTitle.get("C")?.id },
    }, { idempotencyKey: "manual-stale" }), databasePath), /STALE_TASK_VERSION/);

    const parent = task(executeCommand(request("task.create", { title: "Parent" }, { idempotencyKey: "manual-parent" }), databasePath));
    const child = task(executeCommand(request("task.create", { title: "Child", parentId: parent.id }, { idempotencyKey: "manual-child" }), databasePath));
    assert.throws(() => executeCommand(request("task.reorder", {
      tasks: [{ id: child.id, expectedVersion: child.version }],
      placement: { beforeId: parent.id },
    }, { idempotencyKey: "manual-cross-scope" }), databasePath), /INVALID_REORDER_SCOPE/);
    assert.throws(() => executeCommand(request("task.reorder", {
      tasks: [{ id: child.id, expectedVersion: child.version }, { id: parent.id, expectedVersion: parent.version }],
      placement: { first: true },
    }, { idempotencyKey: "manual-mixed-scope" }), databasePath), /INVALID_REORDER_SCOPE/);

    const beforeRollback = siblingPositions(databasePath);
    const rollbackTarget = task(executeCommand(request("task.get", { id: byTitle.get("D")?.id }), databasePath));
    const rollbackRequest = request("task.reorder", {
      tasks: [{ id: rollbackTarget.id, expectedVersion: rollbackTarget.version }],
      placement: { beforeId: byTitle.get("A")?.id },
    }, { idempotencyKey: "manual-rollback" });
    const withFailure = openDatabase(databasePath);
    withFailure.exec("CREATE TRIGGER reject_reorder_activity BEFORE INSERT ON activity WHEN NEW.action = 'reordered' BEGIN SELECT RAISE(ABORT, 'reorder activity failed'); END;");
    withFailure.close();
    assert.throws(() => executeCommand(rollbackRequest, databasePath), /reorder activity failed/);
    assert.deepEqual(siblingPositions(databasePath), beforeRollback);
    const withoutFailure = openDatabase(databasePath);
    withoutFailure.exec("DROP TRIGGER reject_reorder_activity");
    withoutFailure.close();
    const retried = executeCommand(rollbackRequest, databasePath);
    assert.equal(retried.changed, true);
    assert.deepEqual(executeCommand(rollbackRequest, databasePath), retried);

    const activity = executeCommand(request("activity.list", { taskId: byTitle.get("D")?.id }), databasePath) as { activity: Array<{ action: string; details: Record<string, unknown> }> };
    const reorderActivity = activity.activity.find((entry) => entry.action === "reordered");
    assert.equal(typeof reorderActivity?.details.before, "object");
    assert.equal(typeof reorderActivity?.details.after, "object");
    assert.deepEqual(reorderActivity?.details.siblingScope, { parentId: null });
  } finally {
    cleanDirectory(directory);
  }
});

test("manual ordering keeps hidden siblings and context pagination stable", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-manual-filter-"));
  const databasePath = path.join(directory, "tasks.db");
  try {
    const visibleA = task(executeCommand(request("task.create", { title: "Visible A @manual-filter" }, { idempotencyKey: "filter-a" }), databasePath));
    const hidden = task(executeCommand(request("task.create", { title: "Hidden sibling" }, { idempotencyKey: "filter-hidden" }), databasePath));
    const visibleB = task(executeCommand(request("task.create", { title: "Visible B @manual-filter" }, { idempotencyKey: "filter-b" }), databasePath));
    const parent = task(executeCommand(request("task.create", { title: "Hidden parent" }, { idempotencyKey: "filter-parent" }), databasePath));
    const child = task(executeCommand(request("task.create", { title: "Visible child @manual-filter", parentId: parent.id }, { idempotencyKey: "filter-child" }), databasePath));
    const database = new DatabaseSync(databasePath);
    try {
      const update = database.prepare("UPDATE tasks SET position = ? WHERE id = ?");
      update.run(0, visibleA.id);
      update.run(1, hidden.id);
      update.run(2, visibleB.id);
      update.run(3, parent.id);
      update.run(0, child.id);
    } finally {
      database.close();
    }

    const filtered = executeCommand(request("task.list", { category: "manual-filter", sort: "manual", includeAncestors: true }), databasePath);
    assert.deepEqual((filtered.tasks as TaskRecord[]).map((row) => row.title), [
      "Visible A @manual-filter",
      "Visible B @manual-filter",
      "Visible child @manual-filter",
    ]);
    assert.equal(filtered.total, 3);
    assert.deepEqual((filtered.contextTasks as TaskRecord[]).map((row) => row.title), ["Hidden parent"]);
    const reordered = executeCommand(request("task.reorder", {
      tasks: [{ id: visibleB.id, expectedVersion: visibleB.version }],
      placement: { beforeId: visibleA.id },
    }, { idempotencyKey: "filter-reorder" }), databasePath);
    assert.equal(reordered.changed, true);
    assert.deepEqual((executeCommand(request("task.list", { sort: "manual" }), databasePath).tasks as TaskRecord[]).map((row) => row.title), [
      "Visible B @manual-filter",
      "Visible A @manual-filter",
      "Hidden sibling",
      "Hidden parent",
      "Visible child @manual-filter",
    ]);
    assert.deepEqual(siblingPositions(databasePath).filter((row) => [visibleA.id, hidden.id, visibleB.id].includes(row.id)).map((row) => row.id), [visibleB.id, visibleA.id, hidden.id]);

    const page = executeCommand(request("task.list", { category: "manual-filter", sort: "manual", includeAncestors: true, limit: 2, offset: 2 }), databasePath);
    assert.equal(page.total, 3);
    assert.equal((page.tasks as TaskRecord[]).length, 1);
    assert.equal((page.tasks as TaskRecord[])[0]?.id, child.id);
    assert.equal((page.contextTasks as TaskRecord[]).some((row) => row.id === parent.id), true);
  } finally {
    cleanDirectory(directory);
  }
});

test("status undo restores paused after done with exact timestamps", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-status-undo-"));
  const databasePath = path.join(directory, "tasks.db");
  try {
    const created = task(executeCommand(request("task.create", { title: "Undo paused" }, { idempotencyKey: "undo-create" }), databasePath));
    const started = task(executeCommand(request("task.start", { id: created.id, expectedVersion: created.version }, { idempotencyKey: "undo-start" }), databasePath));
    const paused = task(executeCommand(request("task.pause", { id: started.id, expectedVersion: started.version }, { idempotencyKey: "undo-pause" }), databasePath));
    const done = task(executeCommand(request("task.complete", { id: paused.id, expectedVersion: paused.version }, { idempotencyKey: "undo-complete" }), databasePath));
    assert.equal(done.status, "done");
    assert.equal(typeof done.completedAt, "string");

    const undone = executeCommand(
      request("task.status.undo", { id: done.id, expectedVersion: done.version }, { idempotencyKey: "undo-1" }),
      databasePath,
    );
    const restored = task(undone);
    assert.equal(restored.status, "paused");
    assert.equal(restored.version, done.version + 1);
    assert.equal(restored.completedAt, null);
    assert.equal(restored.canceledAt, null);
    assert.equal(undone.changed, true);
    assert.equal(typeof undone.undoneSeq, "number");

    const activities = executeCommand(request("activity.list", { taskId: created.id }), databasePath) as {
      activity: Array<{ action: string; details: Record<string, unknown> }>;
    };
    const latest = activities.activity[0];
    assert.equal(latest.action, "undone");
    assert.deepEqual({ from: latest.details.from, to: latest.details.to }, { from: "done", to: "paused" });
    assert.equal(typeof latest.details.undoneSeq, "number");
  } finally {
    cleanDirectory(directory);
  }
});

test("status undo covers open, done, and cancellation transitions", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-status-undo-cases-"));
  const databasePath = path.join(directory, "tasks.db");
  try {
    const openTask = task(executeCommand(request("task.create", { title: "Open case" }, { idempotencyKey: "case-open-create" }), databasePath));
    const inProgress = task(executeCommand(request("task.start", { id: openTask.id, expectedVersion: openTask.version }, { idempotencyKey: "case-start" }), databasePath));
    assert.equal(inProgress.status, "in_progress");
    const backToOpen = task(executeCommand(request("task.status.undo", { id: inProgress.id, expectedVersion: inProgress.version }, { idempotencyKey: "case-undo-start" }), databasePath));
    assert.equal(backToOpen.status, "open");

    const doneBase = task(executeCommand(request("task.create", { title: "Done case" }, { idempotencyKey: "case-done-create" }), databasePath));
    const doneStarted = task(executeCommand(request("task.start", { id: doneBase.id, expectedVersion: doneBase.version }, { idempotencyKey: "case-done-start" }), databasePath));
    const done = task(executeCommand(request("task.complete", { id: doneStarted.id, expectedVersion: doneStarted.version }, { idempotencyKey: "case-done-complete" }), databasePath));
    const reopened = task(executeCommand(request("task.reopen", { id: done.id, expectedVersion: done.version }, { idempotencyKey: "case-reopen" }), databasePath));
    assert.equal(reopened.status, "open");
    const backToDone = task(executeCommand(request("task.status.undo", { id: reopened.id, expectedVersion: reopened.version }, { idempotencyKey: "case-undo-reopen" }), databasePath));
    assert.equal(backToDone.status, "done");
    assert.equal(typeof backToDone.completedAt, "string");

    const cancelBase = task(executeCommand(request("task.create", { title: "Cancel case" }, { idempotencyKey: "case-cancel-create" }), databasePath));
    const canceled = task(executeCommand(request("task.delete", { id: cancelBase.id, expectedVersion: cancelBase.version }, { idempotencyKey: "case-cancel" }), databasePath));
    assert.equal(canceled.status, "canceled");
    assert.equal(typeof canceled.canceledAt, "string");
    const backFromCancel = task(executeCommand(request("task.status.undo", { id: canceled.id, expectedVersion: canceled.version }, { idempotencyKey: "case-undo-cancel" }), databasePath));
    assert.equal(backFromCancel.status, "open");
    assert.equal(backFromCancel.canceledAt, null);
  } finally {
    cleanDirectory(directory);
  }
});

test("batch status transitions are atomic and support grouped undo", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-status-batch-"));
  const databasePath = path.join(directory, "tasks.db");
  try {
    const first = task(executeCommand(request("task.create", { title: "Batch first" }, { idempotencyKey: "batch-create-first" }), databasePath));
    const second = task(executeCommand(request("task.create", { title: "Batch second" }, { idempotencyKey: "batch-create-second" }), databasePath));
    const secondEdited = task(executeCommand(request("task.update", {
      id: second.id,
      expectedVersion: second.version,
      title: "Batch second edited",
    }, { idempotencyKey: "batch-edit-second" }), databasePath));
    const beforeActivity = countRows(databasePath, "activity");
    const beforeReceipts = countRows(databasePath, "command_receipts");
    assert.throws(
      () => executeCommand(request("task.transitionMany", {
        tasks: [
          { id: first.id, expectedVersion: first.version, command: "task.complete" },
          { id: second.id, expectedVersion: second.version, command: "task.complete" },
        ],
      }, { idempotencyKey: "batch-stale" }), databasePath),
      /STALE_TASK_VERSION/,
    );
    assert.equal(task(executeCommand(request("task.get", { id: first.id }), databasePath)).status, "open");
    assert.equal(task(executeCommand(request("task.get", { id: first.id }), databasePath)).version, first.version);
    assert.equal(countRows(databasePath, "activity"), beforeActivity);
    assert.equal(countRows(databasePath, "command_receipts"), beforeReceipts);

    const changed = executeCommand(request("task.transitionMany", {
      tasks: [
        { id: first.id, expectedVersion: first.version, command: "task.start" },
        { id: second.id, expectedVersion: secondEdited.version, command: "task.pause" },
      ],
    }, { idempotencyKey: "batch-change" }), databasePath) as { tasks: TaskRecord[]; changed: boolean };
    assert.equal(changed.changed, true);
    assert.deepEqual(changed.tasks.map((item) => item.status), ["in_progress", "paused"]);
    assert.deepEqual(executeCommand(request("task.transitionMany", {
      tasks: [
        { id: first.id, expectedVersion: first.version, command: "task.start" },
        { id: second.id, expectedVersion: secondEdited.version, command: "task.pause" },
      ],
    }, { idempotencyKey: "batch-change" }), databasePath), changed);

    const undone = executeCommand(request("task.status.undoMany", {
      tasks: changed.tasks.map((item) => ({ id: item.id, expectedVersion: item.version })),
    }, { idempotencyKey: "batch-undo" }), databasePath) as { tasks: TaskRecord[]; changed: boolean };
    assert.equal(undone.changed, true);
    assert.deepEqual(undone.tasks.map((item) => item.status), ["open", "open"]);
    assert.deepEqual(undone.tasks.map((item) => item.version), [3, 4]);
    assert.deepEqual(executeCommand(request("task.status.undoMany", {
      tasks: changed.tasks.map((item) => ({ id: item.id, expectedVersion: item.version })),
    }, { idempotencyKey: "batch-undo" }), databasePath), undone);
  } finally {
    cleanDirectory(directory);
  }
});

test("operation undo restores typed fields, tolerates unrelated changes, and rejects conflicts", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-operation-undo-"));
  const databasePath = path.join(directory, "tasks.db");
  try {
    const createdResult = executeCommand(request("task.create", { title: "Operation task" }, { idempotencyKey: "operation-create" }), databasePath) as Result & { operationId: string };
    const created = task(createdResult);
    assert.equal(typeof createdResult.operationId, "string");
    const startedResult = executeCommand(request("task.start", {
      id: created.id,
      expectedVersion: created.version,
    }, { idempotencyKey: "operation-start" }), databasePath) as Result & { operationId: string };
    const started = task(startedResult);
    const edited = task(executeCommand(request("task.update", {
      id: started.id,
      expectedVersion: started.version,
      title: "Operation task renamed",
    }, { idempotencyKey: "operation-edit" }), databasePath));
    const undone = executeCommand(request("operation.undo", {
      operationId: startedResult.operationId,
    }, { idempotencyKey: "operation-undo" }), databasePath) as { tasks: TaskRecord[]; changed: boolean; undoneOperationId: string };
    assert.equal(undone.changed, true);
    assert.equal(undone.undoneOperationId, startedResult.operationId);
    assert.equal(undone.tasks[0]?.status, "open");
    assert.equal(undone.tasks[0]?.title, edited.title);
    assert.deepEqual(executeCommand(request("operation.undo", {
      operationId: startedResult.operationId,
    }, { idempotencyKey: "operation-undo" }), databasePath), undone);

    const completedResult = executeCommand(request("task.complete", {
      id: edited.id,
      expectedVersion: undone.tasks[0]!.version,
    }, { idempotencyKey: "operation-complete" }), databasePath) as Result & { operationId: string };
    const completed = task(completedResult);
    task(executeCommand(request("task.reopen", {
      id: completed.id,
      expectedVersion: completed.version,
    }, { idempotencyKey: "operation-reopen" }), databasePath));
    assert.throws(
      () => executeCommand(request("operation.undo", { operationId: completedResult.operationId }, { idempotencyKey: "operation-conflict" }), databasePath),
      /OPERATION_CONFLICT/,
    );
    assert.equal(task(executeCommand(request("task.get", { id: completed.id }), databasePath)).status, "open");

    const freshResult = executeCommand(request("task.create", { title: "Create undo" }, { idempotencyKey: "operation-create-undo-create" }), databasePath) as Result & { operationId: string };
    const createUndo = executeCommand(request("operation.undo", {
      operationId: freshResult.operationId,
    }, { idempotencyKey: "operation-create-undo" }), databasePath) as { tasks: TaskRecord[] };
    assert.deepEqual(createUndo.tasks, []);
    assert.throws(() => executeCommand(request("task.get", { id: task(freshResult).id }), databasePath), /TASK_NOT_FOUND/);
  } finally {
    cleanDirectory(directory);
  }
});

test("status undo rejects stale versions without writing", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-status-undo-stale-"));
  const databasePath = path.join(directory, "tasks.db");
  try {
    const created = task(executeCommand(request("task.create", { title: "Stale undo" }, { idempotencyKey: "stale-create" }), databasePath));
    const done = task(executeCommand(request("task.start", { id: created.id, expectedVersion: created.version }, { idempotencyKey: "stale-start" }), databasePath));
    const beforeTasks = countRows(databasePath, "tasks");
    const beforeActivity = countRows(databasePath, "activity");
    const beforeReceipts = countRows(databasePath, "command_receipts");
    assert.throws(
      () => executeCommand(request("task.status.undo", { id: done.id, expectedVersion: created.version }, { idempotencyKey: "stale-undo" }), databasePath),
      /STALE_TASK_VERSION/,
    );
    assert.equal(countRows(databasePath, "tasks"), beforeTasks);
    assert.equal(countRows(databasePath, "activity"), beforeActivity);
    assert.equal(countRows(databasePath, "command_receipts"), beforeReceipts);
    assert.equal(task(executeCommand(request("task.get", { id: created.id }), databasePath)).status, "in_progress");
  } finally {
    cleanDirectory(directory);
  }
});

test("status undo is unavailable after an intervening mutation", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-status-undo-intervening-"));
  const databasePath = path.join(directory, "tasks.db");
  try {
    const created = task(executeCommand(request("task.create", { title: "Intervening" }, { idempotencyKey: "inter-create" }), databasePath));
    const done = task(executeCommand(request("task.complete", { id: created.id, expectedVersion: created.version }, { idempotencyKey: "inter-complete" }), databasePath));
    const edited = task(executeCommand(request("task.update", { id: done.id, expectedVersion: done.version, title: "Intervening edited" }, { idempotencyKey: "inter-edit" }), databasePath));
    assert.throws(
      () => executeCommand(request("task.status.undo", { id: edited.id, expectedVersion: edited.version }, { idempotencyKey: "inter-undo" }), databasePath),
      /UNDO_UNAVAILABLE/,
    );
    assert.equal(task(executeCommand(request("task.get", { id: created.id }), databasePath)).title, "Intervening edited");

    const second = task(executeCommand(request("task.create", { title: "Second" }, { idempotencyKey: "inter-second" }), databasePath));
    const secondDone = task(executeCommand(request("task.complete", { id: second.id, expectedVersion: second.version }, { idempotencyKey: "inter-second-done" }), databasePath));
    const undoneOnce = task(executeCommand(request("task.status.undo", { id: secondDone.id, expectedVersion: secondDone.version }, { idempotencyKey: "inter-second-undo" }), databasePath));
    assert.equal(undoneOnce.status, "open");
    assert.throws(
      () => executeCommand(request("task.status.undo", { id: undoneOnce.id, expectedVersion: undoneOnce.version }, { idempotencyKey: "inter-second-undo-again" }), databasePath),
      /UNDO_UNAVAILABLE/,
    );
  } finally {
    cleanDirectory(directory);
  }
});

test("status undo replays the same idempotency key without a second mutation", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-status-undo-idem-"));
  const databasePath = path.join(directory, "tasks.db");
  try {
    const created = task(executeCommand(request("task.create", { title: "Idempotent undo" }, { idempotencyKey: "idem-create" }), databasePath));
    const done = task(executeCommand(request("task.complete", { id: created.id, expectedVersion: created.version }, { idempotencyKey: "idem-complete" }), databasePath));
    const first = executeCommand(request("task.status.undo", { id: done.id, expectedVersion: done.version }, { idempotencyKey: "idem-undo" }), databasePath);
    const activityAfterFirst = countRows(databasePath, "activity");
    const replay = executeCommand(request("task.status.undo", { id: done.id, expectedVersion: done.version }, { idempotencyKey: "idem-undo" }), databasePath);
    assert.deepEqual(replay, first);
    assert.equal(countRows(databasePath, "activity"), activityAfterFirst);
    assert.equal(task(executeCommand(request("task.get", { id: created.id }), databasePath)).version, task(first).version);
    assert.throws(
      () => executeCommand(request("task.status.undo", { id: task(first).id, expectedVersion: task(first).version }, { idempotencyKey: "idem-undo" }), databasePath),
      /IDEMPOTENCY_KEY_REUSED/,
    );
  } finally {
    cleanDirectory(directory);
  }
});

test("status undo previews leave every table unchanged", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-status-undo-preview-"));
  const databasePath = path.join(directory, "tasks.db");
  try {
    const created = task(executeCommand(request("task.create", { title: "Preview undo" }, { idempotencyKey: "preview-create" }), databasePath));
    const done = task(executeCommand(request("task.complete", { id: created.id, expectedVersion: created.version }, { idempotencyKey: "preview-complete" }), databasePath));
    const tables = ["tasks", "categories", "tags", "task_tags", "task_dependencies", "activity", "command_receipts"];
    const before = tables.map((tableName) => countRows(databasePath, tableName));
    const dry = executeCommand(request("task.status.undo", { id: done.id, expectedVersion: done.version }, { idempotencyKey: "preview-dry", dryRun: true }), databasePath);
    assert.equal(dry.dryRun, true);
    assert.equal(task(dry).status, "open");
    const readOnly = executeCommand(request("task.status.undo", { id: done.id, expectedVersion: done.version }, { idempotencyKey: "preview-ro", readOnly: true }), databasePath);
    assert.equal(readOnly.dryRun, true);
    assert.deepEqual(tables.map((tableName) => countRows(databasePath, tableName)), before);
    assert.equal(task(executeCommand(request("task.get", { id: created.id }), databasePath)).status, "done");
  } finally {
    cleanDirectory(directory);
  }
});

test("older workspace snapshots receive deterministic manual positions on restore", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-old-snapshot-order-"));
  const databasePath = path.join(directory, "tasks.db");
  const snapshotPath = path.join(directory, "legacy", "tasks.json");
  const restoredPath = path.join(directory, "restored", "tasks.db");
  try {
    const first = task(executeCommand(request("task.create", { title: "First" }, { idempotencyKey: "old-snapshot-first" }), databasePath));
    const second = task(executeCommand(request("task.create", { title: "Second" }, { idempotencyKey: "old-snapshot-second" }), databasePath));
    const database = openDatabase(databasePath);
    try {
      database.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run("2026-02-01T00:00:00.000Z", first.id);
      database.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run("2026-01-01T00:00:00.000Z", second.id);
    } finally {
      database.close();
    }
    const refreshed = executeCommand(request("workspace.export"), databasePath).snapshot as Record<string, unknown> & { tasks: Array<Record<string, unknown>> };
    refreshed.schemaVersion = 4;
    refreshed.tasks = refreshed.tasks.map(({ position: _position, ...row }) => row);
    mkdirSync(path.dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, `${JSON.stringify(refreshed)}\n`);
    executeCommand(request("workspace.restore", { sourcePath: snapshotPath, destinationPath: restoredPath }, { idempotencyKey: "old-snapshot-restore" }), databasePath);
    const restoredPositions = siblingPositions(restoredPath);
    assert.deepEqual(restoredPositions.map(({ id, position }) => ({ id, position })), [
      { id: first.id, position: 0 },
      { id: second.id, position: 1 },
    ]);
    assert.ok(restoredPositions.every(({ version }) => version > 1_000_000));
  } finally {
    cleanDirectory(directory);
  }
});

test("schema version 2 workspaces migrate priority and manual positions", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-schema2-migration-"));
  const databasePath = path.join(directory, "tasks.db");
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO schema_meta (key, value) VALUES ('schema_version', '2');
    CREATE TABLE categories (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, label TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE tags (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, label TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description_markdown TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL, category_id TEXT, parent_id TEXT, version INTEGER NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT, canceled_at TEXT
    );
    INSERT INTO tasks (id, title, description_markdown, status, category_id, parent_id, version, created_at, updated_at, completed_at, canceled_at) VALUES
      ('root', 'Root', '', 'open', NULL, NULL, 1, 'now', '2026-01-01T00:00:00.000Z', NULL, NULL),
      ('child', 'Child', '', 'open', NULL, 'root', 1, 'now', '2026-02-01T00:00:00.000Z', NULL, NULL);
  `);
  legacy.close();
  try {
    const migrated = openDatabase(databasePath);
    const schema = migrated.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get() as { value: string };
    const migratedColumns = migrated.prepare("SELECT name FROM pragma_table_info('tasks')").all() as Array<{ name: string }>;
    assert.equal(schema.value, "6");
    assert.equal(migratedColumns.some((column) => column.name === "priority"), true);
    assert.equal(migratedColumns.some((column) => column.name === "position"), true);
    migrated.close();
    assert.deepEqual(siblingPositions(databasePath, null), [{ id: "root", position: 0, version: 1 }]);
    assert.deepEqual(siblingPositions(databasePath, "root"), [{ id: "child", position: 0, version: 1 }]);
    assert.equal(task(executeCommand(request("task.get", { id: "root" }), databasePath)).priority, 2);
  } finally {
    cleanDirectory(directory);
  }
});

test("schema version 4 workspaces migrate deterministic manual positions", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-order-migration-"));
  const databasePath = path.join(directory, "tasks.db");
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO schema_meta (key, value) VALUES ('schema_version', '4');
    CREATE TABLE categories (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, label TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE tags (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, label TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description_markdown TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL, category_id TEXT, parent_id TEXT, priority INTEGER NOT NULL DEFAULT 2,
      version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT, canceled_at TEXT
    );
    INSERT INTO tasks (id, title, description_markdown, status, category_id, parent_id, priority, version, created_at, updated_at, completed_at, canceled_at) VALUES
      ('z', 'Z', '', 'open', NULL, NULL, 2, 1, 'now', '2026-01-01T00:00:00.000Z', NULL, NULL),
      ('a', 'A', '', 'open', NULL, NULL, 2, 1, 'now', '2026-01-01T00:00:00.000Z', NULL, NULL),
      ('m', 'M', '', 'open', NULL, NULL, 2, 1, 'now', '2026-02-01T00:00:00.000Z', NULL, NULL);
  `);
  legacy.close();
  try {
    const migrated = openDatabase(databasePath);
    const schema = migrated.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get() as { value: string };
    const columns = migrated.prepare("SELECT name FROM pragma_table_info('tasks')").all() as Array<{ name: string }>;
    assert.equal(schema.value, "6");
    assert.equal(columns.some((column) => column.name === "position"), true);
    migrated.close();
    assert.deepEqual(siblingPositions(databasePath), [
      { id: "m", position: 0, version: 1 },
      { id: "a", position: 1, version: 1 },
      { id: "z", position: 2, version: 1 },
    ]);
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
    assert.equal(schema.value, "6");
    migrated.close();
    const migratedTask = task(executeCommand(request("task.get", { id: "old" }), databasePath));
    assert.equal(migratedTask.priority, 2);
  } finally {
    cleanDirectory(directory);
  }
});
