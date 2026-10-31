import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

const script = fileURLToPath(new URL("./android-node.mjs", import.meta.url));
const packager = fileURLToPath(new URL("./package-android-runtime.mjs", import.meta.url));
const contents = Buffer.from("fixture-android-node-runtime");
const archive = gzipSync(contents);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function fixture(t) {
  const home = mkdtempSync(path.join(tmpdir(), "tasks-android-runtime-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const state = { requests: 0, status: 200 };
  const server = createServer((_request, response) => {
    state.requests += 1;
    response.writeHead(state.status);
    response.end(archive);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const runtime = {
    version: process.version,
    url: `http://127.0.0.1:${server.address().port}/node.gz`,
    sha256: sha256(contents),
    archiveSha256: sha256(archive),
  };
  const configuration = path.join(home, "android-runtime.json");
  writeFileSync(configuration, JSON.stringify(runtime));
  const executable = path.join(home, "android-node.mjs");
  copyFileSync(script, executable);
  const binary = path.join(
    home,
    ".cache",
    "tasks-android",
    `node-${process.version}-arm64`,
    "out",
    "Release",
    "node",
  );
  const env = { ...process.env, HOME: home, USERPROFILE: home, PATH: "" };
  delete env.NDK_HOME;
  delete env.ANDROID_HOME;
  delete env.JAVA_HOME;
  return { home, executable, binary, env, state, runtime, configuration };
}

function run(f) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [f.executable], { env: f.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("Android runtime downloads once and verifies reuse without compilers, SDK or signing keys", async (t) => {
  const f = await fixture(t);
  const first = await run(f);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Downloading prebuilt Android Node/);
  assert.deepEqual(readFileSync(f.binary), contents);
  assert.ok(statSync(f.binary).mode & 0o111);
  const second = await run(f);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /Using verified Android Node runtime/);
  assert.equal(f.state.requests, 1);
});

for (const field of ["archiveSha256", "sha256"]) {
  test(`Android runtime refuses ${field} mismatches without installing a binary`, async (t) => {
    const f = await fixture(t);
    f.runtime[field] = "0".repeat(64);
    writeFileSync(f.configuration, JSON.stringify(f.runtime));
    const result = await run(f);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /checksum mismatch/);
    assert.equal(existsSync(f.binary), false);
  });
}

test("a modified cached Android runtime is never trusted or executed", async (t) => {
  const f = await fixture(t);
  mkdirSync(path.dirname(f.binary), { recursive: true });
  writeFileSync(f.binary, "modified-runtime");
  const result = await run(f);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cached executable checksum mismatch/);
  assert.equal(f.state.requests, 0);
});

test("a Node upgrade needs a matching runtime pin before any download", async (t) => {
  const f = await fixture(t);
  f.runtime.version = "v0.0.0";
  writeFileSync(f.configuration, JSON.stringify(f.runtime));
  const result = await run(f);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Publish and pin the matching runtime/);
  assert.equal(f.state.requests, 0);
});

test("a failed runtime download cannot leave an installed binary", async (t) => {
  const f = await fixture(t);
  f.state.status = 503;
  const result = await run(f);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /HTTP 503/);
  assert.equal(existsSync(f.binary), false);
});

test("runtime packaging produces the pinned archive and executable checksums", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "tasks-runtime-package-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const binary = path.join(directory, "node");
  writeFileSync(binary, contents);
  const output = path.join(directory, "assets");
  const result = spawnSync(process.execPath, [packager, binary, output], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_REPOSITORY: "example/tasks" },
  });
  assert.equal(result.status, 0, result.stderr);
  const runtime = JSON.parse(readFileSync(path.join(output, "android-runtime.json"), "utf8"));
  const packed = readFileSync(path.join(output, `node-${process.version}-android-arm64.gz`));
  assert.deepEqual(gunzipSync(packed), contents);
  assert.equal(runtime.version, process.version);
  assert.equal(runtime.sha256, sha256(contents));
  assert.equal(runtime.archiveSha256, sha256(packed));
  assert.equal(
    runtime.url,
    `https://github.com/example/tasks/releases/download/${result.stdout.trim()}/node-${process.version}-android-arm64.gz`,
  );
});
