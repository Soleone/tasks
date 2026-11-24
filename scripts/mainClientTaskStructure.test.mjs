import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { selectedHttpWorkspace } from "./fixtures/mainClientHttpWorkspace.mjs";
import { draft } from "./fixtures/taskDraft.mjs";

function savedState(workspace) {
  const { rootPath, databasePath } = workspace.reader.selection;
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return {
      files: Object.fromEntries(
        [
          "workspace.json",
          ...readdirSync(path.join(rootPath, "tasks")).map((name) => `tasks/${name}`),
        ].map((name) => [name, readFileSync(path.join(rootPath, name), "base64")]),
      ),
      receipts: database.prepare("SELECT COUNT(*) AS n FROM v2_receipts").get().n,
      operations: database.prepare("SELECT COUNT(*) AS n FROM v2_operations").get().n,
    };
  } finally {
    database.close();
  }
}

test("Linux route persists child capture, parent moves and dependency edits with current blocking rules", async (t) => {
  const { root, calls, workspace } = await selectedHttpWorkspace(t);
  const stored = (id) => JSON.parse(readFileSync(path.join(root, "tasks", `${id}.json`), "utf8"));
  const writes = () =>
    calls
      .filter((call) => call.readOnly === false && call.dryRun === false)
      .map((call) => call.command);
  const openId = "c8d4206d-c25a-4317-baa4-a2c5443060e9",
    childId = "6e1bf023-da3c-4785-b8a9-a696ac1fa5c1";
  const pausedId = "62f159c1-22a7-45cb-89a0-c0c35aaeb1ed",
    doneId = "f3e5499b-402e-4d7d-8b61-eefc4409ca32";

  const child = (
    await workspace.createChild(openId, draft("Draft brief #home", "", 1), "child-key")
  ).task;
  assert.deepEqual(
    [child.parentId, stored(child.id).parentId, stored(child.id).tags],
    [openId, openId, ["home"]],
  );
  const moved = (
    await workspace.relationship("task.move", child.id, child.version, null, "move-key")
  ).task;
  assert.equal(stored(child.id).parentId, null);

  const blockedByDone = (
    await workspace.relationship("task.dependency.add", moved.id, moved.version, doneId, "done-key")
  ).task;
  assert.deepEqual(blockedByDone.blockedByIds, [doneId], "a done dependency still blocks");
  const blockedByBoth = (
    await workspace.relationship(
      "task.dependency.add",
      moved.id,
      blockedByDone.version,
      pausedId,
      "paused-key",
    )
  ).task;
  const paused = (await workspace.reader.query("task.get", { id: pausedId })).task;
  await workspace.status("task.cancel", pausedId, paused.version, "cancel-key");
  const afterCancel = (await workspace.reader.query("task.get", { id: moved.id })).task;
  assert.deepEqual(
    [afterCancel.dependencyIds, afterCancel.blockedByIds],
    [[pausedId, doneId].sort(), [doneId]],
    "a canceled dependency does not block",
  );
  const noop = await workspace.relationship(
    "task.dependency.add",
    moved.id,
    blockedByBoth.version,
    pausedId,
    "already-linked-key",
  );
  assert.deepEqual(
    [noop.changed, noop.operationId],
    [false, undefined],
    "an existing canceled link stays a no-op",
  );
  const unblocked = (
    await workspace.relationship(
      "task.dependency.remove",
      moved.id,
      blockedByBoth.version,
      doneId,
      "remove-key",
    )
  ).task;
  assert.deepEqual([stored(moved.id).dependencyIds, unblocked.blockedByIds], [[pausedId], []]);
  assert.deepEqual(writes(), [
    "task.create",
    "task.move",
    "task.dependency.add",
    "task.dependency.add",
    "task.cancel",
    "task.dependency.add",
    "task.dependency.remove",
  ]);

  const sent = writes().length;
  const beforeRefusals = savedState(workspace);
  const previewsBefore = calls.filter((call) => call.dryRun).length;
  const parent = (await workspace.reader.query("task.get", { id: openId })).task;
  await assert.rejects(
    () => workspace.relationship("task.move", openId, parent.version, childId, "cycle-key"),
    /PARENT_CYCLE/,
  );
  await assert.rejects(
    () =>
      workspace.relationship(
        "task.dependency.add",
        openId,
        parent.version,
        childId,
        "dependency-cycle-key",
      ),
    /DEPENDENCY_CYCLE/,
  );
  await assert.rejects(
    () =>
      workspace.relationship(
        "task.dependency.add",
        openId,
        parent.version,
        pausedId,
        "canceled-key",
      ),
    /INVALID_DEPENDENCY/,
  );
  await assert.rejects(
    () => workspace.relationship("task.move", moved.id, moved.version, openId, "stale-key"),
    /STALE_TASK_VERSION/,
  );
  assert.equal(writes().length, sent, "refused previews send no executing relationship write");
  assert.equal(calls.filter((call) => call.dryRun).length - previewsBefore, 3);
  assert.deepEqual(savedState(workspace), beforeRefusals);
  assert.equal(workspace.getUnresolved(), null);
  assert.equal(workspace.hasWriteInProgress(), false);
  await workspace.relationship(
    "task.move",
    moved.id,
    unblocked.version,
    openId,
    "valid-after-refusal",
  );
});

test("Linux route persists manual reorder across reopen and previews ordering refusals before executing", async (t) => {
  const { root, calls, workspace, reopen } = await selectedHttpWorkspace(t);
  const bytes = (id) => readFileSync(path.join(root, "tasks", `${id}.json`), "utf8");
  const writes = () =>
    calls
      .filter((call) => call.readOnly === false && call.dryRun === false)
      .map((call) => call.command);
  const topLevel = async (selected) =>
    (await selected.tasks({ sort: "manual", limit: 100 })).tasks
      .filter((task) => task.parentId === null)
      .map((task) => task.id);
  const pausedId = "62f159c1-22a7-45cb-89a0-c0c35aaeb1ed",
    doneId = "f3e5499b-402e-4d7d-8b61-eefc4409ca32";
  const openId = "c8d4206d-c25a-4317-baa4-a2c5443060e9",
    childId = "6e1bf023-da3c-4785-b8a9-a696ac1fa5c1";
  assert.deepEqual(await topLevel(workspace), [pausedId, doneId, openId]);

  const version = (id) =>
    workspace.reader.query("task.get", { id }).then((result) => result.task.version);
  const untouched = [bytes(pausedId), bytes(doneId)];
  const moved = await workspace.reorder(
    [{ id: openId, expectedVersion: await version(openId) }],
    { beforeId: pausedId },
    "move-key",
  );
  assert.deepEqual(
    [moved.changed, typeof moved.operationId, moved.tasks.map((task) => task.id)],
    [true, "string", [openId]],
  );
  assert.ok(JSON.parse(bytes(openId)).orderKey < "a0");
  assert.deepEqual(
    [bytes(pausedId), bytes(doneId)],
    untouched,
    "an end-gap move rewrites only the selected task",
  );
  const noop = await workspace.reorder(
    [{ id: openId, expectedVersion: moved.tasks[0].version }],
    { first: true },
    "noop-key",
  );
  assert.deepEqual([noop.changed, noop.operationId], [false, undefined]);
  assert.deepEqual(writes(), ["task.reorder", "task.reorder"]);

  const beforeRefusals = savedState(workspace);
  const stale = [{ id: pausedId, expectedVersion: (await version(pausedId)) + 1 }];
  const pausedVersion = await version(pausedId),
    doneVersion = await version(doneId),
    childVersion = await version(childId);
  await assert.rejects(
    () => workspace.reorder(stale, { first: true }, "stale-key"),
    /STALE_TASK_VERSION/,
  );
  await assert.rejects(
    () =>
      workspace.reorder(
        [
          { id: doneId, expectedVersion: doneVersion },
          { id: pausedId, expectedVersion: pausedVersion },
        ],
        { first: true },
        "order-key",
      ),
    /INVALID_ARGUMENT/,
  );
  await assert.rejects(
    () =>
      workspace.reorder(
        [
          { id: pausedId, expectedVersion: pausedVersion },
          { id: childId, expectedVersion: childVersion },
        ],
        { last: true },
        "mixed-key",
      ),
    /INVALID_ARGUMENT/,
  );
  await assert.rejects(
    () =>
      workspace.reorder(
        [{ id: pausedId, expectedVersion: pausedVersion }],
        { afterId: childId },
        "anchor-key",
      ),
    /INVALID_ARGUMENT/,
  );
  await assert.rejects(
    () =>
      workspace.reorder(
        [{ id: pausedId, expectedVersion: pausedVersion }],
        { beforeId: pausedId },
        "self-key",
      ),
    /INVALID_ARGUMENT/,
  );
  assert.equal(writes().length, 2, "refused previews send no executing reorder");
  assert.deepEqual(savedState(workspace), beforeRefusals);
  assert.equal(workspace.getUnresolved(), null);
  assert.equal(workspace.hasWriteInProgress(), false);
  await workspace.reorder(
    [{ id: openId, expectedVersion: moved.tasks[0].version }],
    { first: true },
    "valid-after-refusal",
  );

  const reopened = await reopen();
  assert.deepEqual(
    await topLevel(reopened),
    [openId, pausedId, doneId],
    "manual order persists after reopening with a fresh cache",
  );
});

test("reorder preview stays inside the write guard and execution revalidates the same prepared request", async (t) => {
  const { root, calls, workspace } = await selectedHttpWorkspace(t);
  const id = "c8d4206d-c25a-4317-baa4-a2c5443060e9";
  const version = (await workspace.reader.query("task.get", { id })).task.version;
  const originalFetch = globalThis.fetch;
  let afterRace;
  globalThis.fetch = async (...args) => {
    const request = args[1]?.body ? JSON.parse(args[1].body) : null;
    const response = await originalFetch(...args);
    if (request?.command === "task.reorder" && request.dryRun) {
      assert.equal(workspace.hasWriteInProgress(), true);
      const before = calls.length;
      await assert.rejects(
        workspace.status("task.start", id, version, "during-preview"),
        /WRITE_IN_PROGRESS/,
      );
      assert.equal(calls.length, before);
      const file = path.join(root, "tasks", `${id}.json`);
      const task = JSON.parse(readFileSync(file, "utf8"));
      writeFileSync(file, JSON.stringify({ ...task, title: "Changed after preview" }));
      afterRace = savedState(workspace);
    }
    return response;
  };
  try {
    const unresolved = new Promise((resolve) => {
      const stop = workspace.subscribe(() => {
        if (workspace.getUnresolved()) {
          stop();
          resolve(workspace.getUnresolved());
        }
      });
    });
    const reordering = workspace.reorder(
      [{ id, expectedVersion: version }],
      { first: true },
      "race-key",
    );
    const refused = assert.rejects(reordering, /MANUAL_RECONCILIATION/);
    const locked = await unresolved;
    assert.match(locked.error, /STALE_TASK_VERSION/);
    const [preview, execution] = calls.filter((call) => call.command === "task.reorder");
    assert.deepEqual(preview.args, execution.args);
    assert.equal(preview.writeContext, execution.writeContext);
    assert.equal(preview.idempotencyKey, undefined);
    assert.equal(execution.idempotencyKey, "race-key");
    assert.notEqual(preview.requestId, execution.requestId);
    assert.deepEqual(savedState(workspace), afterRace);
    locked.preserveForReconciliation();
    await refused;
  } finally {
    globalThis.fetch = originalFetch;
  }
});
