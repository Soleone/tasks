import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import test from "node:test";
import { executeCommand } from "./commands.js";
import { getDataDirectory, getDatabasePath } from "./paths.js";
import { parseLine, parseRequest, parseResponse, parseRuntimeProbeResult, parseTaskCommandResult, parseTaskReorderArgs, ProtocolError } from "./protocol.js";

test("runtime probe persists a WAL database and searches with FTS5", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-m0-"));
  const databasePath = path.join(directory, "probe.db");
  const request = parseRequest({ version: 1, requestId: "test-1", command: "runtime.probe" });

  try {
    const first = executeCommand(request, databasePath);
    const second = executeCommand(request, databasePath);

    assert.equal(first.databasePath, databasePath);
    assert.equal(first.journalMode, "wal");
    assert.equal(first.fts5Enabled, true);
    assert.equal(first.searchMatches, 1);
    assert.equal(first.probeValue, "capture a task");
    assert.equal(second.sqliteVersion, first.sqliteVersion);
    assert.equal(readFileSync(databasePath).length > 0, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SQLite reports a bounded writer conflict", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-lock-"));
  const databasePath = path.join(directory, "lock.db");
  const first = new DatabaseSync(databasePath);
  const second = new DatabaseSync(databasePath);

  try {
    first.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 25; CREATE TABLE lock_probe (value TEXT);");
    first.exec("BEGIN IMMEDIATE");
    second.exec("PRAGMA busy_timeout = 25");

    assert.throws(() => second.exec("BEGIN IMMEDIATE"), /database is locked|database table is locked/i);
  } finally {
    try {
      first.exec("ROLLBACK");
    } catch {
      // The transaction may already have been released by a failed assertion.
    }
    first.close();
    second.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("protocol rejects unsupported or malformed requests", () => {
  assert.throws(
    () => parseRequest({ version: 2, requestId: "test", command: "runtime.probe" }),
    (error: unknown) => error instanceof ProtocolError && error.code === "UNSUPPORTED_VERSION",
  );
  assert.throws(
    () => parseLine("not json"),
    (error: unknown) => error instanceof ProtocolError && error.code === "INVALID_JSON",
  );
});

test("protocol validates manual reorder placements and optimistic versions", () => {
  const parsed = parseTaskReorderArgs({
    tasks: [{ id: "one", expectedVersion: 3 }, { id: "two", expectedVersion: 1 }],
    placement: { afterId: "three" },
  });
  assert.deepEqual(parsed, {
    tasks: [{ id: "one", expectedVersion: 3 }, { id: "two", expectedVersion: 1 }],
    placement: { afterId: "three" },
  });
  assert.deepEqual(
    parseRequest({ version: 1, requestId: "reorder", command: "task.reorder", args: { tasks: [{ id: "one", expectedVersion: 1 }], placement: { first: true } } }),
    {
      version: 1,
      requestId: "reorder",
      command: "task.reorder",
      args: { tasks: [{ id: "one", expectedVersion: 1 }], placement: { first: true } },
      actor: { kind: "agent", label: "cli" },
      idempotencyKey: undefined,
      readOnly: undefined,
      dryRun: undefined,
    },
  );
  for (const args of [
    {},
    { tasks: [{ id: "one", expectedVersion: 1 }], placement: { first: true, last: true } },
    { tasks: [{ id: "one", expectedVersion: 0 }], placement: { first: true } },
    { tasks: [{ id: "one", expectedVersion: 1 }, { id: "one", expectedVersion: 1 }], placement: { first: true } },
  ]) {
    assert.throws(() => parseTaskReorderArgs(args), (error: unknown) => error instanceof ProtocolError && error.code === "INVALID_REQUEST");
  }
});

test("protocol validates backend responses before the UI consumes them", () => {
  const response = parseResponse({
    version: 1,
    requestId: "response-1",
    ok: true,
    result: {
      databasePath: "/tmp/tasks.db",
      nodeVersion: "v24.19.0",
      sqliteVersion: "3.53.3",
      journalMode: "wal",
      fts5Enabled: true,
      searchMatches: 1,
      probeValue: "capture a task",
    },
  });

  assert.equal(response.ok, true);
  assert.equal(response.requestId, "response-1");
  assert.throws(
    () => parseResponse({ version: 1, requestId: "response-2", ok: true, result: null }),
    (error: unknown) => error instanceof ProtocolError && error.code === "INVALID_RESPONSE",
  );
  assert.throws(
    () => parseRuntimeProbeResult({}),
    (error: unknown) => error instanceof ProtocolError && error.code === "INVALID_RESPONSE",
  );
});

test("task result parsing rejects malformed successful list payloads", () => {
  const response = parseResponse({
    version: 1,
    requestId: "malformed-task-list",
    ok: true,
    result: {
      tasks: [{ id: "task-without-a-title" }],
      contextTasks: [],
      total: 1,
      limit: 50,
      offset: 0,
      workspaceRevision: 1,
    },
  });
  assert.equal(response.ok, true);
  if (!response.ok) throw new Error("Expected a successful response envelope");
  assert.throws(
    () => parseTaskCommandResult("task.list", response.result),
    (error: unknown) => error instanceof ProtocolError && error.code === "INVALID_RESPONSE",
  );
});

test("data paths are independent of the current working directory", () => {
  assert.equal(
    getDataDirectory({ XDG_DATA_HOME: "/tmp/example" }, "linux", "/home/user"),
    "/tmp/example/com.soleone.tasks",
  );
  assert.equal(
    getDatabasePath({ APPDATA: "C:\\Users\\user\\AppData\\Roaming" }, "win32", "/home/user"),
    path.win32.join("C:\\Users\\user\\AppData\\Roaming", "com.soleone.tasks", "tasks.db"),
  );
});
