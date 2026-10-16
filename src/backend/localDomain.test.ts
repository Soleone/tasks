import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import { syncDirectory, localDomain, withRootWriterLock, writeDurableFile } from "./localDomain.js";

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
  "first root-domain initialization stops at the created parent, including Windows namespace spelling",
  { skip: process.platform !== "linux" && process.platform !== "win32" },
  (t) => {
    const directory = scratch(t);
    const rootPath = path.join(directory, "root");
    mkdirSync(rootPath);
    const stat = lstatSync(rootPath, { bigint: true });
    const root = { rootPath, rootIdentity: `${stat.dev}:${stat.ino}` };
    const variable = process.platform === "win32" ? "APPDATA" : "XDG_DATA_HOME";
    const previous = process.env[variable];
    process.env[variable] = path.join(directory, "new-profile/nested");
    t.after(() => {
      if (previous === undefined) delete process.env[variable];
      else process.env[variable] = previous;
    });
    let calls = 0;
    withRootWriterLock(root, () => {
      calls += 1;
    });
    withRootWriterLock(root, () => {
      calls += 1;
    });
    assert.equal(calls, 2);
    assert.equal(existsSync(path.join(localDomain(root), "lock.db")), true);
  },
);
