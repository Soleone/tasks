import assert from "node:assert/strict";
import test from "node:test";
import { parseRequest } from "./protocol.js";
import { requestIdentity } from "./receipts.js";
import { decodeTaskEdit, isTaskEditRequest } from "./taskEditRequest.js";
import type { TaskEditRequest } from "./taskEditRequest.js";
import type { UpdateInput } from "./updateInputs.js";

function request(command: string, args: object) {
  return parseRequest({
    version: 2,
    command,
    args,
    writeContext: "retained-context",
    idempotencyKey: "original",
    actor: { kind: "human", label: "trace" },
    readOnly: false,
    dryRun: false,
  });
}

test("decoded content retains the original envelope and raw-spelling receipt identity", () => {
  const original = request("task.update", {
    id: "a",
    expectedVersion: 7,
    title: " Call @alice ",
    category: "WORK",
    tags: ["TODO", "todo"],
  });
  assert.ok(isTaskEditRequest(original));
  const bytes = JSON.stringify(original),
    identity = requestIdentity(original);
  const edit = decodeTaskEdit(original);
  assert.equal(edit.kind, "content");
  assert.deepEqual(edit.input, {
    id: "a",
    expectedVersion: 7,
    patch: { title: "Call @alice", category: "work", tags: ["todo"] },
  });
  assert.equal(JSON.stringify(original), bytes);
  assert.equal(requestIdentity(original), identity);
  const normalized = request("task.update", {
    id: "a",
    expectedVersion: 7,
    title: "Call @alice",
    category: "work",
    tags: ["todo"],
  });
  assert.notEqual(requestIdentity(normalized), identity);
});

test("single-file request decoding chooses one existing content/status/relationship effect", () => {
  for (const [command, extra, kind] of [
    ["task.update", { description: "Markdown" }, "content"],
    ["task.complete", {}, "status"],
    ["task.move", { parentId: null }, "relationship"],
    ["task.dependency.add", { dependsOnId: "b" }, "relationship"],
  ] as const) {
    const original = request(command, { id: "a", expectedVersion: 1, ...extra });
    assert.ok(isTaskEditRequest(original));
    const edit = decodeTaskEdit(original);
    assert.equal(edit.kind, kind);
    assert.equal(edit.input.id, "a");
    assert.equal(edit.input.expectedVersion, 1);
    if (edit.kind === "status") assert.equal(edit.command, command);
  }
  for (const command of ["task.create", "task.status.undo", "workspace.recovery.resume"]) {
    assert.equal(isTaskEditRequest(request(command, {})), false);
  }
});

test("update decoder rejects unrelated canonical fields instead of leaking them into the effect", () => {
  for (const patch of [
    { status: "done" },
    { orderKey: "a1" },
    { createdAt: "2026-01-01T00:00:00Z" },
    { parentId: null },
    { title: 3 },
  ]) {
    const original = request("task.update", { id: "a", expectedVersion: 1, ...patch });
    assert.ok(isTaskEditRequest(original));
    assert.throws(() => decodeTaskEdit(original), { code: "INVALID_ARGUMENT" });
  }
});

test("TypeScript rejects non-edit commands and invalid decoded content", () => {
  const original = request("task.update", { id: "a", expectedVersion: 1 });
  // Deliberately invalid compile fixtures; never send them to a writer.
  // @ts-expect-error creation is not a single-file existing-task edit
  const invalidRequest: TaskEditRequest = { ...original, command: "task.create" };
  // @ts-expect-error decoded content cannot modify canonical status
  const invalidInput: UpdateInput = { id: "a", expectedVersion: 1, patch: { status: "done" } };
  assert.equal(invalidRequest.command, "task.create");
  assert.equal("status" in invalidInput.patch, true);
});
