import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { draft } from "./fixtures/taskDraft.mjs";

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

test("without an open task folder every client call refuses", async () => {
  await assert.rejects(() => client.listTasks(), /NO_WORKSPACE/);
  await assert.rejects(() => client.createTask(draft("Lost"), {}), /NO_WORKSPACE/);
});

test("main UI calls concrete selected actions", async () => {
  const calls = [];
  const workspace = {
    async save(...args) {
      calls.push(["save", ...args]);
      return {};
    },
    async level(...args) {
      calls.push(["level", ...args]);
      return {};
    },
    async status(...args) {
      calls.push(["status", ...args]);
      return {};
    },
    async changes() {
      calls.push(["changes"]);
      return { revision: 7, conflictCopies: 0 };
    },
  };
  client.selectMainWorkspace(workspace);
  await client.createTask(draft("Inline @work", "Notes", 1), { idempotencyKey: "capture-key" });
  await client.updateTask("id", draft("Inline @work", "Notes", 1), 3, {
    idempotencyKey: "edit-key",
  });
  await client.updateTaskLevel(
    { id: "id", version: 3 },
    { priority: 0 },
    { idempotencyKey: "priority-key" },
  );
  await client.transitionTask("task.start", "id", 3, { idempotencyKey: "status-key" });
  assert.equal((await client.getWorkspaceChanges()).revision, 7);
  assert.deepEqual(calls, [
    ["save", draft("Inline @work", "Notes", 1), "capture-key"],
    ["save", draft("Inline @work", "Notes", 1), "edit-key", "id", 3],
    ["level", "id", 3, { priority: 0 }, "priority-key"],
    ["status", "task.start", "id", 3, "status-key"],
    ["changes"],
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

test("platform.open-workspace: switching drains queued tasks and home saves before close, choice and reload", async (t) => {
  client.closeMainWorkspace();
  const events = [];
  let releaseTask, releaseDocuments, releaseClose;
  let busy = false;
  const workspace = {
    assertCanClose() {
      if (busy) throw new Error("Finish current task change");
    },
    async save() {
      busy = true;
      events.push("task");
      await new Promise((resolve) => {
        releaseTask = resolve;
      });
      busy = false;
    },
    documents: {
      async waitForIdle() {
        events.push("documents");
        await new Promise((resolve) => {
          releaseDocuments = resolve;
        });
      },
    },
    reader: {
      async close() {
        events.push("close");
        await new Promise((resolve) => {
          releaseClose = resolve;
        });
      },
    },
  };
  const oldWindow = globalThis.window;
  const oldStorage = globalThis.sessionStorage;
  globalThis.window = {
    location: {
      reload() {
        events.push("reload");
      },
    },
  };
  globalThis.sessionStorage = {
    setItem(key, value) {
      events.push([key, value]);
    },
  };
  t.after(() => {
    globalThis.window = oldWindow;
    globalThis.sessionStorage = oldStorage;
    client.closeMainWorkspace();
  });
  client.selectMainWorkspace(workspace);
  const queued = client.createTask(draft("Queued"), {});
  const switching = client.switchHome();
  await assert.rejects(client.switchHome(), /HOME_CLOSING/);
  await assert.rejects(client.createTask(draft("Blocked"), {}), /HOME_CLOSING/);
  await assert.rejects(client.getWorkspaceChanges(), /HOME_CLOSING/);
  assert.deepEqual(events, ["task"]);
  releaseTask();
  await queued;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["task", "documents"]);
  releaseDocuments();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["task", "documents", "close"]);
  await assert.rejects(client.getWorkspaceChanges(), /HOME_CLOSING/);
  releaseClose();
  await switching;
  assert.deepEqual(events, ["task", "documents", "close", ["tasks.chooseHome", "1"], "reload"]);
  await assert.rejects(client.getWorkspaceChanges(), /HOME_CLOSING/);
});

test("platform.open-workspace: active, unresolved, unsaved and failed-close homes stay open", async (t) => {
  t.after(() => client.closeMainWorkspace());
  for (const failure of [
    "active",
    "unresolved",
    "reconciliation",
    "save",
    "close",
    "selection changed",
  ]) {
    client.closeMainWorkspace();
    const events = [];
    const workspace = {
      assertCanClose() {
        if (["active", "unresolved", "reconciliation"].includes(failure)) throw new Error(failure);
      },
      documents: {
        async waitForIdle() {
          events.push("documents");
          if (failure === "save") throw new Error("disk full");
          if (failure === "selection changed") client.closeMainWorkspace();
        },
      },
      reader: {
        async close() {
          events.push("close");
          throw new Error("close failed");
        },
      },
      async changes() {
        return { revision: 4, conflictCopies: 0 };
      },
    };
    client.selectMainWorkspace(workspace);
    await assert.rejects(
      client.switchHome(),
      /active|unresolved|reconciliation|disk full|close failed|selected home changed/,
    );
    assert.deepEqual(
      events,
      ["active", "unresolved", "reconciliation"].includes(failure)
        ? []
        : failure === "close"
          ? ["documents", "close"]
          : ["documents"],
    );
    if (failure !== "selection changed")
      assert.equal((await client.getWorkspaceChanges()).revision, 4);
  }
});
