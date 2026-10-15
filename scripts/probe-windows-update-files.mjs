// Primitive feasibility only, not a writable profile or interrupted-write acceptance.
import assert from "node:assert/strict";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statfsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncV2Directory, withV2RootWriterLock, writeV2DurableFile } from "../dist/backend/localDomain.js";

assert.equal(process.platform, "win32", "Run with Windows Node from a Windows filesystem checkout");
assert.match(realpathSync(import.meta.dirname), /^[A-Za-z]:\\/, "The probe must not run from a WSL/UNC checkout");
const scratch = mkdtempSync(path.join(os.tmpdir(), "tasks-fcf-files-"));
const rootPath = path.join(scratch, "root");
const profile = path.join(scratch, "profile");
const previousAppData = process.env.APPDATA;
process.env.APPDATA = profile;
const observations = [];
function probe(name, action) {
  try { observations.push({ name, ok: true, result: action() }); }
  catch (error) {
    observations.push({ name, ok: false, code: error.code ?? "UNKNOWN", syscall: error.syscall ?? null, message: error.message });
  }
}
try {
  mkdirSync(path.join(rootPath, "tasks"), { recursive: true });
  probe("filesystem-statfs", () => statfsSync(rootPath));
  const stat = lstatSync(rootPath, { bigint: true });
  const root = { rootPath: realpathSync(rootPath), rootIdentity: `${stat.dev}:${stat.ino}` };
  const target = path.join(rootPath, "tasks", "target.json");
  const stage = path.join(rootPath, "tasks", "stage.tmp");
  probe("exclusive-file-write-and-flush", () => {
    writeV2DurableFile(target, Buffer.from("before\n"));
    writeV2DurableFile(stage, Buffer.from("after\n"));
    assert.equal(readFileSync(stage, "utf8"), "after\n");
    return { observedStageBytes: "after\\n" };
  });
  probe("replace-existing-file", () => {
    renameSync(stage, target);
    assert.equal(readFileSync(target, "utf8"), "after\n");
    return { stageAbsent: !existsSync(stage), observedTargetBytes: "after\\n" };
  });
  probe("flush-task-directory", () => syncV2Directory(path.dirname(target)));
  probe("flush-task-directory-with-write-access", () => {
    const descriptor = openSync(path.dirname(target), "r+");
    try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
  });
  let lockActionEntered = false;
  probe("initialize-root-lock-domain", () => withV2RootWriterLock(root, () => { lockActionEntered = true; }));
  assert.equal(process.env.APPDATA, profile);
  console.log(JSON.stringify({
    platform: process.platform, os: os.release(), arch: process.arch, node: process.version, libuv: process.versions.uv,
    checkout: realpathSync(path.join(import.meta.dirname, "..")), scratch, profile, rootIdentity: root.rootIdentity,
    observations, lockActionEntered,
    conclusion: observations.some(observation => !observation.ok) ? "BLOCKED: current update filesystem primitives are not supported" : "primitives observed only; durability and recovery remain unproven",
    limitations: "No task.update gateway dispatch, task cache, receipt, pending intent, crash scene, SEA or native UI proof. Rename success is not a power-loss durability claim.",
    scratchWillBeRemoved: true,
  }, null, 2));
} finally {
  if (previousAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = previousAppData;
  rmSync(scratch, { recursive: true, force: true });
}
