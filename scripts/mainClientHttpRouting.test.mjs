import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { httpClient, selectedHttpWorkspace } from "./fixtures/mainClientHttpWorkspace.mjs";
import { draft } from "./fixtures/taskDraft.mjs";

test("platform.open-workspace: an unresolved or reconciling task change keeps the real home open", async (t) => {
  const { workspace, loseNextReply } = await selectedHttpWorkspace(t);
  const openId = "c8d4206d-c25a-4317-baa4-a2c5443060e9";
  let closes = 0;
  workspace.reader.close = async () => {
    closes += 1;
  };
  httpClient.selectMainWorkspace(workspace);
  t.after(() => httpClient.closeMainWorkspace());
  const { task } = await workspace.reader.query("task.get", { id: openId });
  loseNextReply();
  const pending = workspace.status("task.start", openId, task.version, "switch-lost-key");
  await new Promise((resolve) => {
    const stop = workspace.subscribe(() => {
      stop();
      resolve();
    });
  });
  assert.notEqual(workspace.getUnresolved(), null);
  await assert.rejects(httpClient.switchHome(), /WRITE_IN_PROGRESS/);
  const refused = assert.rejects(pending, /MANUAL_RECONCILIATION/);
  workspace.getUnresolved().preserveForReconciliation();
  await refused;
  assert.equal(workspace.getUnresolved(), null);
  await assert.rejects(httpClient.switchHome(), /WRITE_IN_PROGRESS/);
  assert.equal(closes, 0);
  assert.equal(typeof (await httpClient.getWorkspaceChanges()).revision, "number");
});

test("main UI over the Linux HTTP bridge persists direct actions", async (t) => {
  const { root, calls, workspace } = await selectedHttpWorkspace(t);
  httpClient.selectMainWorkspace(workspace);
  const openId = "c8d4206d-c25a-4317-baa4-a2c5443060e9";

  const created = await httpClient.createTask(draft("Call @alice #home", "Notes", 0), {});
  assert.deepEqual([created.task.title, created.task.priority], ["Call", 0]);
  const stored = JSON.parse(
    readFileSync(path.join(root, "tasks", `${created.task.id}.json`), "utf8"),
  );
  assert.deepEqual(
    [stored.title, stored.category, stored.tags, stored.priority],
    ["Call", "alice", ["home"], 0],
  );
  const { task } = await httpClient.getTask(openId);
  const completed = await httpClient.transitionTask("task.complete", openId, task.version, {});
  assert.equal(completed.task.status, "done");
  const undone = await httpClient.undoOperation(completed.operationId, {});
  assert.equal(undone.tasks[0].status, "open");
  assert.equal(
    JSON.parse(readFileSync(path.join(root, "tasks", `${openId}.json`), "utf8")).status,
    "open",
  );
  const child = await httpClient.createTask(draft("Child"), { parentId: openId });
  assert.equal(child.task.parentId, openId);
  const top = await httpClient.moveTask(child.task.id, null, child.task.version, {});
  const linked = await httpClient.addDependency(top.task.id, openId, top.task.version, {});
  const unlinked = await httpClient.removeDependency(
    linked.task.id,
    openId,
    linked.task.version,
    {},
  );
  assert.deepEqual(
    [top.task.parentId, linked.task.blockedByIds, unlinked.task.dependencyIds],
    [null, [openId], []],
  );
  const reordered = await httpClient.reorderTasks(
    [{ id: unlinked.task.id, expectedVersion: unlinked.task.version }],
    { last: true },
    {},
  );
  assert.deepEqual(
    [reordered.changed, reordered.tasks.map((task) => task.id)],
    [true, [unlinked.task.id]],
  );
  const undoneOrder = await httpClient.undoOperation(reordered.operationId, {});
  assert.deepEqual(
    [
      undoneOrder.changed,
      undoneOrder.undoneOperationId,
      undoneOrder.deletedTaskIds,
      undoneOrder.tasks.map((task) => task.id),
    ],
    [true, reordered.operationId, [], [unlinked.task.id]],
  );
  const batch = await httpClient.transitionTasks(
    [
      {
        id: openId,
        expectedVersion: (await httpClient.getTask(openId)).task.version,
        command: "task.start",
      },
      {
        id: unlinked.task.id,
        expectedVersion: undoneOrder.tasks[0].version,
        command: "task.complete",
      },
    ],
    {},
  );
  assert.deepEqual(
    [batch.changed, typeof batch.operationId, batch.tasks.map((task) => task.status)],
    [true, "string", ["in_progress", "done"]],
  );
  assert.deepEqual(
    calls
      .filter((call) => call.readOnly === false && call.dryRun === false)
      .map((call) => call.command),
    [
      "task.create",
      "task.complete",
      "operation.undo",
      "task.create",
      "task.move",
      "task.dependency.add",
      "task.dependency.remove",
      "task.reorder",
      "operation.undo",
      "task.transitionMany",
    ],
  );
  assert.ok(calls.every((call) => call.version === 2));
});

test("a lost bridge reply locks the original request and Retry same request reuses its envelope", async (t) => {
  const { calls, workspace, loseNextReply } = await selectedHttpWorkspace(t);
  const openId = "c8d4206d-c25a-4317-baa4-a2c5443060e9";
  const { task } = await workspace.reader.query("task.get", { id: openId });
  loseNextReply();
  const pending = workspace.status("task.start", openId, task.version, "lost-reply-key");
  await new Promise((resolve) => {
    const stop = workspace.subscribe(() => {
      stop();
      resolve();
    });
  });
  const unresolved = workspace.getUnresolved();
  assert.match(unresolved.error, /Failed to fetch/);
  await assert.rejects(
    () => workspace.status("task.pause", openId, task.version, "other-key"),
    /WRITE_IN_PROGRESS/,
  );
  await unresolved.retry();
  const result = await pending;
  assert.equal(result.task.status, "in_progress");
  assert.equal(workspace.getUnresolved(), null);
  const writes = calls.filter((call) => call.readOnly === false && call.dryRun === false);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1], writes[0]);

  loseNextReply();
  const linking = workspace.relationship(
    "task.dependency.add",
    openId,
    result.task.version,
    "f3e5499b-402e-4d7d-8b61-eefc4409ca32",
    "lost-link-key",
  );
  await new Promise((resolve) => {
    const stop = workspace.subscribe(() => {
      stop();
      resolve();
    });
  });
  await workspace.getUnresolved().retry();
  assert.deepEqual((await linking).task.blockedByIds, ["f3e5499b-402e-4d7d-8b61-eefc4409ca32"]);
  const links = calls.filter(
    (call) => call.command === "task.dependency.add" && call.dryRun === false,
  );
  assert.equal(links.length, 2);
  assert.deepEqual(links[1], links[0]);

  loseNextReply();
  const linked = (await linking).task;
  const reordering = workspace.reorder(
    [{ id: openId, expectedVersion: linked.version }],
    { first: true },
    "lost-order-key",
  );
  await new Promise((resolve) => {
    const stop = workspace.subscribe(() => {
      stop();
      resolve();
    });
  });
  await assert.rejects(
    () =>
      workspace.reorder(
        [{ id: openId, expectedVersion: linked.version }],
        { last: true },
        "replacement-key",
      ),
    /WRITE_IN_PROGRESS/,
  );
  await workspace.getUnresolved().retry();
  assert.deepEqual(
    (await reordering).tasks.map((task) => task.id),
    [openId],
  );
  const orders = calls.filter((call) => call.command === "task.reorder" && call.dryRun === false);
  assert.equal(orders.length, 2);
  assert.deepEqual(orders[1], orders[0]);

  loseNextReply();
  const undoing = workspace.undo((await reordering).operationId, "lost-undo-key");
  await new Promise((resolve) => {
    const stop = workspace.subscribe(() => {
      stop();
      resolve();
    });
  });
  await assert.rejects(
    () => workspace.undo("other-operation", "replacement-undo-key"),
    /WRITE_IN_PROGRESS/,
  );
  await workspace.getUnresolved().retry();
  assert.equal((await undoing).changed, true);
  const undos = calls.filter((call) => call.command === "operation.undo" && call.dryRun === false);
  assert.equal(undos.length, 2);
  assert.deepEqual(undos[1], undos[0]);
});

test("Linux route applies all-or-refuse status batches and refuses an invalid batch before sending", async (t) => {
  const { root, calls, workspace } = await selectedHttpWorkspace(t);
  const bytes = (id) => readFileSync(path.join(root, "tasks", `${id}.json`), "utf8");
  const executing = () =>
    calls
      .filter((call) => call.readOnly === false && call.dryRun === false)
      .map((call) => call.command);
  const version = async (id) => (await workspace.reader.query("task.get", { id })).task.version;
  const openId = "c8d4206d-c25a-4317-baa4-a2c5443060e9",
    pausedId = "62f159c1-22a7-45cb-89a0-c0c35aaeb1ed",
    doneId = "f3e5499b-402e-4d7d-8b61-eefc4409ca32";

  // The gateway validates the whole batch; one ineligible item refuses every item, with no executing request.
  const original = [openId, pausedId, doneId].map(bytes);
  const start = { id: openId, expectedVersion: await version(openId), command: "task.start" };
  const pausedVersion = await version(pausedId),
    doneVersion = await version(doneId);
  await assert.rejects(
    () =>
      workspace.transitionMany(
        [start, { id: doneId, expectedVersion: doneVersion, command: "task.pause" }],
        "invalid-key",
      ),
    /INVALID_TRANSITION/,
  );
  await assert.rejects(
    () =>
      workspace.transitionMany(
        [start, { id: pausedId, expectedVersion: pausedVersion + 1, command: "task.complete" }],
        "stale-key",
      ),
    /STALE_TASK_VERSION/,
  );
  await assert.rejects(
    () =>
      workspace.transitionMany(
        [start, { id: "missing", expectedVersion: 1, command: "task.complete" }],
        "missing-key",
      ),
    /TASK_NOT_FOUND/,
  );
  assert.deepEqual(executing(), [], "refused batches send no executing request");
  assert.deepEqual(
    [openId, pausedId, doneId].map(bytes),
    original,
    "refused batches have no partial effects",
  );
  assert.equal(workspace.getUnresolved(), null);

  const completed = await workspace.transitionMany(
    [
      { id: pausedId, expectedVersion: pausedVersion, command: "task.complete" },
      { ...start, command: "task.complete" },
    ],
    "complete-key",
  );
  assert.deepEqual(
    [
      completed.changed,
      typeof completed.operationId,
      completed.tasks.map((task) => [task.id, task.status]),
    ],
    [
      true,
      "string",
      [
        [pausedId, "done"],
        [openId, "done"],
      ],
    ],
  );
  assert.deepEqual(
    [pausedId, openId].map((id) => JSON.parse(bytes(id)).status),
    ["done", "done"],
  );
  const noop = await workspace.transitionMany(
    completed.tasks.map((task) => ({
      id: task.id,
      expectedVersion: task.version,
      command: "task.complete",
    })),
    "noop-key",
  );
  assert.deepEqual([noop.changed, noop.operationId], [false, undefined]);
  assert.deepEqual(executing(), ["task.transitionMany", "task.transitionMany"]);
});

test("a lost status-batch reply retries the same envelope", async (t) => {
  const { calls, workspace, loseNextReply } = await selectedHttpWorkspace(t);
  const version = async (id) => (await workspace.reader.query("task.get", { id })).task.version;
  const openId = "c8d4206d-c25a-4317-baa4-a2c5443060e9",
    pausedId = "62f159c1-22a7-45cb-89a0-c0c35aaeb1ed";
  const batches = () =>
    calls.filter((call) => call.command === "task.transitionMany" && call.dryRun === false);
  const unresolved = () =>
    new Promise((resolve) => {
      const stop = workspace.subscribe(() => {
        stop();
        resolve(workspace.getUnresolved());
      });
    });

  loseNextReply();
  const starting = workspace.transitionMany(
    [
      { id: openId, expectedVersion: await version(openId), command: "task.start" },
      { id: pausedId, expectedVersion: await version(pausedId), command: "task.start" },
    ],
    "lost-batch-key",
  );
  const locked = await unresolved();
  assert.match(locked.error, /Failed to fetch/);
  await assert.rejects(
    () =>
      workspace.transitionMany(
        [{ id: openId, expectedVersion: 1, command: "task.pause" }],
        "replacement-key",
      ),
    /WRITE_IN_PROGRESS/,
  );
  await locked.retry();
  assert.deepEqual(
    (await starting).tasks.map((task) => task.status),
    ["in_progress", "in_progress"],
  );
  assert.equal(batches().length, 2);
  assert.deepEqual(batches()[1], batches()[0]);
});
