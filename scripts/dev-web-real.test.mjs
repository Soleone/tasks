import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

function bytes(directory) {
  return Object.fromEntries(
    readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const file = path.join(entry.parentPath, entry.name);
        return [path.relative(directory, file), readFileSync(file, "base64")];
      }),
  );
}
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "tasks-real-copy-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const data = path.join(directory, "data");
  const home = path.join(data, "apps", "tasks");
  const snapshot = path.join(home, "dev-web-real");
  const config = path.join(home, "dev-web-real.json");
  mkdirSync(path.join(snapshot, "sync"), { recursive: true });
  mkdirSync(path.join(snapshot, "local"));
  writeFileSync(path.join(snapshot, "sync", "task.json"), "source bytes");
  writeFileSync(path.join(snapshot, "local", "app.db"), "local bytes");
  return { directory, data, snapshot, config };
}
function run(data, refresh, typed) {
  // Non-TTY child unless an answer is typed, explicit disposable saved choice and DATA; never
  // launch the dev server.
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { realSnapshot } from ${JSON.stringify(new URL("./dev-web-real.mjs", import.meta.url).href)};
    process.stdin.isTTY = ${typed !== undefined};
    await realSnapshot(${refresh});
  `,
    ],
    { env: { ...process.env, DATA: data }, encoding: "utf8", input: typed ?? "" },
  );
}
for (const relation of [
  "equal",
  "source inside",
  "snapshot inside",
  "symlink alias",
  "missing snapshot under symlink",
]) {
  test(`real copy refuses ${relation} without changing config, source or local bytes`, (t) => {
    const f = fixture(t);
    let source = f.snapshot;
    if (relation === "source inside") source = path.join(f.snapshot, "sync");
    if (relation === "snapshot inside") source = f.directory;
    if (relation === "symlink alias") {
      source = path.join(f.directory, "alias");
      symlinkSync(f.snapshot, source, "junction");
    }
    if (relation === "missing snapshot under symlink") {
      rmSync(f.snapshot, { recursive: true });
      const target = path.join(f.directory, "target");
      mkdirSync(target);
      writeFileSync(path.join(target, "keep"), "keep source");
      symlinkSync(target, path.join(f.data, "apps", "alias"), "junction");
      // Make DATA's existing ancestor an alias of the source, with a missing destination below it.
      f.data = path.join(f.data, "apps", "alias", "new-data");
      f.config = path.join(f.data, "apps", "tasks", "dev-web-real.json");
      mkdirSync(path.dirname(f.config), { recursive: true });
      source = target;
    }
    writeFileSync(f.config, `${JSON.stringify({ source })}\n`);
    const before = bytes(f.directory);
    for (const refresh of [false, true]) {
      const result = run(f.data, refresh);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Source and development home overlap/);
      assert.deepEqual(bytes(f.directory), before);
    }
  });
}
test("real copy refreshes a disjoint snapshot and reuses it without refresh", (t) => {
  const f = fixture(t);
  const source = `${f.snapshot}-source`;
  mkdirSync(source);
  writeFileSync(path.join(source, "workspace.json"), "disjoint source");
  writeFileSync(f.config, `${JSON.stringify({ source })}\n`);
  const sourceBefore = bytes(source);
  assert.equal(run(f.data, true).status, 0);
  assert.deepEqual(bytes(source), sourceBefore);
  assert.deepEqual(bytes(f.snapshot), {
    "sync/workspace.json": Buffer.from("disjoint source").toString("base64"),
  });
  writeFileSync(path.join(f.snapshot, "local", "keep"), "retained");
  const before = bytes(f.snapshot);
  assert.equal(run(f.data, false).status, 0);
  assert.deepEqual(bytes(f.snapshot), before);
});
for (const saved of ["gone", "overlapping"]) {
  test(`real copy --refresh replaces a saved folder that is ${saved} with the typed one`, (t) => {
    const f = fixture(t);
    const source = `${f.snapshot}-source`;
    mkdirSync(source);
    writeFileSync(path.join(source, "workspace.json"), "typed source");
    const old = saved === "gone" ? path.join(f.directory, "gone") : f.snapshot;
    writeFileSync(f.config, `${JSON.stringify({ source: old })}\n`);
    const before = bytes(f.directory);
    const reused = run(f.data, false);
    assert.notEqual(reused.status, 0);
    assert.match(reused.stderr, /is not a folder|Source and development home overlap/);
    assert.deepEqual(bytes(f.directory), before);
    const refreshed = run(f.data, true, `${source}\n`);
    assert.equal(refreshed.status, 0, refreshed.stderr);
    assert.deepEqual(JSON.parse(readFileSync(f.config, "utf8")), { source });
    assert.deepEqual(bytes(f.snapshot), {
      "sync/workspace.json": Buffer.from("typed source").toString("base64"),
    });
  });
}
