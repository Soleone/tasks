import assert from "node:assert/strict";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { TestContext } from "node:test";
import { createCopyTestWorkspace as setup, fail, send, success } from "./copyTestWorkspace.js";
import type { CopyTestWorkspace as Workspace } from "./copyTestWorkspace.js";
import type { CanonicalTask } from "./taskModel.js";

const corpus = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../scripts/fixtures/workspace/cases.json", import.meta.url)),
    "utf8",
  ),
);
const linux = { skip: process.platform !== "linux" };
const closed = "2026-09-09T10:00:00.000Z";

function materialize(t: TestContext, records: Record<string, Partial<CanonicalTask>>) {
  const w = setup(t);
  for (const file of readdirSync(path.join(w.root, "tasks")))
    rmSync(path.join(w.root, "tasks", file));
  for (const [id, patch] of Object.entries(records))
    writeFileSync(
      path.join(w.root, "tasks", `${id}.json`),
      JSON.stringify({ ...corpus.taskTemplate, ...patch, id }),
    );
  return w;
}
function stored(w: Workspace, id: string): CanonicalTask {
  return JSON.parse(readFileSync(path.join(w.root, "tasks", `${id}.json`), "utf8"));
}
let key = 0;
function write(w: Workspace, command: string, args: Record<string, unknown>) {
  const writeContext = success(send(w, { command: "workspace.info" })).writeContext;
  return send(w, { command, args, writeContext, idempotencyKey: `rename-${++key}` });
}
function rename(w: Workspace, command: string, from: string, to: string) {
  return success(write(w, command, { from, to })).result as {
    tasks: { id: string }[];
    changed: boolean;
    merged: boolean;
    operationId: string;
  };
}

test("rename.scope: every task with the tag changes, whatever its status", linux, (t) => {
  const w = materialize(t, {
    a: { tags: ["wrk"] },
    b: { tags: ["errand", "wrk"], status: "done", closedAt: closed, orderKey: "a1" },
    c: { tags: ["wrk"], status: "canceled", closedAt: closed, orderKey: "a2" },
    d: { tags: ["errand"], orderKey: "a3" },
  });
  const untouched = readFileSync(path.join(w.root, "tasks/d.json"));
  const result = rename(w, "tag.rename", "wrk", "Work");
  assert.equal(result.changed, true);
  assert.equal(result.merged, false);
  assert.deepEqual(result.tasks.map((task) => task.id).sort(), ["a", "b", "c"]);
  assert.deepEqual(stored(w, "a").tags, ["work"]);
  assert.deepEqual(stored(w, "b").tags, ["errand", "work"]);
  assert.deepEqual(stored(w, "c").tags, ["work"]);
  assert.deepEqual(readFileSync(path.join(w.root, "tasks/d.json")), untouched);
  fail(write(w, "tag.rename", { from: "work", to: "1st" }), "INVALID_ARGUMENT");
  fail(write(w, "category.rename", { from: "work" }), "INVALID_ARGUMENT");
});

test("rename.merge: a name already in use merges into it", linux, (t) => {
  const w = materialize(t, {
    a: { tags: ["work", "wrk"], category: "wrk" },
    b: { tags: ["wrk"], category: "home", orderKey: "a1" },
  });
  const tags = rename(w, "tag.rename", "wrk", "work");
  assert.equal(tags.merged, true);
  assert.deepEqual(stored(w, "a").tags, ["work"]);
  assert.deepEqual(stored(w, "b").tags, ["work"]);
  const category = rename(w, "category.rename", "wrk", "home");
  assert.equal(category.merged, true);
  assert.equal(stored(w, "a").category, "home");
});

test("rename.noop: an unused name, or the same name, writes nothing", linux, (t) => {
  const w = materialize(t, { a: { tags: ["wrk"], text: "Plan #wrk" } });
  const before = readFileSync(path.join(w.root, "tasks/a.json"));
  for (const [from, to] of [
    ["missing", "work"],
    ["wrk", "wrk"],
  ]) {
    const result = rename(w, "tag.rename", from, to);
    assert.equal(result.changed, false);
    assert.equal(result.merged, false);
  }
  assert.deepEqual(readFileSync(path.join(w.root, "tasks/a.json")), before);
});

test("rename.text: text is cleared and both timestamps are kept", linux, (t) => {
  const w = materialize(t, {
    a: { title: "Plan", tags: ["wrk"], text: "Plan #wrk", status: "done", closedAt: closed },
  });
  const before = stored(w, "a");
  rename(w, "tag.rename", "wrk", "work");
  assert.deepEqual(stored(w, "a"), { ...before, tags: ["work"], text: null });
});

test("rename.undo: undo and redo are one step each and keep updatedAt", linux, (t) => {
  const w = materialize(t, {
    a: { tags: ["work", "wrk"], text: "Plan #work #wrk" },
    b: { tags: ["wrk"], orderKey: "a1" },
  });
  const original = { a: stored(w, "a"), b: stored(w, "b") };
  const forward = rename(w, "tag.rename", "wrk", "work");
  const undone = success(write(w, "operation.undo", { operationId: forward.operationId }));
  assert.deepEqual({ a: stored(w, "a"), b: stored(w, "b") }, original);
  success(write(w, "operation.redo", { operationId: undone.result.operationId }));
  assert.deepEqual(stored(w, "a"), { ...original.a, tags: ["work"], text: null });
  assert.deepEqual(stored(w, "b"), { ...original.b, tags: ["work"], text: null });
});

test("rename.undo: undo is refused once a renamed task changed since", linux, (t) => {
  const w = materialize(t, { a: { tags: ["wrk"] }, b: { tags: ["wrk"], orderKey: "a1" } });
  const forward = rename(w, "tag.rename", "wrk", "work");
  const version = (
    success(send(w, { command: "task.get", args: { id: "b" } })).result.task as {
      version: number;
    }
  ).version;
  success(write(w, "task.update", { id: "b", expectedVersion: version, tags: ["other"] }));
  fail(write(w, "operation.undo", { operationId: forward.operationId }), "OPERATION_UNAVAILABLE");
  assert.deepEqual(stored(w, "a").tags, ["work"]);
});
