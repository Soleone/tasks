import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { TestContext } from "node:test";
import { readV2CanonicalRoot } from "./v2CanonicalReader.js";
import { observeV2QueryAuthority } from "./v2QueryCache.js";

const golden = fileURLToPath(new URL("../../scripts/fixtures/taskdb-v2/root/", import.meta.url));
function setup(t: TestContext): { root: string; cache: string } {
  const directory = mkdtempSync(path.join(os.tmpdir(), "taskdb-v2-authority-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, "root");
  cpSync(golden, root, { recursive: true });
  return { root, cache: path.join(directory, "cache.db") };
}

test("v2 query context and versions persist across cache reopen; complete cache loss rotates authority", (t) => {
  const { root, cache } = setup(t);
  const snapshot = readV2CanonicalRoot(root);
  const first = observeV2QueryAuthority(cache, snapshot, snapshot);
  const second = observeV2QueryAuthority(cache, readV2CanonicalRoot(root), readV2CanonicalRoot(root));
  assert.deepEqual(second, first);
  rmSync(cache);
  const lost = observeV2QueryAuthority(cache, snapshot, snapshot);
  assert.notEqual(lost.writeContext, first.writeContext);
  assert.deepEqual(readV2CanonicalRoot(root).files, snapshot.files);
});

test("v2 copied/moved caches cannot inherit another physical cache's context", (t) => {
  const { root, cache } = setup(t);
  const snapshot = readV2CanonicalRoot(root);
  const first = observeV2QueryAuthority(cache, snapshot, snapshot);
  const copy = `${cache}.copy`;
  cpSync(cache, copy);
  const copied = observeV2QueryAuthority(copy, snapshot, snapshot);
  assert.notEqual(copied.writeContext, first.writeContext);
  assert.deepEqual(observeV2QueryAuthority(cache, snapshot, snapshot), first);
  const replacement = `${cache}.replacement`;
  cpSync(cache, replacement);
  renameSync(cache, `${cache}.old`);
  renameSync(replacement, cache);
  const replaced = observeV2QueryAuthority(cache, snapshot, snapshot);
  assert.notEqual(replaced.writeContext, first.writeContext);
  assert.deepEqual(observeV2QueryAuthority(cache, snapshot, snapshot), replaced);
});

test("v2 query tokens notice formatting, deletion/reappearance and moves whose selected key stays unchanged", (t) => {
  const { root, cache } = setup(t);
  let snapshot = readV2CanonicalRoot(root);
  const first = observeV2QueryAuthority(cache, snapshot, snapshot);
  const scope = snapshot.tasks.filter(task => task.parentId === null);
  const selected = scope[1];
  const before = first.versions.get(selected.id)!;
  const neighbor = scope[0];
  const neighborPath = path.join(root, "tasks", `${neighbor.id}.json`);
  writeFileSync(neighborPath, JSON.stringify({ ...neighbor, orderKey: "a3" }));
  snapshot = readV2CanonicalRoot(root);
  const moved = observeV2QueryAuthority(cache, snapshot, snapshot);
  assert.equal(moved.writeContext, first.writeContext);
  assert.ok(moved.versions.get(selected.id)! > before);
  assert.equal(snapshot.tasks.find(task => task.id === selected.id)!.orderKey, selected.orderKey);
  const selectedPath = path.join(root, "tasks", `${selected.id}.json`);
  const original = readFileSync(selectedPath);
  writeFileSync(selectedPath, ` ${original.toString()} `);
  snapshot = readV2CanonicalRoot(root);
  const formatted = observeV2QueryAuthority(cache, snapshot, snapshot);
  assert.ok(formatted.versions.get(selected.id)! > moved.versions.get(selected.id)!);
  rmSync(selectedPath);
  snapshot = readV2CanonicalRoot(root);
  observeV2QueryAuthority(cache, snapshot, snapshot);
  writeFileSync(selectedPath, original);
  snapshot = readV2CanonicalRoot(root);
  const restored = observeV2QueryAuthority(cache, snapshot, snapshot);
  assert.ok(restored.versions.get(selected.id)! > formatted.versions.get(selected.id)!);
  assert.ok(restored.workspaceRevision > first.workspaceRevision);
});

test("v2 query context rotates on root switching and same-path physical root replacement", (t) => {
  const { root, cache } = setup(t);
  let snapshot = readV2CanonicalRoot(root);
  const first = observeV2QueryAuthority(cache, snapshot, snapshot);
  const otherRoot = `${root}-other`;
  cpSync(golden, otherRoot, { recursive: true });
  snapshot = readV2CanonicalRoot(otherRoot);
  const other = observeV2QueryAuthority(cache, snapshot, snapshot);
  assert.notEqual(other.writeContext, first.writeContext);
  snapshot = readV2CanonicalRoot(root);
  const back = observeV2QueryAuthority(cache, snapshot, snapshot);
  assert.notEqual(back.writeContext, first.writeContext);
  renameSync(root, `${root}-old`);
  cpSync(golden, root, { recursive: true });
  snapshot = readV2CanonicalRoot(root);
  const replaced = observeV2QueryAuthority(cache, snapshot, snapshot);
  assert.notEqual(replaced.writeContext, back.writeContext);
});

test("v2 cache rejects dangling aliases into canonical data before SQLite can create files", (t) => {
  const { root, cache } = setup(t);
  const snapshot = readV2CanonicalRoot(root);
  const inside = path.join(root, "must-not-create.db");
  try {
    symlinkSync(inside, cache);
  } catch (error) {
    if (process.platform !== "win32" || (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    t.skip("Windows symlink privilege unavailable");
    return;
  }
  assert.throws(() => observeV2QueryAuthority(cache, snapshot, snapshot));
  assert.equal(existsSync(inside), false);
  rmSync(cache);
  symlinkSync(inside, `${cache}-journal`);
  // Rollback-journal sidecars also cannot redirect writes into the root.
  assert.throws(() => observeV2QueryAuthority(cache, snapshot, snapshot), { code: "INVALID_STORAGE" });
  assert.equal(existsSync(inside), false);
});

test("v2 cache cannot be canonical data or a v1/foreign SQLite database", (t) => {
  const { root, cache } = setup(t);
  const snapshot = readV2CanonicalRoot(root);
  assert.throws(() => observeV2QueryAuthority(path.join(root, "cache.db"), snapshot, snapshot), { code: "INVALID_STORAGE" });
  const foreign = new DatabaseSync(cache);
  foreign.exec("CREATE TABLE personal_data (value TEXT); INSERT INTO personal_data VALUES ('retained')");
  foreign.close();
  const before = readFileSync(cache);
  assert.throws(() => observeV2QueryAuthority(cache, snapshot, snapshot), { code: "INVALID_STORAGE" });
  assert.deepEqual(readFileSync(cache), before);
});
