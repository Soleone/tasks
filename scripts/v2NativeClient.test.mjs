import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import { nativePilotConfig, nativePilotSelection, resolveNativePilotSelection } from "./native-pilot-options.mjs";

const bundle = await build({ stdin: { contents: `export * from './src/platform/v2NativeSelection';export * from './src/platform/v2BackendClient';export * from './src/platform/v2EditorClient';export {JsonLineSession} from './src/platform/backendSession';export {parseV2Response} from './src/backend/v2Protocol';`, resolveDir: process.cwd() }, bundle: true, platform: "node", format: "esm", write: false, external: ["@tauri-apps/plugin-shell"] });
const { parseV2NativeSelection, validateV2NativeSelection, v2NativeSidecarArgs, V2_NATIVE_COMMANDS, V2_NATIVE_EDITOR_COMMANDS, V2WorkspaceReader, V2EditorClient, V2PreparedEdit, JsonLineSession, parseV2Response } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const selection = { rootPath: "C:\\proof\\root", databasePath: "C:\\proof\\cache.db", profilePath: "C:\\proof\\profile" };
const argv = ["--stdio", "--v2-root", selection.rootPath, "--database", selection.databasePath, "--windows-task-proof", "--local-profile", selection.profilePath];
const editorSelection = { ...selection, version: 2, readOnly: false, selectionToken: "native-memory-selection", writeCommands: V2_NATIVE_EDITOR_COMMANDS };
const task = { ...JSON.parse(readFileSync("scripts/fixtures/taskdb-v2/root/tasks/c8d4206d-c25a-4317-baa4-a2c5443060e9.json")), version: 1, blockedByIds: [] };
const info = { state: "ready", schemaVersion: 2, commands: V2_NATIVE_COMMANDS, issues: [], pendingOperationId: null, workspaceRevision: 1 };

function desktop(t, android = false) {
  const beforeWindow = Object.getOwnPropertyDescriptor(globalThis, "window"), beforeNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator"), beforeFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { __TAURI_INTERNALS__: {} } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: android ? "Android" : "Windows NT 10.0" } });
  globalThis.fetch = () => { throw new Error("Native test must never use HTTP"); };
  t.after(() => {
    if (beforeWindow) Object.defineProperty(globalThis, "window", beforeWindow); else delete globalThis.window;
    if (beforeNavigator) Object.defineProperty(globalThis, "navigator", beforeNavigator); else delete globalThis.navigator;
    globalThis.fetch = beforeFetch;
  });
}
function sessionFixture(t, respond) {
  const requests = [], launches = []; let kills = 0;
  const session = new JsonLineSession(async () => {
    launches.push(v2NativeSidecarArgs(selection));
    let stdout, close;
    return { stdout: { on(_event, callback) { stdout = callback; } }, on(event, callback) { if (event === "close") close = callback; },
      async spawn() { return {
        async write(line) { const request = JSON.parse(line); requests.push(request); const result = respond(request, () => close({ code: 1, signal: null })); if (result) stdout(JSON.stringify({ version: 2, requestId: request.requestId, ok: true, writeContext: "native-context", result }) + "\n"); },
        async kill() { kills++; },
      }; },
    };
  }, parseV2Response);
  t.after(() => session.close());
  return { session, requests, launches, kills: () => kills };
}

 test("native pilot freezes three explicit paths and constructs exactly eight positions", () => {
  const parsed = parseV2NativeSelection(selection); assert.deepEqual(parsed, selection); assert.equal(Object.isFrozen(parsed), true);
  assert.deepEqual(v2NativeSidecarArgs(parsed), argv);
  assert.deepEqual(nativePilotSelection(["--v2-root", selection.rootPath, "--database", selection.databasePath, "--local-profile", selection.profilePath]), selection);
  for (const candidate of [null, [], {}, { ...selection, extra: true }]) assert.throws(() => parseV2NativeSelection(candidate));
  for (const flags of [[], argv, ["--v2-root", selection.rootPath, "--local-profile", selection.profilePath, "--database", selection.databasePath], ["--v2-root", selection.rootPath, "--database", selection.databasePath, "--local-profile", selection.profilePath, "--config", "other"]]) assert.throws(() => nativePilotSelection(flags));
});
for (const filename of ["root", "C:relative", "/tmp/root", "\\\\server\\share", "\\\\?\\C:\\root", "C:/root", "C:\\root/other", "C:\\root\n", "C:\\root\r", "C:\\root\u0000", "C:\\root\\..\\other", "C:\\root\\.", "C:\\root\\", "C:\\root ", "C:\\root.", "C:\\root:stream", "C:\\root?", "C:\\root|other", "C:\\CON", "C:\\nul.db", "C:\\COM1", "C:\\LPT².txt", "C:\\CONOUT$"]) {
  test(`native path admission refuses ${JSON.stringify(filename)} before any launch`, () => {
    for (const field of Object.keys(selection)) assert.throws(() => v2NativeSidecarArgs({ ...selection, [field]: filename }));
  });
}
 test("native path admission measures complete cache and physical-root lock journal paths", () => {
  const lockSuffix = `\\com.soleone.tasks\\taskdb-v2\\roots\\${"0".repeat(64)}\\lock.db-journal`;
  const atBoundary = "C:\\" + "p".repeat(259 - lockSuffix.length - 3);
  validateV2NativeSelection({ ...selection, profilePath: atBoundary });
  assert.throws(() => validateV2NativeSelection({ ...selection, profilePath: atBoundary + "p" }), /complete SQLite/);
  const cache = "C:\\" + "c".repeat(259 - "-journal".length - 3);
  validateV2NativeSelection({ ...selection, databasePath: cache });
  assert.throws(() => validateV2NativeSelection({ ...selection, databasePath: cache + "c" }), /complete SQLite/);
  if (process.platform !== "win32") assert.throws(() => resolveNativePilotSelection(selection), /actual Windows/);
});
 test("pilot overlay selects one Windows local/main capability and one exact scoped sidecar", () => {
  const config = nativePilotConfig(selection, "C:\\proof\\webview"), [capability] = config.app.security.capabilities;
  assert.equal(config.app.windows[0].dataDirectory, "C:\\proof\\webview");
  assert.deepEqual(config.build, { devUrl: "http://127.0.0.1:5178", beforeDevCommand: "pnpm exec vite --host 127.0.0.1 --port 5178 --strictPort" });
  assert.match(readFileSync("vite.config.ts", "utf8"), /\*\*\/\.tmp\/\*\*/);
  assert.equal(config.app.security.capabilities.length, 1); assert.deepEqual(capability.platforms, ["windows"]); assert.deepEqual(capability.windows, ["main"]); assert.equal(capability.local, true);
  assert.deepEqual(capability.permissions.slice(0, 3), ["core:default", "shell:allow-stdin-write", "shell:allow-kill"]);
  const permission = capability.permissions[3], [scope] = permission.allow;
  assert.equal(permission.identifier, "shell:allow-spawn"); assert.equal(permission.allow.length, 1); assert.equal(scope.name, "binaries/tasks-backend"); assert.equal(scope.sidecar, true); assert.equal(scope.args.length, 8);
  for (let index = 0; index < 8; index++) {
    if (![2, 4, 7].includes(index)) { assert.equal(scope.args[index], argv[index]); continue; }
    const pattern = scope.args[index].validator;
    assert.ok(pattern.startsWith("\\A") && pattern.endsWith("\\z"));
    // Only translate Rust's absolute anchors to their strict JavaScript equivalent for this structural test.
    const validator = new RegExp(pattern.slice(2, -2).replace(/^/, "^(?:") + ")$(?![\\s\\S])");
    assert.equal(validator.test(argv[index]), true);
    for (const bad of ["", "C:\\other", argv[index] + "\n", argv[index] + "\r", argv[index] + "\u0000"]) assert.equal(validator.test(bad), false);
  }
});
 test("reader and editor share one selected native session without HTTP or duplicate sidecars", async t => {
  desktop(t);
  const state = sessionFixture(t, request => request.command === "workspace.info" ? info : request.command === "task.get" ? { task } : { task: { ...task, title: request.args.title }, changed: true, operationId: "native-operation" });
  const reader = new V2WorkspaceReader(selection, undefined, state.session), editor = new V2EditorClient(state.session, editorSelection);
  assert.equal(editor.isNative, true);
  await reader.workspaceInfo(); const baseline = await editor.begin(task.id);
  const prepared = editor.prepare(baseline, { ...task, title: "Native content" }); const original = prepared.originalRequest;
  await prepared.execute(); await prepared.execute(); assert.equal(prepared.originalRequest, original);
  assert.equal(state.launches.length, 1); assert.deepEqual(state.launches[0], argv); assert.deepEqual(state.requests.at(-1), state.requests.at(-2));
  await reader.close(); assert.equal(state.kills(), 1);
});
 test("native unsupported parent/grouped controls refuse before queries or preparation", async t => {
  desktop(t); const state = sessionFixture(t, () => { throw new Error("No request expected"); });
  const editor = new V2EditorClient(state.session, editorSelection);
  await assert.rejects(() => editor.begin(task.id, "parent"), /no query was sent/);
  await assert.rejects(() => editor.parentCandidates({ writeContext: "native-context", task }), /no query was sent/);
  for (const command of ["task.move", "task.transitionMany", "operation.undo", "workspace.recovery.resume"]) assert.throws(() => new V2PreparedEdit(state.session, editorSelection, { version: 2, command, requestId: "r", writeContext: "native-context", idempotencyKey: "k", actor: { kind: "human", label: "native" }, readOnly: false, dryRun: false, args: { id: task.id, expectedVersion: 1 } }));
  assert.equal(state.requests.length, 0); assert.equal(state.launches.length, 0);
});
 test("native capability mismatch pauses browsing and preparation without fallback", async t => {
  desktop(t); const state = sessionFixture(t, () => ({ ...info, commands: [...info.commands, "task.move"].sort() }));
  const reader = new V2WorkspaceReader(selection, undefined, state.session), editor = new V2EditorClient(state.session, editorSelection);
  await assert.rejects(() => reader.workspaceInfo(), /does not advertise/); await assert.rejects(() => editor.begin(task.id), /does not advertise/);
  assert.deepEqual(state.requests.map(request => request.command), ["workspace.info", "workspace.info"]);
});
 test("native lost reply preserves original request through same-selection process restart", async t => {
  desktop(t); let loseReply = true;
  const state = sessionFixture(t, (request, close) => {
    if (request.command === "workspace.info") return info;
    if (request.command === "task.get") return { task };
    if (loseReply) { loseReply = false; close(); return null; }
    return { task: { ...task, title: request.args.title }, changed: true, operationId: "retained-operation" };
  });
  const editor = new V2EditorClient(state.session, editorSelection), baseline = await editor.begin(task.id), prepared = editor.prepare(baseline, { ...task, title: "Uncertain native edit" });
  const original = prepared.originalRequest; await assert.rejects(() => prepared.execute(), /backend process closed/);
  assert.equal(prepared.hasExecuted, true); await assert.rejects(() => prepared.preview(), /cannot renew uncertain authority/);
  await prepared.execute(); assert.equal(prepared.originalRequest, original); assert.deepEqual(state.requests.at(-1), state.requests.at(-2));
  assert.equal(state.launches.length, 2); for (const launched of state.launches) assert.deepEqual(launched, argv);
});
 test("native Android and missing-native-session remain withheld", async t => {
  desktop(t, true); const state = sessionFixture(t, () => info);
  assert.throws(() => new V2EditorClient(state.session, editorSelection), /unavailable on Android/);
  assert.throws(() => new V2EditorClient("http://127.0.0.1", editorSelection), /browser-only/);
  const reader = new V2WorkspaceReader(selection, undefined, state.session); await assert.rejects(() => reader.workspaceInfo(), /not available on Android/);
  assert.equal(state.launches.length, 0);
});
