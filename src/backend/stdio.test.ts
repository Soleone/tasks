import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { TestContext } from "node:test";
import type { Response } from "./protocol.js";

const cli = fileURLToPath(new URL("./tasks-cli.js", import.meta.url));
const golden = fileURLToPath(new URL("../../scripts/fixtures/workspace/root/", import.meta.url));
type Workspace = { root: string; cache: string };
function setup(t: TestContext): Workspace {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-process-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, "root");
  cpSync(golden, root, { recursive: true });
  return { root, cache: path.join(directory, "cache.db") };
}

function run(workspace: Workspace, bytes: Buffer): Response[] {
  const output = execFileSync(
    process.execPath,
    [cli, "--stdio", "--root", workspace.root, "--database", workspace.cache],
    {
      input: bytes,
      timeout: 10_000,
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

test("JSON-lines queries survive a process restart", (t) => {
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
  assert.equal(
    readFileSync(path.join(current.root, "workspace.json"), "utf8"),
    '{"schemaVersion":2}\n',
  );
  rmSync(current.cache);
  const lost = run(current, lines([{ command: "workspace.info" }]));
  assert.equal(lost[0].ok, true);
  if (lost[0].ok) assert.notEqual(lost[0].writeContext, ctx);
});

test("observe.bytes: a new process starts from the last one's scan and still sees a replaced file", async (t) => {
  const current = setup(t);
  const list = () => {
    const [response] = run(current, lines([{ command: "task.list", args: { sort: "manual" } }]));
    if (!response.ok) throw new Error("query failed");
    return response;
  };
  const titles = () => (list().result.tasks as { title: string }[]).map((task) => task.title);
  // Past the racy window, so the first run saves every file's stamp.
  await new Promise((resolve) => setTimeout(resolve, 3_200));
  const before = titles();
  const seen = list();
  assert.deepEqual(titles(), before);

  const id = "62f159c1-22a7-45cb-89a0-c0c35aaeb1ed";
  const file = path.join(current.root, "tasks", `${id}.json`);
  const task = JSON.parse(readFileSync(file, "utf8")) as { title: string };
  const stage = path.join(current.root, "replace.tmp");
  writeFileSync(stage, `${JSON.stringify({ ...task, title: "Replaced elsewhere" })}\n`);
  renameSync(stage, file);
  // A write in a new process starts from the saved scan too, and must not write over the change.
  const [write] = run(
    current,
    lines([
      {
        command: "task.update",
        writeContext: seen.writeContext,
        idempotencyKey: "stale-write",
        args: {
          id,
          expectedVersion: (seen.result.tasks as { id: string; version: number }[]).find(
            (listed) => listed.id === id,
          )!.version,
          title: "Written over",
        },
      },
    ]),
  );
  assert.equal(write.ok, false);
  const after = before.map((title) => (title === task.title ? "Replaced elsewhere" : title));
  assert.deepEqual(titles(), after);
  assert.deepEqual(titles(), after);
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
