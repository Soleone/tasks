import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { build } from "esbuild";
import { startDevServer } from "../dist/backend/devServer.js";
import { devWebOptions } from "./dev-web-options.mjs";

const bundle = await build({ entryPoints: ["src/platform/v2EditorClient.ts"], bundle: true, platform: "node", format: "esm", write: false, external: ["@tauri-apps/plugin-shell"] });
const { V2EditorClient, V2PreparedEdit, readV2EditorSelection } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const readerBundle = await build({ entryPoints: ["src/platform/v2BackendClient.ts"], bundle: true, platform: "node", format: "esm", write: false, external: ["@tauri-apps/plugin-shell"] });
const { readV2DevSelection } = await import(`data:text/javascript;base64,${Buffer.from(readerBundle.outputFiles[0].text).toString("base64")}`);
const literal = { title: "Call @alice #literal", description: "## @literal\n#not-classification", category: "WORK", tags: ["TODO", "alpha"], priority: 2 };
const closedId = "f3e5499b-402e-4d7d-8b61-eefc4409ca32";
const statusCommands = ["task.start", "task.pause", "task.complete", "task.reopen", "task.cancel", "task.delete"];
const linuxEditorCommands = ["task.create", "task.update", ...statusCommands, "task.status.undo", "task.move", "task.dependency.add", "task.dependency.remove"];
const statusSources = { "task.start": "done", "task.pause": "in_progress", "task.complete": "paused", "task.reopen": "done", "task.cancel": "paused", "task.delete": "done" };

function workspace(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "taskdb-v2-app-editor-"));
  const root = path.join(directory, "root"), cache = path.join(directory, "cache.db");
  cpSync("scripts/fixtures/taskdb-v2/root", root, { recursive: true });
  const originalXdg = process.env.XDG_DATA_HOME;
  const originalRegistry = process.env.TASKS_SOURCE_REGISTRY_PATH;
  process.env.XDG_DATA_HOME = path.join(directory, "profile"); delete process.env.TASKS_SOURCE_REGISTRY_PATH;
  t.after(() => {
    if (originalXdg === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = originalXdg;
    if (originalRegistry === undefined) delete process.env.TASKS_SOURCE_REGISTRY_PATH; else process.env.TASKS_SOURCE_REGISTRY_PATH = originalRegistry;
    rmSync(directory, { recursive: true, force: true });
  });
  return { directory, root, cache };
}
function bytes(root) { return Object.fromEntries(["workspace.json", ...readdirSync(path.join(root, "tasks")).map(name => `tasks/${name}`)].map(name => [name, readFileSync(path.join(root, name), "base64")])); }
function counts(cache) {
  const db = new DatabaseSync(cache, { readOnly: true });
  try { return { receipts: db.prepare("SELECT COUNT(*) AS n FROM v2_receipts").get().n, operations: db.prepare("SELECT COUNT(*) AS n FROM v2_operations").get().n }; }
  finally { db.close(); }
}
async function server(t, selected, v2Edit = true) {
  const dev = await startDevServer({ port: 0, v2Root: selected.root, databasePath: selected.cache, v2Edit });
  t.after(() => new Promise(resolve => dev.server.close(resolve)));
  const handshake = await (v2Edit ? readV2EditorSelection(dev.url) : readV2DevSelection(dev.url));
  return { dev, handshake, editor: v2Edit ? new V2EditorClient(dev.url, handshake) : null };
}
function traceFetch(t, alter) {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (...args) => {
    const request = args[1]?.body ? JSON.parse(args[1].body) : null;
    if (request) calls.push(request);
    const response = await original(...args);
    return alter ? alter(response, request) : response;
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

for (const argv of [["--v2-edit"], ["--v2-edit", "--database", "cache"], ["--v2-root", "root", "--v2-edit"], ["--v2-root", "root", "--database", "cache", "--v2-edit", "--v2-edit"]]) {
  test(`editor launcher refuses incomplete/duplicate selection ${JSON.stringify(argv)}`, () => assert.throws(() => devWebOptions(argv)));
}
test("editor flag is explicit, retains Vite separation and never enables default v1", () => {
  const options = devWebOptions(["--v2-root", "root", "--database", "cache", "--v2-edit", "--", "--host", "127.0.0.1"]);
  assert.equal(options.v2Edit, true); assert.equal(options.v2, true);
  assert.deepEqual(options.backendArgs, ["--v2-root", path.resolve("root"), "--database", path.resolve("cache"), "--v2-edit"]);
  assert.deepEqual(options.viteArgs, ["--host", "127.0.0.1"]);
  assert.equal(devWebOptions([]).v2Edit, undefined);
  assert.throws(() => startDevServer({ v2Edit: true }), /requires explicit/);
});

test("editor/read-only handshakes cannot silently cross modes; health creates no cache or profile", async t => {
  const selected = workspace(t), original = bytes(selected.root);
  const writable = await server(t, selected);
  assert.equal(writable.handshake.readOnly, false);
  assert.deepEqual(writable.handshake.writeCommands, linuxEditorCommands);
  assert.equal(existsSync(selected.cache), false); assert.equal(existsSync(process.env.XDG_DATA_HOME), false);
  await assert.rejects(readV2DevSelection(writable.dev.url), /No v1 fallback/);
  const readonly = await server(t, selected, false);
  await assert.rejects(readV2EditorSelection(readonly.dev.url), /--v2-edit/);
  assert.throws(() => new V2EditorClient(readonly.dev.url, readonly.handshake), /--v2-edit/);
  assert.deepEqual(bytes(selected.root), original);
});

test("editor refuses removed modes before querying the selected task", async t => {
  const selected = workspace(t), { editor } = await server(t, selected), calls = traceFetch(t);
  await assert.rejects(editor.begin(closedId, "parent"), /Unsupported editor mode/);
  assert.equal(calls.length, 0); assert.equal(existsSync(selected.cache), false);
});

test("editor health requires the exact connected-command whitelist, not comma coercion or expansion", async t => {
  const selected = workspace(t), { dev } = await server(t, selected);
  let writeCommands;
  traceFetch(t, async response => { const body = await response.json(); return new Response(JSON.stringify({ ...body, writeCommands })); });
  const allowed = linuxEditorCommands, native = allowed.slice(0, -3);
  for (writeCommands of [native, ["task.create,task.update"], ["task.update", "task.create"], ["task.create", "task.update", "workspace.recovery.resume"], [], ["task.create", null], [...allowed].reverse(), allowed.slice(0, -1), [...allowed.slice(0, -1), "operation.undo"], [...allowed.slice(0, -1), "task.start"]]) await assert.rejects(readV2EditorSelection(dev.url), /explicitly enabled/);
  assert.equal(existsSync(selected.cache), false);
});

for (const command of ["task.status.undoMany", "task.transitionMany", "task.reorder", "task.purgeCanceled", "operation.undo", "workspace.init", "workspace.migrateV1", "workspace.recovery.resume", "workspace.doctor.apply"]) {
  test(`editor HTTP bridge refuses unconnected ${command} before cache/effects`, async t => {
    const selected = workspace(t), original = bytes(selected.root);
    const { dev, handshake } = await server(t, selected);
    const response = await fetch(`${dev.url}/command`, { method: "POST", headers: { "content-type": "application/json", "x-taskdb-selection": handshake.selectionToken }, body: JSON.stringify({ version: 2, requestId: "unsupported", command, args: {}, readOnly: false }) });
    const body = await response.json(); assert.equal(body.error.code, "UNSUPPORTED_COMMAND");
    assert.equal(existsSync(selected.cache), false); assert.deepEqual(bytes(selected.root), original);
  });
}

test("literal capture preview is hypothetical and consumes no canonical effects/receipt/history", async t => {
  const selected = workspace(t), original = bytes(selected.root);
  const { editor } = await server(t, selected);
  const calls = traceFetch(t);
  const draft = structuredClone(literal);
  const prepared = editor.prepare(await editor.begin(), draft);
  draft.title = "changed caller"; draft.tags.push("changed");
  const preview = await prepared.preview();
  assert.equal(preview.task.title, literal.title); assert.equal(preview.task.description, literal.description);
  assert.equal(preview.task.category, "work"); assert.deepEqual(preview.task.tags, ["alpha", "todo"]);
  assert.deepEqual(bytes(selected.root), original); assert.deepEqual(counts(selected.cache), { receipts: 0, operations: 0 });
  assert.equal(prepared.hasExecuted, false);
  const previewRequest = calls.at(-1); assert.equal(previewRequest.dryRun, true); assert.equal(previewRequest.idempotencyKey, undefined);
  const applied = await prepared.execute();
  assert.notEqual(applied.task.id, preview.task.id);
  assert.equal(applied.task.title, literal.title); assert.equal(applied.task.category, "work"); assert.deepEqual(applied.task.tags, ["alpha", "todo"]);
  assert.equal(prepared.hasExecuted, true); assert.deepEqual(counts(selected.cache), { receipts: 1, operations: 1 });
  const replay = await prepared.execute(); assert.deepEqual(replay, applied);
  await assert.rejects(prepared.preview(), /cannot renew uncertain authority/);
  assert.deepEqual(counts(selected.cache), { receipts: 1, operations: 1 });
  assert.equal(prepared.retryMetadata.includes(literal.title), false); assert.equal(prepared.retryMetadata.includes(literal.description), false);
});

test("existing-task edit retains positive version, omissions, graph/order/createdAt and exact closure", async t => {
  const selected = workspace(t), { editor } = await server(t, selected);
  const baseline = await editor.begin(closedId);
  assert.equal(baseline.task.status, "done"); assert.ok(baseline.task.closedAt);
  const before = baseline.task;
  const prepared = editor.prepare(baseline, { ...before, title: "Closed @literal #text" });
  const request = JSON.parse(prepared.originalRequest);
  assert.deepEqual(request.args, { title: "Closed @literal #text", id: closedId, expectedVersion: before.version });
  const preview = await prepared.preview(); assert.equal(preview.task.closedAt, before.closedAt);
  const result = await prepared.execute();
  for (const field of ["description", "category", "tags", "status", "parentId", "dependencyIds", "orderKey", "createdAt", "closedAt"]) assert.deepEqual(result.task[field], before[field]);
  assert.equal(result.task.title, "Closed @literal #text"); assert.ok(result.task.version > before.version);
});

test("explicit classification/description clears do not classify the literal title", async t => {
  const selected = workspace(t), { editor } = await server(t, selected);
  const captured = await editor.prepare(await editor.begin(), literal).execute();
  const baseline = await editor.begin(captured.task.id);
  const prepared = editor.prepare(baseline, { ...baseline.task, category: null, tags: [], description: "" });
  const applied = await prepared.execute();
  assert.equal(applied.task.title, literal.title); assert.equal(applied.task.description, ""); assert.equal(applied.task.category, null); assert.deepEqual(applied.task.tags, []);
});

test("no-op preview/apply retains task bytes/time/version and stores only a success receipt", async t => {
  const selected = workspace(t), { editor } = await server(t, selected);
  const baseline = await editor.begin(closedId), original = bytes(selected.root);
  const prepared = editor.prepare(baseline, baseline.task);
  assert.equal((await prepared.preview()).changed, false);
  const result = await prepared.execute(); assert.equal(result.changed, false); assert.deepEqual(result.task, baseline.task);
  assert.deepEqual(bytes(selected.root), original); assert.deepEqual(counts(selected.cache), { receipts: 1, operations: 0 });
});

for (const failure of ["lost-reply", "v1-response", "wrong-correlation", "wrong-context", "missing-operation"]) {
  test(`executing ${failure} retains the original request and replays without queries or another task/group`, async t => {
    const selected = workspace(t), { editor } = await server(t, selected);
    const prepared = editor.prepare(await editor.begin(), literal);
    let failed = false;
    const calls = traceFetch(t, async (response, request) => {
      if (!failed && request?.command === "task.create" && !request.dryRun) {
        failed = true;
        const body = await response.json(); assert.equal(body.ok, true);
        if (failure === "lost-reply") throw new TypeError("lost reply after commit");
        if (failure === "v1-response") body.version = 1;
        if (failure === "wrong-correlation") body.requestId = "another";
        if (failure === "wrong-context") body.writeContext = "other-authority";
        if (failure === "missing-operation") delete body.result.operationId;
        return new Response(JSON.stringify(body));
      }
      return response;
    });
    await assert.rejects(prepared.execute()); assert.equal(prepared.hasExecuted, true);
    const replay = await prepared.execute(); assert.equal(replay.task.title, literal.title);
    assert.equal(readdirSync(path.join(selected.root, "tasks")).length, 5);
    assert.deepEqual(counts(selected.cache), { receipts: 1, operations: 1 });
    assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
    assert.equal(calls.some(call => ["workspace.info", "task.get"].includes(call.command)), false);
  });
}

for (const preview of [true, false]) {
  test(`wrong update task in ${preview ? "preview" : "executing"} reply is refused with original request retained`, async t => {
    const selected = workspace(t), { editor } = await server(t, selected);
    const baseline = await editor.begin(closedId);
    const prepared = editor.prepare(baseline, { ...baseline.task, title: "Wrong response task" });
    const original = prepared.originalRequest;
    let wrong = true;
    const calls = traceFetch(t, async response => {
      if (!wrong) return response;
      wrong = false; const body = await response.json(); assert.equal(body.ok, true);
      body.result.task.id = "another-task"; return new Response(JSON.stringify(body));
    });
    await assert.rejects(preview ? prepared.preview() : prepared.execute(), /another task/);
    assert.equal(prepared.originalRequest, original); assert.equal(prepared.hasExecuted, !preview);
    const result = await prepared.execute(); assert.equal(result.task.id, closedId);
    assert.deepEqual(counts(selected.cache), { receipts: 1, operations: 1 });
    if (!preview) assert.deepEqual(calls[0], calls[1]);
  });
}

test("stale edit never samples fresh authority or overwrites the concurrent bytes", async t => {
  const selected = workspace(t), { editor } = await server(t, selected);
  const baseline = await editor.begin(closedId);
  const prepared = editor.prepare(baseline, { ...baseline.task, title: "Stale attempted edit" });
  const file = path.join(selected.root, "tasks", `${closedId}.json`);
  const current = JSON.parse(readFileSync(file, "utf8")); current.title = "Concurrent CLI/editor content";
  writeFileSync(file, JSON.stringify(current) + "\n");
  const original = bytes(selected.root), calls = traceFetch(t);
  await assert.rejects(prepared.execute(), /STALE_TASK_VERSION/);
  await assert.rejects(prepared.execute(), /STALE_TASK_VERSION/);
  assert.deepEqual(calls[0], calls[1]); assert.equal(calls.length, 2); assert.deepEqual(bytes(selected.root), original);
  assert.deepEqual(counts(selected.cache), { receipts: 0, operations: 0 });
});

test("cache loss refuses original create context without query/refresh/new identity", async t => {
  const selected = workspace(t), { editor } = await server(t, selected);
  const prepared = editor.prepare(await editor.begin(), literal), original = bytes(selected.root);
  rmSync(selected.cache);
  const calls = traceFetch(t);
  await assert.rejects(prepared.execute(), /STALE_WRITE_CONTEXT/);
  await assert.rejects(prepared.execute(), /STALE_WRITE_CONTEXT/);
  assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]); assert.deepEqual(bytes(selected.root), original);
});

test("successful historical replay after task disappearance does not renew a task token or resurrect it", async t => {
  const selected = workspace(t), { editor } = await server(t, selected);
  const prepared = editor.prepare(await editor.begin(), literal), original = await prepared.execute();
  rmSync(path.join(selected.root, "tasks", `${original.task.id}.json`));
  const calls = traceFetch(t);
  assert.deepEqual(await prepared.execute(), original); assert.equal(calls.length, 1); assert.equal(calls[0].command, "task.create");
  assert.equal(existsSync(path.join(selected.root, "tasks", `${original.task.id}.json`)), false);
});

test("profile selection change is refused before gateway/cache access rather than renewing the retained request", async t => {
  const selected = workspace(t), { editor } = await server(t, selected);
  const prepared = editor.prepare(await editor.begin(), literal), original = bytes(selected.root);
  const profile = process.env.XDG_DATA_HOME, foreign = path.join(selected.directory, "foreign-profile");
  process.env.XDG_DATA_HOME = foreign;
  try { await assert.rejects(prepared.execute(), /STALE_DEV_SELECTION/); assert.equal(existsSync(foreign), false); }
  finally { process.env.XDG_DATA_HOME = profile; }
  assert.deepEqual(bytes(selected.root), original);
});

test("prepared requests copy caller payload/selection and reject absent original authority", async t => {
  const selected = workspace(t), { dev, handshake } = await server(t, selected);
  const caller = structuredClone(handshake), editor = new V2EditorClient(dev.url, caller);
  const baseline = await editor.begin(); const prepared = editor.prepare(baseline, literal);
  caller.rootPath = "/wrong"; caller.databasePath = "/wrong"; caller.profilePath = "/wrong"; caller.selectionToken = "wrong";
  const metadata = JSON.parse(prepared.retryMetadata); assert.equal(metadata.rootPath, selected.root); assert.equal(metadata.databasePath, selected.cache);
  assert.equal((await prepared.execute()).task.title, literal.title);
  const request = JSON.parse(prepared.originalRequest);
  for (const changes of [{ writeContext: undefined }, { idempotencyKey: undefined }, { requestId: undefined }, { requestId: "" }, { readOnly: true }, { dryRun: true }, { command: "task.move" }, { command: "task.update", args: { id: closedId, expectedVersion: 0, title: "bad" } }]) assert.throws(() => new V2PreparedEdit(dev.url, handshake, { ...request, ...changes }));
});

test("parallel execute cannot issue a second request while the original is in flight", async t => {
  const selected = workspace(t), { editor } = await server(t, selected);
  const prepared = editor.prepare(await editor.begin(), literal);
  const originalFetch = globalThis.fetch; let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let count = 0;
  globalThis.fetch = async (...args) => { count++; await blocked; return originalFetch(...args); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const first = prepared.execute();
  await assert.rejects(prepared.execute(), /already in flight/); assert.equal(count, 1);
  release(); await first; assert.deepEqual(counts(selected.cache), { receipts: 1, operations: 1 });
});

test("lost receipt authority after a committed/lost reply refuses original create without inferring completion", async t => {
  const selected = workspace(t), { editor } = await server(t, selected);
  const prepared = editor.prepare(await editor.begin(), literal);
  let drop = true;
  const calls = traceFetch(t, async (response, request) => {
    if (drop && request?.command === "task.create") { drop = false; assert.equal((await response.json()).ok, true); throw new TypeError("lost committed reply"); }
    return response;
  });
  await assert.rejects(prepared.execute()); const canonical = bytes(selected.root);
  rmSync(selected.cache);
  await assert.rejects(prepared.execute(), /STALE_WRITE_CONTEXT/);
  assert.deepEqual(calls[0], calls[1]); assert.equal(calls.length, 2);
  assert.deepEqual(bytes(selected.root), canonical); assert.equal(readdirSync(path.join(selected.root, "tasks")).length, 5);
});

for (const kind of ["empty", "v1"]) {
  test(`editor preparation refuses ${kind} roots without initialization/adoption/fallback`, async t => {
    const selected = workspace(t); rmSync(selected.root, { recursive: true });
    if (kind === "empty") mkdirSync(selected.root); else cpSync("scripts/fixtures/taskdb-v1/sync", selected.root, { recursive: true });
    const original = readdirSync(selected.root, { recursive: true });
    const { editor } = await server(t, selected);
    await assert.rejects(editor.begin(), /UNSUPPORTED_SCHEMA/);
    assert.deepEqual(readdirSync(selected.root, { recursive: true }), original);
  });
}

test("native editor construction is refused without launching any v1/v2 process", async t => {
  const selected = workspace(t), { dev, handshake } = await server(t, selected);
  const originalWindow = globalThis.window; globalThis.window = { __TAURI_INTERNALS__: {} };
  try { assert.throws(() => new V2EditorClient(dev.url, handshake), /browser-only; no native sidecar/); }
  finally { if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow; }
  assert.equal(existsSync(selected.cache), false);
});

test("simulated withheld host refuses the explicit editor launcher before storage, not native acceptance", t => {
  const selected = workspace(t), loader = path.join(selected.directory, "platform.mjs");
  writeFileSync(loader, 'Object.defineProperty(process,"platform",{value:"darwin"});\n');
  const result = spawnSync(process.execPath, ["--import", loader, "dist/backend/devServer.js", "--v2-root", selected.root, "--database", selected.cache, "--v2-edit"], { env: process.env, encoding: "utf8" });
  assert.equal(result.status, 1); assert.match(result.stderr, /editing is unavailable on this platform/); assert.equal(existsSync(selected.cache), false);
});

const statusMatrix = {
  "task.start": { allowed: ["open", "in_progress", "paused", "done"], target: "in_progress" },
  "task.pause": { allowed: ["open", "in_progress", "paused"], target: "paused" },
  "task.complete": { allowed: ["open", "in_progress", "paused", "done"], target: "done" },
  "task.reopen": { allowed: ["open", "in_progress", "paused", "done", "canceled"], target: "open" },
  "task.cancel": { allowed: ["open", "in_progress", "paused", "canceled"], target: "canceled" },
  "task.delete": { allowed: ["open", "in_progress", "paused", "done", "canceled"], target: "canceled" },
};
for (const [command, expected] of Object.entries(statusMatrix)) for (const source of ["open", "in_progress", "paused", "done", "canceled"]) {
  test(`editor status ${command} from ${source}: independent transition/closure/no-op contract`, async t => {
    const selected = workspace(t), file = path.join(selected.root, "tasks", `${closedId}.json`);
    const task = JSON.parse(readFileSync(file, "utf8")); task.status = source;
    task.closedAt = ["done", "canceled"].includes(source) ? task.closedAt : null;
    writeFileSync(file, JSON.stringify(task) + "\n");
    const { editor } = await server(t, selected), baseline = await editor.begin(closedId, "status");
    const original = bytes(selected.root), prepared = editor.prepareStatus(baseline, command);
    const envelope = JSON.parse(prepared.originalRequest), calls = traceFetch(t);
    assert.deepEqual(envelope.args, { id: closedId, expectedVersion: baseline.task.version });
    if (!expected.allowed.includes(source)) {
      await assert.rejects(prepared.preview(), /INVALID_TRANSITION/); assert.equal(prepared.hasExecuted, false);
      await assert.rejects(prepared.execute(), /INVALID_TRANSITION/); await assert.rejects(prepared.execute(), /INVALID_TRANSITION/);
      assert.deepEqual(calls[1], calls[2]); assert.deepEqual(bytes(selected.root), original);
      assert.deepEqual(counts(selected.cache), { receipts: 0, operations: 0 }); return;
    }
    const preview = await prepared.preview(), changed = source !== expected.target;
    assert.equal(preview.changed, changed); assert.equal(preview.task.status, expected.target);
    assert.deepEqual(bytes(selected.root), original); assert.deepEqual(counts(selected.cache), { receipts: 0, operations: 0 });
    const started = new Date().toISOString(), applied = await prepared.execute(), ended = new Date().toISOString();
    assert.equal(applied.changed, changed); assert.equal(applied.task.status, expected.target);
    for (const field of Object.keys(task).filter(field => !["status", "closedAt"].includes(field))) assert.deepEqual(applied.task[field], task[field]);
    if (!changed) { assert.equal(applied.task.closedAt, task.closedAt); assert.equal(applied.task.version, baseline.task.version); assert.deepEqual(bytes(selected.root), original); }
    else if (["done", "canceled"].includes(expected.target)) assert.ok(applied.task.closedAt >= started && applied.task.closedAt <= ended);
    else assert.equal(applied.task.closedAt, null);
    if (changed) assert.ok(applied.task.version > baseline.task.version);
    assert.deepEqual(counts(selected.cache), { receipts: 1, operations: changed ? 1 : 0 });
    assert.deepEqual(await prepared.execute(), applied); assert.deepEqual(calls[1], calls[2]);
    assert.equal(calls.some(call => ["workspace.info", "task.get"].includes(call.command)), false);
  });
}

test("status changes do not cascade, sever links or treat a done dependency as unblocked", async t => {
  const selected = workspace(t), { editor } = await server(t, selected);
  const parentId = "c8d4206d-c25a-4317-baa4-a2c5443060e9", childId = "6e1bf023-da3c-4785-b8a9-a696ac1fa5c1";
  const childFile = path.join(selected.root, "tasks", `${childId}.json`), childBytes = readFileSync(childFile, "base64");
  await editor.prepareStatus(await editor.begin(parentId, "status"), "task.complete").execute();
  let child = await editor.begin(childId); assert.deepEqual(child.task.blockedByIds, [parentId]); assert.equal(readFileSync(childFile, "base64"), childBytes);
  await editor.prepareStatus(await editor.begin(parentId, "status"), "task.delete").execute();
  child = await editor.begin(childId); assert.deepEqual(child.task.blockedByIds, []); assert.equal(readFileSync(childFile, "base64"), childBytes); assert.equal(child.task.parentId, parentId);
});

for (const failure of ["lost-reply", "wrong-task", "wrong-context", "v1-response", "missing-operation"]) {
  test(`status executing ${failure} retains context/version/command and replays without negotiation`, async t => {
    const selected = workspace(t), { editor } = await server(t, selected);
    const baseline = await editor.begin(closedId, "status"), prepared = editor.prepareStatus(baseline, "task.delete");
    const original = prepared.originalRequest; let failed = false;
    const calls = traceFetch(t, async response => {
      if (failed) return response; failed = true; const body = await response.json(); assert.equal(body.ok, true);
      if (failure === "lost-reply") throw new TypeError("lost status reply after commit");
      if (failure === "wrong-task") body.result.task.id = "other-task";
      if (failure === "wrong-context") body.writeContext = "other-context";
      if (failure === "v1-response") body.version = 1;
      if (failure === "missing-operation") delete body.result.operationId;
      return new Response(JSON.stringify(body));
    });
    await assert.rejects(prepared.execute()); assert.equal(prepared.hasExecuted, true); assert.equal(prepared.originalRequest, original);
    await assert.rejects(prepared.preview(), /cannot renew uncertain authority/);
    const applied = await prepared.execute(); assert.equal(applied.task.status, "canceled"); assert.deepEqual(calls[0], calls[1]); assert.equal(calls.length, 2);
    assert.deepEqual(counts(selected.cache), { receipts: 1, operations: 1 });
  });
}

test("status preparation refuses missing IDs/commands and withheld advertised capabilities before mutation", async t => {
  const selected = workspace(t), { editor } = await server(t, selected); let withheld = false;
  const calls = traceFetch(t, async response => { if (!withheld) return response; const body = await response.json(); if (body.result?.commands) body.result.commands = body.result.commands.filter(command => command !== "task.pause"); return new Response(JSON.stringify(body)); });
  await assert.rejects(editor.begin(undefined, "status"), /existing task/); assert.equal(calls.length, 0);
  const baseline = await editor.begin(closedId, "status");
  assert.throws(() => editor.prepareStatus({ ...baseline, task: null }, "task.start"));
  assert.throws(() => editor.prepareStatus(baseline, "operation.undo"));
  withheld = true;
  await assert.rejects(editor.begin(closedId, "status"), /UNSUPPORTED_COMMAND/); assert.equal(counts(selected.cache).operations, 0);
});

test("stale status execution never refreshes authority or changes concurrent content", async t => {
  const selected = workspace(t), { editor } = await server(t, selected), baseline = await editor.begin(closedId, "status");
  const prepared = editor.prepareStatus(baseline, "task.start"); await prepared.preview();
  const file = path.join(selected.root, "tasks", `${closedId}.json`), task = JSON.parse(readFileSync(file, "utf8")); task.title = "External status race"; writeFileSync(file, JSON.stringify(task) + "\n");
  const original = bytes(selected.root), calls = traceFetch(t);
  await assert.rejects(prepared.execute(), /STALE_TASK_VERSION/); await assert.rejects(prepared.execute(), /STALE_TASK_VERSION/);
  assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]); assert.deepEqual(bytes(selected.root), original);
  assert.deepEqual(counts(selected.cache), { receipts: 0, operations: 0 });
});

test("readonly bridge refuses all status commands/undo and relationship changes before authority or cache creation", async t => {
  const selected = workspace(t), { dev, handshake } = await server(t, selected, false), original = bytes(selected.root);
  for (const command of [...statusCommands, "task.status.undo", "task.move"]) {
    const response = await fetch(`${dev.url}/command`, { method: "POST", headers: { "content-type": "application/json", "x-taskdb-selection": handshake.selectionToken }, body: JSON.stringify({ version: 2, requestId: command, command, args: { id: closedId, expectedVersion: 1 }, dryRun: true }) });
    assert.equal((await response.json()).error.code, "UNSUPPORTED_COMMAND");
  }
  assert.equal(existsSync(selected.cache), false); assert.deepEqual(bytes(selected.root), original);
});

test("lost status cache authority after committed/lost reply refuses exact retry without inferred completion", async t => {
  const selected = workspace(t), { editor } = await server(t, selected), baseline = await editor.begin(closedId, "status");
  const prepared = editor.prepareStatus(baseline, "task.delete"); let lost = true;
  const calls = traceFetch(t, async response => { if (!lost) return response; lost = false; assert.equal((await response.json()).ok, true); throw new TypeError("lost status reply"); });
  await assert.rejects(prepared.execute()); const canonical = bytes(selected.root); rmSync(selected.cache);
  await assert.rejects(prepared.execute(), /STALE_WRITE_CONTEXT/); assert.deepEqual(calls[0], calls[1]); assert.equal(calls.length, 2); assert.deepEqual(bytes(selected.root), canonical);
});

test("historic status replay precedes missing task and never recreates canceled bytes", async t => {
  const selected = workspace(t), { editor } = await server(t, selected), baseline = await editor.begin(closedId, "status");
  const prepared = editor.prepareStatus(baseline, "task.delete"), applied = await prepared.execute();
  const file = path.join(selected.root, "tasks", `${closedId}.json`); rmSync(file);
  const calls = traceFetch(t); assert.deepEqual(await prepared.execute(), applied); assert.equal(calls.length, 1); assert.equal(existsSync(file), false);
  assert.deepEqual(counts(selected.cache), { receipts: 1, operations: 1 });
});

async function processDev(t, selected, loader, port = 0) {
  const child = spawn(process.execPath, [...(loader ? ["--import", loader] : []), "dist/backend/devServer.js", "--port", String(port), "--v2-root", selected.root, "--database", selected.cache, "--v2-edit"], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  const closed = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Editor backend startup timed out: " + stderr)), 5000);
    child.stdout.on("data", chunk => {
      stdout += chunk;
      const match = stdout.match(/tasks dev backend at (http:\/\/[^ ]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("exit", () => { clearTimeout(timeout); if (!stdout.includes("tasks dev backend at")) reject(new Error(stderr)); });
  });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM"); await closed; });
  return { child, closed, url, port: Number(new URL(url).port) };
}
function manualLine(selected, envelope) {
  return JSON.parse(execFileSync(process.execPath, ["dist/backend/cli.js", "--stdio", "--v2-root", selected.root, "--database", selected.cache], { env: process.env, input: envelope + "\n", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }));
}

for (const command of ["task.create", "task.update", ...statusCommands]) {
  for (const cut of command === "task.create" ? ["stage-written", "published", "beforeCommit", "afterCommit", "lostReply"] : ["intent", "published", "beforeCommit", "afterCommit", "lostReply"]) {
    test(`actual editor HTTP ${command} crash at ${cut} preserves original request for explicit recovery/manual replay`, async t => {
      const selected = workspace(t);
      const originalTask = JSON.parse(readFileSync(path.join(selected.root, "tasks", `${closedId}.json`), "utf8"));
      if (statusCommands.includes(command)) writeFileSync(path.join(selected.root, "tasks", `${closedId}.json`), JSON.stringify({ ...originalTask, status: statusSources[command], closedAt: statusSources[command] === "done" ? originalTask.closedAt : null }) + "\n");
      const { inspectV2CanonicalRoot } = await import("../dist/backend/v2CanonicalReader.js");
      const { pendingV2Path } = await import("../dist/backend/v2LocalDomain.js");
      const pendingPath = pendingV2Path(inspectV2CanonicalRoot(selected.root));
      const loader = path.join(selected.directory, "cut.mjs");
      writeFileSync(loader, `import { registerHooks } from 'node:module'; import fs from 'node:fs'; import { DatabaseSync } from 'node:sqlite';
const cut=${JSON.stringify(cut)}, pending=${JSON.stringify(pendingPath)}, command=${JSON.stringify(command)};
if(cut==='beforeCommit'||cut==='afterCommit'){const exec=DatabaseSync.prototype.exec; DatabaseSync.prototype.exec=function(sql){if(sql==='COMMIT'&&(fs.existsSync(pending)||globalThis.createStaged)&&cut==='beforeCommit')process.kill(process.pid,'SIGKILL'); const result=exec.call(this,sql); if(sql==='COMMIT'&&(fs.existsSync(pending)||globalThis.createStaged)&&cut==='afterCommit')process.kill(process.pid,'SIGKILL'); return result;};}
registerHooks({load(url,context,next){const result=next(url,context); if(!result.source)return result; let source=String(result.source); function replace(marker){if(source.split(marker).length!==2)throw Error('fault marker not unique: '+marker); source=source.replace(marker,marker+'\\nprocess.kill(process.pid,"SIGKILL");');}
if(cut==='intent'&&url.endsWith('/v2LocalDomain.js'))replace('renameSync(temporary, pending);');
if(command==='task.create'&&url.endsWith('/v2CreateWriter.js')){
 const marker='writeV2DurableFile(stage, bytes);';if(source.split(marker).length!==2)throw Error('unique stage marker required');source=source.replace(marker,marker+'globalThis.createStaged=true;'+(cut==='stage-written'?'process.kill(process.pid,"SIGKILL");':''));
 if(cut==='published')replace('renameSync(stage, target);');
}
if(cut==='published'&&command!=='task.create'&&url.endsWith('/v2UpdateJournal.js'))replace('renameSync(temporary, target);');
if(cut==='lostReply'&&url.endsWith('/devServer.js')){const marker='const result = executeDevV2Command(body, selection, request.headers["x-taskdb-selection"]);';if(source.split(marker).length!==2)throw Error('HTTP fault marker missing');source=source.replace(marker,marker+'\\nif(JSON.parse(body).command===command&&!JSON.parse(body).dryRun&&!JSON.parse(body).readOnly)process.kill(process.pid,"SIGKILL");'.replace('===command','==='+JSON.stringify(command)));}
return {...result,source};}});\n`);
      const initial = await processDev(t, selected, loader);
      const handshake = await readV2EditorSelection(initial.url);
      const editor = new V2EditorClient(initial.url, handshake);
      const baseline = await editor.begin(command === "task.create" ? undefined : closedId, statusCommands.includes(command) ? "status" : "content");
      const prepared = statusCommands.includes(command) ? editor.prepareStatus(baseline, command) : editor.prepare(baseline, baseline.task ? { ...baseline.task, title: literal.title } : literal);
      const originalRequest = prepared.originalRequest;
      await prepared.preview();
      await assert.rejects(prepared.execute());
      assert.equal((await initial.closed).signal, "SIGKILL"); assert.equal(prepared.hasExecuted, true);
      assert.equal(prepared.originalRequest, originalRequest);
      const restarted = await processDev(t, selected, undefined, initial.port);
      await readV2EditorSelection(restarted.url);
      await assert.rejects(prepared.execute(), /STALE_DEV_SELECTION/);
      let fixedId;
      if (existsSync(pendingPath)) {
        const intent = JSON.parse(readFileSync(pendingPath, "utf8"));
        assert.deepEqual(intent.request, JSON.parse(originalRequest)); fixedId = intent.taskId;
        if (["intent", "published", "beforeCommit"].includes(cut)) assert.equal(manualLine(selected, originalRequest).error.code, "RECOVERY_PENDING");
        const recovered = JSON.parse(execFileSync(process.execPath, ["dist/backend/tasks-cli.js", "--v2-root", selected.root, "--database", selected.cache, "recover", intent.operationId, "--json"], { env: process.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
        assert.equal(recovered.outcome, "complete");
      }
      const replay = manualLine(selected, originalRequest); assert.equal(replay.ok, true, JSON.stringify(replay));
      if (fixedId) assert.equal(replay.result.task.id, fixedId);
      assert.equal(replay.result.task.title, statusCommands.includes(command) ? originalTask.title : literal.title);
      if (statusCommands.includes(command)) { assert.equal(replay.result.task.updatedAt, originalTask.updatedAt); assert.equal(replay.result.task.createdAt, originalTask.createdAt); }
      const names = readdirSync(path.join(selected.root, "tasks"));
      if (command === "task.create") {
        assert.equal(names.filter(name => name.endsWith(".json")).length, ["published", "beforeCommit"].includes(cut) ? 6 : 5);
        assert.equal(names.filter(name => name.startsWith(".syncthing.taskdb-create-")).length, cut === "stage-written" ? 1 : 0);
      } else assert.equal(names.length, 4);
      assert.deepEqual(counts(selected.cache), { receipts: command === "task.create" || cut === "lostReply" ? 1 : 2, operations: 1 });
      const canonical = bytes(selected.root);
      assert.deepEqual(manualLine(selected, originalRequest).result, replay.result); assert.deepEqual(bytes(selected.root), canonical);
      assert.equal(existsSync(pendingPath), false);
      assert.equal(prepared.originalRequest, originalRequest);
    });
  }
}

test("browser status undo requires the advertised command before querying the selected task", async t => {
  const selected = workspace(t), { editor } = await server(t, selected);
  const calls = traceFetch(t, async response => {
    const body = await response.json();
    if (body.result?.commands) body.result.commands = body.result.commands.filter(command => command !== "task.status.undo");
    return new Response(JSON.stringify(body));
  });
  assert.deepEqual(editor.selection.writeCommands, linuxEditorCommands);
  await assert.rejects(editor.begin(closedId, "status"), /UNSUPPORTED_COMMAND/);
  assert.deepEqual(calls.map(call => call.command), ["workspace.info"]);
});

test("browser status undo restores the latest eligible status once and refuses without history", async t => {
  const selected = workspace(t), { editor } = await server(t, selected), openId = "c8d4206d-c25a-4317-baa4-a2c5443060e9";
  const unavailable = editor.prepareStatus(await editor.begin(openId, "status"), "task.status.undo");
  await assert.rejects(unavailable.execute(), /UNDO_UNAVAILABLE/);
  const completed = await editor.prepareStatus(await editor.begin(openId, "status"), "task.complete").execute();
  assert.equal(completed.task.status, "done");
  const undo = editor.prepareStatus(await editor.begin(openId, "status"), "task.status.undo");
  const undone = await undo.execute();
  assert.equal(undone.task.status, "open"); assert.equal(undone.task.closedAt, null);
  assert.deepEqual(await undo.execute(), undone);
  await assert.rejects(editor.prepareStatus(await editor.begin(openId, "status"), "task.status.undo").execute(), /UNDO_UNAVAILABLE/);
});
