import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createV2CopyTestWorkspace as setup } from "./v2CopyTestWorkspace.js";
import { readV2CanonicalRoot } from "./v2CanonicalReader.js";
import { stageV2CanonicalCopy } from "./v2CopyStage.js";
import { executeV2Line } from "./v2Gateway.js";
import { persistV2Pending, withV2RootWriterLock } from "./v2LocalDomain.js";
import { parseV2Request } from "./v2Protocol.js";

const parentId = "c8d4206d-c25a-4317-baa4-a2c5443060e9";

const linuxOnly = { skip: process.platform !== "linux" };
test("v2 copy stage preserves every canonical byte and known raw conflict, not transport/cache state", linuxOnly, (t) => {
  const { root, destination } = setup(t);
  writeFileSync(path.join(root, "workspace.json"), ' {"schemaVersion": 2}\n');
  const conflictPath = path.join(root, "tasks", `${parentId}.sync-conflict-20261002-120000-TESTDEV.json`);
  writeFileSync(conflictPath, Buffer.from([0x7b, 0xff, 0x00]));
  mkdirSync(path.join(root, ".stfolder"));
  mkdirSync(path.join(root, ".stversions"));
  writeFileSync(path.join(root, ".stversions", "transport-history"), "not canonical");
  writeFileSync(path.join(root, "tasks", ".syncthing.transfer.tmp"), "incomplete transport");
  const source = readV2CanonicalRoot(root);
  const original = new Map(source.files.map(file => [file.relativePath, readFileSync(path.join(root, file.relativePath))]));
  const report = stageV2CanonicalCopy(root, destination);
  assert.equal(report.state, "verified_stage");
  assert.equal(report.taskCount, 4);
  assert.equal(report.conflictCount, 1);
  assert.equal(existsSync(destination), false);
  const staged = readV2CanonicalRoot(report.stageDirectory);
  assert.deepEqual(staged.files, source.files);
  assert.deepEqual(staged.tasks, source.tasks);
  assert.deepEqual(staged.conflictFiles, source.conflictFiles);
  for (const [relativePath, bytes] of original) {
    assert.deepEqual(readFileSync(path.join(report.stageDirectory, relativePath)), bytes);
    assert.deepEqual(readFileSync(path.join(root, relativePath)), bytes);
  }
  assert.deepEqual(readdirSync(report.stageDirectory).sort(), ["tasks", "workspace.json"]);
  assert.equal(existsSync(path.join(report.stageDirectory, "tasks", ".syncthing.transfer.tmp")), false);
  assert.deepEqual(JSON.parse(readFileSync(report.completionPath, "utf8")), report);
  assert.equal(JSON.parse(readFileSync(report.intentPath, "utf8")).format, "taskdb.canonical-copy-stage");
  assert.equal(path.relative(report.stageDirectory, report.intentPath).startsWith(".."), true);
  assert.equal(path.relative(root, report.intentPath).startsWith(".."), true);
});

test("v2 copy stage resolves an authorized empty destination alias without filling or publishing it", linuxOnly, (t) => {
  const { directory, root, destination } = setup(t);
  mkdirSync(destination);
  const alias = path.join(directory, "destination-alias");
  symlinkSync(destination, alias, "dir");
  const report = stageV2CanonicalCopy(root, alias);
  assert.equal(report.destinationDirectory, destination);
  assert.deepEqual(readdirSync(destination), []);
  assert.equal(readV2CanonicalRoot(report.stageDirectory).tasks.length, 4);
});

test("v2 copy destination guards refuse overlaps, aliases and occupied outputs before stage writes", linuxOnly, (t) => {
  const { directory, root, destination } = setup(t);
  const source = readV2CanonicalRoot(root);
  for (const overlap of [root, directory, path.join(root, "new-copy"), path.join(root, "tasks", "new-copy")]) {
    assert.throws(() => stageV2CanonicalCopy(root, overlap), { code: "INVALID_ARGUMENT" });
  }
  const missingParent = path.join(directory, "missing-parent", "archive");
  assert.throws(() => stageV2CanonicalCopy(root, missingParent), { code: "INVALID_ARGUMENT" });
  assert.equal(existsSync(path.dirname(missingParent)), false);
  const alias = path.join(directory, "source-alias");
  symlinkSync(root, alias, "dir");
  assert.throws(() => stageV2CanonicalCopy(root, alias), { code: "INVALID_ARGUMENT" });
  assert.throws(() => stageV2CanonicalCopy(root, path.join(alias, "new-copy")), { code: "INVALID_ARGUMENT" });
  mkdirSync(destination);
  writeFileSync(path.join(destination, "keep"), "retained");
  assert.throws(() => stageV2CanonicalCopy(root, destination), { code: "DESTINATION_NOT_EMPTY" });
  assert.throws(() => stageV2CanonicalCopy(root, path.join(destination, "keep")), { code: "DESTINATION_NOT_EMPTY" });
  assert.equal(readFileSync(path.join(destination, "keep"), "utf8"), "retained");
  assert.deepEqual(readV2CanonicalRoot(root).files, source.files);
  assert.equal(readdirSync(directory).some(name => name.endsWith(".stage")), false);
});

test("v2 copy stage refuses invalid/mixed source bytes without creating an output", linuxOnly, (t) => {
  const { root, destination } = setup(t);
  const taskPath = path.join(root, "tasks", `${parentId}.json`);
  const original = JSON.parse(readFileSync(taskPath, "utf8"));
  const bytes = Buffer.from('{"id":');
  writeFileSync(taskPath, bytes);
  assert.throws(() => stageV2CanonicalCopy(root, destination), { code: "INVALID_CANONICAL" });
  assert.deepEqual(readFileSync(taskPath), bytes);
  assert.equal(existsSync(destination), false);
  const mixed = Buffer.from(JSON.stringify({ ...original, descriptionMarkdown: "legacy alias" }));
  writeFileSync(taskPath, mixed);
  assert.throws(() => stageV2CanonicalCopy(root, destination), { code: "INVALID_CANONICAL" });
  assert.deepEqual(readFileSync(taskPath), mixed);
  assert.equal(existsSync(destination), false);
});

test("v2 copy stage preserves descriptor conflict originals and refuses ambiguous input", linuxOnly, (t) => {
  const { directory, root, destination } = setup(t);
  const source = readV2CanonicalRoot(root);
  const conflictPath = path.join(root, "workspace.sync-conflict-20261002-120000-OTHER.json");
  const bytes = Buffer.from('{"schemaVersion":1}');
  writeFileSync(conflictPath, bytes);
  assert.throws(() => stageV2CanonicalCopy(root, destination), { code: "INVALID_CANONICAL" });
  assert.deepEqual(readFileSync(conflictPath), bytes);
  assert.deepEqual(readV2CanonicalRoot(root).files, source.files);
  assert.equal(readdirSync(directory).some(name => name.endsWith(".stage")), false);
});

test("v2 copy stage refuses a published source update intent without copying unfinished state", linuxOnly, (t) => {
  const { directory, root, destination } = setup(t);
  const source = readV2CanonicalRoot(root);
  const task = source.tasks.find(task => task.id === parentId)!;
  const at = "2026-10-02T12:00:00.000Z";
  const binding = { rootPath: source.rootPath, rootIdentity: source.rootIdentity };
  withV2RootWriterLock(binding, () => persistV2Pending(binding, {
    format: "taskdb.pending-update", version: 1, root: binding, cachePath: path.join(directory, "cache.db"),
    request: parseV2Request({ version: 2, command: "task.update", writeContext: "fixture-context", idempotencyKey: "fixture-key", args: { id: parentId, expectedVersion: 1, title: "Pending edit" } }),
    operationId: "00000000-0000-4000-8000-000000000000", at, taskId: parentId,
    beforeBytes: readFileSync(path.join(root, "tasks", `${parentId}.json`)).toString("base64"),
    nextBytes: Buffer.from(`${JSON.stringify({ ...task, title: "Pending edit", updatedAt: at })}\n`).toString("base64"), guards: source.files,
  }));
  assert.throws(() => stageV2CanonicalCopy(root, destination), { code: "RECOVERY_PENDING" });
  assert.deepEqual(readV2CanonicalRoot(root).files, source.files);
  assert.equal(existsSync(destination), false);
  assert.equal(readdirSync(directory).some(name => name.endsWith(".stage")), false);
});

test("v2 verified stages support byte-preserving restore staging and fresh local authority, not public controls", linuxOnly, (t) => {
  const { directory, root, destination } = setup(t);
  const cache = path.join(directory, "cache.db");
  const request = Buffer.from(JSON.stringify({ version: 2, command: "task.get", args: { id: parentId } }));
  const first = executeV2Line(request, root, cache);
  assert.equal(first.ok, true);
  const archive = stageV2CanonicalCopy(root, destination);
  const restoreDestination = path.join(directory, "restored");
  const restored = stageV2CanonicalCopy(archive.stageDirectory, restoreDestination);
  assert.deepEqual(readV2CanonicalRoot(restored.stageDirectory).files, readV2CanonicalRoot(root).files);
  assert.equal(existsSync(destination), false);
  assert.equal(existsSync(restoreDestination), false);
  const restoredRead = executeV2Line(request, restored.stageDirectory, cache);
  assert.equal(restoredRead.ok, true);
  if (first.ok && restoredRead.ok) assert.notEqual(restoredRead.writeContext, first.writeContext);
  for (const command of ["workspace.migrateV1"]) {
    const response = executeV2Line(Buffer.from(JSON.stringify({ version: 2, command })), root, cache);
    assert.equal(response.ok, false);
    if (!response.ok) assert.equal(response.error.code, "UNSUPPORTED_COMMAND");
  }
});
