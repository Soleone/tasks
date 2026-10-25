import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const compiled = await build({
  stdin: {
    contents: `export * from './src/platform/backendClient';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  define: { "import.meta.env": JSON.stringify({}) },
});
const client = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);

const draft = (text, description = "", priority = 2) => ({
  text,
  description,
  priority,
  attachments: [],
  due: null,
});

const withheldActions = [
  ["transitionTasks", [[{ id: "id", expectedVersion: 1, command: "task.start" }], {}]],
  ["undoOperation", ["operation", {}]],
  ["redoOperation", ["operation", {}]],
  ["moveTask", ["id", null, 1, {}]],
  ["reorderTasks", [[{ id: "id", expectedVersion: 1 }], { first: true }, {}]],
  ["addDependency", ["id", "blocker", 1, {}]],
  ["removeDependency", ["id", "blocker", 1, {}]],
];

test("without an open task folder every client call refuses", async () => {
  await assert.rejects(() => client.listTasks(), /NO_WORKSPACE/);
  await assert.rejects(() => client.createTask(draft("Lost"), {}), /NO_WORKSPACE/);
});

test("main UI calls concrete selected actions; unadvertised operations never fall through", async () => {
  const calls = [];
  const workspace = {
    async save(...args) {
      calls.push(["save", ...args]);
      return {};
    },
    async priority(...args) {
      calls.push(["priority", ...args]);
      return {};
    },
    async status(...args) {
      calls.push(["status", ...args]);
      return {};
    },
    async revision() {
      calls.push(["revision"]);
      return 7;
    },
  };
  client.selectMainWorkspace(workspace);
  await assert.rejects(
    () => client.createTask(draft("Child"), { parentId: "parent" }),
    /Child capture/,
  );
  for (const [action, args] of withheldActions) {
    await assert.rejects(
      () => client[action](...args),
      /selected workspace/,
      `${action} needs its command advertised`,
    );
  }
  assert.deepEqual(calls, []);
  await client.createTask(draft("Inline @work", "Notes", 1), { idempotencyKey: "capture-key" });
  await client.updateTask("id", draft("Inline @work", "Notes", 1), 3, {
    idempotencyKey: "edit-key",
  });
  await client.updateTaskPriority({ id: "id", version: 3 }, 0, { idempotencyKey: "priority-key" });
  await client.transitionTask("task.start", "id", 3, { idempotencyKey: "status-key" });
  await client.undoStatusChange("id", 4, { idempotencyKey: "undo-key" });
  assert.equal(await client.getWorkspaceRevision(), 7);
  assert.deepEqual(calls, [
    ["save", draft("Inline @work", "Notes", 1), "capture-key"],
    ["save", draft("Inline @work", "Notes", 1), "edit-key", "id", 3],
    ["priority", "id", 3, 0, "priority-key"],
    ["status", "task.start", "id", 3, "status-key"],
    ["status", "task.status.undo", "id", 4, "undo-key"],
    ["revision"],
  ]);
});

test("queued writes stay with the folder selected when they were made", async () => {
  client.closeMainWorkspace();
  const calls = [];
  let finish;
  const first = {
    async status(...args) {
      calls.push(["first", ...args]);
      await new Promise((resolve) => {
        finish = resolve;
      });
      return {};
    },
    async save(...args) {
      calls.push(["first-save", ...args]);
      return {};
    },
  };
  const second = {
    async save(...args) {
      calls.push(["second-save", ...args]);
      return {};
    },
  };
  client.selectMainWorkspace(first);
  const started = client.transitionTask("task.start", "id", 1, { idempotencyKey: "start" });
  await new Promise((resolve) => setImmediate(resolve));
  const capture = client.createTask(draft("Queued"), { idempotencyKey: "capture" });
  client.closeMainWorkspace();
  client.selectMainWorkspace(second);
  const nextCapture = client.createTask(draft("Next"), { idempotencyKey: "next" });
  finish();
  await started;
  await assert.rejects(capture, /NO_WORKSPACE/);
  await nextCapture;
  assert.deepEqual(calls, [
    ["first", "task.start", "id", 1, "start"],
    ["second-save", draft("Next"), "next"],
  ]);
  client.closeMainWorkspace();
});

const http = await build({
  stdin: {
    contents: `export * from './src/platform/backendClient'; export {MainWorkspace} from './src/platform/mainWorkspace'; export {WorkspaceReader} from './src/platform/workspaceReader'; export {readEditorSelection, EditorClient} from './src/platform/editorClient'; export {UndoHistory, UNDO_HISTORY_LIMIT} from './src/platform/undoHistory';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  define: { "import.meta.env": JSON.stringify({}) },
});
const httpClient = await import(
  `data:text/javascript;base64,${Buffer.from(http.outputFiles[0].text).toString("base64")}`
);
const { startDevServer } = await import("../test-dist/backend/devServer.js");

async function selectedHttpWorkspace(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "taskdb-main-http-"));
  const home = path.join(directory, "home"),
    root = path.join(home, "sync"),
    cache = path.join(home, "local", "app.db");
  cpSync("scripts/fixtures/workspace/root", root, { recursive: true });
  mkdirSync(path.join(home, "local"));
  const originalFetch = globalThis.fetch;
  let dev = await startDevServer({ port: 0, home });
  const calls = [];
  let loseNextWriteReply = false;
  globalThis.fetch = async (...args) => {
    const request = args[1]?.body ? JSON.parse(args[1].body) : null;
    if (request) calls.push(request);
    const response = await originalFetch(...args);
    if (request?.readOnly === false && request.dryRun === false && loseNextWriteReply) {
      loseNextWriteReply = false;
      throw new TypeError("Failed to fetch");
    }
    return response;
  };
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => dev.server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  });
  const confirm = async (storage) => {
    const selection = await httpClient.readEditorSelection(dev.url);
    return new httpClient.MainWorkspace(
      new httpClient.WorkspaceReader(selection, { url: dev.url, selection }),
      new httpClient.EditorClient(dev.url, selection),
      storage,
    );
  };
  // Restart the bridge with the cache set aside and reconfirm, as after losing the cache.
  const reopen = async () => {
    await new Promise((resolve) => dev.server.close(resolve));
    renameSync(cache, `${cache}.set-aside`);
    dev = await startDevServer({ port: 0, home });
    return confirm();
  };
  // Restart the bridge on the same home and cache, as after closing and reopening.
  const restart = async (storage) => {
    await new Promise((resolve) => dev.server.close(resolve));
    dev = await startDevServer({ port: 0, home });
    return confirm(storage);
  };
  return {
    directory,
    root,
    calls,
    workspace: await confirm(),
    confirm,
    reopen,
    restart,
    loseNextReply: () => {
      loseNextWriteReply = true;
    },
  };
}

test("main UI over the Linux HTTP bridge persists direct actions", async (t) => {
  const { root, calls, workspace } = await selectedHttpWorkspace(t);
  httpClient.selectMainWorkspace(workspace);
  const openId = "c8d4206d-c25a-4317-baa4-a2c5443060e9";
  assert.equal(workspace.supportsRelationships, true);

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
  const undone = await httpClient.undoStatusChange(openId, completed.task.version, {});
  assert.equal(undone.task.status, "open");
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
      "task.status.undo",
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

test("Linux route persists child capture, parent moves and dependency edits with current blocking rules", async (t) => {
  const { root, calls, workspace } = await selectedHttpWorkspace(t);
  const stored = (id) => JSON.parse(readFileSync(path.join(root, "tasks", `${id}.json`), "utf8"));
  const writes = () => calls.filter((call) => call.readOnly === false).map((call) => call.command);
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
    "task.dependency.remove",
  ]);

  const sent = writes().length;
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
  assert.equal(writes().length, sent, "refused relationship edits send no write");
  assert.equal(workspace.getUnresolved(), null);
});

test("Linux route persists manual reorder across reopen and refuses reachable ordering mistakes before sending", async (t) => {
  const { root, calls, workspace, reopen } = await selectedHttpWorkspace(t);
  const bytes = (id) => readFileSync(path.join(root, "tasks", `${id}.json`), "utf8");
  const writes = () => calls.filter((call) => call.readOnly === false).map((call) => call.command);
  const topLevel = async (selected) =>
    (await selected.tasks({ sort: "manual", limit: 100 })).tasks
      .filter((task) => task.parentId === null)
      .map((task) => task.id);
  const pausedId = "62f159c1-22a7-45cb-89a0-c0c35aaeb1ed",
    doneId = "f3e5499b-402e-4d7d-8b61-eefc4409ca32";
  const openId = "c8d4206d-c25a-4317-baa4-a2c5443060e9",
    childId = "6e1bf023-da3c-4785-b8a9-a696ac1fa5c1";
  assert.equal(workspace.supportsOrdering, true);
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
    /STALE_TASK_VERSION/,
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
    /STALE_TASK_VERSION/,
  );
  await assert.rejects(
    () =>
      workspace.reorder(
        [{ id: pausedId, expectedVersion: pausedVersion }],
        { afterId: childId },
        "anchor-key",
      ),
    /move target changed/,
  );
  await assert.rejects(
    () =>
      workspace.reorder(
        [{ id: pausedId, expectedVersion: pausedVersion }],
        { beforeId: pausedId },
        "self-key",
      ),
    /move target changed/,
  );
  assert.equal(writes().length, 2, "refused reorders send no write");
  assert.equal(workspace.getUnresolved(), null);

  const reopened = await reopen();
  assert.deepEqual(
    await topLevel(reopened),
    [openId, pausedId, doneId],
    "manual order persists after reopening with a fresh cache",
  );
});

test("Linux route undoes the latest content, capture, relationship and reorder operations through operation.undo", async (t) => {
  const { root, calls, workspace } = await selectedHttpWorkspace(t);
  const stored = (id) => JSON.parse(readFileSync(path.join(root, "tasks", `${id}.json`), "utf8"));
  const exists = (id) => existsSync(path.join(root, "tasks", `${id}.json`));
  const writes = () =>
    calls
      .filter((call) => call.readOnly === false && call.dryRun === false)
      .map((call) => call.command);
  const openId = "c8d4206d-c25a-4317-baa4-a2c5443060e9",
    pausedId = "62f159c1-22a7-45cb-89a0-c0c35aaeb1ed";
  const topLevel = async () =>
    (await workspace.tasks({ sort: "manual", limit: 100 })).tasks
      .filter((task) => task.parentId === null)
      .map((task) => task.id);
  assert.equal(workspace.supportsOperationUndo, true);

  const version = async (id) => (await workspace.reader.query("task.get", { id })).task.version;
  const original = stored(openId);
  const edited = await workspace.save(
    draft("Renamed", "", 1),
    "edit-key",
    openId,
    await version(openId),
  );
  const restored = await workspace.undo(edited.operationId, "undo-edit-key");
  assert.deepEqual(
    [
      restored.changed,
      typeof restored.operationId,
      restored.tasks.map((task) => task.title),
      stored(openId).title,
    ],
    [true, "string", [original.title], original.title],
  );

  const created = await workspace.createChild(openId, draft("Draft"), "child-key");
  const removed = await workspace.undo(created.operationId, "undo-child-key");
  assert.deepEqual(
    [removed.tasks, removed.removedIds, exists(created.task.id)],
    [[], [created.task.id], false],
    "creation undo removes the unchanged capture",
  );

  const moved = await workspace.relationship(
    "task.move",
    openId,
    await version(openId),
    pausedId,
    "move-key",
  );
  await workspace.undo(moved.operationId, "undo-move-key");
  assert.equal(stored(openId).parentId, null);

  const before = await topLevel();
  const reordered = await workspace.reorder(
    [{ id: openId, expectedVersion: await version(openId) }],
    { first: true },
    "order-key",
  );
  assert.notDeepEqual(await topLevel(), before);
  await workspace.undo(reordered.operationId, "undo-order-key");
  assert.deepEqual(await topLevel(), before, "reorder undo restores the recorded sibling order");
  assert.deepEqual(writes(), [
    "task.update",
    "operation.undo",
    "task.create",
    "operation.undo",
    "task.move",
    "operation.undo",
    "task.reorder",
    "operation.undo",
  ]);

  // The gateway's preview refuses consumed or superseded history before the locked request is sent.
  const sent = writes().length;
  await assert.rejects(
    () => workspace.undo(reordered.operationId, "consumed-key"),
    /OPERATION_UNAVAILABLE/,
  );
  const first = await workspace.save(
    draft("First", "", 1),
    "first-key",
    openId,
    await version(openId),
  );
  await workspace.save(draft("Second", "", 1), "second-key", openId, first.task.version);
  await assert.rejects(
    () => workspace.undo(first.operationId, "superseded-key"),
    /OPERATION_UNAVAILABLE/,
  );
  assert.deepEqual(
    writes().slice(sent),
    ["task.update", "task.update"],
    "ineligible undo sends no executing request",
  );
  assert.equal(stored(openId).title, "Second");
  assert.equal(workspace.getUnresolved(), null);
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
  const writes = calls.filter((call) => call.readOnly === false);
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
  const links = calls.filter((call) => call.command === "task.dependency.add");
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
  const orders = calls.filter((call) => call.command === "task.reorder");
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

function memoryStorage() {
  const items = new Map();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, String(value));
    },
  };
}
const undoEntry = (operationId, title) => ({
  operationId,
  key: crypto.randomUUID(),
  affectedTaskIds: [],
  createdTaskIds: [],
  title,
  statusLike: false,
  wasActiveTaskId: null,
});

test("Linux route keeps a bounded own undo history across reopen and walks it back through the gateway", async (t) => {
  const { directory, root, calls, confirm, reopen, restart } = await selectedHttpWorkspace(t);
  const storage = memoryStorage();
  let workspace = await restart(storage);
  const stored = (id) => JSON.parse(readFileSync(path.join(root, "tasks", `${id}.json`), "utf8"));
  const executing = () =>
    calls
      .filter((call) => call.readOnly === false && call.dryRun === false)
      .map((call) => call.command);
  const version = async (id) => (await workspace.reader.query("task.get", { id })).task.version;
  const topLevel = async () =>
    (await workspace.tasks({ sort: "manual", limit: 100 })).tasks
      .filter((task) => task.parentId === null)
      .map((task) => task.id);
  const openId = "c8d4206d-c25a-4317-baa4-a2c5443060e9",
    pausedId = "62f159c1-22a7-45cb-89a0-c0c35aaeb1ed";
  // App's Ctrl+Z: the newest own entry, the gateway preview/execute path, then the next older entry.
  const undoLatest = async () => {
    const history = await workspace.undoHistory();
    const entry = history.latest();
    try {
      return await workspace.undo(entry.operationId, entry.key);
    } catch (error) {
      if (!/OPERATION_UNAVAILABLE/.test(error.message)) throw error;
      return error;
    } finally {
      history.remove(entry.operationId);
    }
  };
  const record = async (operationId) =>
    (await workspace.undoHistory()).push(undoEntry(operationId, "task"));

  const original = stored(openId),
    order = await topLevel();
  assert.equal((await workspace.undoHistory()).latest(), null);
  await record(
    (await workspace.save(draft("Renamed", "", 1), "edit-key", openId, await version(openId)))
      .operationId,
  );
  await record(
    (await workspace.status("task.complete", openId, await version(openId), "complete-key"))
      .operationId,
  );
  await record(
    (
      await workspace.reorder(
        [{ id: openId, expectedVersion: await version(openId) }],
        { first: true },
        "order-key",
      )
    ).operationId,
  );
  await record(
    (
      await workspace.save(
        draft("Paused renamed", "", 3),
        "paused-key",
        pausedId,
        await version(pausedId),
      )
    ).operationId,
  );
  // Another writer on the same cache supersedes the newest own entry; that edit is not this client's history.
  await workspace.save(draft("Elsewhere", "", 3), "foreign-key", pausedId, await version(pausedId));
  assert.notDeepEqual(await topLevel(), order);

  // Reopening the same root/cache/profile restores the list; the gateway refuses the superseded entry before sending.
  workspace = await restart(storage);
  const sent = executing().length;
  assert.match((await undoLatest()).message, /OPERATION_UNAVAILABLE/);
  assert.equal(executing().length, sent, "the refused entry sends no executing request");
  assert.equal(stored(pausedId).title, "Elsewhere");
  await undoLatest();
  assert.deepEqual(await topLevel(), order, "repeated undo restores the recorded order");
  await undoLatest();
  assert.deepEqual(
    [stored(openId).status, stored(openId).closedAt],
    [original.status, original.closedAt],
    "status history walks back through operation.undo",
  );
  workspace = await restart(storage);
  await undoLatest();
  assert.equal(stored(openId).title, original.title);
  assert.equal((await workspace.undoHistory()).latest(), null);
  assert.deepEqual(executing().slice(sent), ["operation.undo", "operation.undo", "operation.undo"]);

  // Entries are scoped to the confirmed root, cache, profile and write context.
  await record(
    (await workspace.save(draft("Scoped", "", 1), "scoped-key", openId, await version(openId)))
      .operationId,
  );
  workspace = await restart(storage);
  assert.notEqual((await workspace.undoHistory()).latest(), null);
  workspace = await reopen();
  workspace = await confirm(storage);
  assert.equal((await workspace.undoHistory()).latest(), null, "a different cache sees no entries");
  const otherHome = path.join(directory, "other-home");
  cpSync("scripts/fixtures/workspace/root", path.join(otherHome, "sync"), { recursive: true });
  mkdirSync(path.join(otherHome, "local"));
  const other = await startDevServer({ port: 0, home: otherHome });
  t.after(() => new Promise((resolve) => other.server.close(resolve)));
  const selection = await httpClient.readEditorSelection(other.url);
  const otherWorkspace = new httpClient.MainWorkspace(
    new httpClient.WorkspaceReader(selection, { url: other.url, selection }),
    new httpClient.EditorClient(other.url, selection),
    storage,
  );
  assert.equal((await otherWorkspace.undoHistory()).latest(), null, "another root sees no entries");
});

test("redo.scope: confirmed transfers persist both stacks without dropping existing undo entries", () => {
  const storage = memoryStorage();
  const first = undoEntry("first", "task");
  storage.setItem(
    "tasks.v2UndoHistory",
    JSON.stringify({ version: 1, workspaces: [{ scope: "scope", entries: [first] }] }),
  );
  const history = new httpClient.UndoHistory("scope", storage);
  assert.equal(history.latest().operationId, "first");
  assert.equal(history.latestRedo(), null);
  history.push(undoEntry("second", "task"));
  history.completeUndo("second", undoEntry("undo-second", "task"));
  history.completeUndo("first", undoEntry("undo-first", "task"));
  const reopened = new httpClient.UndoHistory("scope", storage);
  assert.equal(reopened.latest(), null);
  assert.equal(reopened.latestRedo().operationId, "undo-first");
  reopened.completeRedo("undo-first", undoEntry("redo-first", "task"));
  reopened.completeRedo("undo-first", undoEntry("duplicate-reply", "task"));
  assert.equal(reopened.latest().operationId, "redo-first");
  assert.equal(reopened.latestRedo().operationId, "undo-second");
  reopened.push(undoEntry("branch", "task"));
  assert.equal(reopened.latestRedo(), null);
  assert.equal(new httpClient.UndoHistory("other-scope", storage).latest(), null);
  assert.equal(new httpClient.UndoHistory("other-scope", storage).latestRedo(), null);
});

test("redo.scope: stacks share the bound and failed persistence keeps confirmed memory history", () => {
  const storage = memoryStorage();
  const history = new httpClient.UndoHistory("scope", storage);
  for (let index = 0; index < httpClient.UNDO_HISTORY_LIMIT + 5; index++)
    history.push(undoEntry(`operation-${index}`, "task"));
  for (let entry = history.latest(); entry; entry = history.latest())
    history.completeUndo(entry.operationId, undoEntry(`undo-${entry.operationId}`, "task"));
  let count = 0;
  for (let entry = history.latestRedo(); entry; entry = history.latestRedo()) {
    history.completeRedo(entry.operationId, undoEntry(`redo-${entry.operationId}`, "task"));
    count++;
  }
  assert.equal(count, httpClient.UNDO_HISTORY_LIMIT);
  const quota = new httpClient.UndoHistory("scope", {
    ...storage,
    setItem() {
      throw new Error("quota");
    },
  });
  quota.completeUndo(quota.latest().operationId, undoEntry("memory-undo", "task"));
  assert.equal(quota.latestRedo().operationId, "memory-undo");
  quota.completeRedo("memory-undo", undoEntry("memory-redo", "task"));
  assert.equal(quota.latest().operationId, "memory-redo");
  assert.equal(quota.latestRedo(), null);
});

test("own undo history keeps the newest entries up to its bound and tolerates unusable storage", () => {
  const storage = memoryStorage();
  const history = new httpClient.UndoHistory("scope", storage);
  for (let index = 0; index < httpClient.UNDO_HISTORY_LIMIT + 5; index += 1)
    history.push(undoEntry(`operation-${index}`, "task"));
  const reloaded = new httpClient.UndoHistory("scope", storage);
  const walked = [];
  for (let entry = reloaded.latest(); entry; entry = reloaded.latest()) {
    walked.push(entry.operationId);
    reloaded.remove(entry.operationId);
  }
  assert.equal(walked.length, httpClient.UNDO_HISTORY_LIMIT);
  assert.deepEqual(
    [walked[0], walked.at(-1)],
    [`operation-${httpClient.UNDO_HISTORY_LIMIT + 4}`, "operation-5"],
  );

  storage.setItem("tasks.v2UndoHistory", "{not json");
  assert.equal(new httpClient.UndoHistory("scope", storage).latest(), null);
  const unusable = new httpClient.UndoHistory("scope", {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  });
  unusable.push(undoEntry("memory-only", "task"));
  assert.equal(
    unusable.latest()?.operationId,
    "memory-only",
    "unusable storage keeps this session's history in memory",
  );
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
  assert.equal(workspace.supportsStatusBatch, true);

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

test("a lost status-batch reply retries the same envelope or stays preserved for manual reconciliation", async (t) => {
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

  loseNextReply();
  const pausing = workspace.transitionMany(
    (await starting).tasks.map((task) => ({
      id: task.id,
      expectedVersion: task.version,
      command: "task.pause",
    })),
    "reconcile-key",
  );
  (await unresolved()).preserveForReconciliation();
  await assert.rejects(() => pausing, /MANUAL_RECONCILIATION/);
  const sent = calls.length;
  await assert.rejects(
    () =>
      workspace.transitionMany(
        [{ id: openId, expectedVersion: 1, command: "task.complete" }],
        "after-key",
      ),
    /MANUAL_RECONCILIATION/,
  );
  assert.equal(calls.length, sent, "writes stay paused without any request until reconciliation");
});

test("one recorded status batch is undone as a whole through operation.undo after reopening", async (t) => {
  const { root, calls, restart } = await selectedHttpWorkspace(t);
  const storage = memoryStorage();
  let workspace = await restart(storage);
  const stored = (id) => JSON.parse(readFileSync(path.join(root, "tasks", `${id}.json`), "utf8"));
  const executing = () =>
    calls
      .filter((call) => call.readOnly === false && call.dryRun === false)
      .map((call) => call.command);
  const version = async (id) => (await workspace.reader.query("task.get", { id })).task.version;
  const openId = "c8d4206d-c25a-4317-baa4-a2c5443060e9",
    pausedId = "62f159c1-22a7-45cb-89a0-c0c35aaeb1ed",
    doneId = "f3e5499b-402e-4d7d-8b61-eefc4409ca32";
  const ids = [openId, pausedId, doneId],
    original = ids.map(stored);

  const batch = await workspace.transitionMany(
    [
      { id: openId, expectedVersion: await version(openId), command: "task.complete" },
      { id: pausedId, expectedVersion: await version(pausedId), command: "task.cancel" },
      { id: doneId, expectedVersion: await version(doneId), command: "task.reopen" },
    ],
    "batch-key",
  );
  (await workspace.undoHistory()).push({
    ...undoEntry(batch.operationId, "task"),
    affectedTaskIds: ids,
    statusLike: true,
  });
  assert.deepEqual(
    ids.map((id) => stored(id).status),
    ["done", "canceled", "open"],
  );

  workspace = await restart(storage);
  const history = await workspace.undoHistory();
  const entry = history.latest();
  assert.equal(entry.operationId, batch.operationId);
  const undone = await workspace.undo(entry.operationId, entry.key);
  history.remove(entry.operationId);
  assert.deepEqual(undone.tasks.map((task) => task.id).sort(), [...ids].sort());
  assert.deepEqual(
    ids.map((id) => [stored(id).status, stored(id).closedAt]),
    original.map((task) => [task.status, task.closedAt]),
    "one undo restores every status and exact closure",
  );
  assert.deepEqual(executing(), ["task.transitionMany", "operation.undo"]);
  assert.equal(history.latest(), null);
  await assert.rejects(
    () => workspace.undo(batch.operationId, "again-key"),
    /OPERATION_UNAVAILABLE/,
    "no undo-of-undo or repeated undo",
  );
});
