import assert from "node:assert/strict";
import test from "node:test";
import { createCopyTestWorkspace as setup, send, success } from "./copyTestWorkspace.js";
import type { CopyTestWorkspace as Workspace } from "./copyTestWorkspace.js";

const linux = { skip: process.platform !== "linux" };
let key = 0;
function write(w: Workspace, command: string, args: Record<string, unknown>) {
  const writeContext = success(send(w, { command: "workspace.info" })).writeContext;
  return success(send(w, { command, args, writeContext, idempotencyKey: `meta-${++key}` }))
    .result as { task: { id: string; version: number; meta: object }; operationId: string };
}
function meta(w: Workspace, id: string) {
  return (
    success(send(w, { command: "task.get", args: { id } })).result as { task: { meta: object } }
  ).task.meta;
}

test("data.meta: kept through edits, renames, undo and redo", linux, (t) => {
  const w = setup(t);
  const created = write(w, "task.create", {
    title: "Port #ui",
    meta: { factory: { tier: "grunt" } },
  });
  const id = created.task.id;
  assert.deepEqual(created.task.meta, { factory: { tier: "grunt" } });
  const updated = write(w, "task.update", {
    id,
    expectedVersion: created.task.version,
    meta: { factory: { tier: "builder" } },
  });
  write(w, "task.update", { id, expectedVersion: updated.task.version, title: "Port it" });
  write(w, "tag.rename", { from: "ui", to: "gpui" });
  assert.deepEqual(meta(w, id), { factory: { tier: "builder" } });
  write(w, "operation.undo", { operationId: updated.operationId });
  assert.deepEqual(meta(w, id), { factory: { tier: "grunt" } });
});
