import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const compiled = await build({ stdin: { contents: `export * from './src/platform/backendClient'; export {getBackendTransport} from './src/platform/backendTransport';`, resolveDir: process.cwd() }, bundle: true, platform: "node", format: "esm", write: false, define: { "import.meta.env": JSON.stringify({ VITE_TASKDB_V2_NATIVE_SELECTION: "explicit-native-selection" }) } });
const client = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);

const withheldActions = [
  ["transitionTasks", [[{ id: "id", expectedVersion: 1, command: "task.start" }], {}]],
  ["undoStatusChanges", [[{ id: "id", expectedVersion: 1 }], {}]],
  ["undoOperation", ["operation", {}]],
  ["moveTask", ["id", null, 1, {}]],
  ["reorderTasks", [[{ id: "id", expectedVersion: 1 }], { first: true }, {}]],
  ["addDependency", ["id", "blocker", 1, {}]],
  ["removeDependency", ["id", "blocker", 1, {}]],
  ["purgeCanceledTasks", [{}]],
  ["listActivity", []],
  ["exportTasks", []],
  ["prepareReceiveWorkspace", []],
  ["abortReceiveWorkspace", []],
];

const relationshipActions = new Set(["moveTask", "addDependency", "removeDependency"]);
const linuxWithheldActions = withheldActions.filter(([action]) => !relationshipActions.has(action));

test("selected native launch can never use the legacy transport, even before registration or after reload", async () => {
  assert.throws(() => client.getBackendTransport(), /cannot launch a legacy backend/);
  await assert.rejects(() => client.runBackendCommand("task.list"), /selected workspace.*Reopen and confirm/);
});

test("main UI calls concrete selected actions; preview flags and unproven operations never fall through", async () => {
  const calls = [];
  const workspace = {
    async save(...args) { calls.push(["save", ...args]); return {}; },
    async priority(...args) { calls.push(["priority", ...args]); return {}; },
    async status(...args) { calls.push(["status", ...args]); return {}; },
    async revision() { calls.push(["revision"]); return 7; },
    async info() { calls.push(["info"]); return { databasePath: "C:\\workspace", taskCount: 4, canceledTaskCount: 2, workspaceRevision: 7 }; },
  };
  client.selectMainWorkspace(workspace);
  await assert.rejects(() => client.runBackendCommand("task.list"), error => {
    assert.equal(error.code, "UNSUPPORTED_COMMAND");
    assert.equal(error.message, "This action is not yet available in the selected workspace.");
    assert.ok(!error.message.includes("Reopen and confirm"));
    return true;
  });
  for (const options of [{ dryRun: true }, { readOnly: true }]) {
    await assert.rejects(() => client.createTask("Preview", "", options), /Nothing was sent/);
    await assert.rejects(() => client.updateTask("id", "Preview", "", 1, options), /Nothing was sent/);
    await assert.rejects(() => client.transitionTask("task.start", "id", 1, options), /Nothing was sent/);
  }
  await assert.rejects(() => client.createTask("Child", "", { parentId: "parent" }), /Child capture/);
  for (const [action, args] of withheldActions) {
    await assert.rejects(() => client[action](...args), /selected workspace/, `${action} must not use the legacy transport`);
  }
  assert.deepEqual(await client.receiveWorkspaceStatus(), { waiting: false });
  assert.deepEqual(calls, []);
  await client.createTask("Inline @work", "Notes", { priority: 1, idempotencyKey: "capture-key" });
  await client.updateTask("id", "Inline @work", "Notes", 3, { idempotencyKey: "edit-key" });
  await client.updateTaskPriority({ id: "id", version: 3 }, 0, { idempotencyKey: "priority-key" });
  await client.transitionTask("task.start", "id", 3, { idempotencyKey: "status-key" });
  await client.undoStatusChange("id", 4, { idempotencyKey: "undo-key" });
  assert.equal(await client.getWorkspaceRevision(), 7);
  assert.deepEqual(await client.getWorkspaceInfo(), { databasePath: "C:\\workspace", taskCount: 4, canceledTaskCount: 2, workspaceRevision: 7 });
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

const http = await build({ stdin: { contents: `export * from './src/platform/backendClient'; export {getBackendTransport} from './src/platform/backendTransport'; export {MainWorkspace} from './src/platform/mainWorkspace'; export {V2WorkspaceReader} from './src/platform/v2BackendClient'; export {readV2EditorSelection, V2EditorClient} from './src/platform/v2EditorClient';`, resolveDir: process.cwd() }, bundle: true, platform: "node", format: "esm", write: false, define: { "import.meta.env": JSON.stringify({ VITE_TASKDB_V2: "1", VITE_TASKDB_V2_EDIT: "1" }) } });
const httpClient = await import(`data:text/javascript;base64,${Buffer.from(http.outputFiles[0].text).toString("base64")}`);
const { startDevServer } = await import("../dist/backend/devServer.js");

async function selectedHttpWorkspace(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "taskdb-main-http-"));
  const root = path.join(directory, "root");
  cpSync("scripts/fixtures/taskdb-v2/root", root, { recursive: true });
  const originalXdg = process.env.XDG_DATA_HOME, originalFetch = globalThis.fetch;
  process.env.XDG_DATA_HOME = path.join(directory, "profile");
  const dev = await startDevServer({ port: 0, v2Root: root, databasePath: path.join(directory, "cache.db"), v2Edit: true });
  const calls = [];
  let loseNextWriteReply = false;
  globalThis.fetch = async (...args) => {
    const request = args[1]?.body ? JSON.parse(args[1].body) : null;
    if (request) calls.push(request);
    const response = await originalFetch(...args);
    if (request?.readOnly === false && loseNextWriteReply) { loseNextWriteReply = false; throw new TypeError("Failed to fetch"); }
    return response;
  };
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await new Promise(resolve => dev.server.close(resolve));
    if (originalXdg === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = originalXdg;
    rmSync(directory, { recursive: true, force: true });
  });
  const selection = await httpClient.readV2EditorSelection(dev.url);
  const workspace = new httpClient.MainWorkspace(new httpClient.V2WorkspaceReader(selection, { url: dev.url, selection }), new httpClient.V2EditorClient(dev.url, selection));
  return { root, calls, workspace, loseNextReply: () => { loseNextWriteReply = true; } };
}

test("selected dev:web launch refuses the legacy transport before confirmation", async () => {
  assert.throws(() => httpClient.getBackendTransport(), /cannot launch a legacy backend/);
  await assert.rejects(() => httpClient.listTasks(), /selected workspace.*Reopen and confirm/);
});

test("main UI over the Linux HTTP bridge persists direct actions and refuses withheld ones without any request", async t => {
  const { root, calls, workspace } = await selectedHttpWorkspace(t);
  httpClient.selectMainWorkspace(workspace);
  const openId = "c8d4206d-c25a-4317-baa4-a2c5443060e9";
  assert.equal(workspace.supportsRelationships, true);
  for (const [action, args] of linuxWithheldActions) {
    await assert.rejects(() => httpClient[action](...args), /selected workspace/, `${action} must not reach the bridge`);
  }
  assert.deepEqual(calls, []);

  const created = await httpClient.createTask("Call @alice #home", "Notes", { priority: 0 });
  assert.deepEqual([created.task.title, created.task.priority], ["Call", 0]);
  const stored = JSON.parse(readFileSync(path.join(root, "tasks", `${created.task.id}.json`), "utf8"));
  assert.deepEqual([stored.title, stored.category, stored.tags, stored.priority], ["Call", "alice", ["home"], 0]);
  const { task } = await httpClient.getTask(openId);
  const completed = await httpClient.transitionTask("task.complete", openId, task.version, {});
  assert.equal(completed.task.status, "done");
  const undone = await httpClient.undoStatusChange(openId, completed.task.version, {});
  assert.equal(undone.task.status, "open");
  assert.equal(JSON.parse(readFileSync(path.join(root, "tasks", `${openId}.json`), "utf8")).status, "open");
  const child = await httpClient.createTask("Child", "", { parentId: openId });
  assert.equal(child.task.parentId, openId);
  const top = await httpClient.moveTask(child.task.id, null, child.task.version, {});
  const linked = await httpClient.addDependency(top.task.id, openId, top.task.version, {});
  const unlinked = await httpClient.removeDependency(linked.task.id, openId, linked.task.version, {});
  assert.deepEqual([top.task.parentId, linked.task.blockedByIds, unlinked.task.dependencyIds], [null, [openId], []]);
  assert.deepEqual(calls.filter(call => call.readOnly === false).map(call => call.command),
    ["task.create", "task.complete", "task.status.undo", "task.create", "task.move", "task.dependency.add", "task.dependency.remove"]);
  assert.ok(calls.every(call => call.version === 2));
});

test("Linux route persists child capture, parent moves and dependency edits with current blocking rules", async t => {
  const { root, calls, workspace } = await selectedHttpWorkspace(t);
  const stored = id => JSON.parse(readFileSync(path.join(root, "tasks", `${id}.json`), "utf8"));
  const writes = () => calls.filter(call => call.readOnly === false).map(call => call.command);
  const openId = "c8d4206d-c25a-4317-baa4-a2c5443060e9", childId = "6e1bf023-da3c-4785-b8a9-a696ac1fa5c1";
  const pausedId = "62f159c1-22a7-45cb-89a0-c0c35aaeb1ed", doneId = "f3e5499b-402e-4d7d-8b61-eefc4409ca32";

  const child = (await workspace.createChild(openId, "Draft brief #home", "", 1, "child-key")).task;
  assert.deepEqual([child.parentId, stored(child.id).parentId, stored(child.id).tags], [openId, openId, ["home"]]);
  const moved = (await workspace.relationship("task.move", child.id, child.version, null, "move-key")).task;
  assert.equal(stored(child.id).parentId, null);

  const blockedByDone = (await workspace.relationship("task.dependency.add", moved.id, moved.version, doneId, "done-key")).task;
  assert.deepEqual(blockedByDone.blockedByIds, [doneId], "a done dependency still blocks");
  const blockedByBoth = (await workspace.relationship("task.dependency.add", moved.id, blockedByDone.version, pausedId, "paused-key")).task;
  const paused = (await workspace.reader.query("task.get", { id: pausedId })).task;
  await workspace.status("task.cancel", pausedId, paused.version, "cancel-key");
  const afterCancel = (await workspace.reader.query("task.get", { id: moved.id })).task;
  assert.deepEqual([afterCancel.dependencyIds, afterCancel.blockedByIds], [[pausedId, doneId].sort(), [doneId]], "a canceled dependency does not block");
  const unblocked = (await workspace.relationship("task.dependency.remove", moved.id, blockedByBoth.version, doneId, "remove-key")).task;
  assert.deepEqual([stored(moved.id).dependencyIds, unblocked.blockedByIds], [[pausedId], []]);
  assert.deepEqual(writes(), ["task.create", "task.move", "task.dependency.add", "task.dependency.add", "task.cancel", "task.dependency.remove"]);

  const sent = writes().length;
  const parent = (await workspace.reader.query("task.get", { id: openId })).task;
  await assert.rejects(() => workspace.relationship("task.move", openId, parent.version, childId, "cycle-key"), /PARENT_CYCLE/);
  await assert.rejects(() => workspace.relationship("task.dependency.add", openId, parent.version, childId, "dependency-cycle-key"), /DEPENDENCY_CYCLE/);
  await assert.rejects(() => workspace.relationship("task.dependency.add", openId, parent.version, pausedId, "canceled-key"), /INVALID_DEPENDENCY/);
  await assert.rejects(() => workspace.relationship("task.move", moved.id, moved.version, openId, "stale-key"), /STALE_TASK_VERSION/);
  assert.equal(writes().length, sent, "refused relationship edits send no write");
  assert.equal(workspace.getUnresolved(), null);
});

test("a lost bridge reply locks the original request and Retry same request reuses its envelope", async t => {
  const { calls, workspace, loseNextReply } = await selectedHttpWorkspace(t);
  const openId = "c8d4206d-c25a-4317-baa4-a2c5443060e9";
  const { task } = await workspace.reader.query("task.get", { id: openId });
  loseNextReply();
  const pending = workspace.status("task.start", openId, task.version, "lost-reply-key");
  await new Promise(resolve => { const stop = workspace.subscribe(() => { stop(); resolve(); }); });
  const unresolved = workspace.getUnresolved();
  assert.match(unresolved.error, /Failed to fetch/);
  await assert.rejects(() => workspace.status("task.pause", openId, task.version, "other-key"), /WRITE_IN_PROGRESS/);
  await unresolved.retry();
  const result = await pending;
  assert.equal(result.task.status, "in_progress");
  assert.equal(workspace.getUnresolved(), null);
  const writes = calls.filter(call => call.readOnly === false);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1], writes[0]);

  loseNextReply();
  const linking = workspace.relationship("task.dependency.add", openId, result.task.version, "f3e5499b-402e-4d7d-8b61-eefc4409ca32", "lost-link-key");
  await new Promise(resolve => { const stop = workspace.subscribe(() => { stop(); resolve(); }); });
  await workspace.getUnresolved().retry();
  assert.deepEqual((await linking).task.blockedByIds, ["f3e5499b-402e-4d7d-8b61-eefc4409ca32"]);
  const links = calls.filter(call => call.command === "task.dependency.add");
  assert.equal(links.length, 2);
  assert.deepEqual(links[1], links[0]);
});
