import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const compiled = await build({ stdin: { contents: `export * from './src/platform/backendClient'; export {getBackendTransport} from './src/platform/backendTransport';`, resolveDir: process.cwd() }, bundle: true, platform: "node", format: "esm", write: false, define: { "import.meta.env": JSON.stringify({ VITE_TASKDB_V2_NATIVE_SELECTION: "explicit-native-selection" }) } });
const client = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);

test("selected native launch can never use the legacy transport, even before registration or after reload", async () => {
  assert.throws(() => client.getBackendTransport(), /cannot launch a legacy backend/);
  await assert.rejects(() => client.runBackendCommand("task.list"), /selected workspace/);
});

test("main UI calls concrete selected actions; preview flags and unproven operations never fall through", async () => {
  const calls = [];
  const workspace = {
    async save(...args) { calls.push(["save", ...args]); return {}; },
    async priority(...args) { calls.push(["priority", ...args]); return {}; },
    async status(...args) { calls.push(["status", ...args]); return {}; },
  };
  client.selectMainWorkspace(workspace);
  for (const options of [{ dryRun: true }, { readOnly: true }]) {
    await assert.rejects(() => client.createTask("Preview", "", options), /Nothing was sent/);
    await assert.rejects(() => client.updateTask("id", "Preview", "", 1, options), /Nothing was sent/);
    await assert.rejects(() => client.transitionTask("task.start", "id", 1, options), /Nothing was sent/);
  }
  await assert.rejects(() => client.createTask("Child", "", { parentId: "parent" }), /Child capture/);
  await assert.rejects(() => client.transitionTasks([{ id: "id", expectedVersion: 1, command: "task.start" }], {}), /selected workspace/);
  await assert.rejects(() => client.undoOperation("operation", {}), /selected workspace/);
  await assert.rejects(() => client.moveTask("id", null, 1, {}), /selected workspace/);
  assert.deepEqual(calls, []);
  await client.createTask("Inline @work", "Notes", { priority: 1, idempotencyKey: "capture-key" });
  await client.updateTask("id", "Inline @work", "Notes", 3, { idempotencyKey: "edit-key" });
  await client.updateTaskPriority({ id: "id", version: 3 }, 0, { idempotencyKey: "priority-key" });
  await client.transitionTask("task.start", "id", 3, { idempotencyKey: "status-key" });
  await client.undoStatusChange("id", 4, { idempotencyKey: "undo-key" });
  assert.deepEqual(calls, [
    ["save", "Inline @work", "Notes", 1, "capture-key"],
    ["save", "Inline @work", "Notes", undefined, "edit-key", "id", 3],
    ["priority", "id", 3, 0, "priority-key"],
    ["status", "task.start", "id", 3, "status-key"],
    ["status", "task.status.undo", "id", 4, "undo-key"],
  ]);
});
