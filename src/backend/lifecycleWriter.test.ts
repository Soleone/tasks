import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { TestContext } from "node:test";
import { createV2CopyTestWorkspace as setup } from "./copyTestWorkspace.js";
import type { V2CopyTestWorkspace as Workspace } from "./copyTestWorkspace.js";
import { readV2PhysicalRoot } from "./canonicalReader.js";
import { executeV2Line } from "./gateway.js";
import { pendingV2Path } from "./localDomain.js";
import type { V2Response } from "./protocol.js";

const fixtures = fileURLToPath(new URL("../../scripts/fixtures/taskdb-v2/", import.meta.url));
const corpus = JSON.parse(readFileSync(path.join(fixtures, "cases.json"), "utf8")) as {
  taskTemplate: Record<string, unknown>; cases: { id: string; action: { command?: string; args?: object; steps?: Record<string, unknown>[] }; expect: Record<string, unknown> }[];
};
const id = "c8d4206d-c25a-4317-baa4-a2c5443060e9";
const linuxOnly = { skip: process.platform !== "linux" };
function send(workspace: Workspace, envelope: object): V2Response { return executeV2Line(Buffer.from(JSON.stringify({ version: 2, ...envelope })), workspace.root, workspace.cache); }
function success(response: V2Response): Extract<V2Response, { ok: true }> {
  assert.equal(response.ok, true, JSON.stringify(response));
  if (!response.ok) throw Error("failed");
  return response;
}
function fail(response: V2Response, code: string) { assert.equal(response.ok, false); if (!response.ok) assert.equal(response.error.code, code, JSON.stringify(response)); }
function emptyWorkspace(t: TestContext) {
  const workspace = setup(t);
  for (const name of readdirSync(workspace.root)) rmSync(path.join(workspace.root, name), { recursive: true });
  return workspace;
}
function prepared(workspace: Workspace, command: string) {
  return { command, args: {}, writeContext: success(send(workspace, { command: "workspace.info" })).writeContext, idempotencyKey: command };
}
function rawCanonical(root: string) {
  return ["workspace.json", ...readdirSync(path.join(root, "tasks")).sort().map(name => `tasks/${name}`)]
    .map(name => [name, readFileSync(path.join(root, name)).toString("base64")]);
}
function cacheRows(workspace: Workspace) {
  const db = new DatabaseSync(workspace.cache);
  try { return ["v2_query_state", "v2_query_tasks", "v2_receipts", "v2_operations"].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()); }
  finally { db.close(); }
}

test("public workspace.init executes root-empty corpus with exact descriptor and zero tasks", linuxOnly, (t) => {
  const entry = corpus.cases.find(entry => entry.id === "root-empty")!;
  const workspace = emptyWorkspace(t);
  const info = success(send(workspace, { command: "workspace.info" }));
  assert.equal(info.result.state, "empty");
  assert.deepEqual(readdirSync(workspace.root), []);
  const request = { ...prepared(workspace, entry.action.command!), args: entry.action.args };
  const initialized = success(send(workspace, request));
  assert.deepEqual(initialized.result, { schemaVersion: 2, changed: true });
  assert.equal(readFileSync(path.join(workspace.root, "workspace.json"), "utf8"), entry.expect.manifestBytes);
  assert.equal(success(send(workspace, { command: "task.list" })).result.total, entry.expect.taskCount);
  assert.deepEqual(readdirSync(workspace.root).sort(), ["tasks", "workspace.json"]);
  assert.deepEqual(success(send(workspace, request)).result, initialized.result);
  assert.equal(existsSync(pendingV2Path(readV2PhysicalRoot(workspace.root))), false);
  assert.deepEqual(success(send(workspace, { command: "activity.list" })).result.activity, []);
});

test("init permits existing empty tasks and physical transport history, preserving their bytes", linuxOnly, (t) => {
  const workspace = emptyWorkspace(t);
  mkdirSync(path.join(workspace.root, "tasks"));
  mkdirSync(path.join(workspace.root, ".stfolder"));
  mkdirSync(path.join(workspace.root, ".stversions"));
  writeFileSync(path.join(workspace.root, ".stversions/old.json"), "retained transport history, not canonical data");
  writeFileSync(path.join(workspace.root, ".stignore"), "// keep these rules\n");
  const request = prepared(workspace, "workspace.init");
  success(send(workspace, request));
  assert.equal(readFileSync(path.join(workspace.root, ".stignore"), "utf8"), "// keep these rules\n");
  assert.equal(readFileSync(path.join(workspace.root, ".stversions/old.json"), "utf8"), "retained transport history, not canonical data");
  assert.equal(success(send(workspace, { command: "task.list" })).result.total, 0);
});

for (const fault of ["foreign-file", "foreign-directory", "missing-manifest-records", "task-transfer", "root-transfer", "task-symlink", "marker-symlink", "descriptor-symlink", "legacy", "unsupported", "partial", "ready", "descriptor-conflict"]) {
  test(`init never reinterprets or overwrites ${fault}`, linuxOnly, (t) => {
    const workspace = emptyWorkspace(t);
    const request = prepared(workspace, "workspace.init");
    const root = workspace.root;
    if (fault === "foreign-file") writeFileSync(path.join(root, "keep.txt"), "keep");
    if (fault === "foreign-directory") mkdirSync(path.join(root, "foreign"));
    if (["missing-manifest-records", "task-transfer"].includes(fault)) {
      mkdirSync(path.join(root, "tasks"));
      writeFileSync(path.join(root, "tasks", fault === "task-transfer" ? ".syncthing.transfer.tmp" : "old.json"), "preserve partial or old record");
    }
    if (fault === "root-transfer") writeFileSync(path.join(root, ".syncthing.transfer.tmp"), "partial descriptor");
    if (["task-symlink", "marker-symlink", "descriptor-symlink"].includes(fault)) {
      const outside = path.join(workspace.directory, "outside");
      mkdirSync(outside);
      writeFileSync(path.join(outside, "workspace.json"), '{"schemaVersion":2}\n');
      symlinkSync(fault === "descriptor-symlink" ? path.join(outside, "workspace.json") : outside, path.join(root, fault === "task-symlink" ? "tasks" : fault === "marker-symlink" ? ".stfolder" : "workspace.json"));
    }
    if (fault === "legacy" || fault === "unsupported" || fault === "partial") writeFileSync(path.join(root, "workspace.json"), fault === "partial" ? "{" : JSON.stringify({ schemaVersion: fault === "legacy" ? 1 : 3 }));
    if (fault === "ready") cpSync(path.join(fixtures, "root"), root, { recursive: true });
    if (fault === "descriptor-conflict") writeFileSync(path.join(root, "workspace.sync-conflict-peer.json"), '{"schemaVersion":1}');
    const before = readdirSync(root).sort();
    const response = send(workspace, request);
    assert.equal(response.ok, false, JSON.stringify(response));
    if (fault === "legacy" || fault === "unsupported") fail(response, "UNSUPPORTED_SCHEMA");
    assert.deepEqual(readdirSync(root).sort(), before);
    assert.equal(existsSync(pendingV2Path(readV2PhysicalRoot(root))), false);
    assert.equal(cacheRows(workspace)[2].length, 0);
  });
}

test("init root aliases resolve to one physical authority; missing/file roots and unsafe cache locations refuse", linuxOnly, (t) => {
  const workspace = emptyWorkspace(t);
  const request = prepared(workspace, "workspace.init");
  const alias = path.join(workspace.directory, "alias");
  symlinkSync(workspace.root, alias);
  assert.equal(success(send({ ...workspace, root: alias }, { command: "workspace.info" })).writeContext, request.writeContext);
  success(send({ ...workspace, root: alias }, request));
  assert.deepEqual(success(send(workspace, request)).result, { schemaVersion: 2, changed: true });
  fail(send({ ...workspace, root: path.join(workspace.directory, "missing") }, request), "INVALID_STORAGE");
  fail(send({ ...workspace, root: path.join(workspace.root, "workspace.json") }, request), "INVALID_CANONICAL");
  fail(send({ ...workspace, cache: path.join(workspace.root, "cache.db") }, request), "INVALID_STORAGE");
  assert.equal(existsSync(path.join(workspace.root, "cache.db")), false);
});

for (const command of ["workspace.init", "workspace.rebuild"]) {
  test(`${command} validates context/key/shape and previews consume no key or canonical effects`, linuxOnly, (t) => {
    const workspace = command === "workspace.init" ? emptyWorkspace(t) : setup(t);
    const request = prepared(workspace, command);
    fail(send(workspace, { ...request, writeContext: undefined }), "WRITE_CONTEXT_REQUIRED");
    fail(send(workspace, { ...request, writeContext: "lost" }), "STALE_WRITE_CONTEXT");
    fail(send(workspace, { ...request, idempotencyKey: undefined }), "IDEMPOTENCY_REQUIRED");
    fail(send(workspace, { ...request, args: { preserveSQLite: true } }), "INVALID_ARGUMENT");
    const before = cacheRows(workspace);
    const bytes = command === "workspace.init" ? [] : rawCanonical(workspace.root);
    for (const flags of [{ dryRun: true }, { readOnly: true }]) {
      success(send(workspace, { ...request, ...flags, idempotencyKey: undefined }));
      success(send(workspace, { ...request, ...flags }));
      assert.deepEqual(cacheRows(workspace), before);
      if (command === "workspace.init") assert.deepEqual(readdirSync(workspace.root), []);
      else assert.deepEqual(rawCanonical(workspace.root), bytes);
    }
    const first = success(send(workspace, request));
    fail(send(workspace, { ...request, dryRun: true }), "IDEMPOTENCY_KEY_REUSED");
    fail(send(workspace, { ...request, actor: { kind: "human", label: "Other" } }), "IDEMPOTENCY_KEY_REUSED");
    assert.deepEqual(success(send(workspace, { ...request, requestId: "different" })).result, first.result);
    writeFileSync(path.join(workspace.root, "tasks/unknown.txt"), "keep unrelated later content");
    assert.deepEqual(success(send(workspace, request)).result, first.result);
    assert.equal(readFileSync(path.join(workspace.root, "tasks/unknown.txt"), "utf8"), "keep unrelated later content");
  });
}

test("public workspace.rebuild materializes receipt-rebuild: same context/receipt/history, fresh task tokens", linuxOnly, (t) => {
  const entry = corpus.cases.find(entry => entry.id === "receipt-rebuild")!;
  const workspace = setup(t);
  // Materialize the symbolic fixture ID from the independent template, not a production converter.
  for (const name of readdirSync(path.join(workspace.root, "tasks"))) rmSync(path.join(workspace.root, "tasks", name));
  writeFileSync(path.join(workspace.root, "tasks/a.json"), JSON.stringify({ ...corpus.taskTemplate, id: "a" }));
  const [edit, rebuild, repeat] = entry.action.steps!;
  assert.equal(rebuild.preserveSQLite, true);
  assert.equal(repeat.repeat, "first");
  const task = success(send(workspace, { command: "task.get", args: { id: edit.id } }));
  const request = { command: edit.command, writeContext: task.writeContext, idempotencyKey: edit.key, args: { id: edit.id, title: edit.title, expectedVersion: (task.result.task as { version: number }).version } };
  const first = success(send(workspace, request));
  const bytes = rawCanonical(workspace.root);
  const rebuilt = success(send(workspace, { command: rebuild.command, writeContext: first.writeContext, idempotencyKey: "rebuild" }));
  assert.equal(rebuilt.writeContext, first.writeContext);
  assert.equal(rebuilt.result.taskCount, 1);
  const replay = success(send(workspace, request));
  assert.deepEqual(replay.result, first.result);
  const current = success(send(workspace, { command: "task.get", args: { id: edit.id } })).result.task as { version: number };
  assert.ok(current.version > (replay.result.task as { version: number }).version);
  const activity = success(send(workspace, { command: "activity.list" })).result.activity as { operationId: string }[];
  assert.equal(activity.filter(row => row.operationId === first.result.operationId).length, entry.expect.activityGroupsForFirst);
  assert.deepEqual(rawCanonical(workspace.root), bytes);
  fail(send(workspace, { ...request, idempotencyKey: "new-intent" }), "STALE_TASK_VERSION");
  assert.deepEqual(entry.expect, { sameHistoricalResult: true, currentVersionDiffersFromReplayed: true, activityGroupsForFirst: 1 });
});

test("rebuild advances every token/revision once, replay is historical, and full cache loss rejects old authority", linuxOnly, (t) => {
  const workspace = setup(t);
  const old = success(send(workspace, { command: "task.list" }));
  const bytes = rawCanonical(workspace.root);
  const request = prepared(workspace, "workspace.rebuild");
  const first = success(send(workspace, request));
  const current = success(send(workspace, { command: "task.list" }));
  const oldVersions = new Map((old.result.tasks as { id: string; version: number }[]).map(task => [task.id, task.version]));
  for (const task of current.result.tasks as { id: string; version: number }[]) assert.ok(task.version > oldVersions.get(task.id)!);
  assert.ok((first.result.workspaceRevision as number) > (old.result.workspaceRevision as number));
  assert.deepEqual(success(send(workspace, request)).result, first.result);
  assert.deepEqual(success(send(workspace, { command: "task.list" })), current);
  rmSync(workspace.cache);
  const fresh = success(send(workspace, { command: "workspace.info" }));
  assert.notEqual(fresh.writeContext, first.writeContext);
  fail(send(workspace, request), "STALE_WRITE_CONTEXT");
  success(send(workspace, { ...request, writeContext: fresh.writeContext, idempotencyKey: "explicit-fresh" }));
  assert.deepEqual(rawCanonical(workspace.root), bytes);
});

for (const fault of ["partial-record", "missing-manifest", "legacy-order", "unsupported", "descriptor-conflict", "task-escape", "stem-mismatch", "unknown-task", "graph-hole"]) {
  test(`rebuild refuses ${fault} without deleting the last projection, receipts or history`, linuxOnly, (t) => {
    const workspace = setup(t);
    const request = prepared(workspace, "workspace.rebuild");
    const before = cacheRows(workspace);
    const file = path.join(workspace.root, "tasks", `${id}.json`);
    if (fault === "partial-record") writeFileSync(file, "{");
    if (fault === "missing-manifest") rmSync(path.join(workspace.root, "workspace.json"));
    if (fault === "legacy-order") { mkdirSync(path.join(workspace.root, "order")); writeFileSync(path.join(workspace.root, "order/root.json"), "{}"); }
    if (fault === "unsupported") writeFileSync(path.join(workspace.root, "workspace.json"), '{"schemaVersion":3}');
    if (fault === "descriptor-conflict") writeFileSync(path.join(workspace.root, "workspace.sync-conflict-peer.json"), '{"schemaVersion":1}');
    if (fault === "task-escape") { cpSync(file, path.join(workspace.directory, "outside.json")); rmSync(file); symlinkSync(path.join(workspace.directory, "outside.json"), file); }
    if (fault === "stem-mismatch" || fault === "graph-hole") {
      const task = JSON.parse(readFileSync(file, "utf8"));
      if (fault === "stem-mismatch") task.id = "other"; else task.parentId = "missing";
      writeFileSync(file, JSON.stringify(task));
    }
    if (fault === "unknown-task") writeFileSync(path.join(workspace.root, "tasks/unknown.txt"), "keep");
    const failed = send(workspace, request);
    assert.equal(failed.ok, false);
    assert.deepEqual(cacheRows(workspace), before);
    assert.equal(existsSync(pendingV2Path(readV2PhysicalRoot(workspace.root))), false);
  });
}

test("rebuild removes absent projection rows without resurrecting files or importing a foreign/v1 cache", linuxOnly, (t) => {
  const workspace = setup(t);
  const request = prepared(workspace, "workspace.rebuild");
  // Remove the complete child/parent linked subgraph, leaving a valid two-task root.
  rmSync(path.join(workspace.root, "tasks", `${id}.json`));
  rmSync(path.join(workspace.root, "tasks/6e1bf023-da3c-4785-b8a9-a696ac1fa5c1.json"));
  const bytes = rawCanonical(workspace.root);
  assert.equal(success(send(workspace, request)).result.taskCount, 2);
  assert.equal(cacheRows(workspace)[1].length, 2);
  assert.deepEqual(rawCanonical(workspace.root), bytes);
  const foreign = path.join(workspace.directory, "foreign.db");
  const db = new DatabaseSync(foreign);
  db.exec("CREATE TABLE tasks(id TEXT); INSERT INTO tasks VALUES('old')");
  db.close();
  fail(send({ ...workspace, cache: foreign }, request), "INVALID_STORAGE");
  assert.deepEqual(rawCanonical(workspace.root), bytes);
});

for (const command of ["workspace.init", "workspace.rebuild"]) {
  test(`${command} refuses near-exhausted authority before effects`, linuxOnly, (t) => {
    const workspace = command === "workspace.init" ? emptyWorkspace(t) : setup(t);
    const request = prepared(workspace, command);
    const db = new DatabaseSync(workspace.cache);
    db.prepare("UPDATE v2_query_state SET counter = ?, revision = ?").run(Number.MAX_SAFE_INTEGER - 2, Number.MAX_SAFE_INTEGER - 1);
    db.close();
    const before = cacheRows(workspace);
    const names = readdirSync(workspace.root).sort();
    fail(send(workspace, request), "UNSUPPORTED_COMMAND");
    assert.deepEqual(cacheRows(workspace), before);
    assert.deepEqual(readdirSync(workspace.root).sort(), names);
    assert.equal(existsSync(pendingV2Path(readV2PhysicalRoot(workspace.root))), false);
  });
}

test("rebuild refuses actual unreadable enumeration without deleting last-good cache", { skip: process.platform !== "linux" || process.getuid?.() === 0 }, (t) => {
  const workspace = setup(t);
  const request = prepared(workspace, "workspace.rebuild");
  const before = cacheRows(workspace);
  const tasks = path.join(workspace.root, "tasks");
  chmodSync(tasks, 0);
  try { fail(send(workspace, request), "INVALID_STORAGE"); assert.deepEqual(cacheRows(workspace), before); }
  finally { chmodSync(tasks, 0o700); }
  success(send(workspace, request));
});
