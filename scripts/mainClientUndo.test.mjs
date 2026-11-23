import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  httpClient,
  selectedHttpWorkspace,
  startDevServer,
} from "./fixtures/mainClientHttpWorkspace.mjs";
import { draft } from "./fixtures/taskDraft.mjs";

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
