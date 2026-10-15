import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { TestContext } from "node:test";
import { executeLine } from "./gateway.js";
import { readRootDescriptor } from "./canonicalReader.js";
import { pendingIntentPath } from "./localDomain.js";
import type { Response } from "./protocol.js";

const golden = fileURLToPath(new URL("../../scripts/fixtures/taskdb-v2/root/", import.meta.url));
type Workspace = { root: string; cache: string };
const parentId = "c8d4206d-c25a-4317-baa4-a2c5443060e9";
function setup(t: TestContext): Workspace {
  const directory = mkdtempSync(path.join(os.tmpdir(), "taskdb-v2-update-"));
  const env = { XDG_DATA_HOME: process.env.XDG_DATA_HOME, APPDATA: process.env.APPDATA };
  process.env.XDG_DATA_HOME = path.join(directory, "local");
  process.env.APPDATA = path.join(directory, "local");
  t.after(() => {
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(directory, { recursive: true, force: true });
  });
  const root = path.join(directory, "root");
  cpSync(golden, root, { recursive: true });
  return { root, cache: path.join(directory, "cache.db") };
}
function send(workspace: Workspace, envelope: object): Response {
  return executeLine(Buffer.from(JSON.stringify({ version: 2, ...envelope })), workspace.root, workspace.cache);
}
function success(response: Response): Extract<Response, { ok: true }> {
  assert.equal(response.ok, true, JSON.stringify(response));
  if (!response.ok) throw new Error("failed");
  return response;
}
function prepared(workspace: Workspace, args: object, key = "edit") {
  const read = success(send(workspace, { command: "task.get", args: { id: parentId } }));
  const task = read.result.task as { version: number };
  return { command: "task.update", writeContext: read.writeContext, idempotencyKey: key, args: { id: parentId, expectedVersion: task.version, ...args } };
}

test("v2 update commits once, preserves classifications/closure, and replays before live graph checks", { skip: process.platform !== "linux" }, (t) => {
  const workspace = setup(t);
  const request = prepared(workspace, { title: "Call @alice" });
  const first = success(send(workspace, request));
  const task = first.result.task as Record<string, unknown>;
  assert.equal(task.title, "Call @alice");
  assert.equal(task.category, "planning");
  assert.deepEqual(task.tags, ["product"]);
  assert.equal(task.closedAt, null);
  assert.ok((task.version as number) > request.args.expectedVersion);
  assert.equal(existsSync(pendingIntentPath(readRootDescriptor(workspace.root))), false);
  assert.deepEqual(success(send(workspace, { ...request, requestId: "repeat" })).result, first.result);
  const activity = success(send(workspace, { command: "activity.list" })).result.activity as object[];
  assert.equal(activity.length, 1);
  for (const changed of [{ ...request, args: { ...request.args, title: "Other" } }, { ...request, actor: { kind: "human", label: "changed" } }, { ...request, dryRun: true }]) {
    const response = send(workspace, changed);
    assert.equal(response.ok, false);
    if (!response.ok) assert.equal(response.error.code, "IDEMPOTENCY_KEY_REUSED");
  }
  rmSync(path.join(workspace.root, "tasks", `${parentId}.json`));
  assert.deepEqual(success(send(workspace, request)).result, first.result);
});

test("malformed task result in a retained receipt cannot become typed historical success", { skip: process.platform !== "linux" }, t => {
  const workspace = setup(t), request = prepared(workspace, { description: "Typed receipt boundary" });
  const committed = success(send(workspace, request));
  const file = path.join(workspace.root, "tasks", `${parentId}.json`), bytes = readFileSync(file);
  const database = new DatabaseSync(workspace.cache);
  database.prepare("UPDATE v2_receipts SET result = ?").run(JSON.stringify({ ...committed.result, operationId: undefined }));
  database.close();
  const replay = send(workspace, request);
  assert.equal(replay.ok, false);
  if (!replay.ok) assert.equal(replay.error.code, "INVALID_STORAGE");
  assert.deepEqual(readFileSync(file), bytes);
  assert.equal((success(send(workspace, { command: "activity.list" })).result.activity as object[]).length, 1);
  const restore = new DatabaseSync(workspace.cache);
  restore.prepare("UPDATE v2_receipts SET result = ?").run(JSON.stringify(committed.result));
  restore.close();
  assert.deepEqual(success(send(workspace, request)).result, committed.result);
});

test("v2 copied cache refuses original receipts without changing canonical bytes", { skip: process.platform !== "linux" }, (t) => {
  const workspace = setup(t);
  const request = prepared(workspace, { description: "Copied-cache boundary" });
  const committed = success(send(workspace, request));
  const copy = { ...workspace, cache: `${workspace.cache}.copy` };
  cpSync(workspace.cache, copy.cache);
  const file = path.join(workspace.root, "tasks", `${parentId}.json`);
  const bytes = readFileSync(file);
  const refused = send(copy, request);
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.error.code, "STALE_WRITE_CONTEXT");
  const fresh = success(send(copy, { command: "workspace.info" }));
  assert.notEqual(fresh.writeContext, request.writeContext);
  assert.deepEqual(readFileSync(file), bytes);
  assert.deepEqual(success(send(workspace, request)).result, committed.result);
});

test("v2 no-op/preview leave bytes, versions and activity unchanged, but executed no-op has a receipt", { skip: process.platform !== "linux" }, (t) => {
  const workspace = setup(t);
  const file = path.join(workspace.root, "tasks", `${parentId}.json`);
  const bytes = readFileSync(file);
  const noOpRequest = prepared(workspace, { title: " Plan launch " });
  const noOp = success(send(workspace, noOpRequest));
  assert.equal(noOp.result.changed, false);
  assert.equal((noOp.result.task as { version: number }).version, noOpRequest.args.expectedVersion);
  assert.deepEqual(success(send(workspace, { ...noOpRequest, requestId: "again" })).result, noOp.result);
  const preview = prepared(workspace, { text: "Review @Work #TODO" }, "preview");
  const result = success(send(workspace, { ...preview, dryRun: true, idempotencyKey: undefined }));
  assert.equal(result.result.changed, true);
  assert.equal((result.result.task as { title: string }).title, "Review");
  assert.deepEqual(readFileSync(file), bytes);
  assert.deepEqual(success(send(workspace, { command: "activity.list" })).result.activity, []);
  const applied = success(send(workspace, preview));
  assert.equal((applied.result.task as { category: string }).category, "work");
  assert.deepEqual((applied.result.task as { tags: string[] }).tags, ["todo"]);
});

test("v2 stale/missing context, versions, keys and malformed args fail without consuming a retry", { skip: process.platform !== "linux" }, (t) => {
  const workspace = setup(t);
  const request = prepared(workspace, { description: "New" });
  const bytes = readFileSync(path.join(workspace.root, "tasks", `${parentId}.json`));
  for (const [envelope, code] of [
    [{ ...request, writeContext: undefined }, "WRITE_CONTEXT_REQUIRED"],
    [{ ...request, writeContext: "old" }, "STALE_WRITE_CONTEXT"],
    [{ ...request, idempotencyKey: undefined }, "IDEMPOTENCY_REQUIRED"],
    [{ ...request, args: { ...request.args, expectedVersion: undefined } }, "EXPECTED_VERSION_REQUIRED"],
    [{ ...request, args: { ...request.args, expectedVersion: request.args.expectedVersion + 100 } }, "STALE_TASK_VERSION"],
    [{ ...request, args: { ...request.args, descriptionMarkdown: "old" } }, "INVALID_ARGUMENT"],
  ] as const) {
    const response = send(workspace, envelope);
    assert.equal(response.ok, false);
    if (!response.ok) assert.equal(response.error.code, code);
  }
  assert.deepEqual(readFileSync(path.join(workspace.root, "tasks", `${parentId}.json`)), bytes);
  assert.equal(success(send(workspace, request)).result.changed, true);
  rmSync(workspace.cache);
  const lost = send(workspace, request);
  assert.equal(lost.ok, false);
  if (!lost.ok) assert.equal(lost.error.code, "STALE_WRITE_CONTEXT");
});

test("v2 edit of a closed task preserves closure and updates only edit time/content", { skip: process.platform !== "linux" }, (t) => {
  const workspace = setup(t);
  const file = path.join(workspace.root, "tasks", `${parentId}.json`);
  const task = JSON.parse(readFileSync(file, "utf8"));
  task.status = "done"; task.closedAt = "2026-09-08T14:00:00.000Z";
  writeFileSync(file, JSON.stringify(task));
  const response = success(send(workspace, prepared(workspace, { description: "Closed note" })));
  const edited = response.result.task as Record<string, unknown>;
  assert.equal(edited.closedAt, task.closedAt);
  assert.equal(edited.createdAt, task.createdAt);
  assert.equal(edited.status, "done");
  assert.notEqual(edited.updatedAt, task.updatedAt);
});
