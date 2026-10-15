import assert from "node:assert/strict";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { TestContext } from "node:test";
import { createV2CopyTestWorkspace as setup } from "./copyTestWorkspace.js";
import type { V2CopyTestWorkspace as Workspace } from "./copyTestWorkspace.js";
import { readV2RootDescriptor } from "./canonicalReader.js";
import { executeV2Line } from "./gateway.js";
import { pendingV2Path } from "./localDomain.js";
import type { V2Response } from "./protocol.js";
import type { V2CanonicalTask } from "./taskModel.js";

const fixtures = fileURLToPath(new URL("../../scripts/fixtures/taskdb-v2/", import.meta.url));
type Case = { id: string; profile: string; given: { patch?: Record<string, unknown> }; action: { command?: string; args?: Record<string, unknown>; at?: string; commands?: string[]; statuses?: string[]; steps?: Record<string, unknown>[]; writeContext?: null }; expect: Record<string, unknown> };
const corpus = JSON.parse(readFileSync(path.join(fixtures, "cases.json"), "utf8")) as { taskTemplate: V2CanonicalTask; cases: Case[] };
const linuxOnly = { skip: process.platform !== "linux" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function send(workspace: Workspace, envelope: object): V2Response { return executeV2Line(Buffer.from(JSON.stringify({ version: 2, ...envelope })), workspace.root, workspace.cache); }
function success(response: V2Response): Extract<V2Response, { ok: true }> {
  assert.equal(response.ok, true, JSON.stringify(response));
  if (!response.ok) throw Error("failed");
  return response;
}
function fail(response: V2Response, code: string) { assert.equal(response.ok, false); if (!response.ok) assert.equal(response.error.code, code, JSON.stringify(response)); }
function materialize(t: TestContext, patch: Record<string, unknown> = {}) {
  const workspace = setup(t);
  for (const name of readdirSync(path.join(workspace.root, "tasks"))) rmSync(path.join(workspace.root, "tasks", name));
  writeFileSync(path.join(workspace.root, "tasks/a.json"), JSON.stringify({ ...corpus.taskTemplate, ...patch }));
  return workspace;
}
function prepared(workspace: Workspace, command: string, args: Record<string, unknown> = { title: "New" }) {
  const info = success(send(workspace, { command: "workspace.info" }));
  if (command !== "task.create") {
    const task = success(send(workspace, { command: "task.get", args: { id: args.id ?? "a" } })).result.task as { version: number };
    args = { ...args, expectedVersion: task.version };
  }
  return { command, args, writeContext: info.writeContext, idempotencyKey: "operation" };
}
function canonicalBytes(workspace: Workspace) {
  return ["workspace.json", ...readdirSync(path.join(workspace.root, "tasks")).sort().map(name => `tasks/${name}`)]
    .map(name => [name, readFileSync(path.join(workspace.root, name)).toString("base64")]);
}
function activity(workspace: Workspace) { return success(send(workspace, { command: "activity.list" })).result.activity as { operationId: string; command: string; createdAt: string; before: unknown; after: V2CanonicalTask }[]; }
function cacheRows(workspace: Workspace) {
  const db = new DatabaseSync(workspace.cache);
  try { return ["v2_query_state", "v2_query_tasks", "v2_receipts", "v2_operations"].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()); }
  finally { db.close(); }
}

for (const entry of corpus.cases.filter(entry => entry.profile === "inputs")) {
  test(`public task writer executes input corpus ${entry.id} without adapting command`, linuxOnly, (t) => {
    const workspace = materialize(t, entry.given.patch);
    const before = canonicalBytes(workspace);
    const request = prepared(workspace, entry.action.command!, entry.action.args!);
    const started = Date.now();
    const response = send(workspace, request);
    if (entry.expect.error) {
      fail(response, entry.expect.error as string);
      assert.deepEqual(canonicalBytes(workspace), before);
      assert.equal(cacheRows(workspace)[2].length, 0);
      return;
    }
    const result = success(response).result;
    const task = result.task as V2CanonicalTask & { version: number; blockedByIds: string[] };
    for (const [field, value] of Object.entries(entry.expect.fields as Record<string, unknown>)) assert.deepEqual(task[field as keyof V2CanonicalTask], value);
    if (entry.action.command === "task.create") {
      assert.match(task.id, uuid);
      assert.ok(Date.parse(task.createdAt) >= started && Date.parse(task.createdAt) <= Date.now());
      assert.equal(task.updatedAt, task.createdAt);
      assert.equal(task.closedAt, null);
      assert.equal(task.status, "open");
      assert.equal(task.priority, 2);
      assert.equal(task.orderKey, "Zz");
      assert.deepEqual(task.dependencyIds, []);
      assert.deepEqual(task.blockedByIds, []);
      assert.deepEqual(canonicalBytes(workspace).filter(([file]) => file === "workspace.json" || file === "tasks/a.json"), before);
    }
    const rows = activity(workspace);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].command, entry.action.command);
    assert.deepEqual(success(send(workspace, request)).result, result);
  });
}

const matrix = corpus.cases.find(entry => entry.id === "status-matrix")!;
for (const command of matrix.action.commands!) for (const status of matrix.action.statuses!) {
  test(`public status-matrix ${command} from ${status}`, linuxOnly, (t) => {
    const closedAt = status === "done" || status === "canceled" ? "2026-09-08T14:00:00.000Z" : null;
    const workspace = materialize(t, { status, closedAt });
    const request = prepared(workspace, `task.${command}`, { id: "a" });
    const before = success(send(workspace, { command: "task.get", args: { id: "a" } })).result.task as V2CanonicalTask & { version: number };
    const bytes = canonicalBytes(workspace);
    const response = send(workspace, request);
    const allowed = (matrix.expect.allowed as Record<string, string[]>)[command].includes(status);
    if (!allowed) {
      fail(response, matrix.expect.forbiddenError as string);
      assert.deepEqual(canonicalBytes(workspace), bytes);
      assert.equal(activity(workspace).length, 0);
      assert.equal(cacheRows(workspace)[2].length, 0);
      return;
    }
    const result = success(response).result;
    const after = result.task as V2CanonicalTask & { version: number };
    const target = (matrix.expect.targets as Record<string, string>)[command];
    assert.equal(after.status, target);
    const changed = status !== target;
    assert.equal(result.changed, changed);
    assert.equal(after.createdAt, before.createdAt);
    assert.equal(after.updatedAt, before.updatedAt);
    assert.equal(after.orderKey, before.orderKey);
    assert.equal(after.version !== before.version, changed);
    assert.equal(activity(workspace).length, changed ? 1 : 0);
    if (!changed) { assert.deepEqual(canonicalBytes(workspace), bytes); assert.equal(after.closedAt, closedAt); }
    else {
      const row = activity(workspace)[0];
      assert.equal(row.command, `task.${command}`);
      assert.equal(after.closedAt, target === "done" || target === "canceled" ? row.createdAt : null);
    }
    assert.deepEqual(success(send(workspace, request)).result, result);
    assert.equal(existsSync(path.join(workspace.root, "tasks/a.json")), true);
  });
}

for (const id of ["time-complete", "time-noop", "time-edit-closed"]) {
  test(`public task writer executes ${id} with an observed operation-time binding`, linuxOnly, (t) => {
    const entry = corpus.cases.find(entry => entry.id === id)!;
    const workspace = materialize(t, entry.given.patch);
    const request = prepared(workspace, entry.action.command!, entry.action.args!);
    const bytes = canonicalBytes(workspace);
    const started = Date.now();
    const result = success(send(workspace, request)).result;
    const task = result.task as V2CanonicalTask & { version: number };
    const rows = activity(workspace);
    const boundAt = rows[0]?.createdAt;
    if (boundAt) assert.ok(Date.parse(boundAt) >= started && Date.parse(boundAt) <= Date.now());
    for (const [field, value] of Object.entries(entry.expect.fields as Record<string, unknown>)) assert.equal(task[field as keyof V2CanonicalTask], value === entry.action.at ? boundAt : value);
    if (entry.expect.versionChanged !== undefined) assert.equal(task.version !== request.args.expectedVersion, entry.expect.versionChanged);
    if (entry.expect.activityGroups !== undefined) assert.equal(rows.length, entry.expect.activityGroups);
    if (entry.expect.canonicalWrites === 0) assert.deepEqual(canonicalBytes(workspace), bytes);
  });
}

for (const id of ["context-required", "context-loss", "context-root-switch", "receipt-replay", "receipt-changed", "receipt-actor", "noop-receipt", "restore-cache-authority"]) {
  test(`public task writer materializes protocol ${id}`, linuxOnly, (t) => {
    const entry = corpus.cases.find(entry => entry.id === id)!;
    const workspace = id === "restore-cache-authority" ? setup(t) : materialize(t, entry.given.patch);
    const steps = entry.action.steps ?? [];
    const first = steps[0] ?? {};
    if (id === "context-required") {
      const request = prepared(workspace, entry.action.command!, entry.action.args!);
      const bytes = canonicalBytes(workspace);
      fail(send(workspace, { ...request, writeContext: undefined }), entry.expect.error as string);
      assert.deepEqual(canonicalBytes(workspace), bytes);
      return;
    }
    if (id === "context-root-switch" || id === "restore-cache-authority") {
      const context = success(send(workspace, { command: "workspace.info" })).writeContext;
      const root = path.join(workspace.directory, "other-root");
      if (id === "restore-cache-authority") success(send(workspace, { command: "workspace.restore", args: { sourceDirectory: workspace.root, destinationDirectory: root }, writeContext: context, idempotencyKey: "restore" }));
      else cpSync(workspace.root, root, { recursive: true });
      const selected = { ...workspace, root };
      success(send(selected, { command: "workspace.info" }));
      const bytes = canonicalBytes(selected);
      const last = steps.at(-1)!;
      fail(send(selected, { command: last.command, args: { title: last.title }, writeContext: context, idempotencyKey: "wrong-root" }), entry.expect.error as string);
      assert.deepEqual(canonicalBytes(selected), bytes);
      return;
    }
    const command = first.command as string;
    const args = command === "task.create" ? { title: first.title } : { id: first.id, priority: first.priority };
    const request = { ...prepared(workspace, command, args), idempotencyKey: first.key, ...(first.actor ? { actor: first.actor } : {}) };
    const original = success(send(workspace, request));
    const bytes = canonicalBytes(workspace);
    if (id === "context-loss") {
      rmSync(workspace.cache);
      success(send(workspace, { command: "workspace.info" }));
      fail(send(workspace, request), entry.expect.error as string);
    } else if (id === "receipt-changed") {
      fail(send(workspace, { ...request, args: { title: steps[1].title } }), entry.expect.error as string);
    } else if (id === "receipt-actor") {
      fail(send(workspace, { ...request, actor: steps[1].actor }), entry.expect.error as string);
    } else {
      assert.deepEqual(success(send(workspace, { ...request, requestId: steps[1].requestId })).result, original.result);
      if (entry.expect.changed !== undefined) assert.equal(original.result.changed, entry.expect.changed);
      if (entry.expect.activityGroups !== undefined) assert.equal(activity(workspace).length, entry.expect.activityGroups);
      if (entry.expect.receiptCount !== undefined) assert.equal(cacheRows(workspace)[2].length, entry.expect.receiptCount);
    }
    assert.deepEqual(canonicalBytes(workspace), bytes);
    if (entry.expect.newTaskCount !== undefined) assert.equal(readdirSync(path.join(workspace.root, "tasks")).length - 1, entry.expect.newTaskCount);
  });
}

test("capture preserves full Markdown/defaults, prepends complete scopes and rejects missing/canceled parents without consuming keys", linuxOnly, (t) => {
  const workspace = materialize(t);
  const request = prepared(workspace, "task.create", { title: "Child", parentId: "missing" });
  fail(send(workspace, request), "INVALID_PARENT");
  const note = "## Notes\r\n\n@not-a-category #not-a-tag\n```js\nconst x = 1;\n```";
  const first = success(send(workspace, { ...request, args: { title: " Child ", parentId: "a", description: note, priority: 0 } })).result.task as V2CanonicalTask;
  assert.equal(first.parentId, "a");
  assert.equal(first.orderKey, "a0");
  assert.equal(first.description, note);
  assert.equal(first.category, null);
  const next = success(send(workspace, { ...prepared(workspace, "task.create", { text: "Second @Work #B #a", parentId: "a" }), idempotencyKey: "second" })).result.task as V2CanonicalTask;
  assert.equal(next.orderKey, "Zz");
  const canceled = success(send(workspace, { ...prepared(workspace, "task.delete", { id: "a" }), idempotencyKey: "cancel-parent" }));
  assert.equal((canceled.result.task as V2CanonicalTask).status, "canceled");
  const rejected = { ...prepared(workspace, "task.create", { title: "Not under canceled", parentId: "a" }), idempotencyKey: "new-child" };
  fail(send(workspace, rejected), "INVALID_PARENT");
  success(send(workspace, { ...prepared(workspace, "task.reopen", { id: "a" }), idempotencyKey: "reopen-parent" }));
  success(send(workspace, rejected));
  assert.equal(first.title, "Child");
});

test("capture first placement includes hidden/canceled equal-key siblings without rewriting any of them", linuxOnly, (t) => {
  const workspace = materialize(t, { status: "canceled", closedAt: corpus.taskTemplate.createdAt });
  writeFileSync(path.join(workspace.root, "tasks/b.json"), JSON.stringify({ ...corpus.taskTemplate, id: "b", status: "paused" }));
  const before = canonicalBytes(workspace);
  const result = success(send(workspace, prepared(workspace, "task.create"))).result;
  assert.equal((result.task as V2CanonicalTask).orderKey, "Zz");
  assert.deepEqual(canonicalBytes(workspace).filter(([file]) => file === "workspace.json" || file === "tasks/a.json" || file === "tasks/b.json"), before);
  const manual = success(send(workspace, { command: "task.list", args: { sort: "manual", status: ["open", "paused", "canceled"] } })).result.tasks as V2CanonicalTask[];
  assert.deepEqual(manual.map(task => task.id), [(result.task as V2CanonicalTask).id, "a", "b"]);
});

test("capture rejects forbidden fields/text boundaries and key exhaustion before staging or canonical effects", linuxOnly, (t) => {
  const workspace = materialize(t);
  const request = prepared(workspace, "task.create");
  const before = canonicalBytes(workspace);
  for (const args of [{}, { title: "" }, { title: "x", text: "x" }, { title: "x", id: "caller" }, { title: "x", status: "done" }, { title: "x", dependencyIds: [] }, { title: "x", orderKey: "a0" }, { title: "x", createdAt: "now" }, { title: "x", descriptionMarkdown: "old" }, { title: "x", parentId: 1 }, { title: "x", expectedVersion: 1 }, { title: "x".repeat(1001) }, { title: "x", description: "x".repeat(10001) }, { title: "x", tags: ["#marked"] }]) {
    fail(send(workspace, { ...request, args }), "INVALID_ARGUMENT");
    assert.deepEqual(canonicalBytes(workspace), before);
  }
  fail(send(workspace, { ...request, args: { title: "\uD800" } }), "INVALID_REQUEST");
  assert.deepEqual(canonicalBytes(workspace), before);
  const key = `A${"0".repeat(26)}${"0".repeat(228)}1`;
  writeFileSync(path.join(workspace.root, "tasks/a.json"), JSON.stringify({ ...corpus.taskTemplate, orderKey: key }));
  const longBytes = canonicalBytes(workspace);
  fail(send(workspace, request), "ORDER_KEY_LIMIT");
  assert.deepEqual(canonicalBytes(workspace), longBytes);
  assert.equal(existsSync(pendingV2Path(readV2RootDescriptor(workspace.root))), false);
});

test("capture/status previews preserve cache/bytes/history and do not reserve preview IDs or keys", linuxOnly, (t) => {
  const workspace = materialize(t);
  const create = prepared(workspace, "task.create");
  const complete = { ...prepared(workspace, "task.complete", { id: "a" }), idempotencyKey: "status" };
  const rows = cacheRows(workspace);
  const bytes = canonicalBytes(workspace);
  let previewId = "";
  for (const request of [create, complete]) for (const flags of [{ dryRun: true }, { readOnly: true }]) {
    const preview = success(send(workspace, { ...request, ...flags, idempotencyKey: undefined }));
    const withKey = success(send(workspace, { ...request, ...flags }));
    assert.equal(withKey.result.changed, true);
    assert.deepEqual(cacheRows(workspace), rows);
    assert.deepEqual(canonicalBytes(workspace), bytes);
    if (request === create) { previewId = (preview.result.task as V2CanonicalTask).id; assert.match(previewId, uuid); fail(send(workspace, { command: "task.get", args: { id: previewId } }), "TASK_NOT_FOUND"); }
  }
  const created = success(send(workspace, create));
  assert.notEqual((created.result.task as V2CanonicalTask).id, previewId);
  fail(send(workspace, { ...create, dryRun: true }), "IDEMPOTENCY_KEY_REUSED");
  const freshComplete = prepared(workspace, complete.command, { id: "a" });
  success(send(workspace, { ...freshComplete, idempotencyKey: complete.idempotencyKey }));
});

test("status preserves relationship/order bytes, never cascades, and done still blocks while canceled does not", linuxOnly, (t) => {
  const workspace = materialize(t);
  writeFileSync(path.join(workspace.root, "tasks/child.json"), JSON.stringify({ ...corpus.taskTemplate, id: "child", parentId: "a", dependencyIds: ["a"] }));
  const child = readFileSync(path.join(workspace.root, "tasks/child.json"));
  const completed = success(send(workspace, prepared(workspace, "task.complete", { id: "a" })));
  assert.deepEqual((success(send(workspace, { command: "task.get", args: { id: "child" } })).result.task as { blockedByIds: string[] }).blockedByIds, ["a"]);
  const canceled = success(send(workspace, { ...prepared(workspace, "task.delete", { id: "a" }), idempotencyKey: "delete-done" }));
  assert.equal((canceled.result.task as V2CanonicalTask).status, "canceled");
  assert.equal((canceled.result.task as V2CanonicalTask).updatedAt, (completed.result.task as V2CanonicalTask).updatedAt);
  assert.deepEqual((success(send(workspace, { command: "task.get", args: { id: "child" } })).result.task as { blockedByIds: string[] }).blockedByIds, []);
  assert.deepEqual(readFileSync(path.join(workspace.root, "tasks/child.json")), child);
});

for (const command of ["task.create", "task.complete"]) {
  test(`${command} context/key/shape/staleness guards and historical replay precede live task existence`, linuxOnly, (t) => {
    const workspace = materialize(t);
    const request = prepared(workspace, command, command === "task.create" ? { title: "New" } : { id: "a" });
    fail(send(workspace, { ...request, writeContext: undefined }), "WRITE_CONTEXT_REQUIRED");
    fail(send(workspace, { ...request, writeContext: "old" }), "STALE_WRITE_CONTEXT");
    fail(send(workspace, { ...request, idempotencyKey: undefined }), "IDEMPOTENCY_REQUIRED");
    if (command !== "task.create") {
      fail(send(workspace, { ...request, args: { id: "a" } }), "EXPECTED_VERSION_REQUIRED");
      fail(send(workspace, { ...request, args: { id: "a", expectedVersion: 0 } }), "EXPECTED_VERSION_REQUIRED");
      fail(send(workspace, { ...request, args: { ...request.args, status: "done" } }), "INVALID_ARGUMENT");
      fail(send(workspace, { ...request, args: { ...request.args, expectedVersion: 123456 } }), "STALE_TASK_VERSION");
    }
    const first = success(send(workspace, request));
    const task = first.result.task as V2CanonicalTask;
    rmSync(path.join(workspace.root, "tasks", `${task.id}.json`));
    assert.deepEqual(success(send(workspace, request)).result, first.result);
    assert.equal(existsSync(path.join(workspace.root, "tasks", `${task.id}.json`)), false);
    fail(send(workspace, { ...request, actor: { kind: "human", label: "Other" } }), "IDEMPOTENCY_KEY_REUSED");
    const copied = { ...workspace, cache: path.join(workspace.directory, "copied.db") };
    cpSync(workspace.cache, copied.cache);
    success(send(copied, { command: "workspace.info" }));
    fail(send(copied, request), "STALE_WRITE_CONTEXT");
  });
}

test("capture/status refuse malformed graphs and descriptor conflicts without consuming their keys", linuxOnly, (t) => {
  const workspace = materialize(t);
  const create = prepared(workspace, "task.create");
  const status = { ...prepared(workspace, "task.complete", { id: "a" }), idempotencyKey: "status" };
  writeFileSync(path.join(workspace.root, "tasks/a.json"), JSON.stringify({ ...corpus.taskTemplate, parentId: "missing" }));
  for (const request of [create, status]) fail(send(workspace, request), "INVALID_CANONICAL");
  writeFileSync(path.join(workspace.root, "tasks/a.json"), JSON.stringify(corpus.taskTemplate));
  writeFileSync(path.join(workspace.root, "workspace.sync-conflict-peer.json"), '{"schemaVersion":1}');
  for (const request of [create, status]) fail(send(workspace, request), "INVALID_CANONICAL");
  assert.equal(cacheRows(workspace)[2].length, 0);
});

for (const command of ["task.create", "task.complete"]) {
  test(`${command} refuses near-exhausted counter/revision before canonical staging`, linuxOnly, (t) => {
    const workspace = materialize(t);
    const request = prepared(workspace, command, command === "task.create" ? { title: "New" } : { id: "a" });
    const db = new DatabaseSync(workspace.cache);
    db.prepare("UPDATE v2_query_state SET counter = ?, revision = ?").run(Number.MAX_SAFE_INTEGER - 2, Number.MAX_SAFE_INTEGER - 1);
    db.close();
    const rows = cacheRows(workspace);
    const bytes = canonicalBytes(workspace);
    fail(send(workspace, request), "UNSUPPORTED_COMMAND");
    assert.deepEqual(cacheRows(workspace), rows);
    assert.deepEqual(canonicalBytes(workspace), bytes);
    assert.equal(existsSync(pendingV2Path(readV2RootDescriptor(workspace.root))), false);
  });
}
