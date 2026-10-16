import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const compiled = await build({
  stdin: {
    contents: `export * from './src/platform/backendClient'; export {getBackendTransport} from './src/legacy/platform/backendTransport';`,
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

const withheldActions = [
  ["transitionTasks", [[{ id: "id", expectedVersion: 1, command: "task.start" }], {}]],
  ["undoOperation", ["operation", {}]],
  ["moveTask", ["id", null, 1, {}]],
  ["reorderTasks", [[{ id: "id", expectedVersion: 1 }], { first: true }, {}]],
  ["addDependency", ["id", "blocker", 1, {}]],
  ["removeDependency", ["id", "blocker", 1, {}]],
  ["purgeCanceledTasks", [{}]],
  ["exportTasks", []],
  ["prepareReceiveWorkspace", []],
  ["abortReceiveWorkspace", []],
];

const linuxConnectedActions = new Set([
  "transitionTasks",
  "undoOperation",
  "moveTask",
  "reorderTasks",
  "addDependency",
  "removeDependency",
]);
const linuxWithheldActions = withheldActions.filter(
  ([action]) => !linuxConnectedActions.has(action),
);

test("selected native launch can never use the legacy transport, even before registration or after reload", async () => {
  assert.throws(() => client.getBackendTransport(), /cannot launch a legacy backend/);
  await assert.rejects(
    () => client.runBackendCommand("task.list"),
    /selected workspace.*Reopen and confirm/,
  );
});

test("main UI calls concrete selected actions; preview flags and unproven operations never fall through", async () => {
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
    async info() {
      calls.push(["info"]);
      return {
        databasePath: "C:\\workspace",
        taskCount: 4,
        canceledTaskCount: 2,
        workspaceRevision: 7,
      };
    },
  };
  client.selectMainWorkspace(workspace);
  await assert.rejects(
    () => client.runBackendCommand("task.list"),
    (error) => {
      assert.equal(error.code, "UNSUPPORTED_COMMAND");
      assert.equal(error.message, "This action is not yet available in the selected workspace.");
      assert.ok(!error.message.includes("Reopen and confirm"));
      return true;
    },
  );
  for (const options of [{ dryRun: true }, { readOnly: true }]) {
    await assert.rejects(() => client.createTask("Preview", "", options), /Nothing was sent/);
    await assert.rejects(
      () => client.updateTask("id", "Preview", "", 1, options),
      /Nothing was sent/,
    );
    await assert.rejects(
      () => client.transitionTask("task.start", "id", 1, options),
      /Nothing was sent/,
    );
  }
  await assert.rejects(
    () => client.createTask("Child", "", { parentId: "parent" }),
    /Child capture/,
  );
  for (const [action, args] of withheldActions) {
    await assert.rejects(
      () => client[action](...args),
      /selected workspace/,
      `${action} must not use the legacy transport`,
    );
  }
  assert.deepEqual(await client.receiveWorkspaceStatus(), { waiting: false });
  assert.deepEqual(calls, []);
  await client.createTask("Inline @work", "Notes", { priority: 1, idempotencyKey: "capture-key" });
  await client.updateTask("id", "Inline @work", "Notes", 3, { idempotencyKey: "edit-key" });
  await client.updateTaskPriority({ id: "id", version: 3 }, 0, { idempotencyKey: "priority-key" });
  await client.transitionTask("task.start", "id", 3, { idempotencyKey: "status-key" });
  await client.undoStatusChange("id", 4, { idempotencyKey: "undo-key" });
  assert.equal(await client.getWorkspaceRevision(), 7);
  assert.deepEqual(await client.getWorkspaceInfo(), {
    databasePath: "C:\\workspace",
    taskCount: 4,
    canceledTaskCount: 2,
    workspaceRevision: 7,
  });
  assert.deepEqual(calls, [
    ["save", "Inline @work", "Notes", 1, "capture-key"],
    ["save", "Inline @work", "Notes", undefined, "edit-key", "id", 3],
    ["priority", "id", 3, 0, "priority-key"],
    ["status", "task.start", "id", 3, "status-key"],
    ["status", "task.status.undo", "id", 4, "undo-key"],
    ["revision"],
    ["info"],
  ]);
});

const http = await build({
  stdin: {
    contents: `export * from './src/platform/backendClient'; export {getBackendTransport} from './src/legacy/platform/backendTransport'; export {MainWorkspace} from './src/platform/mainWorkspace'; export {WorkspaceReader} from './src/platform/workspaceReader'; export {readEditorSelection, EditorClient} from './src/platform/editorClient'; export {UndoHistory, UNDO_HISTORY_LIMIT} from './src/platform/undoHistory';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  define: { "import.meta.env": JSON.stringify({ VITE_TASKS_LEGACY: "0" }) },
});
const httpClient = await import(
  `data:text/javascript;base64,${Buffer.from(http.outputFiles[0].text).toString("base64")}`
);
const { startDevServer } = await import("../dist/backend/devServer.js");

async function selectedHttpWorkspace(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "taskdb-main-http-"));
  const root = path.join(directory, "root");
  cpSync("scripts/fixtures/workspace/root", root, { recursive: true });
  const originalXdg = process.env.XDG_DATA_HOME,
    originalFetch = globalThis.fetch;
  process.env.XDG_DATA_HOME = path.join(directory, "profile");
  let dev = await startDevServer({ port: 0, root, databasePath: path.join(directory, "cache.db") });
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
    if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = originalXdg;
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
  // Restart the bridge on the same root with a fresh cache and reconfirm, as after closing and reopening.
  const reopen = async () => {
    await new Promise((resolve) => dev.server.close(resolve));
    dev = await startDevServer({
      port: 0,
      root,
      databasePath: path.join(directory, "reopened-cache.db"),
    });
    return confirm();
  };
  // Restart the bridge on the same root and cache, optionally under another profile, as after closing and reopening.
  const restart = async (storage, profile = "profile") => {
    await new Promise((resolve) => dev.server.close(resolve));
    process.env.XDG_DATA_HOME = path.join(directory, profile);
    dev = await startDevServer({ port: 0, root, databasePath: path.join(directory, "cache.db") });
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

test("selected Linux themes survive bridge restart without task writes, selection storage or undo changes", async (t) => {
  const { root, calls, confirm, restart, loseNextReply } = await selectedHttpWorkspace(t);
  const preferenceClient = await import(
    `data:text/javascript;base64,${Buffer.from(http.outputFiles[0].text).toString("base64")}#preferences`
  );
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  t.after(() => {
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else delete globalThis.localStorage;
  });
  const workspace = await confirm(storage);
  preferenceClient.selectMainWorkspace(workspace);
  const edit = await preferenceClient.createTask("Preference isolation", "", {});
  const originalBytes = readdirSync(path.join(root, "tasks")).map((name) => [
    name,
    readFileSync(path.join(root, "tasks", name)),
  ]);
  const history = await workspace.undoHistory();
  history.push(undoEntry(edit.operationId, "Preference isolation"));
  const historyBefore = history.latest();
  const storedHistoryBefore = storage.getItem("tasks.v2UndoHistory");
  calls.length = 0;
  const initial = await preferenceClient.listThemes();
  const chosen = initial.themes.find((theme) => theme.name !== initial.selected);
  assert.ok(chosen);
  assert.deepEqual(await preferenceClient.setTheme(chosen.name), {
    theme: chosen,
    selected: chosen.name,
  });
  assert.equal((await preferenceClient.listThemes()).selected, chosen.name);
  await assert.rejects(
    () => preferenceClient.setTheme("missing-theme"),
    (error) => error.code === "THEME_NOT_FOUND",
  );
  assert.deepEqual(calls, []);
  assert.deepEqual([...values.keys()].sort(), ["tasks.selectedTheme", "tasks.v2UndoHistory"]);
  assert.equal(storage.getItem("tasks.v2UndoHistory"), storedHistoryBefore);
  assert.deepEqual(history.latest(), historyBefore);

  const reopened = await restart(storage);
  const restartedClient = await import(
    `data:text/javascript;base64,${Buffer.from(http.outputFiles[0].text).toString("base64")}#preferences-restart`
  );
  await assert.rejects(() => restartedClient.listTasks(), /selected workspace.*Reopen and confirm/);
  restartedClient.selectMainWorkspace(reopened);
  assert.equal((await restartedClient.listThemes()).selected, chosen.name);
  assert.deepEqual((await reopened.undoHistory()).latest(), historyBefore);
  for (const [name, bytes] of originalBytes)
    assert.deepEqual(readFileSync(path.join(root, "tasks", name)), bytes);
  assert.ok(calls.every((call) => call.readOnly === true));
  storage.setItem("tasks.selectedTheme", "retired-theme");
  assert.equal((await restartedClient.listThemes()).selected, initial.selected);

  calls.length = 0;
  loseNextReply();
  const pending = restartedClient.createTask("Uncertain capture", "", {
    idempotencyKey: "preference-retry",
  });
  await new Promise((resolve) => {
    const stop = reopened.subscribe(() => {
      stop();
      resolve();
    });
  });
  const unresolved = reopened.getUnresolved();
  const originalRequest = unresolved.prepared.originalRequest;
  const originalCalls = calls.length;
  await restartedClient.setTheme(chosen.name);
  assert.equal(calls.length, originalCalls);
  assert.equal(reopened.getUnresolved(), unresolved);
  assert.equal(unresolved.prepared.originalRequest, originalRequest);
  assert.equal(storage.getItem("tasks.v2UndoHistory"), storedHistoryBefore);
  await unresolved.retry();
  await pending;
  const writes = calls.filter((call) => call.readOnly === false);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1], writes[0]);
});

test("selected dev:web launch refuses the legacy transport before confirmation", async () => {
  assert.throws(() => httpClient.getBackendTransport(), /cannot launch a legacy backend/);
  await assert.rejects(() => httpClient.listTasks(), /selected workspace.*Reopen and confirm/);
});

test("main UI over the Linux HTTP bridge persists direct actions and refuses withheld ones without any request", async (t) => {
  const { root, calls, workspace } = await selectedHttpWorkspace(t);
  httpClient.selectMainWorkspace(workspace);
  const openId = "c8d4206d-c25a-4317-baa4-a2c5443060e9";
  assert.equal(workspace.supportsRelationships, true);
  for (const [action, args] of linuxWithheldActions) {
    await assert.rejects(
      () => httpClient[action](...args),
      /selected workspace/,
      `${action} must not reach the bridge`,
    );
  }
  assert.deepEqual(calls, []);

  const created = await httpClient.createTask("Call @alice #home", "Notes", { priority: 0 });
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
  const child = await httpClient.createTask("Child", "", { parentId: openId });
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

  const child = (await workspace.createChild(openId, "Draft brief #home", "", 1, "child-key")).task;
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
    "Renamed",
    "",
    undefined,
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

  const created = await workspace.createChild(openId, "Draft", "", 2, "child-key");
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
    "First",
    "",
    undefined,
    "first-key",
    openId,
    await version(openId),
  );
  await workspace.save("Second", "", undefined, "second-key", openId, first.task.version);
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
    (await workspace.save("Renamed", "", undefined, "edit-key", openId, await version(openId)))
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
        "Paused renamed",
        "",
        undefined,
        "paused-key",
        pausedId,
        await version(pausedId),
      )
    ).operationId,
  );
  // Another writer on the same cache supersedes the newest own entry; that edit is not this client's history.
  await workspace.save(
    "Elsewhere",
    "",
    undefined,
    "foreign-key",
    pausedId,
    await version(pausedId),
  );
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
    (await workspace.save("Scoped", "", undefined, "scoped-key", openId, await version(openId)))
      .operationId,
  );
  workspace = await restart(storage, "other-profile");
  assert.equal((await workspace.undoHistory()).latest(), null, "another profile sees no entries");
  workspace = await restart(storage);
  assert.notEqual((await workspace.undoHistory()).latest(), null);
  workspace = await reopen();
  workspace = await confirm(storage);
  assert.equal((await workspace.undoHistory()).latest(), null, "a different cache sees no entries");
  const otherRoot = path.join(directory, "other-root");
  cpSync("scripts/fixtures/workspace/root", otherRoot, { recursive: true });
  const other = await startDevServer({
    port: 0,
    root: otherRoot,
    databasePath: path.join(directory, "other-cache.db"),
  });
  t.after(() => new Promise((resolve) => other.server.close(resolve)));
  const selection = await httpClient.readEditorSelection(other.url);
  const otherWorkspace = new httpClient.MainWorkspace(
    new httpClient.WorkspaceReader(selection, { url: other.url, selection }),
    new httpClient.EditorClient(other.url, selection),
    storage,
  );
  assert.equal((await otherWorkspace.undoHistory()).latest(), null, "another root sees no entries");
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

function canonicalBytes(root) {
  return [
    "workspace.json",
    ...readdirSync(path.join(root, "tasks"))
      .sort()
      .map((name) => `tasks/${name}`),
  ].map((name) => [name, readFileSync(path.join(root, name)).toString("base64")]);
}

test("Linux workspace backup and separately selected restore preserve raw canonical/conflict bytes, selection and undo scope", async (t) => {
  const { directory, root, calls, restart } = await selectedHttpWorkspace(t);
  const workspace = await restart(memoryStorage());
  const history = await workspace.undoHistory();
  const edit = await workspace.save("Before backup", "notes", 2, "before-backup");
  history.push(undoEntry(edit.operationId, "task"));
  const entry = history.latest();
  writeFileSync(
    path.join(
      root,
      "tasks",
      "c8d4206d-c25a-4317-baa4-a2c5443060e9.sync-conflict-20261002-DEVICE.json",
    ),
    Buffer.from([255, 128, 0]),
  );
  const before = canonicalBytes(root),
    archive = path.join(directory, "archive"),
    restored = path.join(directory, "restored");
  const backup = await workspace.copyWorkspace(archive, "backup-key");
  assert.equal(backup.taskCount, 5);
  assert.ok(backup.operationId);
  assert.deepEqual(canonicalBytes(archive), before);
  assert.deepEqual(readdirSync(archive).sort(), ["tasks", "workspace.json"]);
  const restore = await workspace.copyWorkspace(restored, "restore-key", archive);
  assert.equal(restore.taskCount, 5);
  assert.deepEqual(canonicalBytes(restored), before);
  assert.deepEqual(canonicalBytes(root), before);
  assert.equal(workspace.reader.selection.rootPath, root);
  assert.deepEqual(history.latest(), entry, "copies do not enter or retire task undo history");
  const selectedContext = (await workspace.editor.begin(undefined, "copy")).writeContext;
  const dev = await startDevServer({
    port: 0,
    root: restored,
    databasePath: path.join(directory, "restored-cache.db"),
  });
  t.after(() => new Promise((resolve) => dev.server.close(resolve)));
  const selection = await httpClient.readEditorSelection(dev.url);
  const fresh = new httpClient.MainWorkspace(
    new httpClient.WorkspaceReader(selection, { url: dev.url, selection }),
    new httpClient.EditorClient(dev.url, selection),
    memoryStorage(),
  );
  assert.notEqual((await fresh.editor.begin(undefined, "copy")).writeContext, selectedContext);
  assert.equal((await fresh.undoHistory()).latest(), null);
  assert.deepEqual(
    calls
      .filter(
        (call) =>
          call.command.startsWith("workspace.") && call.readOnly === false && call.dryRun === false,
      )
      .map((call) => call.command),
    ["workspace.archive", "workspace.restore"],
  );
});

test("backup/restore path and source refusals are preview-only with no partial output or source changes", async (t) => {
  const { directory, root, calls, workspace } = await selectedHttpWorkspace(t);
  const before = canonicalBytes(root),
    occupied = path.join(directory, "occupied");
  cpSync(root, occupied, { recursive: true });
  const alias = path.join(directory, "root-alias");
  symlinkSync(root, alias);
  for (const [destination, source] of [
    [root],
    [path.join(root, "inside")],
    [alias],
    [occupied],
    [path.join(directory, "bad-source-output"), occupied + "/missing"],
  ]) {
    await assert.rejects(
      () => workspace.copyWorkspace(destination, crypto.randomUUID(), source),
      /INVALID_ARGUMENT|DESTINATION_NOT_EMPTY|INVALID_STORAGE/,
    );
    assert.equal(workspace.getUnresolved(), null);
    assert.deepEqual(canonicalBytes(root), before);
  }
  assert.equal(existsSync(path.join(root, "inside")), false);
  assert.equal(existsSync(path.join(directory, "bad-source-output")), false);
  assert.equal(calls.filter((call) => call.readOnly === false && call.dryRun === false).length, 0);
});

for (const restore of [false, true])
  test(`lost ${restore ? "restore" : "backup"} reply retries its immutable envelope and preserves reconciliation lock`, async (t) => {
    const { directory, root, calls, workspace, loseNextReply } = await selectedHttpWorkspace(t);
    const command = restore ? "workspace.restore" : "workspace.archive";
    const source = restore ? path.join(directory, "source") : undefined;
    if (source) cpSync(root, source, { recursive: true });
    const before = canonicalBytes(root),
      destination = path.join(directory, "copy");
    const unresolved = () =>
      new Promise((resolve) => {
        const stop = workspace.subscribe(() => {
          stop();
          resolve(workspace.getUnresolved());
        });
      });
    loseNextReply();
    const copying = workspace.copyWorkspace(destination, "lost-copy", source);
    const locked = await unresolved();
    assert.match(locked.error, /Failed to fetch/);
    assert.equal(JSON.parse(locked.prepared.retryMetadata).destinationDirectory, destination);
    assert.equal(JSON.parse(locked.prepared.retryMetadata).sourceDirectory, source);
    await assert.rejects(
      () => workspace.copyWorkspace(path.join(directory, "replacement"), "replacement", source),
      /WRITE_IN_PROGRESS/,
    );
    await locked.retry();
    assert.equal((await copying).destinationDirectory, destination);
    const writes = calls.filter((call) => call.command === command && call.dryRun === false);
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[0], writes[1]);
    assert.deepEqual(canonicalBytes(destination), before);
    assert.deepEqual(canonicalBytes(root), before);

    loseNextReply();
    const second = workspace.copyWorkspace(
      path.join(directory, "second"),
      "reconcile-copy",
      source,
    );
    (await unresolved()).preserveForReconciliation();
    await assert.rejects(() => second, /MANUAL_RECONCILIATION/);
    const sent = calls.length;
    await assert.rejects(
      () => workspace.save("Must not send", "", 2, "later"),
      /MANUAL_RECONCILIATION/,
    );
    assert.equal(calls.length, sent);
  });
