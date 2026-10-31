import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./release-artifacts.mjs", import.meta.url));
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const tag = `v${version}`;
const windows = `Tasks_${version}_x64-setup.exe`;
const linux = `Tasks_${version}_amd64.AppImage`;
const dmg = `Tasks_${version}_aarch64.dmg`;
const macUpdater = `Tasks_${version}_aarch64.app.tar.gz`;
const apk = `Tasks_${version}_arm64.apk`;

function run(...args) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_REPOSITORY: "example/tasks" },
  });
}

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "tasks-release-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, "build");
  const output = path.join(directory, "assets");
  for (const [file, content] of [
    [`nsis/${windows}`, "installer"],
    [`nsis/${windows}.sig`, "windows-signature\n"],
    [`appimage/${linux}`, "appimage"],
    [`appimage/${linux}.sig`, "linux-signature\n"],
    [`dmg/${dmg}`, "dmg"],
    ["macos/Tasks.app.tar.gz", "mac-updater"],
    ["macos/Tasks.app.tar.gz.sig", "mac-signature\n"],
    ["app-universal-release.apk", "signed-apk"],
  ]) {
    const destination = path.join(source, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
  return { directory, source, output };
}

function stageAll(source, output) {
  for (const platform of ["windows", "linux", "macos", "android"]) {
    const result = run(platform, source, output);
    assert.equal(result.status, 0, result.stderr);
  }
}

test("release assets include every installer and one complete signed desktop updater manifest", (t) => {
  const { source, output } = fixture(t);
  stageAll(source, output);
  const result = run("manifest", output, tag);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    readdirSync(output).sort(),
    [
      windows,
      `${windows}.sig`,
      linux,
      `${linux}.sig`,
      dmg,
      macUpdater,
      `${macUpdater}.sig`,
      apk,
      "latest.json",
      "notes.md",
    ].sort(),
  );
  const manifest = JSON.parse(readFileSync(path.join(output, "latest.json"), "utf8"));
  assert.equal(manifest.version, version);
  assert.ok(Number.isFinite(Date.parse(manifest.pub_date)));
  assert.deepEqual(manifest.platforms, {
    "windows-x86_64": {
      signature: "windows-signature",
      url: `https://github.com/example/tasks/releases/download/${tag}/${windows}`,
    },
    "linux-x86_64": {
      signature: "linux-signature",
      url: `https://github.com/example/tasks/releases/download/${tag}/${linux}`,
    },
    "darwin-aarch64": {
      signature: "mac-signature",
      url: `https://github.com/example/tasks/releases/download/${tag}/${macUpdater}`,
    },
  });
  for (const [name, content] of [
    [windows, "installer"],
    [linux, "appimage"],
    [dmg, "dmg"],
    [macUpdater, "mac-updater"],
    [apk, "signed-apk"],
  ])
    assert.equal(readFileSync(path.join(output, name), "utf8"), content);
  assert.equal(typeof manifest.notes, "string");
  assert.doesNotMatch(manifest.notes, /^#{1,2} /m);
  assert.equal(readFileSync(path.join(output, "notes.md"), "utf8"), `${manifest.notes}\n`);
});

for (const notes of ["### Bug Fixes\n\n* Keep release downloads complete.", ""]) {
  test(`release notes preserve ${notes ? "populated" : "empty maintenance-only"} changelog entries`, (t) => {
    const { directory, source, output } = fixture(t);
    stageAll(source, output);
    const scripts = path.join(directory, "scripts");
    mkdirSync(scripts);
    const fixtureScript = path.join(scripts, "release-artifacts.mjs");
    copyFileSync(script, fixtureScript);
    writeFileSync(path.join(directory, "package.json"), JSON.stringify({ version }));
    writeFileSync(
      path.join(directory, "CHANGELOG.md"),
      `# Changelog\n\n## [${version}] (2026-10-31)\n\n${notes}\n\n## 0.0.0\n\nPrevious release notes.\n`,
    );
    const result = spawnSync(process.execPath, [fixtureScript, "manifest", output, tag], {
      encoding: "utf8",
      env: { ...process.env, GITHUB_REPOSITORY: "example/tasks" },
    });
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(readFileSync(path.join(output, "latest.json"), "utf8"));
    assert.equal(manifest.notes, notes);
    assert.equal(readFileSync(path.join(output, "notes.md"), "utf8"), `${notes}\n`);
  });
}

test("a release tag must match the checked-out package version", (t) => {
  const { source, output } = fixture(t);
  assert.equal(run("verify-tag", tag).status, 0);
  assert.notEqual(run("verify-tag", "v999.0.0").status, 0);
  stageAll(source, output);
  const result = run("manifest", output, "v999.0.0");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not match package.json/);
  assert.equal(existsSync(path.join(output, "latest.json")), false);
});

test("missing or empty platform assets and signatures cannot produce a release manifest", (t) => {
  const { source, output } = fixture(t);
  stageAll(source, output);
  for (const file of [
    apk,
    dmg,
    windows,
    linux,
    macUpdater,
    `${windows}.sig`,
    `${linux}.sig`,
    `${macUpdater}.sig`,
  ]) {
    const destination = path.join(output, file);
    const content = readFileSync(destination);
    for (const empty of [false, true]) {
      if (empty) writeFileSync(destination, "");
      else rmSync(destination);
      assert.notEqual(run("manifest", output, tag).status, 0, file);
      assert.equal(existsSync(path.join(output, "latest.json")), false);
      writeFileSync(destination, content);
    }
  }
});

test("an unsigned desktop build cannot be staged for upload", (t) => {
  const { source, output } = fixture(t);
  rmSync(path.join(source, `nsis/${windows}.sig`));
  assert.notEqual(run("windows", source, output).status, 0);
  assert.equal(existsSync(path.join(output, `${windows}.sig`)), false);
});
