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
import { readPhysicalRoot } from "./canonicalReader.js";
import {
  localDomain,
  selectOtherRootsDirectory,
  syncDirectory,
  withRootWriterLock,
  writeDurableFile,
} from "./localDomain.js";

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
