import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { contentHash } from "../legacy/backend/requestHash.js";
import type { Response } from "../backend/protocol.js";
import type { CanonicalTask } from "../backend/taskModel.js";

const cli = fileURLToPath(new URL("../backend/cli.js", import.meta.url));
const humanCli = fileURLToPath(new URL("../backend/tasks-cli.js", import.meta.url));
const markdown = "## Notes Ω\r\n\r\n#not-a-tag @not-a-category\r\n```ts\r\nconst text = 'λ';\r\n```\r\n";
const expectedTimes = { createdAt: "2026-01-01T01:30:00.000Z", updatedAt: "2026-09-08T12:00:00.123Z" };
const terminalTime = "2026-09-09T03:00:00.120Z";
const expectedTasks: CanonicalTask[] = [
  { id: "done-root", title: "Ship", status: "done", priority: 1, parentId: null, dependencyIds: [], orderKey: "a0", category: "work", tags: ["alpha", "zoo"], description: markdown, ...expectedTimes, closedAt: terminalTime },
  { id: "Z_parent-7", title: "Retired  Ω `@code #literal`", status: "canceled", priority: 0, parentId: null, dependencyIds: [], orderKey: "a1", category: "home", tags: ["later"], description: markdown, ...expectedTimes, closedAt: terminalTime },
  { id: "a-root", title: "Plain  Ω", status: "open", priority: 4, parentId: null, dependencyIds: [], orderKey: "a2", category: null, tags: [], description: "", ...expectedTimes, closedAt: null },
  { id: "paused-child", title: "Paused", status: "paused", priority: 2, parentId: "Z_parent-7", dependencyIds: ["done-root"], orderKey: "a0", category: null, tags: [], description: markdown, ...expectedTimes, closedAt: null },
  { id: "canceled-child", title: "Canceled", status: "canceled", priority: 0, parentId: "Z_parent-7", dependencyIds: [], orderKey: "a1", category: null, tags: [], description: markdown, ...expectedTimes, closedAt: terminalTime },
  { id: "done-child", title: "Done", status: "done", priority: 4, parentId: "Z_parent-7", dependencyIds: ["a-root"], orderKey: "a2", category: null, tags: [], description: markdown, ...expectedTimes, closedAt: terminalTime },
  { id: "open-child", title: "Open", status: "open", priority: 3, parentId: "Z_parent-7", dependencyIds: ["done-child", "done-root"], orderKey: "a3", category: null, tags: [], description: markdown, ...expectedTimes, closedAt: null },
  { id: "grandchild", title: "Working", status: "in_progress", priority: 1, parentId: "paused-child", dependencyIds: ["a-root"], orderKey: "a0", category: null, tags: [], description: markdown, ...expectedTimes, closedAt: null },
];
const orders = [
  { parentId: null, taskIds: ["done-root", "Z_parent-7", "a-root"] },
  { parentId: "Z_parent-7", taskIds: ["paused-child", "canceled-child", "done-child", "open-child"] },
  { parentId: "paused-child", taskIds: ["grandchild"] },
  { parentId: "a-root", taskIds: [] },
];

function writeLegacyRecord(root: string, relativePath: string, record: object) {
  const unsigned = { ...record, sync: { revision: 41, modifiedBy: "disposable-legacy-writer", basedOnHash: null } };
  const signed = { ...unsigned, sync: { ...unsigned.sync, contentHash: contentHash(unsigned) } };
  writeFileSync(path.join(root, relativePath), `${JSON.stringify(signed, null, 2)}\n`);
}

function seedLegacyRoot(root: string) {
  mkdirSync(path.join(root, "tasks"), { recursive: true });
  mkdirSync(path.join(root, "order"));
  writeFileSync(path.join(root, "workspace.json"), '{"format":"tasks.workspace","formatVersion":1,"workspaceId":"disposable-rehearsal","schemaVersion":1}\n');
  for (const task of expectedTasks) {
    const title = task.id === "done-root" ? "Ship @WORK #Zoo #alpha #ZOO"
      : task.id === "Z_parent-7" ? "Retired  Ω `@code #literal` @Home #Later" : task.title;
    writeLegacyRecord(root, `tasks/${task.id}.json`, {
      format: "tasks.task", formatVersion: 1, workspaceId: "disposable-rehearsal",
      id: task.id, title, descriptionMarkdown: task.description, status: task.status, priority: task.priority,
      parentId: task.parentId, dependencyIds: [...task.dependencyIds].reverse(),
      createdAt: "2026-01-01T00:00:00-01:30", updatedAt: "2026-09-08T14:00:00.123000+02:00",
      completedAt: task.status === "done" ? "2026-09-08T23:00:00.12-04:00" : null,
      canceledAt: task.status === "canceled" ? "2026-09-09t03:00:00.120z" : null,
    });
  }
  for (const order of orders) writeLegacyRecord(root, `order/${order.parentId ?? "root"}.json`, {
    format: "tasks.sibling-order", formatVersion: 1, workspaceId: "disposable-rehearsal", ...order,
  });
}

function rawTree(root: string, prefix = ""): [string, string][] {
  return readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1).flatMap(entry => {
    const relativePath = `${prefix}${entry.name}`;
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? rawTree(file, `${relativePath}/`) : [[relativePath, readFileSync(file).toString("base64")]];
  });
}

function success(response: Response): Extract<Response, { ok: true }> {
  assert.equal(response.ok, true, JSON.stringify(response));
  if (!response.ok) throw Error("rehearsal command failed");
  return response;
}

function cacheCounts(cache: string) {
  const database = new DatabaseSync(cache, { readOnly: true });
  try {
    return ["v2_receipts", "v2_operations", "v2_undo_claims"].map(table => database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count);
  } finally {
    database.close();
  }
}

test("one-user migration rehearsal preserves a frozen eight-task snapshot and backup with fresh target authority", { skip: process.platform !== "linux" }, t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-migration-rehearsal-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, "frozen-v1");
  const backup = path.join(directory, "independent-backup");
  const destination = path.join(directory, "converted");
  const controlCache = path.join(directory, "control.db");
  const freshCache = path.join(directory, "fresh-target.db");
  const env = { ...process.env, XDG_DATA_HOME: path.join(directory, "profile"), TASKS_SYNC_ROOT: source, TASKS_SOURCE_REGISTRY_PATH: "", TASKS_DATABASE_PATH: path.join(directory, "legacy.db") };
  seedLegacyRoot(source);
  cpSync(source, backup, { recursive: true });
  const frozenBytes = rawTree(source);
  const legacy = spawnSync(process.execPath, [cli, "--stdio", "--database", env.TASKS_DATABASE_PATH], {
    input: JSON.stringify({ version: 1, requestId: "legacy-check", command: "task.list", args: { sort: "manual" } }), env, encoding: "utf8", timeout: 10_000,
  });
  assert.equal(legacy.status, 0, legacy.stderr);
  const legacyResult = JSON.parse(legacy.stdout);
  assert.equal(legacyResult.ok, true, legacy.stdout);
  assert.equal(legacyResult.result.total, 8);
  const legacyCacheBytes = readFileSync(env.TASKS_DATABASE_PATH);
  assert.deepEqual(rawTree(source), frozenBytes);
  const send = (root: string, cache: string, envelope: object): Response => {
    const child = spawnSync(process.execPath, [cli, "--stdio", "--v2-root", root, "--database", cache], {
      input: JSON.stringify({ version: 2, ...envelope }), env, encoding: "utf8", timeout: 10_000,
    });
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(child.stdout) as Response;
  };
  const control = success(send(source, controlCache, { command: "workspace.info" }));
  const request = { command: "workspace.migrateV1", writeContext: control.writeContext, idempotencyKey: "frozen-snapshot-once", args: { destinationDirectory: destination } };
  const preview = spawnSync(process.execPath, [humanCli, "--v2-root", source, "--database", controlCache, "--json", "--dry-run", "migrate-v1", destination], { env, encoding: "utf8", timeout: 10_000 });
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).taskCount, 8);
  assert.equal(existsSync(destination), false);
  assert.deepEqual(cacheCounts(controlCache), [0, 0, 0]);
  const converted = success(send(source, controlCache, request));
  assert.equal(converted.result.taskCount, 8);
  assert.equal(converted.result.selectionChanged, false);
  assert.deepEqual((converted.result.transformedIds as string[]).sort(), expectedTasks.map(task => task.id).sort());
  const convertedBytes = rawTree(destination);
  assert.deepEqual(convertedBytes.map(([file]) => file).sort(), ["workspace.json", ...expectedTasks.map(task => `tasks/${task.id}.json`)].sort());
  assert.equal(readFileSync(path.join(destination, "workspace.json"), "utf8"), '{"schemaVersion":2}\n');
  const tasks = expectedTasks.map(task => JSON.parse(readFileSync(path.join(destination, "tasks", `${task.id}.json`), "utf8")) as CanonicalTask);
  assert.deepEqual(tasks, expectedTasks);
  for (const order of orders) {
    const siblings = tasks.filter(task => task.parentId === order.parentId).sort((a, b) => a.orderKey < b.orderKey ? -1 : 1);
    assert.deepEqual(siblings.map(task => task.id), order.taskIds);
  }
  const recovery = JSON.parse(readFileSync(converted.result.recoveryLocation as string, "utf8"));
  assert.deepEqual(recovery.files.map((file: { relativePath: string; bytes: string }) => [file.relativePath, file.bytes]).sort(), [...frozenBytes].sort());
  assert.deepEqual(cacheCounts(controlCache), [1, 0, 0]);
  assert.deepEqual(success(send(source, controlCache, request)), converted);
  const target = success(send(destination, freshCache, { command: "workspace.info" }));
  assert.equal(target.result.state, "ready");
  assert.notEqual(target.writeContext, control.writeContext);
  assert.deepEqual(cacheCounts(freshCache), [0, 0, 0]);
  const observed = success(send(destination, freshCache, { command: "task.get", args: { id: "a-root" } }));
  const version = (observed.result.task as { version: number }).version;
  const stale = send(destination, freshCache, { command: "task.update", writeContext: control.writeContext, idempotencyKey: "old-authority", args: { id: "a-root", expectedVersion: version, title: "Must not write" } });
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.error.code, "STALE_WRITE_CONTEXT");
  assert.deepEqual(cacheCounts(freshCache), [0, 0, 0]);
  assert.deepEqual(rawTree(destination), convertedBytes);
  assert.deepEqual(rawTree(source), frozenBytes);
  assert.deepEqual(rawTree(backup), frozenBytes);
  assert.deepEqual(readFileSync(env.TASKS_DATABASE_PATH), legacyCacheBytes);
  assert.equal(success(send(source, controlCache, { command: "workspace.info" })).writeContext, control.writeContext);
});
