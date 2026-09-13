import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { executeCommand } from "./commands.js";
import { canonicalRootPath, pendingOperationPath } from "./canonicalWorkspace.js";
import { contentHash, requestHash } from "./requestHash.js";
import type { ProtocolRequest, TaskRecord } from "./protocol.js";

type Result = Record<string, unknown>;
type CanonicalTask = {
  format: "tasks.task";
  formatVersion: 1;
  workspaceId: string;
  id: string;
  title: string;
  descriptionMarkdown: string;
  status: TaskRecord["status"];
  priority: TaskRecord["priority"];
  parentId: string | null;
  dependencyIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  canceledAt: string | null;
  sync: {
    revision: number;
    modifiedBy: string;
    basedOnHash: string | null;
    contentHash: string;
  };
};

type CanonicalOrder = {
  format: "tasks.sibling-order";
  formatVersion: 1;
  workspaceId: string;
  parentId: string | null;
  taskIds: string[];
  sync: CanonicalTask["sync"];
};

function request(
  command: ProtocolRequest["command"],
  args: Record<string, unknown> = {},
  idempotencyKey?: string,
): ProtocolRequest {
  return {
    version: 1,
    requestId: `${command}-${Math.random().toString(36).slice(2)}`,
    command,
    args,
    actor: { kind: "agent", label: "canonical-test" },
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  };
}

function task(result: Result): TaskRecord {
  return result.task as TaskRecord;
}

function hashable<T extends { sync: CanonicalTask["sync"] }>(record: T): Omit<T, "sync"> & { sync: Omit<T["sync"], "contentHash"> } {
  return {
    ...record,
    sync: {
      revision: record.sync.revision,
      modifiedBy: record.sync.modifiedBy,
      basedOnHash: record.sync.basedOnHash,
    },
  } as Omit<T, "sync"> & { sync: Omit<T["sync"], "contentHash"> };
}

function withNextSync<T extends { sync: CanonicalTask["sync"] }>(record: T, title?: string): T {
  const next = {
    ...record,
    ...(title === undefined ? {} : { title }),
    sync: {
      revision: record.sync.revision + 1,
      modifiedBy: "tablet",
      basedOnHash: record.sync.contentHash,
      contentHash: "",
    },
  } as T;
  next.sync.contentHash = contentHash(hashable(next));
  return next;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function removeDatabaseFiles(databasePath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${databasePath}${suffix}`);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

test("task mutations write canonical task and sibling-order files", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-canonical-write-"));
  const databasePath = path.join(directory, "tasks.db");
  try {
    const parent = task(executeCommand(request("task.create", { title: "Parent @work #one" }, "canonical-parent"), databasePath));
    const child = task(executeCommand(request("task.create", { title: "Child", parentId: parent.id }, "canonical-child"), databasePath));
    const linked = task(
      executeCommand(
        request("task.dependency.add", { id: child.id, dependsOnId: parent.id, expectedVersion: child.version }, "canonical-link"),
        databasePath,
      ),
    );

    const root = canonicalRootPath(databasePath);
    const workspace = readJson<{ workspaceId: string }>(path.join(root, "workspace.json"));
    const taskFile = readJson<CanonicalTask>(path.join(root, "tasks", `${child.id}.json`));
    const orderFile = readJson<CanonicalOrder>(path.join(root, "order", `${parent.id}.json`));
    assert.equal(workspace.workspaceId, taskFile.workspaceId);
    assert.equal(taskFile.title, child.title);
    assert.deepEqual(taskFile.dependencyIds, [parent.id]);
    assert.equal("version" in taskFile, false);
    assert.equal("position" in taskFile, false);
    assert.deepEqual(orderFile.taskIds, [child.id]);
    assert.equal("position" in orderFile, false);
    assert.equal(linked.version, child.version + 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("changed canonical files import without rereading unrelated task bodies", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-canonical-import-"));
  const databasePath = path.join(directory, "tasks.db");
  try {
    const first = task(executeCommand(request("task.create", { title: "First" }, "import-first"), databasePath));
    const second = task(executeCommand(request("task.create", { title: "Second" }, "import-second"), databasePath));
    const root = canonicalRootPath(databasePath);
    const firstPath = path.join(root, "tasks", `${first.id}.json`);
    const firstFile = readJson<CanonicalTask>(firstPath);
    const changedFirst = withNextSync(firstFile, "First from tablet");
    writeJson(firstPath, changedFirst);

    const imported = task(executeCommand(request("task.get", { id: first.id }), databasePath));
    assert.equal(imported.title, "First from tablet");
    assert.equal(imported.version, first.version + 1);
    const untouched = task(executeCommand(request("task.get", { id: second.id }), databasePath));
    assert.equal(untouched.title, second.title);
    assert.equal(untouched.version, second.version);

    const rootOrderPath = path.join(root, "order", "root.json");
    const rootOrder = readJson<CanonicalOrder>(rootOrderPath);
    const changedOrder = withNextSync({ ...rootOrder, taskIds: [...rootOrder.taskIds].reverse() });
    writeJson(rootOrderPath, changedOrder);
    const ordered = executeCommand(request("task.list", { sort: "manual" }), databasePath).tasks as TaskRecord[];
    assert.deepEqual(ordered.map((item) => item.id), [first.id, second.id]);
    assert.deepEqual(ordered.map((item) => item.title), ["First from tablet", second.title]);

    const conflict = withNextSync(readJson<CanonicalTask>(firstPath), "Conflicting copy");
    writeJson(path.join(root, "tasks", `${first.id}.sync-conflict-tablet.json`), conflict);
    const beforeConflict = task(executeCommand(request("task.get", { id: first.id }), databasePath));
    assert.equal(beforeConflict.title, "First from tablet");
    const status = executeCommand(request("workspace.sync"), databasePath);
    assert.equal(status.unresolvedConflictCount, 1);
    const conflicts = executeCommand(request("workspace.conflict.list"), databasePath).conflicts as Array<{ id: number }>;
    assert.equal(conflicts.length, 1);
    const resolutionRequest = request(
      "workspace.conflict.resolve",
      { conflictId: conflicts[0].id, resolution: "use-conflict" },
      "resolve-canonical-conflict",
    );
    const resolved = executeCommand(resolutionRequest, databasePath);
    assert.deepEqual(resolved, { conflictId: conflicts[0].id, resolution: "use-conflict" });
    assert.equal(task(executeCommand(request("task.get", { id: first.id }), databasePath)).title, "Conflicting copy");
    assert.deepEqual(executeCommand(resolutionRequest, databasePath), resolved);
    assert.equal((executeCommand(request("workspace.sync"), databasePath).unresolvedConflictCount), 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("two local caches converge through one canonical workspace", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-canonical-devices-"));
  const firstDatabasePath = path.join(directory, "laptop", "tasks.db");
  const secondDatabasePath = path.join(directory, "tablet", "tasks.db");
  const previousRoot = process.env.TASKS_SYNC_ROOT;
  process.env.TASKS_SYNC_ROOT = path.join(directory, "shared-sync");
  try {
    const created = task(executeCommand(request("task.create", { title: "Shared task" }, "device-create"), firstDatabasePath));
    const imported = task(executeCommand(request("task.get", { id: created.id }), secondDatabasePath));
    assert.equal(imported.title, created.title);
    assert.ok(imported.version > created.version);

    const updated = task(
      executeCommand(
        request("task.update", { id: imported.id, title: "Changed on tablet", expectedVersion: imported.version }, "device-update"),
        secondDatabasePath,
      ),
    );
    const converged = task(executeCommand(request("task.get", { id: created.id }), firstDatabasePath));
    assert.equal(converged.title, updated.title);
    assert.equal(converged.version, created.version + 1);
  } finally {
    if (previousRoot === undefined) delete process.env.TASKS_SYNC_ROOT;
    else process.env.TASKS_SYNC_ROOT = previousRoot;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an order can arrive before its task without hiding the later task", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-canonical-order-transfer-"));
  const databasePath = path.join(directory, "tasks.db");
  try {
    const existing = task(executeCommand(request("task.create", { title: "Existing" }, "order-transfer-existing"), databasePath));
    const root = canonicalRootPath(databasePath);
    const orderPath = path.join(root, "order", "root.json");
    const order = readJson<CanonicalOrder>(orderPath);
    const futureId = "future-task";
    const changedOrder = withNextSync({ ...order, taskIds: [futureId, ...order.taskIds] });
    writeJson(orderPath, changedOrder);
    executeCommand(request("workspace.sync"), databasePath);

    const existingFile = readJson<CanonicalTask>(path.join(root, "tasks", `${existing.id}.json`));
    const future = {
      ...existingFile,
      id: futureId,
      title: "Future task",
      sync: {
        revision: 1,
        modifiedBy: "tablet",
        basedOnHash: null,
        contentHash: "",
      },
    } as CanonicalTask;
    future.sync.contentHash = contentHash(hashable(future));
    writeJson(path.join(root, "tasks", `${futureId}.json`), future);

    const tasks = executeCommand(request("task.list", { sort: "manual" }), databasePath).tasks as TaskRecord[];
    assert.deepEqual(tasks.map((item) => item.id), [futureId, existing.id]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a deleted cache rebuilds from canonical files and invalidates old versions", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-canonical-rebuild-"));
  const databasePath = path.join(directory, "tasks.db");
  try {
    const first = task(executeCommand(request("task.create", { title: "First" }, "rebuild-first"), databasePath));
    const second = task(executeCommand(request("task.create", { title: "Second", parentId: first.id }, "rebuild-second"), databasePath));
    executeCommand(
      request("task.dependency.add", { id: second.id, dependsOnId: first.id, expectedVersion: second.version }, "rebuild-link"),
      databasePath,
    );
    removeDatabaseFiles(databasePath);

    const rebuilt = task(executeCommand(request("task.get", { id: second.id }), databasePath));
    assert.equal(rebuilt.title, second.title);
    assert.equal(rebuilt.parentId, first.id);
    assert.deepEqual(rebuilt.dependencyIds, [first.id]);
    assert.ok(rebuilt.version > 1_000_000);
    const order = executeCommand(request("task.list", { sort: "manual" }), databasePath).tasks as TaskRecord[];
    assert.deepEqual(order.map((item) => item.id), [first.id, second.id]);
    assert.equal(executeCommand(request("activity.list", { taskId: second.id }), databasePath).activity instanceof Array, true);
    assert.equal((executeCommand(request("activity.list", { taskId: second.id }), databasePath).activity as unknown[]).length, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("explicit rebuild advances the cache generation and invalidates local versions", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-canonical-explicit-rebuild-"));
  const databasePath = path.join(directory, "tasks.db");
  try {
    const created = task(executeCommand(request("task.create", { title: "Rebuild me" }, "explicit-rebuild-create"), databasePath));
    const rebuilt = executeCommand(request("workspace.rebuild", {}, "explicit-rebuild"), databasePath);
    assert.equal(rebuilt.taskCount, 1);
    assert.equal(rebuilt.orderCount, 1);
    assert.equal(rebuilt.cacheGeneration, 2);
    const refreshed = task(executeCommand(request("task.get", { id: created.id }), databasePath));
    assert.ok(refreshed.version > 1_000_000);
    assert.throws(
      () => executeCommand(request("task.update", { id: created.id, title: "stale", expectedVersion: created.version }, "explicit-rebuild-stale"), databasePath),
      /STALE_TASK_VERSION/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("pending canonical writes recover and preserve create/update idempotency", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-canonical-pending-"));
  const databasePath = path.join(directory, "tasks.db");
  try {
    const current = task(executeCommand(request("task.create", { title: "Before" }, "pending-base"), databasePath));
    const root = canonicalRootPath(databasePath);
    const taskPath = path.join(root, "tasks", `${current.id}.json`);
    const previousContent = readFileSync(taskPath, "utf8");
    const previous = JSON.parse(previousContent) as CanonicalTask;
    const pendingRequest = request(
      "task.update",
      { id: current.id, title: "After crash", expectedVersion: current.version },
      "pending-update",
    );
    const nextTask = {
      ...current,
      title: "After crash",
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    const nextCanonical = withNextSync(previous, nextTask.title);
    nextCanonical.updatedAt = nextTask.updatedAt;
    nextCanonical.sync.contentHash = contentHash(hashable(nextCanonical));
    const pending = {
      format: "tasks.pending-operation",
      formatVersion: 1,
      operationId: "pending-operation-test",
      workspaceId: previous.workspaceId,
      command: pendingRequest.command,
      idempotencyKey: pendingRequest.idempotencyKey,
      requestHash: requestHash(pendingRequest),
      responseJson: JSON.stringify({ task: nextTask, changed: true }),
      replacements: [{
        relativePath: `tasks/${current.id}.json`,
        kind: "task",
        previousContent,
        content: `${JSON.stringify(nextCanonical, null, 2)}\n`,
      }],
    };
    writeJson(pendingOperationPath(databasePath), pending);

    const recovered = task(executeCommand(request("task.get", { id: current.id }), databasePath));
    assert.equal(recovered.title, "After crash");
    assert.equal(recovered.version, current.version + 1);
    assert.equal(existsSync(pendingOperationPath(databasePath)), false);
    assert.deepEqual(executeCommand(pendingRequest, databasePath), { task: nextTask, changed: true });
    assert.equal((executeCommand(request("task.list"), databasePath).tasks as TaskRecord[]).length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
