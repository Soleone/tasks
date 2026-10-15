import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
import { V2_RELATIONSHIP_COMMANDS } from "./taskRelationships.js";

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL("../../scripts/fixtures/taskdb-v2/cases.json", import.meta.url)), "utf8"));
const template = fixture.taskTemplate as V2CanonicalTask;
const linuxOnly = { skip: process.platform !== "linux" };
type Projection = V2CanonicalTask & { version: number; blockedByIds: string[] };
function send(workspace: Workspace, envelope: object): V2Response { return executeV2Line(Buffer.from(JSON.stringify({ version: 2, ...envelope })), workspace.root, workspace.cache); }
function success(response: V2Response): Extract<V2Response, { ok: true }> {
  assert.equal(response.ok, true, JSON.stringify(response));
  if (!response.ok) throw Error("failed");
  return response;
}
function fail(response: V2Response, code: string) { assert.equal(response.ok, false); if (!response.ok) assert.equal(response.error.code, code, JSON.stringify(response)); }
function materialize(t: TestContext, records: Record<string, Partial<V2CanonicalTask>> = { a: {}, p: {}, d: {} }) {
  const workspace = setup(t);
  for (const file of readdirSync(path.join(workspace.root, "tasks"))) rmSync(path.join(workspace.root, "tasks", file));
  for (const [id, patch] of Object.entries(records)) writeFileSync(path.join(workspace.root, "tasks", `${id}.json`), JSON.stringify({ ...template, ...patch, id }));
  return workspace;
}
function get(workspace: Workspace, id = "a") { return success(send(workspace, { command: "task.get", args: { id } })).result.task as Projection; }
function prepared(workspace: Workspace, command: string, args: Record<string, unknown>) {
  const context = success(send(workspace, { command: "workspace.info" })).writeContext;
  return { command, args: { ...args, expectedVersion: get(workspace, args.id as string).version }, writeContext: context, idempotencyKey: "edit" };
}
function bytes(workspace: Workspace) { return readdirSync(path.join(workspace.root, "tasks")).sort().map(file => [file, readFileSync(path.join(workspace.root, "tasks", file)).toString("base64")]); }
function history(workspace: Workspace) { return success(send(workspace, { command: "activity.list" })).result.activity as { command: string; createdAt: string; before: V2CanonicalTask; after: V2CanonicalTask }[]; }
function receipts(workspace: Workspace) {
  const db = new DatabaseSync(workspace.cache);
  try { return db.prepare("SELECT count(*) AS n FROM v2_receipts").get()!.n; } finally { db.close(); }
}

// Operation time in the declarative case is bound to the observed command activity, not a production clock override.
test("public task.move materializes time-parent with independent records/expected fields", linuxOnly, (t) => {
  const entry = fixture.cases.find((entry: { id: string }) => entry.id === "time-parent");
  const workspace = materialize(t, entry.given.records);
  const request = prepared(workspace, entry.action.command, entry.action.args);
  const before = bytes(workspace), started = Date.now();
  const result = success(send(workspace, request)).result;
  const task = result.task as Projection;
  const at = history(workspace)[0].createdAt;
  assert.ok(Date.parse(at) >= started && Date.parse(at) <= Date.now());
  for (const [field, value] of Object.entries(entry.expect.fields)) assert.equal(task[field as keyof V2CanonicalTask], value === entry.action.at ? at : value);
  assert.equal(task.orderKey, "a0");
  assert.equal(history(workspace).length, 1);
  assert.deepEqual(bytes(workspace).filter(([file]) => file !== "a.json"), before.filter(([file]) => file !== "a.json"));
  assert.deepEqual(success(send(workspace, request)).result, result);
});

for (const status of ["open", "in_progress", "paused", "done", "canceled"] as const) for (const command of V2_RELATIONSHIP_COMMANDS) {
  test(`${command} edits ${status} task while retaining closure/content/descendant links`, linuxOnly, (t) => {
    const workspace = materialize(t, { a: { status, closedAt: status === "done" || status === "canceled" ? "3999-01-01T00:00:00.000Z" : null, createdAt: "3999-01-01T00:00:00.000Z", updatedAt: "3999-01-01T00:00:00.000Z", dependencyIds: command === "task.dependency.remove" ? ["d"] : [], description: "# **Notes**\r\n@literal #literal", category: "work", tags: ["alpha", "todo"], priority: 0 }, child: { parentId: "a" }, p: {}, d: { status: "done", closedAt: "2026-09-08T14:00:00.000Z" } });
    const before = get(workspace), raw = bytes(workspace);
    const request = prepared(workspace, command, { id: "a", ...(command === "task.move" ? { parentId: "p" } : { dependsOnId: "d" }) });
    const result = success(send(workspace, request)).result;
    const after = result.task as Projection;
    assert.equal(result.changed, true);
    for (const field of ["id", "title", "description", "status", "priority", "category", "tags", "createdAt", "closedAt"] as const) assert.deepEqual(after[field], before[field]);
    assert.equal(after.updatedAt, history(workspace)[0].createdAt);
    assert.ok(after.updatedAt < before.updatedAt);
    assert.ok(after.version > before.version);
    assert.equal(after.parentId, command === "task.move" ? "p" : before.parentId);
    assert.equal(after.orderKey, "a0");
    assert.deepEqual(after.dependencyIds, command === "task.dependency.add" ? ["d"] : command === "task.dependency.remove" ? [] : before.dependencyIds);
    assert.deepEqual(bytes(workspace).filter(([file]) => file !== "a.json"), raw.filter(([file]) => file !== "a.json"));
    assert.equal(get(workspace, "child").parentId, "a");
    assert.equal(history(workspace).length, 1);
    assert.equal(history(workspace)[0].command, command);
  });
}

for (const command of V2_RELATIONSHIP_COMMANDS) {
  test(`${command} effective no-op on existing canceled references or absent removal is receipt-only`, linuxOnly, (t) => {
    const workspace = materialize(t, { a: { parentId: "p", dependencyIds: ["d"], orderKey: "a2" }, p: { status: "canceled", closedAt: "2026-09-08T14:00:00.000Z" }, d: { status: "canceled", closedAt: "2026-09-08T14:00:00.000Z" } });
    const before = get(workspace), raw = bytes(workspace);
    const request = prepared(workspace, command, { id: "a", ...(command === "task.move" ? { parentId: "p" } : { dependsOnId: command === "task.dependency.add" ? "d" : "absent" }) });
    const result = success(send(workspace, request)).result;
    assert.deepEqual(result, { task: before, changed: false });
    assert.deepEqual(bytes(workspace), raw);
    assert.equal(history(workspace).length, 0);
    assert.equal(receipts(workspace), 1);
    assert.deepEqual(success(send(workspace, { ...request, requestId: "new-correlation" })).result, result);
    if (command === "task.dependency.remove") assert.equal(success(send(workspace, { ...request, idempotencyKey: "self-remove", args: { ...request.args, dependsOnId: "a" } })).result.changed, false);
  });
}

test("same-root parent is no-op even when selected task is not first", linuxOnly, (t) => {
  const workspace = materialize(t, { a: { orderKey: "a2" }, b: { orderKey: "a0" } });
  const request = prepared(workspace, "task.move", { id: "a", parentId: null });
  const raw = bytes(workspace);
  assert.equal(success(send(workspace, request)).result.changed, false);
  assert.deepEqual(bytes(workspace), raw);
});

for (const [command, args, records, error] of [
  ["task.move", { parentId: "a" }, { a: {} }, "PARENT_CYCLE"],
  ["task.move", { parentId: "leaf" }, { a: {}, child: { parentId: "a" }, leaf: { parentId: "child" } }, "PARENT_CYCLE"],
  ["task.dependency.add", { dependsOnId: "a" }, { a: {} }, "DEPENDENCY_CYCLE"],
  ["task.dependency.add", { dependsOnId: "d" }, { a: {}, d: { dependencyIds: ["mid"] }, mid: { dependencyIds: ["a"] } }, "DEPENDENCY_CYCLE"],
  ["task.move", { parentId: "missing" }, { a: {} }, "INVALID_PARENT"],
  ["task.dependency.add", { dependsOnId: "missing" }, { a: {} }, "INVALID_DEPENDENCY"],
  ["task.move", { parentId: "gone" }, { a: {}, gone: { status: "canceled", closedAt: "2026-09-08T14:00:00.000Z" } }, "INVALID_PARENT"],
  ["task.dependency.add", { dependsOnId: "gone" }, { a: {}, gone: { status: "canceled", closedAt: "2026-09-08T14:00:00.000Z" } }, "INVALID_DEPENDENCY"],
] as [string, Record<string, unknown>, Record<string, Partial<V2CanonicalTask>>, string][]) {
  test(`${command} refuses ${error}/${Object.values(args)[0]} before effects or key consumption`, linuxOnly, (t) => {
    const workspace = materialize(t, records);
    const request = prepared(workspace, command, { id: "a", ...args });
    const raw = bytes(workspace);
    fail(send(workspace, request), error);
    assert.deepEqual(bytes(workspace), raw);
    assert.equal(history(workspace).length, 0);
    assert.equal(receipts(workspace), 0);
    assert.equal(existsSync(pendingV2Path(readV2RootDescriptor(workspace.root))), false);
  });
}

test("removing an existing canceled parent prepends into the complete root scope without changing closure", linuxOnly, (t) => {
  const workspace = materialize(t, { a: { parentId: "p", status: "done", closedAt: "2026-09-08T14:00:00.000Z", orderKey: "a2" }, p: { status: "canceled", closedAt: "2026-09-08T14:00:00.000Z" } });
  const request = prepared(workspace, "task.move", { id: "a", parentId: null });
  const result = success(send(workspace, request)).result.task as Projection;
  assert.equal(result.parentId, null);
  assert.equal(result.orderKey, "Zz");
  assert.equal(result.closedAt, "2026-09-08T14:00:00.000Z");
  assert.equal(get(workspace, "p").status, "canceled");
});

test("full prospective graph separates parent and dependency edges and accepts a converging DAG", linuxOnly, (t) => {
  const workspace = materialize(t, { a: {}, d: { dependencyIds: ["a"] }, p: { parentId: "d" }, z: { dependencyIds: ["a"] }, q: { dependencyIds: ["d", "z"] } });
  success(send(workspace, prepared(workspace, "task.move", { id: "a", parentId: "p" })));
  assert.equal(get(workspace).parentId, "p");
  assert.deepEqual(get(workspace, "q").dependencyIds, ["d", "z"]);
});

test("reparent guards complete old/new scopes, prepends before canceled/equal keys and reissues only affected scope tokens", linuxOnly, (t) => {
  const workspace = materialize(t, { a: { parentId: "old", orderKey: "a0" }, old: { orderKey: "a0" }, next: { orderKey: "a1" }, q: { orderKey: "a2" }, oldSibling: { parentId: "old", orderKey: "a1", status: "canceled", closedAt: "2026-09-08T14:00:00.000Z" }, b: { parentId: "next", orderKey: "a0", status: "canceled", closedAt: "2026-09-08T14:00:00.000Z" }, c: { parentId: "next", orderKey: "a0", status: "paused" }, child: { parentId: "a", orderKey: "a0" }, unrelated: { parentId: "q", orderKey: "a0" } });
  const ids = ["a", "old", "next", "q", "oldSibling", "b", "c", "child", "unrelated"];
  const before = new Map(ids.map(id => [id, get(workspace, id)]));
  const raw = bytes(workspace);
  const result = success(send(workspace, prepared(workspace, "task.move", { id: "a", parentId: "next" }))).result;
  assert.equal((result.task as Projection).orderKey, "Zz");
  for (const id of ids) assert.equal(get(workspace, id).version !== before.get(id)!.version, ["a", "oldSibling", "b", "c"].includes(id), id);
  assert.deepEqual(bytes(workspace).filter(([file]) => file !== "a.json"), raw.filter(([file]) => file !== "a.json"));
  const list = success(send(workspace, { command: "task.list", args: { sort: "manual", status: ["open", "paused", "canceled"] } })).result.tasks as Projection[];
  assert.deepEqual(list.filter(task => task.parentId === "next").map(task => task.id), ["a", "b", "c"]);
  const rooted = success(send(workspace, { ...prepared(workspace, "task.move", { id: "a", parentId: null }), idempotencyKey: "unparent" })).result.task as Projection;
  assert.equal(rooted.orderKey, "Zz");
  assert.equal(get(workspace, "child").parentId, "a");
});

test("dependency edits byte-sort IDs, retain canceled links until explicit removal, and done still blocks", linuxOnly, (t) => {
  const workspace = materialize(t, { a: { dependencyIds: ["gone", "z"] }, gone: { status: "canceled", closedAt: "2026-09-08T14:00:00.000Z" }, z: {}, Done: { status: "done", closedAt: "2026-09-08T14:00:00.000Z" } });
  const sibling = get(workspace, "z");
  const added = success(send(workspace, prepared(workspace, "task.dependency.add", { id: "a", dependsOnId: "Done" }))).result.task as Projection;
  assert.deepEqual(added.dependencyIds, ["Done", "gone", "z"]);
  assert.deepEqual(added.blockedByIds, ["Done", "z"]);
  assert.equal(get(workspace, "z").version, sibling.version);
  const removed = success(send(workspace, { ...prepared(workspace, "task.dependency.remove", { id: "a", dependsOnId: "gone" }), idempotencyKey: "remove" })).result.task as Projection;
  assert.deepEqual(removed.dependencyIds, ["Done", "z"]);
  assert.deepEqual(removed.blockedByIds, ["Done", "z"]);
  assert.equal(removed.orderKey, template.orderKey);
  fail(send(workspace, { ...prepared(workspace, "task.dependency.add", { id: "a", dependsOnId: "done" }), idempotencyKey: "case-sensitive" }), "INVALID_DEPENDENCY");
});

for (const command of V2_RELATIONSHIP_COMMANDS) {
  test(`${command} validates authority/shape/version, previews without effects, and replays original identity`, linuxOnly, (t) => {
    const workspace = materialize(t, { a: { dependencyIds: command === "task.dependency.remove" ? ["d"] : [] }, p: {}, d: {} });
    const request = prepared(workspace, command, { id: "a", ...(command === "task.move" ? { parentId: "p" } : { dependsOnId: "d" }) });
    const raw = bytes(workspace);
    fail(send(workspace, { ...request, writeContext: undefined }), "WRITE_CONTEXT_REQUIRED");
    fail(send(workspace, { ...request, writeContext: "not-current" }), "STALE_WRITE_CONTEXT");
    fail(send(workspace, { ...request, idempotencyKey: undefined }), "IDEMPOTENCY_REQUIRED");
    fail(send(workspace, { ...request, args: { ...request.args, expectedVersion: undefined } }), "EXPECTED_VERSION_REQUIRED");
    fail(send(workspace, { ...request, args: { ...request.args, expectedVersion: 987654 } }), "STALE_TASK_VERSION");
    for (const field of ["readOnly", "dryRun"]) {
      assert.equal(success(send(workspace, { ...request, idempotencyKey: undefined, [field]: true })).result.changed, true);
      assert.deepEqual(bytes(workspace), raw);
      assert.equal(receipts(workspace), 0);
      assert.equal(history(workspace).length, 0);
    }
    const result = success(send(workspace, request)).result;
    const after = bytes(workspace);
    assert.deepEqual(success(send(workspace, { ...request, requestId: "later" })).result, result);
    for (const changed of [{ actor: { kind: "human", label: "different" } }, { dryRun: true }, { args: { ...request.args, expectedVersion: 2 ** 40 } }]) fail(send(workspace, { ...request, ...changed }), "IDEMPOTENCY_KEY_REUSED");
    assert.deepEqual(bytes(workspace), after);
    fail(send(workspace, { ...request, idempotencyKey: "new-edit" }), "STALE_TASK_VERSION");
  });
}

test("relationship inputs reject unknown/v1 fields and unsafe or omitted target IDs before writes", linuxOnly, (t) => {
  const workspace = materialize(t);
  const request = prepared(workspace, "task.move", { id: "a", parentId: "p" });
  const raw = bytes(workspace);
  for (const parentId of [undefined, "", "../p", 1, [], {}]) fail(send(workspace, { ...request, args: { ...request.args, parentId } }), "INVALID_ARGUMENT");
  for (const dependsOnId of [undefined, null, "", "../d", 1, [], {}]) fail(send(workspace, { ...request, command: "task.dependency.add", args: { id: "a", expectedVersion: get(workspace).version, dependsOnId } }), "INVALID_ARGUMENT");
  for (const extra of ["title", "parent", "dependencyIds", "orderKey", "updatedAt", "status", "expectedParentVersion", "sourceKey"]) fail(send(workspace, { ...request, args: { ...request.args, [extra]: "not allowed" } }), "INVALID_ARGUMENT");
  const missing = { ...request, args: { ...request.args, id: "missing" } };
  fail(send(workspace, missing), "TASK_NOT_FOUND");
  assert.deepEqual(bytes(workspace), raw);
  assert.equal(receipts(workspace), 0);
});

test("reparent key exhaustion and corrupt complete source refuse without normalization or cache repair", linuxOnly, (t) => {
  const maximum = `A${"0".repeat(26)}${"0".repeat(228)}1`;
  const workspace = materialize(t, { a: {}, p: {}, low: { parentId: "p", orderKey: maximum } });
  const request = prepared(workspace, "task.move", { id: "a", parentId: "p" });
  const raw = bytes(workspace);
  fail(send(workspace, request), "ORDER_KEY_LIMIT");
  assert.deepEqual(bytes(workspace), raw);
  assert.equal(existsSync(pendingV2Path(readV2RootDescriptor(workspace.root))), false);
  writeFileSync(path.join(workspace.root, "tasks/low.json"), "{");
  const corrupt = bytes(workspace);
  fail(send(workspace, request), "INVALID_CANONICAL");
  assert.deepEqual(bytes(workspace), corrupt);
});

test("historical move replay precedes missing target/invalid live graph and never rewrites or resurrects", linuxOnly, (t) => {
  const workspace = materialize(t);
  const request = prepared(workspace, "task.move", { id: "a", parentId: "p" });
  const original = success(send(workspace, request));
  rmSync(path.join(workspace.root, "tasks/p.json"));
  const raw = bytes(workspace);
  assert.deepEqual(success(send(workspace, request)).result, original.result);
  assert.deepEqual(bytes(workspace), raw);
  rmSync(path.join(workspace.root, "tasks/a.json"));
  assert.deepEqual(success(send(workspace, request)).result, original.result);
  assert.equal(existsSync(path.join(workspace.root, "tasks/a.json")), false);
});

for (const command of V2_RELATIONSHIP_COMMANDS) {
  test(`${command} refuses near-exhausted authority before staging`, linuxOnly, (t) => {
    const workspace = materialize(t, { a: { dependencyIds: ["d"] }, p: {}, d: {} });
    const request = prepared(workspace, command, { id: "a", ...(command === "task.move" ? { parentId: "p" } : { dependsOnId: command === "task.dependency.add" ? "p" : "d" }) });
    const raw = bytes(workspace);
    const db = new DatabaseSync(workspace.cache);
    db.prepare("UPDATE v2_query_state SET counter = ?, revision = ?").run(Number.MAX_SAFE_INTEGER - 4, Number.MAX_SAFE_INTEGER - 1);
    db.close();
    fail(send(workspace, request), "UNSUPPORTED_COMMAND");
    assert.deepEqual(bytes(workspace), raw);
    assert.equal(existsSync(pendingV2Path(readV2RootDescriptor(workspace.root))), false);
  });
}
