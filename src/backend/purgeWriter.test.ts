import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { TestContext } from "node:test";
import { createCopyTestWorkspace as setup } from "./copyTestWorkspace.js";
import type { CopyTestWorkspace as Workspace } from "./copyTestWorkspace.js";
import { executeLine } from "./gateway.js";
import { readRootDescriptor } from "./canonicalReader.js";
import { pendingIntentPath } from "./localDomain.js";
import type { Response } from "./protocol.js";
import type { CanonicalTask } from "./taskModel.js";
const corpus = JSON.parse(readFileSync(fileURLToPath(new URL("../../scripts/fixtures/taskdb-v2/cases.json", import.meta.url)), "utf8"));
const linux = { skip: process.platform !== "linux" };
const canceled = { status: "canceled" as const, closedAt: "2026-09-08T14:00:00.000Z" };
function send(w: Workspace, request: object): Response { return executeLine(Buffer.from(JSON.stringify({ version: 2, ...request })), w.root, w.cache); }
function ok(r: Response): Extract<Response, { ok: true }> { assert.equal(r.ok, true, JSON.stringify(r)); if (!r.ok) throw Error("failed"); return r; }
function fail(r: Response, code: string) { assert.equal(r.ok, false, JSON.stringify(r)); if (!r.ok) assert.equal(r.error.code, code); }
function materialize(t: TestContext, records: Record<string, Partial<CanonicalTask>> = { a: canceled, z: {} }) {
  const w = setup(t);
  for (const file of readdirSync(path.join(w.root, "tasks"))) rmSync(path.join(w.root, "tasks", file));
  for (const [id, fields] of Object.entries(records)) writeFileSync(path.join(w.root, "tasks", `${id}.json`), JSON.stringify({ ...corpus.taskTemplate, ...fields, id }) + "\n");
  return w;
}
function raw(w: Workspace) { return readdirSync(path.join(w.root, "tasks")).sort().map(file => [file, readFileSync(path.join(w.root, "tasks", file)).toString("base64")]); }
function prepared(w: Workspace, command = "task.purgeCanceled", args: Record<string, unknown> = {}, key = command) {
  const info = ok(send(w, { command: "workspace.info" }));
  if (typeof args.id === "string") args = { ...args, expectedVersion: (ok(send(w, { command: "task.get", args: { id: args.id } })).result.task as { version: number }).version };
  return { command, args, writeContext: info.writeContext, idempotencyKey: key, actor: { kind: "human", label: "purge test" } };
}
function history(w: Workspace, taskId?: string) { return ok(send(w, { command: "activity.list", args: taskId ? { taskId } : {} })).result.activity as { operationId: string; command: string; before: { tasks: CanonicalTask[] }; after: { tasks: CanonicalTask[] } }[]; }
function counts(w: Workspace) { const db = new DatabaseSync(w.cache);try { return ["v2_receipts", "v2_operations", "v2_undo_claims"].map(table => db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n); } finally { db.close(); } }

for (const id of ["purge-referenced", "purge-closed-subgraph"]) test(`purge executes original corpus ${id}`, linux, t => {
  const entry = corpus.cases.find((entry: { id: string }) => entry.id === id), w = materialize(t, entry.given.records), before = raw(w);
  const response = send(w, prepared(w, entry.action.command, entry.action.args));
  if (entry.expect.error) { fail(response, entry.expect.error);if (!response.ok) assert.deepEqual(response.error.details?.references, entry.expect.references);assert.deepEqual(raw(w), before);assert.deepEqual(counts(w), [0, 0, 0]); }
  else { const result = ok(response).result;assert.deepEqual(result.purgedIds, entry.expect.purgedIds);assert.deepEqual(readdirSync(path.join(w.root, "tasks")), entry.expect.remainingIds);const copy = JSON.parse(readFileSync(result.recoveryLocation as string, "utf8"));assert.deepEqual(copy.files.filter((file: { relativePath: string }) => file.relativePath.startsWith("tasks/")).map((file: { relativePath: string; beforeBytes: string }) => [path.basename(file.relativePath), file.beforeBytes]), before); }
});
for (const status of ["open", "in_progress", "paused", "done"] as const) for (const field of ["parentId", "dependencyIds"] as const) test(`complete purge refuses surviving ${status} ${field} before any effects`, linux, t => {
  const w = materialize(t, { a: canceled, b: canceled, survivor: { status, closedAt: status === "done" ? canceled.closedAt : null, ...(field === "parentId" ? { parentId: "a" } : { dependencyIds: ["a", "b"] }) } });
  const before = raw(w), response = send(w, prepared(w));fail(response, "PURGE_REFERENCED");
  if (!response.ok) assert.deepEqual(response.error.details?.references, (field === "parentId" ? ["a"] : ["a", "b"]).map(targetId => ({ taskId: "survivor", targetId, field })));
  assert.deepEqual(raw(w), before);assert.deepEqual(counts(w), [0, 0, 0]);assert.equal(existsSync(pendingIntentPath(readRootDescriptor(w.root))), false);
});
for (const flags of [{ readOnly: true }, { dryRun: true }, { readOnly: true, dryRun: true }]) test(`purge preview ${JSON.stringify(flags)} consumes no archive/key/activity/version`, linux, t => {
  const w = materialize(t), request = prepared(w), before = raw(w), initial = ok(send(w, { command: "task.get", args: { id: "z" } })).result;
  const preview = ok(send(w, { ...request, idempotencyKey: undefined, ...flags }));assert.deepEqual(preview.result.purgedIds, ["a"]);assert.equal(preview.result.changed, true);assert.equal(preview.result.recoveryLocation, undefined);
  assert.deepEqual(counts(w), [0, 0, 0]);assert.deepEqual(raw(w), before);assert.deepEqual(ok(send(w, { command: "task.get", args: { id: "z" } })).result, initial);
  assert.equal(readdirSync(path.dirname(pendingIntentPath(readRootDescriptor(w.root)))).some(file => file.endsWith(".recovery.json")), false);ok(send(w, request));
});
for (const args of [{ ids: ["a"] }, { status: "canceled" }, { expectedVersion: 1 }, { force: true }, { destinationDirectory: "somewhere" }]) test(`purge refuses undeclared argument ${Object.keys(args)[0]}`, linux, t => {
  const w = materialize(t), before = raw(w);fail(send(w, prepared(w, "task.purgeCanceled", args)), "INVALID_ARGUMENT");assert.deepEqual(raw(w), before);assert.deepEqual(counts(w), [0, 0, 0]);
});
for (const [patch, code] of [[{ writeContext: undefined }, "WRITE_CONTEXT_REQUIRED"], [{ writeContext: "wrong" }, "STALE_WRITE_CONTEXT"], [{ idempotencyKey: undefined }, "IDEMPOTENCY_REQUIRED"]] as const) test(`purge requires ${code}`, linux, t => {
  const w = materialize(t), before = raw(w);fail(send(w, { ...prepared(w), ...patch }), code);assert.deepEqual(raw(w), before);
});
test("purge preserves raw survivors/conflicts, full recovery bytes, scope tokens and one task-filtered group", linux, t => {
  const w = materialize(t, { a: canceled, b: { ...canceled, parentId: "a", dependencyIds: ["a"] }, z: {}, child: { parentId: "z" } });
  writeFileSync(path.join(w.root, "tasks/a.sync-conflict-raw.json"), Buffer.from([0xff, 0x00, 0x7b]));
  const before = raw(w), child = ok(send(w, { command: "task.get", args: { id: "child" } })).result.task as { version: number }, z = ok(send(w, { command: "task.get", args: { id: "z" } })).result.task as { version: number };
  const request = prepared(w), result = ok(send(w, request)).result;
  assert.deepEqual(result.purgedIds, ["a", "b"]);for (const [name, bytes] of before.filter(([name]) => !["a.json", "b.json"].includes(name))) assert.equal(readFileSync(path.join(w.root, "tasks", name)).toString("base64"), bytes);
  assert.equal((ok(send(w, { command: "task.get", args: { id: "child" } })).result.task as { version: number }).version, child.version);assert.notEqual((ok(send(w, { command: "task.get", args: { id: "z" } })).result.task as { version: number }).version, z.version);
  assert.equal(history(w).length, 1);for (const id of ["a", "b"]) { const rows = history(w, id);assert.equal(rows.length, 1);assert.equal(rows[0].operationId, result.operationId);assert.deepEqual(rows[0].before.tasks.map(task => task.id).sort(), ["a", "b"]);assert.deepEqual(rows[0].after.tasks, []); }
  const archive = JSON.parse(readFileSync(result.recoveryLocation as string, "utf8"));assert.equal(archive.format, "taskdb.purge-recovery");assert.equal(archive.files.length, before.length + 1);for (const [name, bytes] of before) assert.equal(archive.files.find((file: { relativePath: string }) => file.relativePath === `tasks/${name}`).beforeBytes, bytes);
  ok(send(w, prepared(w, "workspace.rebuild")));assert.deepEqual(ok(send(w, request)).result, result);assert.equal(history(w).length, 1);assert.equal(existsSync(result.recoveryLocation as string), true);fail(send(w, prepared(w, "operation.undo", { operationId: result.operationId })), "OPERATION_UNAVAILABLE");
});
test("empty purge is receipt-only and preserves existing status undo", linux, t => {
  const w = materialize(t, { a: {} });ok(send(w, prepared(w, "task.complete", { id: "a" })));const before = raw(w), prior = counts(w), request = prepared(w);
  const result = ok(send(w, request)).result;assert.deepEqual(result, { purgedIds: [], changed: false });assert.deepEqual(counts(w), [Number(prior[0]) + 1, prior[1], prior[2]]);assert.deepEqual(raw(w), before);assert.deepEqual(ok(send(w, request)).result, result);ok(send(w, prepared(w, "task.status.undo", { id: "a" })));
});
test("historical receipt precedes arrivals/invalid graph/archive loss but enforces actor/flags identity", linux, t => {
  const w = materialize(t), request = prepared(w), result = ok(send(w, request)).result;
  writeFileSync(path.join(w.root, "tasks/new.json"), JSON.stringify({ ...corpus.taskTemplate, id: "new", ...canceled, parentId: "missing" }));rmSync(result.recoveryLocation as string);
  assert.deepEqual(ok(send(w, { ...request, requestId: "different" })).result, result);
  for (const patch of [{ actor: { kind: "agent", label: "other" } }, { readOnly: true }, { dryRun: true }, { command: "workspace.rebuild" }]) fail(send(w, { ...request, ...patch }), "IDEMPOTENCY_KEY_REUSED");
});
test("failed reference guard consumes no key; new explicit unlink permits the original purge", linux, t => {
  const w = materialize(t, { a: canceled, child: { parentId: "a", dependencyIds: ["a"] } }), request = prepared(w);
  fail(send(w, request), "PURGE_REFERENCED");ok(send(w, prepared(w, "task.move", { id: "child", parentId: null })));ok(send(w, prepared(w, "task.dependency.remove", { id: "child", dependsOnId: "a" })));ok(send(w, request));assert.deepEqual((ok(send(w, { command: "task.get", args: { id: "child" } })).result.task as CanonicalTask).dependencyIds, []);
});
test("nonempty purge permanently invalidates removed-task history despite exact external reappearance, but unrelated content inverse survives", linux, t => {
  const w = materialize(t, { a: {}, z: {} });const changed = ok(send(w, prepared(w, "task.update", { id: "a", priority: 0 }, "a-edit"))).result;
  const unrelated = ok(send(w, prepared(w, "task.update", { id: "z", priority: 1 }, "z-edit"))).result;ok(send(w, prepared(w, "task.cancel", { id: "a" })));const removed = readFileSync(path.join(w.root, "tasks/a.json"));
  ok(send(w, prepared(w)));ok(send(w, prepared(w, "operation.undo", { operationId: unrelated.operationId }, "z-inverse")));writeFileSync(path.join(w.root, "tasks/a.json"), removed);
  fail(send(w, prepared(w, "operation.undo", { operationId: changed.operationId }, "a-inverse")), "OPERATION_UNAVAILABLE");fail(send(w, prepared(w, "task.status.undo", { id: "a" })), "UNDO_UNAVAILABLE");
});
test("purge consumes ordered history even when removed sibling was an unselected guard", linux, t => {
  const w = materialize(t, { a: { ...canceled, orderKey: "a0" }, b: { orderKey: "a1" }, c: { orderKey: "a2" } });const b = ok(send(w, { command: "task.get", args: { id: "b" } })).result.task as { version: number };
  const forward = ok(send(w, prepared(w, "task.reorder", { tasks: [{ id: "b", expectedVersion: b.version }], placement: { last: true } }))).result;const removed = readFileSync(path.join(w.root, "tasks/a.json"));ok(send(w, prepared(w)));writeFileSync(path.join(w.root, "tasks/a.json"), removed);
  fail(send(w, prepared(w, "operation.undo", { operationId: forward.operationId })), "OPERATION_UNAVAILABLE");
});
for (const relation of ["parent", "dependency"]) test(`purge invalidates historic ${relation} inverse involving removed target`, linux, t => {
  const w = materialize(t, { a: canceled, z: relation === "parent" ? { parentId: "a" } : { dependencyIds: ["a"] } });
  const edit = ok(send(w, prepared(w, relation === "parent" ? "task.move" : "task.dependency.remove", relation === "parent" ? { id: "z", parentId: null } : { id: "z", dependsOnId: "a" }))).result;
  const removed = readFileSync(path.join(w.root, "tasks/a.json"));ok(send(w, prepared(w)));writeFileSync(path.join(w.root, "tasks/a.json"), removed);fail(send(w, prepared(w, "operation.undo", { operationId: edit.operationId })), "OPERATION_UNAVAILABLE");
});
for (const field of ["counter", "revision"]) test(`purge ${field} exhaustion refuses before archive/staging/deletion`, linux, t => {
  const w = materialize(t), request = prepared(w), before = raw(w), db = new DatabaseSync(w.cache);db.prepare(`UPDATE v2_query_state SET ${field} = ?`).run(Number.MAX_SAFE_INTEGER - 2);db.close();
  fail(send(w, request), "UNSUPPORTED_COMMAND");assert.deepEqual(raw(w), before);assert.equal(existsSync(pendingIntentPath(readRootDescriptor(w.root))), false);assert.deepEqual(counts(w), [0, 0, 0]);
});
test("purge refuses descriptor conflict authority before creating recovery or deleting files", linux, t => {
  const w = materialize(t), request = prepared(w), before = raw(w);writeFileSync(path.join(w.root, "workspace.sync-conflict-test.json"), '{"schemaVersion":1}');
  fail(send(w, request), "INVALID_CANONICAL");assert.deepEqual(raw(w), before);assert.deepEqual(counts(w), [0, 0, 0]);assert.equal(existsSync(pendingIntentPath(readRootDescriptor(w.root))), false);
});

test("purge uses complete canonical canceled set, not a filtered or default-sized projection", linux, t => {
  const records = Object.fromEntries(Array.from({ length: 110 }, (_, index) => [`id${String(index).padStart(3, "0")}`, canceled]));const w = materialize(t, records);assert.equal((ok(send(w, { command: "task.list" })).result.tasks as unknown[]).length, 50);
  const result = ok(send(w, prepared(w))).result;assert.deepEqual(result.purgedIds, Object.keys(records));assert.equal(readdirSync(path.join(w.root, "tasks")).length, 0);
});
