import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./android-node.mjs", import.meta.url));

function fixture(t) {
  const home = mkdtempSync(path.join(tmpdir(), "tasks-android-runtime-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.NDK_HOME;
  delete env.ANDROID_HOME;
  return { home, env };
}

test("Android runtime preparation reuses the pinned binary without an SDK or signing keys", (t) => {
  const { home, env } = fixture(t);
  const binary = path.join(
    home,
    ".cache",
    "tasks-android",
    `node-${process.version}-arm64`,
    "out",
    "Release",
    "node",
  );
  mkdirSync(path.dirname(binary), { recursive: true });
  writeFileSync(binary, "cached-runtime");
  const result = spawnSync(process.execPath, [script], { env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`Using cached Android Node runtime: ${binary}`));
  assert.equal(readFileSync(binary, "utf8"), "cached-runtime");
});

test("an uncached Android runtime requires an NDK before downloading or creating build files", (t) => {
  const { home, env } = fixture(t);
  const result = spawnSync(process.execPath, [script], { env, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Set NDK_HOME/);
  assert.equal(existsSync(path.join(home, ".cache", "tasks-android")), false);
});
