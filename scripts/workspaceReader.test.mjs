import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { startDevServer } from "../dist/backend/devServer.js";
import { devWebOptions } from "./dev-web-options.mjs";

const bundled = await build({
  stdin: {
    contents:
      "export * from './src/platform/workspaceReader'; export { readEditorSelection } from './src/platform/editorClient';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  external: ["@tauri-apps/plugin-shell"],
});
const client = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const { WorkspaceReader, readEditorSelection, parseTaskPage, parseWorkspaceInfo, sidecarArgs } =
  client;
const { parseTaskProjection } = await import("../dist/backend/taskResults.js");
const { parseResponse } = await import("../dist/backend/protocol.js");
const task = JSON.parse(
  readFileSync(
    "scripts/fixtures/workspace/root/tasks/c8d4206d-c25a-4317-baa4-a2c5443060e9.json",
    "utf8",
  ),
);
const projection = { ...task, version: 1, blockedByIds: [] };
const request = (command = "workspace.info") => ({
  version: 2,
  requestId: crypto.randomUUID(),
  command,
  args: {},
  actor: { kind: "human", label: "reader test" },
  readOnly: true,
  dryRun: false,
});

function canonicalBytes(root) {
  return Object.fromEntries(
    ["workspace.json", ...readdirSync(path.join(root, "tasks")).map((name) => `tasks/${name}`)].map(
      (name) => [name, readFileSync(path.join(root, name), "base64")],
    ),
  );
}
function workspace(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "tasks-app-reader-"));
  const rootPath = path.join(directory, "root");
  cpSync("scripts/fixtures/workspace/root", rootPath, { recursive: true });
  const originalXdg = process.env.XDG_DATA_HOME;
  const originalRegistry = process.env.TASKS_SOURCE_REGISTRY_PATH;
  delete process.env.TASKS_SOURCE_REGISTRY_PATH;
  process.env.XDG_DATA_HOME = path.join(directory, "profile");
  t.after(() => {
    if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = originalXdg;
    if (originalRegistry === undefined) delete process.env.TASKS_SOURCE_REGISTRY_PATH;
    else process.env.TASKS_SOURCE_REGISTRY_PATH = originalRegistry;
    rmSync(directory, { recursive: true, force: true });
  });
  return { rootPath, databasePath: path.join(directory, "cache.db"), directory };
}
async function devReader(t, selection) {
  const dev = await startDevServer({
    port: 0,
    root: selection.rootPath,
    databasePath: selection.databasePath,
  });
  t.after(() => new Promise((resolve) => dev.server.close(resolve)));
  const selected = await readEditorSelection(dev.url);
  const reader = new WorkspaceReader(selection, { url: dev.url, selection: selected });
  return { dev, selected, reader };
}
function processCommand(args, launches, responses) {
  return async () => {
    launches.push(args);
    let receive, close, error;
    return {
      stdout: {
        on(_event, callback) {
          receive = callback;
        },
      },
      on(event, callback) {
        if (event === "close") close = callback;
        if (event === "error") error = callback;
      },
      async spawn() {
        const child = spawn(process.execPath, ["dist/backend/cli.js", ...args], {
          env: process.env,
          stdio: ["pipe", "pipe", "pipe"],
        });
        child.stdout.on("data", (data) => {
          responses.push(data.toString());
          receive(data.toString());
        });
        child.on("close", (code, signal) => close?.({ code, signal }));
        child.on("error", (reason) => error?.(reason.message));
        return {
          write(line) {
            return new Promise((resolve, reject) =>
              child.stdin.write(line, (reason) => (reason ? reject(reason) : resolve())),
            );
          },
          async kill() {
            if (child.exitCode !== null) return;
            await new Promise((resolve) => {
              child.once("close", resolve);
              child.kill("SIGTERM");
            });
          },
        };
      },
    };
  };
}

test("dev launcher passes an explicit root and keeps Vite arguments separate", () => {
  assert.deepEqual(
    devWebOptions(["--root", "fixture", "--database", "cache.db", "--", "--port", "5231"]),
    {
      backendArgs: ["--root", path.resolve("fixture"), "--database", path.resolve("cache.db")],
      viteArgs: ["--port", "5231"],
      real: false,
      refresh: false,
    },
  );
});
test("dev launcher without a selection leaves the workspace to the disposable fixture", () => {
  assert.deepEqual(devWebOptions(["--", "--host", "127.0.0.1"]), {
    backendArgs: [],
    viteArgs: ["--host", "127.0.0.1"],
    real: false,
    refresh: false,
  });
});
test("dev launcher asks for the kept copy of the real folder", () => {
  assert.deepEqual(devWebOptions(["--real", "--refresh"]), {
    backendArgs: [],
    viteArgs: [],
    real: true,
    refresh: true,
  });
});
for (const argv of [
  ["--root", "root"],
  ["--root"],
  ["--root", "--database", "cache"],
  ["--root", "root", "--database", "cache", "--root", "other"],
  ["--root", "root", "--database", ""],
  ["--root", "root", "--database", "cache", "--unknown", "value"],
  ["--refresh"],
  ["--real", "--real"],
  ["--real", "--root", "root", "--database", "cache"],
]) {
  test(`dev launcher refuses ambiguous selection ${JSON.stringify(argv)}`, () =>
    assert.throws(() => devWebOptions(argv)));
}

test("response validator refuses legacy and malformed successes/errors", () => {
  const success = { version: 2, requestId: "r", ok: true, writeContext: "ctx", result: {} };
  assert.deepEqual(parseResponse(success), success);
  const failure = {
    version: 2,
    requestId: null,
    ok: false,
    error: { code: "RECOVERY_CONFLICT", message: "preserve evidence", details: {} },
  };
  assert.deepEqual(parseResponse(failure), failure);
  for (const response of [
    { ...success, version: 1 },
    { ...success, writeContext: "" },
    { ...success, requestId: 1 },
    { ...success, result: [] },
    { ...success, rootPath: "other" },
    { ...failure, ok: "false" },
    { ...failure, error: { code: "BAD", message: 7 } },
    { ...failure, error: { code: "BAD", message: "bad", details: [] } },
  ])
    assert.throws(() => parseResponse(response));
});

test("projections retain literal title, description, slugs and closedAt", () => {
  const literal = {
    ...projection,
    title: "Call @alice #not-a-tag",
    description: "## @literal\n#not-classification",
    category: "work",
    tags: ["todo"],
    status: "done",
    closedAt: task.updatedAt,
  };
  assert.deepEqual(parseTaskProjection(literal), literal);
  assert.equal(Object.hasOwn(parseTaskProjection(literal), "descriptionMarkdown"), false);
  assert.equal(Object.hasOwn(parseTaskProjection(literal), "completedAt"), false);
});
for (const [label, changes] of Object.entries({
  "legacy description": { descriptionMarkdown: "legacy" },
  "label category": { category: { slug: "work", label: "Work" } },
  "zero version": { version: 0 },
  "unsafe version": { version: Number.MAX_SAFE_INTEGER + 1 },
  "foreign blocker": { blockedByIds: ["missing"] },
  "unknown field": { extra: true },
  "invalid closure": { status: "open", closedAt: task.updatedAt },
})) {
  test(`client refuses ${label}`, () =>
    assert.throws(() => parseTaskProjection({ ...projection, ...changes })));
}

test("list validator refuses duplicate projection identities and unsafe pagination", () => {
  const page = {
    tasks: [projection],
    contextTasks: [],
    total: 1,
    limit: 50,
    offset: 0,
    workspaceRevision: 1,
  };
  assert.deepEqual(parseTaskPage(page), page);
  for (const changes of [
    { contextTasks: [projection] },
    { tasks: [projection, projection], total: 2 },
    { limit: 101 },
    { offset: -1 },
    { total: 0 },
    { contextTasks: undefined },
  ])
    assert.throws(() => parseTaskPage({ ...page, ...changes }));
  assert.throws(() =>
    parseWorkspaceInfo({
      state: "ready",
      schemaVersion: 2,
      commands: [],
      issues: [],
      pendingOperationId: null,
      workspaceRevision: -1,
    }),
  );
});

test("sidecar selection accepts explicit absolute paths and exact argv only", () => {
  for (const rootPath of [
    "/tmp/disposable root",
    "C:\\disposable\\root",
    "\\\\host\\share\\root",
  ]) {
    assert.deepEqual(sidecarArgs({ rootPath, databasePath: "/tmp/cache.db" }), [
      "--stdio",
      "--root",
      rootPath,
      "--database",
      "/tmp/cache.db",
    ]);
  }
  for (const rootPath of ["", "relative", "--root", "/tmp/root\nother", "/tmp/root\0other"])
    assert.throws(() => sidecarArgs({ rootPath, databasePath: "/tmp/cache.db" }));
  const permission = JSON.parse(
    readFileSync("src-tauri/capabilities/default.json", "utf8"),
  ).permissions.find((item) => item.identifier === "shell:allow-spawn");
  // The desktop app may start the backend only on one folder and its cache.
  assert.equal(permission.allow.length, 1);
  assert.deepEqual(
    permission.allow[0].args.map((arg) => (typeof arg === "string" ? arg : "*")),
    ["--stdio", "--root", "*", "--database", "*"],
  );
  assert.throws(
    () => new WorkspaceReader({ rootPath: "/tmp/root", databasePath: "/tmp/cache.db" }),
    /Native launch is unavailable here/,
  );
});

test("health discovers explicit selection without reading/initializing root or cache", async (t) => {
  const selected = workspace(t);
  const original = canonicalBytes(selected.rootPath);
  const { reader } = await devReader(t, selected);
  assert.equal(existsSync(selected.databasePath), false);
  const info = await reader.workspaceInfo();
  assert.equal(info.state, "ready");
  assert.equal(info.schemaVersion, 2);
  const page = await reader.tasks({ sort: "manual" });
  assert.equal(page.total, 4);
  assert.equal(page.contextTasks.length, 0);
  assert.deepEqual(canonicalBytes(selected.rootPath), original);
  await assert.rejects(
    reader.query("task.create", { title: "must not exist" }),
    /no mutation capability/,
  );
  assert.deepEqual(canonicalBytes(selected.rootPath), original);
});

test("dev bridge requires an explicit cache", (t) => {
  const selected = workspace(t);
  assert.throws(() => startDevServer({ port: 0, root: selected.rootPath }), /no default workspace/);
});

test("dev bridge refuses unconnected commands, stale/missing selection and version 1 frames without effects", async (t) => {
  const selected = workspace(t);
  const original = canonicalBytes(selected.rootPath);
  const { dev, selected: handshake } = await devReader(t, selected);
  for (const [body, token, code] of [
    [
      { ...request("task.purgeCanceled"), readOnly: false },
      handshake.selectionToken,
      "UNSUPPORTED_COMMAND",
    ],
    [request(), "old-server", "STALE_DEV_SELECTION"],
    [request(), undefined, "STALE_DEV_SELECTION"],
    [
      { version: 1, requestId: "version-1", command: "task.list" },
      handshake.selectionToken,
      "INVALID_REQUEST",
    ],
  ]) {
    const response = await fetch(`${dev.url}/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { "x-taskdb-selection": token } : {}),
      },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(result.version, 2);
    assert.equal(result.error.code, code);
  }
  assert.deepEqual(canonicalBytes(selected.rootPath), original);
  assert.equal(existsSync(selected.databasePath), false);
});

test("browser client refuses mismatched selected paths", async (t) => {
  const selected = workspace(t);
  const { dev: bridge, selected: handshake } = await devReader(t, selected);
  assert.throws(
    () =>
      new WorkspaceReader(
        { ...selected, rootPath: path.join(selected.directory, "other") },
        { url: bridge.url, selection: handshake },
      ),
    /does not match/,
  );
});

test("a restarted dev backend cannot silently substitute a different root/cache", async (t) => {
  const selected = workspace(t);
  const { reader, dev } = await devReader(t, selected);
  await reader.workspaceInfo();
  await new Promise((resolve) => dev.server.close(resolve));
  const rootPath = path.join(selected.directory, "different-root");
  const databasePath = path.join(selected.directory, "different-cache.db");
  cpSync("scripts/fixtures/workspace/root", rootPath, { recursive: true });
  const next = await startDevServer({ port: dev.port, root: rootPath, databasePath });
  t.after(() => new Promise((resolve) => next.server.close(resolve)));
  await assert.rejects(reader.workspaceInfo(), /STALE_DEV_SELECTION|fetch failed/);
  assert.equal(existsSync(databasePath), false);
  const nextSelection = await readEditorSelection(next.url);
  await assert.rejects(reader.workspaceInfo(), /STALE_DEV_SELECTION/);
  const nextReader = new WorkspaceReader(nextSelection, {
    url: next.url,
    selection: nextSelection,
  });
  assert.equal((await nextReader.workspaceInfo()).state, "ready");
});

test("reader selection is a fixed private snapshot, not a mutable caller reference", async (t) => {
  const selected = workspace(t);
  const { dev, selected: handshake } = await devReader(t, selected);
  const supplied = { rootPath: selected.rootPath, databasePath: selected.databasePath };
  const reader = new WorkspaceReader(supplied, { url: dev.url, selection: handshake });
  supplied.rootPath = "/must-not-select";
  handshake.selectionToken = "changed-by-caller";
  assert.equal(reader.selection.rootPath, selected.rootPath);
  assert.equal((await reader.workspaceInfo()).state, "ready");
  assert.ok(Object.isFrozen(reader.selection));
});

test("empty and schema 1 roots are inspected without initialization or fallback", async (t) => {
  const selected = workspace(t);
  const empty = path.join(selected.directory, "empty");
  mkdirSync(empty);
  const { reader: emptyReader } = await devReader(t, {
    rootPath: empty,
    databasePath: path.join(selected.directory, "empty-cache.db"),
  });
  assert.equal((await emptyReader.workspaceInfo()).state, "empty");
  await assert.rejects(emptyReader.tasks(), /complete schema-2/);
  assert.deepEqual(readdirSync(empty), []);
  const legacy = path.join(selected.directory, "legacy");
  cpSync("scripts/fixtures/schema1/sync", legacy, { recursive: true });
  const legacyBefore = canonicalBytes(legacy);
  const { reader } = await devReader(t, {
    rootPath: legacy,
    databasePath: path.join(selected.directory, "legacy-control.db"),
  });
  assert.equal((await reader.workspaceInfo()).state, "unsupported");
  await assert.rejects(reader.tasks(), /UNSUPPORTED_SCHEMA/);
  assert.deepEqual(canonicalBytes(legacy), legacyBefore);
});

test("conflicts are reported separately and no alternate is silently adopted", async (t) => {
  const selected = workspace(t);
  const alternate = { ...task, title: "Alternate, not selected" };
  writeFileSync(
    path.join(selected.rootPath, "tasks", `${task.id}.sync-conflict-20261004-000000-ABCDEF.json`),
    JSON.stringify(alternate),
  );
  const original = canonicalBytes(selected.rootPath);
  const { reader } = await devReader(t, selected);
  const info = await reader.workspaceInfo();
  assert.ok(info.issues.some((issue) => issue.code.includes("CONFLICT")));
  const page = await reader.tasks();
  assert.equal(page.tasks.find((item) => item.id === task.id).title, task.title);
  assert.deepEqual(canonicalBytes(selected.rootPath), original);
});

test("malformed pending evidence pauses queries without automatic repair or deletion", async (t) => {
  const selected = workspace(t);
  const { reader } = await devReader(t, selected);
  await reader.workspaceInfo();
  const { inspectCanonicalRoot } = await import("../dist/backend/canonicalReader.js");
  const { pendingIntentPath } = await import("../dist/backend/localDomain.js");
  const pending = pendingIntentPath(inspectCanonicalRoot(selected.rootPath));
  mkdirSync(path.dirname(pending), { recursive: true });
  writeFileSync(pending, "{incomplete");
  const original = canonicalBytes(selected.rootPath);
  const info = await reader.workspaceInfo();
  assert.equal(info.state, "recovery_pending");
  assert.ok(info.issues.some((issue) => issue.code === "RECOVERY_CONFLICT"));
  await assert.rejects(reader.tasks(), /RECOVERY_CONFLICT/);
  assert.equal(readFileSync(pending, "utf8"), "{incomplete");
  assert.deepEqual(canonicalBytes(selected.rootPath), original);
});

test("HTTP reader sees actual friendly CLI edits and retains query-only authority", async (t) => {
  const selected = workspace(t);
  const { reader } = await devReader(t, selected);
  const before = await reader.tasks();
  const added = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "dist/backend/tasks-cli.js",
        "--root",
        selected.rootPath,
        "--database",
        selected.databasePath,
        "add",
        "--title",
        "Call @alice",
        "--category",
        "WORK",
        "--tag",
        "TODO",
        "--json",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
  const after = await reader.tasks();
  assert.equal(after.total, before.total + 1);
  assert.ok(after.workspaceRevision > before.workspaceRevision);
  const observed = after.tasks.find((item) => item.id === added.task.id);
  assert.equal(observed.title, "Call @alice");
  assert.equal(observed.category, "work");
  assert.deepEqual(observed.tags, ["todo"]);
  const filtered = await reader.tasks({ status: "open", search: "Call @alice" });
  assert.deepEqual(
    filtered.tasks.map((item) => item.id),
    [observed.id],
  );
});

test("actual JSON-lines reader launches only selected process and can reopen retained cache", async (t) => {
  const selected = workspace(t);
  const original = canonicalBytes(selected.rootPath);
  const launches = [],
    responses = [];
  const args = sidecarArgs(selected);
  const reader = new WorkspaceReader(
    selected,
    undefined,
    processCommand(args, launches, responses),
  );
  t.after(() => reader.close());
  assert.equal(launches.length, 0);
  const info = await reader.workspaceInfo();
  const before = await reader.tasks();
  assert.equal(info.state, "ready");
  assert.equal(before.total, 4);
  await reader.close();
  const after = await reader.tasks();
  assert.equal(after.workspaceRevision, before.workspaceRevision);
  assert.deepEqual(
    after.tasks.map((item) => item.version),
    before.tasks.map((item) => item.version),
  );
  assert.deepEqual(launches, [args, args]);
  assert.ok(
    responses
      .join("")
      .trim()
      .split("\n")
      .every((line) => JSON.parse(line).version === 2),
  );
  assert.deepEqual(canonicalBytes(selected.rootPath), original);
});
