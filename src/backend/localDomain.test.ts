import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { parseBatchIntent } from "./batchJournal.js";
import { readPhysicalRoot } from "./canonicalReader.js";
import { parseDoctorIntent } from "./doctorJournal.js";
import {
  localDomain,
  parseIntentEnvelope,
  selectOtherRootsDirectory,
  syncDirectory,
  withRootWriterLock,
  writeDurableFile,
} from "./localDomain.js";
import { parseOrderIntent } from "./orderJournal.js";
import { parsePurgeIntent } from "./purgeJournal.js";

function scratch(t: TestContext): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "taskdb-local-domain-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test(
  "local directory flush and exclusive file flush succeed without dropping failures",
  { skip: process.platform !== "linux" && process.platform !== "win32" },
  (t) => {
    const directory = scratch(t);
    syncDirectory(directory);
    const file = path.join(directory, "exact-bytes");
    const bytes = Buffer.from("durable byte probe\r\n");
    writeDurableFile(file, bytes);
    assert.deepEqual(readFileSync(file), bytes);
    assert.throws(() => writeDurableFile(file, Buffer.from("must not overwrite")), {
      code: "EEXIST",
    });
    assert.deepEqual(readFileSync(file), bytes);
    assert.throws(() => syncDirectory(path.join(directory, "absent")), { code: "ENOENT" });
  },
);

test(
  "home.layout: a home's lock and recovery files sit beside its sync folder under every spelling",
  { skip: process.platform !== "linux" },
  (t) => {
    const home = scratch(t);
    mkdirSync(path.join(home, "sync"));
    mkdirSync(path.join(home, "local"));
    symlinkSync(home, `${home}-alias`);
    t.after(() => rmSync(`${home}-alias`, { force: true }));
    const root = readPhysicalRoot(path.join(home, "sync"));
    const alias = readPhysicalRoot(path.join(`${home}-alias`, "sync"));
    assert.equal(localDomain(alias), path.join(home, "local"));
    let calls = 0;
    withRootWriterLock(root, () => {
      calls += 1;
    });
    withRootWriterLock(alias, () => {
      calls += 1;
    });
    assert.equal(calls, 2);
    assert.equal(existsSync(path.join(home, "local", "lock.db")), true);
  },
);

test(
  "home.layout: other roots keep their lock beside the selected cache, creating only the missing folders",
  { skip: process.platform !== "linux" && process.platform !== "win32" },
  (t) => {
    const directory = scratch(t);
    const rootPath = path.join(directory, "old");
    mkdirSync(rootPath);
    const stat = lstatSync(rootPath, { bigint: true });
    const root = { rootPath, rootIdentity: `${stat.dev}:${stat.ino}` };
    selectOtherRootsDirectory(path.join(directory, "new-local", "nested", "cli.db"));
    withRootWriterLock(root, () => {});
    const domain = localDomain(root);
    assert.equal(path.dirname(domain), path.join(directory, "new-local", "nested", "roots"));
    assert.equal(existsSync(path.join(domain, "lock.db")), true);
  },
);

test(
  "a pending intent's envelope must match its format, root, cache, time, operation and executing request",
  { skip: process.platform !== "linux" && process.platform !== "win32" },
  (t) => {
    const home = scratch(t);
    mkdirSync(path.join(home, "sync"));
    mkdirSync(path.join(home, "local"));
    const root = readPhysicalRoot(path.join(home, "sync"));
    const request = {
      version: 2,
      command: "task.reorder",
      args: {},
      writeContext: "context",
      idempotencyKey: "key",
      readOnly: false,
      dryRun: false,
    };
    const envelope = {
      format: "taskdb.pending-order",
      version: 1,
      root,
      cachePath: path.join(home, "local", "cache.db"),
      request,
      operationId: randomUUID(),
      at: new Date().toISOString(),
    };
    const parse = (value: unknown) =>
      parseIntentEnvelope(value, root, "taskdb.pending-order", ["task.reorder"]);
    assert.equal(parse(envelope).command, "task.reorder");

    const refused: Record<string, unknown> = {
      "not an object": null,
      format: { ...envelope, format: "taskdb.pending-batch" },
      version: { ...envelope, version: 2 },
      "root path": { ...envelope, root: { ...root, rootPath: path.join(home, "other") } },
      "root identity": { ...envelope, root: { ...root, rootIdentity: "0:0" } },
      "missing root": { ...envelope, root: undefined },
      "relative cache": { ...envelope, cachePath: "cache.db" },
      "cache inside the root": { ...envelope, cachePath: path.join(root.rootPath, "cache.db") },
      time: { ...envelope, at: "2026-11-14" },
      "operation ID": { ...envelope, operationId: "not-a-uuid" },
      "unparsable request": { ...envelope, request: { ...request, version: 1 } },
      "another command": { ...envelope, request: { ...request, command: "task.create" } },
      preview: { ...envelope, request: { ...request, dryRun: true } },
      "read-only": { ...envelope, request: { ...request, readOnly: true } },
      "no write context": { ...envelope, request: { ...request, writeContext: undefined } },
      "no idempotency key": { ...envelope, request: { ...request, idempotencyKey: undefined } },
    };
    for (const [change, value] of Object.entries(refused))
      assert.throws(() => parse(value), Error, change);

    // Each journal reports a refused envelope as its own recovery conflict.
    const tampered = { ...envelope, operationId: "not-a-uuid" };
    for (const [parseIntent, owner] of [
      [parseOrderIntent, "ordering"],
      [parseBatchIntent, "batch"],
      [parsePurgeIntent, "purge"],
      [parseDoctorIntent, "doctor"],
    ] as const)
      assert.throws(() => parseIntent(tampered, root), {
        code: "RECOVERY_CONFLICT",
        message: new RegExp(`^RECOVERY_CONFLICT: ${owner} has missing`),
      });
  },
);
