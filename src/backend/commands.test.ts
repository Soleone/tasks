import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { executeCommand } from "./commands.js";
import { getDataDirectory, getDatabasePath } from "./paths.js";
import { parseLine, parseRequest, ProtocolError } from "./protocol.js";

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

test("data paths are independent of the current working directory", () => {
  assert.equal(
    getDataDirectory({ XDG_DATA_HOME: "/tmp/example" }, "linux", "/home/user"),
    "/tmp/example/com.soleone.tasks",
  );
  assert.equal(
    getDatabasePath({ APPDATA: "C:\\Users\\user\\AppData\\Roaming" }, "win32", "/home/user"),
    path.join("C:\\Users\\user\\AppData\\Roaming", "com.soleone.tasks", "tasks.db"),
  );
});
