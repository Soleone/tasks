import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { TestContext } from "node:test";
import { createCopyTestWorkspace as setup, fail, send, success } from "./copyTestWorkspace.js";
import type { CopyTestWorkspace as Workspace } from "./copyTestWorkspace.js";
import { pendingIntentPath } from "./localDomain.js";
import { readRootDescriptor } from "./canonicalReader.js";
import type { Response } from "./protocol.js";
import type { CanonicalTask } from "./taskModel.js";
const corpus = JSON.parse(readFileSync(fileURLToPath(new URL("../../scripts/fixtures/workspace/cases.json", import.meta.url)), "utf8"));
const linux = { skip: process.platform !== "linux" };
type Projection = CanonicalTask & { version: number };
function materialize(t: TestContext, records: Record<string, Partial<CanonicalTask>> = { a: {} }) {
  const w = setup(t);
  for (const file of readdirSync(path.join(w.root, "tasks"))) rmSync(path.join(w.root, "tasks", file));
  for (const [id, patch] of Object.entries(records)) writeFileSync(path.join(w.root, "tasks", `${id}.json`), JSON.stringify({ ...corpus.taskTemplate, ...patch, id }));
  return w;
}
function get(w: Workspace, id = "a") { return success(send(w, { command: "task.get", args: { id } })).result.task as Projection; }
function raw(w: Workspace) { return readdirSync(path.join(w.root, "tasks")).sort().map(file => [file, readFileSync(path.join(w.root, "tasks", file)).toString("base64")]); }
function rows(w: Workspace, taskId?: string) { return success(send(w, { command: "activity.list", args: taskId ? { taskId } : {} })).result.activity as { operationId: string; createdAt: string; command: string; before: unknown; after: unknown }[]; }
function prepared(w: Workspace, command: string, args: Record<string, unknown>, key = command): { command: string; writeContext: string; idempotencyKey: string; args: Record<string, unknown> } {
  const ctx = success(send(w, { command: "workspace.info" })).writeContext;
  return { command, writeContext: ctx, idempotencyKey: key, args: { ...args, ...(typeof args.id === "string" ? { expectedVersion: get(w, args.id).version } : {}) } };
}
function batch(w: Workspace, command: string, items: { id: string; command?: string }[], key = command) {
  return prepared(w, command, { tasks: items.map(item => ({ ...item, expectedVersion: get(w, item.id).version })) }, key);
}
function patch(w: Workspace, id: string, fields: object) { const file = path.join(w.root, "tasks", `${id}.json`); writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), ...fields })); }
function counts(w: Workspace) { const db = new DatabaseSync(w.cache); try { return ["v2_receipts", "v2_operations", "v2_undo_claims"].map(table => db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n); } finally { db.close(); } }

for (const id of ["time-status-undo", "undo-cycle", "undo-unrelated-edit", "undo-order-arrival", "undo-missing-history"]) {
  test(`public undo executes original corpus ${id}`, linux, t => {
    const entry = corpus.cases.find((entry: { id: string }) => entry.id === id);
    const w = materialize(t, entry.given.records ?? { a: entry.given.patch ?? {} });
    let operationId: unknown;
    let last: Response | undefined;
    let before: string[][] = [];
    let firstAt = "";
    for (const step of entry.action.steps ?? [entry.action]) {
      if (step.externalPatch || step.arrival) { for (const [taskId, fields] of Object.entries(step.externalPatch ?? step.arrival)) {
        if (step.arrival) writeFileSync(path.join(w.root, "tasks", `${taskId}.json`), JSON.stringify({ ...corpus.taskTemplate, ...(fields as object), id: taskId })); else patch(w, taskId, fields as object);
      } continue; }
      let req;
      if (step.command === "operation.undo") req = prepared(w, step.command, { operationId });
      else if (step.command === "task.reorder") req = batch(w, step.command, step.ids.map((id: string) => ({ id })) );
      else req = prepared(w, step.command, step.args ?? { ...step, command: undefined, at: undefined, id: step.id ?? "a" });
      if (step.command === "task.reorder") req.args.placement = step.placement;
      if (step.command === "operation.undo" || step.command === "task.status.undo") { before = raw(w); firstAt = new Date().toISOString(); }
      last = send(w, req);
      if (last.ok && !operationId) operationId = last.result.operationId;
    }
    assert.ok(last);
    if (entry.expect.error) { fail(last, entry.expect.error); assert.deepEqual(raw(w), before); }
    else {
      success(last);
      const task = get(w);
      for (const [field, value] of Object.entries(entry.expect.fields)) {
        if (field === "updatedAt" && id === "undo-unrelated-edit") { assert.equal(task.updatedAt, rows(w)[0].createdAt); assert.ok(task.updatedAt >= firstAt && task.updatedAt <= new Date().toISOString()); }
        else assert.deepEqual(task[field as keyof CanonicalTask], value);
      }
    }
  });
}

const statuses = ["open", "in_progress", "paused", "done", "canceled"] as const;
const allowed: Record<string, readonly string[]> = { start: ["open", "in_progress", "paused", "done"], pause: ["open", "in_progress", "paused"], complete: ["open", "in_progress", "paused", "done"], reopen: statuses, cancel: ["open", "in_progress", "paused", "canceled"], delete: statuses };
for (const [suffix, states] of Object.entries(allowed)) for (const status of statuses.filter(state => states.includes(state))) {
  test(`latest status undo ${suffix} from ${status} restores exact closure/edit time or has no meaningful history`, linux, t => {
    const w = materialize(t, { a: { status, updatedAt: "2030-01-01T00:00:00.000Z", closedAt: ["done", "canceled"].includes(status) ? "2026-09-08T14:00:00.000Z" : null } });
    const before = get(w), changed = success(send(w, prepared(w, `task.${suffix}`, { id: "a" }))).result.changed;
    const req = prepared(w, "task.status.undo", { id: "a" });
    if (!changed) { fail(send(w, req), "UNDO_UNAVAILABLE"); return; }
    const result = success(send(w, req)).result;
    const current = get(w);
    for (const key of Object.keys(corpus.taskTemplate) as (keyof CanonicalTask)[]) assert.deepEqual(current[key], before[key]);
    assert.ok(current.version > before.version);
    assert.deepEqual(success(send(w, req)).result, result);
    fail(send(w, prepared(w, "task.status.undo", { id: "a" }, "again")), "UNDO_UNAVAILABLE");
  });
}

for (const corruption of ["invalid-preimage", "invalid-postimage", "missing-preimage"]) {
  test(`selected status undo ${corruption} remains unavailable without effects`, linux, t => {
    const w = materialize(t);
    success(send(w, prepared(w, "task.complete", { id: "a" })));
    const request = prepared(w, "task.status.undo", { id: "a" });
    const db = new DatabaseSync(w.cache);
    try {
      const history = db.prepare("SELECT before_record, after_record FROM v2_operations").get() as { before_record: string; after_record: string };
      if (corruption === "invalid-preimage") {
        const before = JSON.parse(history.before_record); delete before.status;
        db.prepare("UPDATE v2_operations SET before_record = ?").run(JSON.stringify(before));
      } else {
        db.prepare(`UPDATE v2_operations SET ${corruption === "missing-preimage" ? "before_record" : "after_record"} = ?`).run(corruption === "missing-preimage" ? JSON.stringify({ tasks: [] }) : "{}");
      }
    } finally { db.close(); }
    const before = raw(w), state = counts(w);
    fail(send(w, request), "UNDO_UNAVAILABLE");
    assert.deepEqual(raw(w), before); assert.deepEqual(counts(w), state);
  });
}

test("batch transition and per-task status undo claims retain partial group eligibility without replaying others", linux, t => {
  const w = materialize(t, { a: {}, b: { orderKey: "a1" }, c: { status: "done", closedAt: "2026-09-08T14:00:00.000Z", orderKey: "a2" } });
  const cBefore = get(w, "c"), bytes = raw(w);
  const req = batch(w, "task.transitionMany", [{ id: "a", command: "task.complete" }, { id: "b", command: "task.start" }, { id: "c", command: "task.complete" }]);
  const changed = success(send(w, req));
  assert.equal(rows(w).length, 1);assert.equal(rows(w, "c").length, 0);assert.equal(get(w, "c").version, cBefore.version);assert.deepEqual(raw(w).find(([file]) => file === "c.json"), bytes.find(([file]) => file === "c.json"));
  success(send(w, prepared(w, "task.status.undo", { id: "a" })));
  fail(send(w, prepared(w, "operation.undo", { operationId: changed.result.operationId })), "OPERATION_UNAVAILABLE");
  success(send(w, batch(w, "task.status.undoMany", [{ id: "b" }])));
  assert.equal(get(w, "a").status, "open");assert.equal(get(w, "b").status, "open");assert.deepEqual(success(send(w, req)).result, changed.result);
  assert.equal(rows(w).length, 3);assert.deepEqual(counts(w), [3, 3, 2]);
});

test("status undoMany gathers distinct sources into one group and refuses all effects when any item is unavailable", linux, t => {
  const w = materialize(t, { a: {}, b: { orderKey: "a1" }, c: { orderKey: "a2" } });
  success(send(w, prepared(w, "task.complete", { id: "a" })));success(send(w, prepared(w, "task.pause", { id: "b" })));
  const before = raw(w);
  fail(send(w, batch(w, "task.status.undoMany", [{ id: "a" }, { id: "c" }])), "UNDO_UNAVAILABLE");assert.deepEqual(raw(w), before);
  success(send(w, batch(w, "task.status.undoMany", [{ id: "a" }, { id: "b" }])));assert.equal(rows(w).length, 3);assert.equal(get(w).status, "open");assert.equal(get(w, "b").status, "open");
});

for (const command of ["task.update", "task.move", "task.dependency.add", "task.dependency.remove", "task.reorder", "task.order.normalize", "task.transitionMany"]) {
  test(`operation undo ${command} preserves unrelated current fields, graph/order and one group`, linux, t => {
    const w = materialize(t, { a: { dependencyIds: command === "task.dependency.remove" ? ["target"] : [], orderKey: "a0V" }, b: { orderKey: "a1V" }, target: { orderKey: "a2V", status: "canceled", closedAt: "2026-09-08T14:00:00.000Z" } });
    const original = get(w), allBefore = raw(w);
    let req;
    if (command === "task.reorder") { req = batch(w, command, [{ id: "a" }]);req.args.placement = { last: true }; }
    else if (command === "task.order.normalize") { req = batch(w, command, [{ id: "a" }, { id: "b" }, { id: "target" }]);req.args.parentId = null; }
    else if (command === "task.transitionMany") req = batch(w, command, [{ id: "a", command: "task.complete" }, { id: "b", command: "task.pause" }]);
    else req = prepared(w, command, { id: "a", ...(command === "task.update" ? { priority: 0 } : command === "task.move" ? { parentId: "b" } : { dependsOnId: command === "task.dependency.add" ? "b" : "target" }) });
    const forward = success(send(w, req));
    patch(w, "a", { description: "Later unrelated note", updatedAt: "2035-01-01T00:00:00.000Z" });
    const start = new Date().toISOString();const inverse = prepared(w, "operation.undo", { operationId: forward.result.operationId });
    const result = success(send(w, inverse)).result;
    const task = get(w);
    assert.equal(task.description, "Later unrelated note");
    assert.equal(task.priority, original.priority);assert.equal(task.parentId, original.parentId);assert.deepEqual(task.dependencyIds, original.dependencyIds);assert.equal(task.orderKey, original.orderKey);assert.equal(task.status, original.status);assert.equal(task.closedAt, original.closedAt);
    if (["task.reorder", "task.order.normalize", "task.transitionMany"].includes(command)) assert.equal(task.updatedAt, "2035-01-01T00:00:00.000Z"); else assert.ok(task.updatedAt >= start && task.updatedAt <= new Date().toISOString());
    assert.equal(rows(w).length, 2);assert.deepEqual(success(send(w, inverse)).result, result);
    fail(send(w, { ...inverse, idempotencyKey: "second-undo" }), "OPERATION_UNAVAILABLE");
    if (!["task.reorder", "task.order.normalize", "task.transitionMany"].includes(command)) assert.deepEqual(raw(w).find(([file]) => file === "target.json"), allBefore.find(([file]) => file === "target.json"));
  });
}

test("reorder inverse restores ties and version-only selected effects without rewriting selected original bytes", linux, t => {
  const w = materialize(t, { a: {}, b: {}, move: { orderKey: "a1" } });const original = raw(w);
  const req = batch(w, "task.reorder", [{ id: "move" }]);req.args.placement = { beforeId: "b" };
  const changed = success(send(w, req));const version = get(w, "move").version;
  const undo = success(send(w, prepared(w, "operation.undo", { operationId: changed.result.operationId })));
  assert.ok((undo.result.tasks as Projection[]).find(task => task.id === "move")!.version > version);
  assert.deepEqual(raw(w).find(([file]) => file === "move.json"), original.find(([file]) => file === "move.json"));
  assert.deepEqual((success(send(w, { command: "task.list", args: { sort: "manual" } })).result.tasks as Projection[]).map(task => task.id), ["a", "b", "move"]);
});

for (const invalid of ["edited", "formatting", "child", "dependency", "local-edit", "conflict"]) {
  test(`creation undo refuses ${invalid} without archiving/deleting/recreating`, linux, t => {
    const w = materialize(t, {});const created = success(send(w, prepared(w, "task.create", { title: "Only unchanged capture" })));
    const id = (created.result.task as Projection).id;
    if (invalid === "edited") patch(w, id, { title: "Keep this edit" });
    if (invalid === "formatting") writeFileSync(path.join(w.root, "tasks", `${id}.json`), readFileSync(path.join(w.root, "tasks", `${id}.json`), "utf8") + " ");
    if (invalid === "child" || invalid === "dependency") writeFileSync(path.join(w.root, "tasks/new.json"), JSON.stringify({ ...corpus.taskTemplate, id: "new", ...(invalid === "child" ? { parentId: id } : { dependencyIds: [id] }) }));
    if (invalid === "local-edit") { const edited = success(send(w, prepared(w, "task.update", { id, priority: 0 })));success(send(w, prepared(w, "operation.undo", { operationId: edited.result.operationId }, "undo-edit"))); }
    if (invalid === "conflict") writeFileSync(path.join(w.root, "tasks", `${id}.sync-conflict-device.json`), "raw alternate");
    const before = raw(w), req = prepared(w, "operation.undo", { operationId: created.result.operationId });
    if (invalid === "conflict") { fail(send(w, req), "OPERATION_UNAVAILABLE"); } else { fail(send(w, { ...req, dryRun: true, idempotencyKey: undefined }), "OPERATION_UNAVAILABLE");fail(send(w, req), "OPERATION_UNAVAILABLE"); }
    assert.deepEqual(raw(w), before);assert.equal(existsSync(pendingIntentPath(readRootDescriptor(w.root))), false);
  });
}

test("unchanged creation removal preserves independently verified exact raw recovery bytes, historical create/undo and retained rebuild", linux, t => {
  const w = materialize(t, {});const capture = prepared(w, "task.create", { title: "Exact capture", description: "Full **Markdown**\r\n" });
  const created = success(send(w, capture));const id = (created.result.task as Projection).id;const original = readFileSync(path.join(w.root, "tasks", `${id}.json`));
  const req = prepared(w, "operation.undo", { operationId: created.result.operationId });
  const preview = success(send(w, { ...req, dryRun: true, idempotencyKey: undefined }));assert.deepEqual(preview.result.removedIds, [id]);assert.equal(get(w, id).title, "Exact capture");
  const inverse = success(send(w, req));assert.deepEqual(inverse.result.tasks, []);assert.deepEqual(inverse.result.removedIds, [id]);assert.equal(existsSync(path.join(w.root, "tasks", `${id}.json`)), false);
  const recovery = JSON.parse(readFileSync(inverse.result.recoveryLocation as string, "utf8"));assert.deepEqual(Buffer.from(recovery.files[0].beforeBytes, "base64"), original);
  assert.deepEqual(success(send(w, capture)).result, created.result);assert.equal(existsSync(path.join(w.root, "tasks", `${id}.json`)), false);
  success(send(w, prepared(w, "workspace.rebuild", {})));assert.deepEqual(success(send(w, req)).result, inverse.result);assert.equal(rows(w).length, 2);assert.equal(existsSync(inverse.result.recoveryLocation as string), true);
});

for (const field of ["priority", "parentId", "dependencyIds"]) {
  test(`undo affected ${field} postcondition refuses without consuming key/history`, linux, t => {
    const w = materialize(t, { a: {}, b: { orderKey: "a1" }, c: { orderKey: "a2" } });const command = field === "priority" ? "task.update" : field === "parentId" ? "task.move" : "task.dependency.add";
    const changed = success(send(w, prepared(w, command, { id: "a", ...(field === "priority" ? { priority: 0 } : field === "parentId" ? { parentId: "b" } : { dependsOnId: "b" }) })));
    patch(w, "a", { [field]: field === "priority" ? 1 : field === "parentId" ? "c" : ["b", "c"] });
    const req = prepared(w, "operation.undo", { operationId: changed.result.operationId });const bytes = raw(w);fail(send(w, req), "OPERATION_UNAVAILABLE");assert.deepEqual(raw(w), bytes);assert.deepEqual(counts(w), [1, 1, 0]);
  });
}

test("latest status undo is invalidated by meaningful local or imported changes, not receipt-only no-ops", linux, t => {
  const w = materialize(t);const completed = success(send(w, prepared(w, "task.complete", { id: "a" })));
  success(send(w, prepared(w, "task.complete", { id: "a" }, "noop")));success(send(w, prepared(w, "task.status.undo", { id: "a" })));
  const again = success(send(w, prepared(w, "task.complete", { id: "a" }, "complete-again")));
  success(send(w, prepared(w, "task.update", { id: "a", description: "Intervening note" })));
  fail(send(w, prepared(w, "task.status.undo", { id: "a" }, "unavailable")), "UNDO_UNAVAILABLE");
  success(send(w, prepared(w, "operation.undo", { operationId: again.result.operationId }, "group-undo-status")));assert.equal(get(w).description, "Intervening note");assert.equal(get(w).status, "open");
  assert.notEqual(completed.result.operationId, again.result.operationId);
});

for (const command of ["task.status.undo", "task.status.undoMany", "task.transitionMany", "operation.undo"]) {
  test(`${command} context/key/preview/actor/replay, schema-3 upgrade and failed request effects`, linux, t => {
    const w = materialize(t);const initial = success(send(w, prepared(w, "task.complete", { id: "a" })));
    const req = command === "operation.undo" ? prepared(w, command, { operationId: initial.result.operationId }) : command === "task.status.undo" ? prepared(w, command, { id: "a" }) : batch(w, command, [{ id: "a", ...(command === "task.transitionMany" ? { command: "task.reopen" } : {}) }]);
    const db = new DatabaseSync(w.cache);db.exec("DROP TABLE v2_undo_claims; DROP TABLE v2_doctor_plans; PRAGMA user_version = 3;");db.close();
    const before = raw(w);const tokens = get(w).version;
    fail(send(w, { ...req, writeContext: undefined }), "WRITE_CONTEXT_REQUIRED");fail(send(w, { ...req, writeContext: "other" }), "STALE_WRITE_CONTEXT");fail(send(w, { ...req, idempotencyKey: undefined }), "IDEMPOTENCY_REQUIRED");
    for (const flag of ["dryRun", "readOnly"]) { success(send(w, { ...req, [flag]: true, idempotencyKey: undefined }));assert.deepEqual(raw(w), before);assert.equal(get(w).version, tokens);assert.deepEqual(counts(w), [1, 1, 0]); }
    const result = success(send(w, req)).result;assert.deepEqual(success(send(w, { ...req, requestId: "later" })).result, result);
    fail(send(w, { ...req, actor: { kind: "system", label: "another" } }), "IDEMPOTENCY_KEY_REUSED");fail(send(w, { ...req, readOnly: true }), "IDEMPOTENCY_KEY_REUSED");
    const verify = new DatabaseSync(w.cache);assert.equal(verify.prepare("PRAGMA user_version").get()!.user_version, 5);verify.close();
  });
}

test("batch refuses a later invalid transition atomically and dependency inverse cannot create a cycle", linux, t => {
  const w = materialize(t, { a: {}, b: { status: "canceled", closedAt: "2026-09-08T14:00:00.000Z", orderKey: "a1" } });
  const before = raw(w);
  fail(send(w, batch(w, "task.transitionMany", [{ id: "a", command: "task.complete" }, { id: "b", command: "task.start" }])), "INVALID_TRANSITION");
  assert.deepEqual(raw(w), before);assert.deepEqual(counts(w), [0, 0, 0]);
  patch(w, "a", { dependencyIds: ["b"] });
  const removed = success(send(w, prepared(w, "task.dependency.remove", { id: "a", dependsOnId: "b" })));
  patch(w, "b", { dependencyIds: ["a"] });
  const current = raw(w);fail(send(w, prepared(w, "operation.undo", { operationId: removed.result.operationId })), "DEPENDENCY_CYCLE");assert.deepEqual(raw(w), current);
});

test("rebuild retains eligible status/group history and consumed claims with fresh versions", linux, t => {
  const w = materialize(t, { a: {}, b: { orderKey: "a1" } });const completed = success(send(w, prepared(w, "task.complete", { id: "a" })));
  const oldVersion = get(w).version;success(send(w, prepared(w, "workspace.rebuild", {}, "rebuild-1")));assert.ok(get(w).version > oldVersion);
  success(send(w, prepared(w, "task.status.undo", { id: "a" })));
  success(send(w, prepared(w, "workspace.rebuild", {}, "rebuild-2")));fail(send(w, prepared(w, "operation.undo", { operationId: completed.result.operationId })), "OPERATION_UNAVAILABLE");
  const moved = success(send(w, prepared(w, "task.move", { id: "a", parentId: "b" })));
  success(send(w, prepared(w, "workspace.rebuild", {}, "rebuild-3")));success(send(w, prepared(w, "operation.undo", { operationId: moved.result.operationId }, "undo-move")));assert.equal(get(w).parentId, null);
});

test("valid history can restore a now-canceled parent without new-target eligibility or descendant changes", linux, t => {
  const w = materialize(t, { a: { parentId: "b" }, b: {}, leaf: { parentId: "a" } });const bytes = raw(w).find(([file]) => file === "leaf.json");
  const moved = success(send(w, prepared(w, "task.move", { id: "a", parentId: null })));success(send(w, prepared(w, "task.cancel", { id: "b" })));
  success(send(w, prepared(w, "operation.undo", { operationId: moved.result.operationId })));assert.equal(get(w).parentId, "b");assert.deepEqual(raw(w).find(([file]) => file === "leaf.json"), bytes);
});

test("corrupt/missing ordered history or changed complete scope cannot authorize inverse ordering", linux, t => {
  const w = materialize(t, { a: {}, b: { orderKey: "a1" } });const req = batch(w, "task.reorder", [{ id: "a" }]);req.args.placement = { last: true };
  const forward = success(send(w, req));const bytes = raw(w);
  const db = new DatabaseSync(w.cache);const row = db.prepare("SELECT after_record FROM v2_operations WHERE id = ?").get(forward.result.operationId as string)!;
  const after = JSON.parse(row.after_record as string);delete after.scope;db.prepare("UPDATE v2_operations SET after_record = ? WHERE id = ?").run(JSON.stringify(after), forward.result.operationId as string);db.close();
  fail(send(w, prepared(w, "operation.undo", { operationId: forward.result.operationId })), "OPERATION_UNAVAILABLE");assert.deepEqual(raw(w), bytes);
});

test("complete cache loss refuses old authority and cannot infer imported status or grouped undo history", linux, t => {
  const w = materialize(t);const completed = success(send(w, prepared(w, "task.complete", { id: "a" })));const old = prepared(w, "operation.undo", { operationId: completed.result.operationId });
  rmSync(w.cache);fail(send(w, old), "STALE_WRITE_CONTEXT");fail(send(w, prepared(w, "operation.undo", { operationId: completed.result.operationId })), "OPERATION_UNAVAILABLE");fail(send(w, prepared(w, "task.status.undo", { id: "a" })), "UNDO_UNAVAILABLE");assert.equal(get(w).status, "done");
});

test("strict batch item/version/command/ID shapes and empty/no-op requests have no extra group or effects", linux, t => {
  const w = materialize(t);const base = batch(w, "task.transitionMany", [{ id: "a", command: "task.complete" }]);const bytes = raw(w);
  for (const tasks of [null, [1], [{ id: "a", expectedVersion: 1, command: "task.update" }], [{ id: "a", expectedVersion: 1, command: "task.status.undo" }], [...(base.args.tasks as object[]), ...(base.args.tasks as object[])]]) fail(send(w, { ...base, args: { tasks } }), "INVALID_ARGUMENT");
  fail(send(w, { ...base, args: { tasks: [{ id: "a", command: "task.complete" }] } }), "EXPECTED_VERSION_REQUIRED");fail(send(w, { ...base, args: { tasks: [{ id: "a", command: "task.complete", expectedVersion: 99999 }] } }), "STALE_TASK_VERSION");
  assert.deepEqual(raw(w), bytes);assert.deepEqual(counts(w), [0, 0, 0]);
  for (const command of ["task.transitionMany", "task.status.undoMany"]) { const response = success(send(w, batch(w, command, [])));assert.equal(response.result.changed, false); }
  assert.deepEqual(counts(w), [2, 0, 0]);
});
