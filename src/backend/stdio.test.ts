import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { TestContext } from "node:test";
import type { Response } from "./protocol.js";

const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
const golden = fileURLToPath(new URL("../../scripts/fixtures/workspace/root/", import.meta.url));
type Workspace = { root: string; cache: string; trap: string };
function setup(t: TestContext): Workspace {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-process-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, "root");
  const trap = path.join(directory, "legacy-must-not-open");
  cpSync(golden, root, { recursive: true });
  mkdirSync(trap);
  return { root, cache: path.join(directory, "cache.db"), trap };
}

function run(workspace: Workspace, bytes: Buffer): Response[] {
  const output = execFileSync(
    process.execPath,
    [cli, "--stdio", "--root", workspace.root, "--database", workspace.cache],
    {
      input: bytes,
      timeout: 10_000,
      env: {
        ...process.env,
        TASKS_SYNC_ROOT: workspace.trap,
        TASKS_SOURCE_REGISTRY_PATH: path.join(workspace.trap, "missing-registry.json"),
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  return output
    .toString()
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Response);
}

function lines(requests: object[]): Buffer {
  return Buffer.from(
    requests.map((request) => JSON.stringify({ version: 2, ...request })).join("\n"),
  );
}

test("opt-in JSON-lines queries survive process restart without using legacy roots/registry", (t) => {
  const current = setup(t);
  const first = run(
    current,
    lines([
      { requestId: "info", command: "workspace.info" },
      { requestId: "list", command: "task.list", args: { sort: "manual" } },
    ]),
  );
  assert.equal(first[0].ok, true);
  assert.equal(first[1].ok, true);
  if (!first[0].ok || !first[1].ok) throw new Error("query failed");
  const ctx = first[0].writeContext;
  const tasks = first[1].result.tasks as { id: string; version: number }[];
  const restarted = run(current, lines([{ command: "task.list", args: { sort: "manual" } }]));
  assert.equal(restarted[0].ok, true);
  if (!restarted[0].ok) throw new Error("query failed");
  assert.equal(restarted[0].writeContext, ctx);
  assert.deepEqual(restarted[0].result.tasks, first[1].result.tasks);
  assert.ok(tasks.every((task) => Number.isSafeInteger(task.version) && task.version > 0));
  assert.equal(existsSync(path.join(current.trap, "workspace.json")), false);
  assert.equal(existsSync(path.join(current.trap, "missing-registry.json")), false);
  assert.equal(
    readFileSync(path.join(current.root, "workspace.json"), "utf8"),
    '{"schemaVersion":2}\n',
  );
  rmSync(current.cache);
  const lost = run(current, lines([{ command: "workspace.info" }]));
  assert.equal(lost[0].ok, true);
  if (lost[0].ok) assert.notEqual(lost[0].writeContext, ctx);
});

test("stdio preserves invalid UTF-8, nulls unsafe correlation and continues after errors/EOF", (t) => {
  const current = setup(t);
  const bytes = Buffer.concat([
    Buffer.from(
      ' \t\r\n{"version":2,"requestId":"unsafe","command":"task.list","args":{"search":"',
    ),
    Buffer.from([0xff]),
    Buffer.from('"}}\n{"version":2,"command":"task.list","args":{"search":"\\ud800"}}\n'),
    lines([
      {
        requestId: "known",
        command: "workspace.receive.prepare",
        args: { title: "sensitive" },
        readOnly: true,
      },
      { requestId: "last", command: "task.list" },
    ]),
  ]);
  const responses = run(current, bytes);
  assert.equal(responses.length, 4);
  assert.equal(responses[0].ok, false);
  if (!responses[0].ok) assert.equal(responses[0].error.code, "INVALID_REQUEST");
  assert.equal(responses[0].requestId, null);
  assert.equal(responses[1].ok, false);
  assert.equal(responses[2].requestId, "known");
  if (!responses[2].ok) {
    assert.equal(responses[2].error.code, "UNSUPPORTED_COMMAND");
    assert.equal(responses[2].error.message.includes("sensitive"), false);
  }
  assert.equal(responses[3].requestId, "last");
  assert.equal(responses[3].ok, true);
});

test("CLI requires an explicit cache; an inside-root cache cannot create synced metadata", (t) => {
  const current = setup(t);
  const missing = spawnSync(process.execPath, [cli, "--stdio", "--root", current.root], {
    input: "",
    timeout: 10_000,
  });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr.toString(), /--database/);
  const bad = run(
    { ...current, cache: path.join(current.root, "cache.db") },
    lines([{ command: "workspace.info" }]),
  );
  assert.equal(bad[0].ok, false);
  if (!bad[0].ok) assert.equal(bad[0].error.code, "INVALID_STORAGE");
  assert.equal(existsSync(path.join(current.root, "cache.db")), false);
});
