import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCopyTestWorkspace as setup } from "./copyTestWorkspace.js";
import type { CopyTestWorkspace as Workspace } from "./copyTestWorkspace.js";
import { readCanonicalRoot, readRootDescriptor } from "./canonicalReader.js";
import { executeLine } from "./gateway.js";
import { executeCopy } from "./copyWriter.js";
import { parseRequest } from "./protocol.js";
import { DatabaseSync } from "node:sqlite";
import { pendingIntentPath, persistPending, withRootWriterLock } from "./localDomain.js";
import type { Response } from "./protocol.js";

const fixtures = fileURLToPath(new URL("../../scripts/fixtures/taskdb-v2/", import.meta.url));
const corpus = JSON.parse(readFileSync(path.join(fixtures, "cases.json"), "utf8")) as { cases: { id: string; action: { steps?: { command: string; sourceDirectory?: string; destinationDirectory: string }[]; args?: { destinationDirectory: string } }; expect: Record<string, unknown> }[] };
const id = "c8d4206d-c25a-4317-baa4-a2c5443060e9";
function send(workspace: Workspace, envelope: object): Response {
  return executeLine(Buffer.from(JSON.stringify({ version: 2, ...envelope })), workspace.root, workspace.cache);
}
function success(response: Response): Extract<Response, { ok: true }> {
  assert.equal(response.ok, true, JSON.stringify(response));
  if (!response.ok) throw new Error("failed");
  return response;
}
function fail(response: Response, code: string) {
  assert.equal(response.ok, false);
  if (!response.ok) assert.equal(response.error.code, code, JSON.stringify(response));
}
function prepared(workspace: Workspace, command = "workspace.archive", args: object = { destinationDirectory: workspace.destination }) {
  const info = success(send(workspace, { command: "workspace.info" }));
  return { command, args, writeContext: info.writeContext, idempotencyKey: "copy" };
}
function rawCanonical(root: string) {
  return ["workspace.json", ...readdirSync(path.join(root, "tasks")).filter(name => name.endsWith(".json")).sort().map(name => `tasks/${name}`)]
    .map(name => [name, readFileSync(path.join(root, name)).toString("base64")]);
}
const linuxOnly = { skip: process.platform !== "linux" };

for (const command of ["workspace.archive", "workspace.restore"]) {
  test(`Windows absence-only ${command} refuses an empty destination before staging without consuming the key`, linuxOnly, t => {
    const workspace = setup(t), canonical = rawCanonical(workspace.root);
    mkdirSync(workspace.destination);
    const request = parseRequest({ version: 2, ...prepared(workspace, command, {
      destinationDirectory: workspace.destination, ...(command === "workspace.restore" ? { sourceDirectory: workspace.root } : {}),
    }) });
    for (const flags of [{}, { readOnly: true }, { dryRun: true }]) {
      assert.throws(() => executeCopy({ ...request, ...flags }, workspace.root, workspace.cache, true),
        { code: "UNSUPPORTED_COMMAND", message: "UNSUPPORTED_COMMAND: Windows copy proof requires an absent destination; existing empty directories are not supported" });
      assert.deepEqual(rawCanonical(workspace.root), canonical);
      assert.deepEqual(readdirSync(workspace.destination), []);
      assert.equal(existsSync(pendingIntentPath(readRootDescriptor(workspace.root))), false);
      const database = new DatabaseSync(workspace.cache);
      try { assert.equal(database.prepare("SELECT count(*) AS n FROM v2_receipts").get()!.n, 0); }
      finally { database.close(); }
    }
    // Disposable preparation, not a production delete-before-publication fallback.
    rmSync(workspace.destination, { recursive: true });
    const result = executeCopy(request, workspace.root, workspace.cache, true);
    assert.deepEqual(rawCanonical(workspace.destination), canonical);
    assert.deepEqual(rawCanonical(workspace.root), canonical);
    assert.deepEqual(executeCopy(request, workspace.root, workspace.cache, true).result, result.result);
  });
}

test("Node v2 copy commands execute archive-restore corpus case without changing selection or authority", linuxOnly, (t) => {
  const entry = corpus.cases.find(entry => entry.id === "archive-restore")!;
  assert.deepEqual(entry.expect, { sameCanonicalBytes: true, sourceBytesUnchanged: true, selectionUnchanged: true, noCacheCopied: true });
  const workspace = setup(t);
  const bytes = rawCanonical(workspace.root);
  const before = success(send(workspace, { command: "task.list" }));
  const [archiveStep, restoreStep] = entry.action.steps!;
  assert.equal(restoreStep.sourceDirectory, archiveStep.destinationDirectory);
  workspace.destination = path.join(workspace.directory, archiveStep.destinationDirectory);
  const request = prepared(workspace, archiveStep.command);
  const archive = success(send(workspace, request));
  assert.equal(archive.result.destinationDirectory, workspace.destination);
  assert.equal(archive.result.taskCount, 4);
  assert.deepEqual(rawCanonical(workspace.destination), bytes);
  assert.deepEqual(readdirSync(workspace.destination).sort(), ["tasks", "workspace.json"]);
  assert.equal(existsSync(pendingIntentPath(readRootDescriptor(workspace.root))), false);
  const restored = path.join(workspace.directory, restoreStep.destinationDirectory);
  success(send(workspace, { ...request, command: restoreStep.command, idempotencyKey: "restore", args: { sourceDirectory: workspace.destination, destinationDirectory: restored } }));
  assert.deepEqual(rawCanonical(restored), bytes);
  assert.deepEqual(rawCanonical(workspace.root), bytes);
  assert.deepEqual(success(send(workspace, { command: "task.list" })), before);
  assert.deepEqual(success(send(workspace, { command: "activity.list" })).result.activity, []);
  const adopted = { ...workspace, root: restored, cache: path.join(workspace.directory, "restored.db") };
  const fresh = success(send(adopted, { command: "workspace.info" }));
  assert.equal(fresh.result.state, "ready");
  assert.notEqual(fresh.writeContext, before.writeContext);
  fail(send(adopted, { command: "task.update", writeContext: before.writeContext, idempotencyKey: "old", args: { id, expectedVersion: 1, title: "Old authority" } }), "STALE_WRITE_CONTEXT");
});

test("Node v2 archive executes destination-overlap corpus case with zero canonical effects", linuxOnly, (t) => {
  const entry = corpus.cases.find(entry => entry.id === "destination-overlap")!;
  assert.equal(entry.expect.error, "INVALID_ARGUMENT");
  const workspace = setup(t);
  const bytes = rawCanonical(workspace.root);
  const request = prepared(workspace);
  const overlap = entry.action.args!.destinationDirectory.replace("selected-root", workspace.root);
  const alias = path.join(workspace.directory, "source-alias");
  symlinkSync(workspace.root, alias, "dir");
  const missingParent = path.join(workspace.directory, "missing-parent", "archive");
  for (const destinationDirectory of [workspace.root, overlap, workspace.directory, path.join(workspace.root, "tasks", "archive"), alias, path.join(alias, "archive"), missingParent]) {
    fail(send(workspace, { ...request, args: { destinationDirectory } }), "INVALID_ARGUMENT");
    assert.deepEqual(rawCanonical(workspace.root), bytes);
    assert.equal(existsSync(pendingIntentPath(readRootDescriptor(workspace.root))), false);
  }
  assert.equal(existsSync(path.dirname(missingParent)), false);
  assert.equal(readdirSync(workspace.directory).some(name => name.endsWith(".stage")), false);
  success(send(workspace, request));
});

test("v2 copy preserves raw conflicts and excludes transport artifacts", linuxOnly, (t) => {
  const workspace = setup(t);
  const conflict = `${id}.sync-conflict-20261002-DEVICE.json`;
  writeFileSync(path.join(workspace.root, "workspace.json"), ' {"schemaVersion": 2}\n');
  mkdirSync(path.join(workspace.root, ".stfolder"));
  writeFileSync(path.join(workspace.root, "tasks", conflict), Buffer.from([255, 128, 0]));
  writeFileSync(path.join(workspace.root, "tasks", ".syncthing.transfer.tmp"), "partial");
  mkdirSync(path.join(workspace.root, ".stversions"));
  writeFileSync(path.join(workspace.root, ".stversions", "old.json"), "historical");
  const before = rawCanonical(workspace.root);
  const request = prepared(workspace);
  success(send(workspace, request));
  assert.deepEqual(rawCanonical(workspace.destination), before);
  assert.deepEqual(rawCanonical(workspace.root), before);
  assert.deepEqual(readdirSync(workspace.destination).sort(), ["tasks", "workspace.json"]);
  assert.equal(existsSync(path.join(workspace.destination, ".stversions")), false);
  assert.equal(existsSync(path.join(workspace.destination, "tasks", ".syncthing.transfer.tmp")), false);
});

test("v2 copy previews consume no key and preserve bytes, versions and local activity", linuxOnly, (t) => {
  const workspace = setup(t);
  const before = success(send(workspace, { command: "task.list" }));
  const bytes = rawCanonical(workspace.root);
  const request = prepared(workspace);
  for (const flags of [{ dryRun: true }, { readOnly: true }]) {
    success(send(workspace, { ...request, idempotencyKey: undefined, ...flags }));
    success(send(workspace, { ...request, ...flags }));
    assert.equal(existsSync(workspace.destination), false);
    assert.equal(readdirSync(workspace.directory).some(name => name.endsWith(".stage")), false);
    assert.deepEqual(success(send(workspace, { command: "task.list" })), before);
    assert.deepEqual(rawCanonical(workspace.root), bytes);
  }
  const copied = success(send(workspace, request));
  fail(send(workspace, { ...request, dryRun: true }), "IDEMPOTENCY_KEY_REUSED");
  fail(send(workspace, { ...request, actor: { kind: "human", label: "Other" } }), "IDEMPOTENCY_KEY_REUSED");
  assert.deepEqual(success(send(workspace, { ...request, requestId: "replay" })).result, copied.result);
});

test("v2 copy historical replay precedes source/destination checks and never recopy overwrites", linuxOnly, (t) => {
  const workspace = setup(t);
  const request = prepared(workspace);
  const first = success(send(workspace, request));
  writeFileSync(path.join(workspace.destination, "keep"), "New destination data");
  writeFileSync(path.join(workspace.root, "tasks", `${id}.json`), "{");
  assert.deepEqual(success(send(workspace, request)).result, first.result);
  assert.equal(readFileSync(path.join(workspace.destination, "keep"), "utf8"), "New destination data");
  const other = { ...workspace, root: path.join(workspace.directory, "selected"), cache: path.join(workspace.directory, "selected.db") };
  cpSync(path.join(fixtures, "root"), other.root, { recursive: true });
  const source = path.join(workspace.directory, "external");
  cpSync(path.join(fixtures, "root"), source, { recursive: true });
  const restore = prepared(other, "workspace.restore", { sourceDirectory: source, destinationDirectory: path.join(workspace.directory, "restored") });
  const result = success(send(other, restore));
  rmSync(source, { recursive: true });
  assert.deepEqual(success(send(other, restore)).result, result.result);
});

test("v2 copy validates context, key and shapes; occupied/invalid destinations consume no key", linuxOnly, (t) => {
  const workspace = setup(t);
  const request = prepared(workspace);
  fail(send(workspace, { ...request, writeContext: undefined }), "WRITE_CONTEXT_REQUIRED");
  fail(send(workspace, { ...request, writeContext: "lost" }), "STALE_WRITE_CONTEXT");
  fail(send(workspace, { ...request, idempotencyKey: undefined }), "IDEMPOTENCY_REQUIRED");
  for (const args of [{}, { destinationDirectory: "" }, { destinationDirectory: 7 }, { destinationDirectory: workspace.destination, extra: true }]) fail(send(workspace, { ...request, args }), "INVALID_ARGUMENT");
  mkdirSync(workspace.destination);
  writeFileSync(path.join(workspace.destination, "keep"), "User data");
  fail(send(workspace, request), "DESTINATION_NOT_EMPTY");
  assert.equal(readFileSync(path.join(workspace.destination, "keep"), "utf8"), "User data");
  rmSync(workspace.destination, { recursive: true });
  writeFileSync(workspace.destination, "Occupied file");
  fail(send(workspace, request), "DESTINATION_NOT_EMPTY");
  assert.equal(readFileSync(workspace.destination, "utf8"), "Occupied file");
  assert.equal(existsSync(pendingIntentPath(readRootDescriptor(workspace.root))), false);
  rmSync(workspace.destination);
  success(send(workspace, request));
});

test("v2 restore destination cannot overlap selected root or cache, even with a separate source", linuxOnly, (t) => {
  const workspace = setup(t);
  const source = path.join(workspace.directory, "source");
  cpSync(path.join(fixtures, "root"), source, { recursive: true });
  const request = prepared(workspace, "workspace.restore", { sourceDirectory: source, destinationDirectory: path.join(workspace.root, "inside") });
  fail(send(workspace, request), "INVALID_ARGUMENT");
  const cacheDirectory = path.join(workspace.directory, "cache-dir");
  mkdirSync(cacheDirectory);
  const other = { ...workspace, cache: path.join(cacheDirectory, "cache.db") };
  const restore = prepared(other, "workspace.restore", { sourceDirectory: source, destinationDirectory: cacheDirectory });
  fail(send(other, restore), "DESTINATION_NOT_EMPTY");
  assert.equal(existsSync(pendingIntentPath(readRootDescriptor(workspace.root))), false);
});

test("v2 archive refuses descriptor conflicts without changing originals", linuxOnly, (t) => {
  const workspace = setup(t);
  const request = prepared(workspace);
  const file = path.join(workspace.root, "workspace.sync-conflict-20261002-OTHER.json");
  writeFileSync(file, '{"schemaVersion":1}');
  fail(send(workspace, request), "INVALID_CANONICAL");
  assert.equal(readFileSync(file, "utf8"), '{"schemaVersion":1}');
  assert.equal(existsSync(workspace.destination), false);
  assert.equal(readCanonicalRoot(workspace.root).tasks.length, 4);
});

test("v2 copy publishes into an explicitly empty destination reached through an authorized alias", linuxOnly, (t) => {
  const workspace = setup(t);
  const actual = path.join(workspace.directory, "empty-output");
  mkdirSync(actual);
  const alias = path.join(workspace.directory, "output-alias");
  symlinkSync(actual, alias, "dir");
  const request = prepared(workspace, "workspace.archive", { destinationDirectory: alias });
  const result = success(send(workspace, request));
  assert.equal(result.result.destinationDirectory, actual);
  assert.deepEqual(rawCanonical(alias), rawCanonical(workspace.root));
  assert.equal(success(send({ ...workspace, root: alias, cache: path.join(workspace.directory, "new.db") }, { command: "workspace.info" })).result.state, "ready");
});

for (const command of ["workspace.archive", "workspace.restore"]) {
  test(`v2 ${command} refuses pending source updates without copying unfinished state`, linuxOnly, t => {
    const workspace = setup(t);
    const sourceDirectory = command === "workspace.archive" ? workspace.root : path.join(workspace.directory, "source");
    if (sourceDirectory !== workspace.root) cpSync(path.join(fixtures, "root"), sourceDirectory, { recursive: true });
    const request = prepared(workspace, command, { destinationDirectory: workspace.destination, ...(command === "workspace.restore" ? { sourceDirectory } : {}) });
    const source = readCanonicalRoot(sourceDirectory);
    const root = readRootDescriptor(sourceDirectory);
    const task = source.tasks.find(task => task.id === id)!;
    const beforeBytes = readFileSync(path.join(sourceDirectory, "tasks", `${id}.json`));
    const at = "2026-10-02T12:00:00.000Z";
    withRootWriterLock(root, () => persistPending(root, {
      format: "taskdb.pending-update", version: 1, root, cachePath: workspace.cache,
      request: parseRequest({ version: 2, command: "task.update", writeContext: request.writeContext, idempotencyKey: "pending-edit", args: { id, expectedVersion: 1, title: "Pending edit" } }),
      operationId: "00000000-0000-4000-8000-000000000000", at, taskId: id,
      beforeBytes: beforeBytes.toString("base64"), nextBytes: Buffer.from(`${JSON.stringify({ ...task, title: "Pending edit", updatedAt: at })}\n`).toString("base64"), guards: source.files,
    }));
    const pending = readFileSync(pendingIntentPath(root));
    fail(send(workspace, request), "RECOVERY_PENDING");
    assert.deepEqual(readCanonicalRoot(sourceDirectory).files, source.files);
    assert.deepEqual(readFileSync(pendingIntentPath(root)), pending);
    assert.equal(existsSync(workspace.destination), false);
    assert.equal(readdirSync(workspace.directory).some(name => name.endsWith(".stage")), false);
  });
}

test("v2 copy receipts cannot be adopted from a copied cache", linuxOnly, (t) => {
  const workspace = setup(t);
  const request = prepared(workspace);
  const original = success(send(workspace, request));
  const copied = { ...workspace, cache: `${workspace.cache}.copy` };
  cpSync(workspace.cache, copied.cache);
  fail(send(copied, request), "STALE_WRITE_CONTEXT");
  assert.deepEqual(success(send(workspace, request)).result, original.result);
  assert.deepEqual(rawCanonical(workspace.destination), rawCanonical(workspace.root));
});

test("v2 restore copies its named source rather than the selected workspace", linuxOnly, (t) => {
  const workspace = setup(t);
  const source = path.join(workspace.directory, "source");
  cpSync(path.join(fixtures, "root"), source, { recursive: true });
  const file = path.join(source, "tasks", `${id}.json`);
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), title: "Separate archive content" }));
  const selected = rawCanonical(workspace.root);
  const sourceBytes = rawCanonical(source);
  const request = prepared(workspace, "workspace.restore", { sourceDirectory: source, destinationDirectory: workspace.destination });
  success(send(workspace, request));
  assert.deepEqual(rawCanonical(workspace.destination), sourceBytes);
  assert.deepEqual(rawCanonical(workspace.root), selected);
  assert.notDeepEqual(sourceBytes, selected);
});

test("v2 invalid or unsupported restore sources are refused without consuming the execution key", linuxOnly, (t) => {
  const workspace = setup(t);
  const source = path.join(workspace.directory, "source");
  cpSync(path.join(fixtures, "root"), source, { recursive: true });
  const request = prepared(workspace, "workspace.restore", { sourceDirectory: source, destinationDirectory: workspace.destination });
  const file = path.join(source, "tasks", `${id}.json`);
  const original = readFileSync(file);
  for (const bytes of [Buffer.from("{"), Buffer.from(JSON.stringify({ ...JSON.parse(original.toString()), descriptionMarkdown: "legacy alias" }))]) {
    writeFileSync(file, bytes);
    fail(send(workspace, request), "INVALID_CANONICAL");
    assert.deepEqual(readFileSync(file), bytes);
    assert.equal(existsSync(workspace.destination), false);
    assert.equal(existsSync(pendingIntentPath(readRootDescriptor(workspace.root))), false);
    assert.equal(readdirSync(workspace.directory).some(name => name.endsWith(".stage")), false);
  }
  writeFileSync(file, original);
  const manifest = path.join(source, "workspace.json");
  const descriptor = readFileSync(manifest);
  writeFileSync(manifest, '{"schemaVersion":1}');
  fail(send(workspace, request), "UNSUPPORTED_SCHEMA");
  writeFileSync(manifest, descriptor);
  success(send(workspace, request));
});
