// Current unjournaled capture proof. The 2026-10-04 journaled report is historical, not a pass for this route.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

assert.equal(process.platform, "win32", "Run with actual Windows Node from a local Windows checkout");
const checkout = realpathSync(path.join(import.meta.dirname, ".."));
assert.match(checkout, /^[A-Za-z]:\\/);
const volume = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$v=Get-Volume -DriveLetter ${checkout[0]}; @{filesystem=$v.FileSystem;driveType=$v.DriveType.ToString()} | ConvertTo-Json -Compress`], { encoding: "utf8" }));
assert.deepEqual(volume, { filesystem: "NTFS", driveType: "Fixed" });
const bundle = path.join(checkout, "dist/sidecar/cli.cjs"), source = readFileSync(bundle, "utf8");
const { inject } = createRequire(import.meta.url)(path.join(checkout, "node_modules/postject/dist/api.js"));
mkdirSync(path.join(checkout, ".tmp"), { recursive: true });
const scratch = mkdtempSync(path.join(checkout, ".tmp/windows-create-"));
const golden = path.join(checkout, "scripts/fixtures/taskdb-v2/root");
const id = "c8d4206d-c25a-4317-baa4-a2c5443060e9";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const cuts = ["stage-written", "published", "beforeCommit", "afterCommit", "flushRefusal", "destination", "parentChange", "unrelatedChange"];
const passed = [], artifacts = [];
let completedProof = false, workspaceIndex = 0;

function workspace(name) {
  // Short fresh scene paths keep SQLite's lock-journal filename below this host's path limit.
  const directory = path.join(scratch, String(workspaceIndex++)), root = path.join(directory, "root");
  mkdirSync(directory); cpSync(golden, root, { recursive: true });
  const stat = lstatSync(root, { bigint: true });
  const key = createHash("sha256").update(JSON.stringify([realpathSync(root), `${stat.dev}:${stat.ino}`])).digest("hex");
  const profile = path.join(directory, "profile"), domain = path.join(profile, "com.soleone.tasks/taskdb-v2/roots", key);
  return { name, directory, root, profile, domain, cache: path.join(directory, "cache.db"), pending: path.join(domain, "pending.json") };
}
function argv(w, proof) { return ["--stdio", "--v2-root", w.root, "--database", w.cache, ...(proof ? ["--windows-task-proof", "--local-profile", w.profile] : [])]; }
function run(runner, w, request, cut, proof = true) {
  const program = cut ? runner.faults[cut] : runner.normal;
  return spawnSync(runner.command ?? program, runner.command ? [program, ...argv(w, proof)] : argv(w, proof), {
    input: JSON.stringify({ version: 2, requestId: "capture-proof", ...request }) + "\n", encoding: "utf8", timeout: 20_000,
    env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: process.env.TEMP, TMP: process.env.TMP,
      APPDATA: path.join(w.directory, "default-profile-trap"), TASKS_DATABASE_PATH: path.join(w.directory, "v1-trap.db"),
      TASKS_SYNC_ROOT: path.join(w.directory, "v1-root-trap") },
  });
}
function send(runner, w, request, proof = true, cut) {
  const child = run(runner, w, request, cut, proof);
  assert.equal(child.error, undefined); assert.equal(child.status, 0, `${w.name}: ${child.stderr}`);
  const lines = child.stdout.trim().split(/\r?\n/); assert.equal(lines.length, 1, child.stdout);
  const response = JSON.parse(lines[0]); assert.equal(response.requestId, request.requestId ?? "capture-proof");
  for (const trap of ["default-profile-trap", "v1-trap.db", "v1-root-trap"]) assert.equal(existsSync(path.join(w.directory, trap)), false);
  return response;
}
function ok(response) { assert.equal(response.ok, true, JSON.stringify(response)); return response; }
function fail(response, code) { assert.equal(response.ok, false); assert.equal(response.error.code, code, JSON.stringify(response)); }
function prepared(runner, w) {
  return { version: 2, requestId: "capture-proof", command: "task.create", writeContext: ok(send(runner, w, { command: "workspace.info" })).writeContext,
    idempotencyKey: "original-capture", args: { text: "Windows capture @Work #TODO", description: "**Windows notes**\r\n" },
    actor: { kind: "human", label: "Windows capture proof" }, readOnly: false, dryRun: false };
}
function raw(w) {
  return ["workspace.json", ...readdirSync(path.join(w.root, "tasks")).filter(name => name.endsWith(".json")).sort().map(name => `tasks/${name}`)]
    .map(name => [name, readFileSync(path.join(w.root, name)).toString("base64")]);
}
function counts(w) {
  const db = new DatabaseSync(w.cache);
  try { return ["v2_receipts", "v2_operations"].map(table => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n); }
  finally { db.close(); }
}
function faultBundle(cut) {
  const name = ["beforeCommit", "afterCommit"].includes(cut) ? "withV2CacheTransaction" : "executeV2Create";
  const moduleName = name === "withV2CacheTransaction" ? "v2QueryCache" : "v2CreateWriter";
  const matches = [];
  let marker = -1;
  while ((marker = source.indexOf(`// src/backend/${moduleName}.ts\n`, marker + 1)) >= 0) {
    const moduleEnd = source.indexOf("\n// src/", marker + 1);
    assert.ok(moduleEnd > marker, `bounded ${moduleName} module required`);
    for (const definition of source.slice(marker, moduleEnd).matchAll(new RegExp(`\\nfunction ${name}\\d*\\(`, "g"))) {
      matches.push({ start: marker + definition.index + 1, moduleEnd });
    }
  }
  assert.equal(matches.length, 1, `unique ${name} in ${moduleName} required`);
  const { start, moduleEnd } = matches[0], nextFunction = source.indexOf("\nfunction ", start + 1);
  const end = nextFunction >= 0 ? Math.min(nextFunction, moduleEnd) : moduleEnd;
  const section = source.slice(start, end);
  let needle;
  if (cut === "stage-written") needle = "writeV2DurableFile(stage, bytes);";
  else if (cut === "published") needle = section.match(/\(0, import_node_fs\d+\.renameSync\)\(stage, target\);/)[0];
  else if (cut === "flushRefusal") needle = "syncV2Directory(taskDirectory);";
  else if (["destination", "parentChange", "unrelatedChange"].includes(cut)) needle = section.match(/guardCreateDestination\d*\(snapshot, taskDirectoryIdentity, taskId\d*, task.parentId\);/)[0];
  else needle = 'database.exec("COMMIT");';
  assert.equal(section.split(needle).length, 2, `unique ${cut} cut required`);
  const stop = `require("node:fs").writeSync(2,"TASKS_TEST_CUT:${cut}\\n");process.kill(process.pid,"SIGKILL");`;
  let replacement = cut === "beforeCommit" ? stop + needle : needle + stop;
  if (cut === "flushRefusal") replacement = 'throw Object.assign(new Error("test-only capture directory flush refusal"),{code:"EPERM"});' + needle;
  if (cut === "destination") replacement = 'require("node:fs").writeFileSync(target,"preserve arriving destination");' + needle;
  if (["parentChange", "unrelatedChange"].includes(cut)) {
    const fileId = cut === "parentChange" ? id : "62f159c1-22a7-45cb-89a0-c0c35aaeb1ed";
    replacement = `require("node:fs").appendFileSync(require("node:path").join(taskDirectory,"${fileId}.json")," ");` + needle;
  }
  return source.slice(0, start) + section.replace(needle, replacement) + source.slice(end);
}
async function sea(name, input) {
  const main = path.join(scratch, `${name}.cjs`), blob = path.join(scratch, `${name}.blob`), config = path.join(scratch, `${name}.json`), exe = path.join(scratch, `${name}.exe`);
  writeFileSync(main, input); writeFileSync(config, JSON.stringify({ main, output: blob, disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false }));
  execFileSync(process.execPath, ["--experimental-sea-config", config], { stdio: "pipe" }); copyFileSync(process.execPath, exe);
  await inject(exe, "NODE_SEA_BLOB", readFileSync(blob), { sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2" });
  artifacts.push({ name, sha256: createHash("sha256").update(readFileSync(exe)).digest("hex"), bytes: lstatSync(exe).size }); return exe;
}

try {
  // Validate every unique source transform before spending time packaging any executable.
  const faultSources = new Map(cuts.map(cut => [cut, faultBundle(cut)]));
  const diagnosticNeedle = "const storageError = isV2Record(error)";
  for (const [cut, fault] of faultSources) {
    assert.equal(fault.split(diagnosticNeedle).length, 2, "unique disposable gateway diagnostic required");
    faultSources.set(cut, fault.replace(diagnosticNeedle, 'require("node:fs").writeSync(2, String(error.stack || error)+"\\n");' + diagnosticNeedle));
  }
  const node = { command: process.execPath, normal: bundle, faults: {} };
  const native = { command: null, normal: null, faults: {} };
  // Test harness duplication with the update checker is intentional: two concrete families, no shared writer abstraction.
  for (const cut of cuts) {
    const fault = faultSources.get(cut); node.faults[cut] = path.join(scratch, `node-${cut}.cjs`); writeFileSync(node.faults[cut], fault);
  }
  for (const [prefix, runner] of [["node", node], ["sea", native]]) {
    if (prefix === "sea") {
      native.normal = await sea("tasks-backend", source);
      for (const cut of cuts) native.faults[cut] = await sea(`sea-${cut}`, faultSources.get(cut));
    }
    const w = workspace(`${prefix}-capture`), request = prepared(runner, w), before = raw(w);
    const advertised = ok(send(runner, w, { command: "workspace.info" })).result.commands;
    assert.deepEqual(advertised, ["activity.list", "category.list", "tag.list", "task.create", "task.get", "task.list", "task.update", "task.start", "task.pause", "task.complete", "task.reopen", "task.cancel", "task.delete", "task.status.undo", "workspace.info", "workspace.archive", "workspace.restore", "workspace.recovery.resume"].sort());
    fail(send(runner, w, request, false), "UNSUPPORTED_COMMAND");
    for (const command of ["task.status.undoMany", "task.move", "task.dependency.add", "task.reorder", "task.transitionMany", "operation.undo", "task.purgeCanceled", "workspace.init", "workspace.migrateV1", "workspace.doctor.apply"]) fail(send(runner, w, { ...request, command }), "UNSUPPORTED_COMMAND");
    const preview = ok(send(runner, w, { ...request, idempotencyKey: undefined, dryRun: true }));
    assert.match(preview.result.task.id, uuid); assert.equal(preview.result.operationId, undefined);
    assert.deepEqual(raw(w), before); assert.deepEqual(counts(w), [0, 0]);
    for (const [args, code] of [[{ title: "New", id: "caller-id" }, "INVALID_ARGUMENT"], [{ title: "New", parentId: "missing" }, "INVALID_PARENT"], [{ title: "" }, "INVALID_ARGUMENT"]]) fail(send(runner, w, { ...request, args }), code);
    const committed = ok(send(runner, w, request)), task = committed.result.task;
    assert.match(task.id, uuid); assert.match(committed.result.operationId, uuid); assert.equal(task.createdAt, task.updatedAt);
    assert.equal(task.status, "open"); assert.equal(task.priority, 2); assert.equal(task.closedAt, null); assert.deepEqual(task.dependencyIds, []);
    assert.equal(task.title, "Windows capture"); assert.equal(task.category, "work"); assert.deepEqual(task.tags, ["todo"]); assert.equal(task.description, request.args.description);
    assert.deepEqual(raw(w).filter(([name]) => name !== `tasks/${task.id}.json`), before); assert.deepEqual(counts(w), [1, 1]);
    assert.deepEqual(ok(send(runner, w, { ...request, requestId: "restarted-original" })).result, committed.result);
    for (const change of [{ args: { ...request.args, description: "changed identity" } }, { actor: { kind: "human", label: "other actor" } }, { dryRun: true }]) fail(send(runner, w, { ...request, ...change }), "IDEMPOTENCY_KEY_REUSED");
    const rows = ok(send(runner, w, { command: "activity.list" })).result.activity;
    assert.equal(rows.length, 1); assert.equal(rows[0].before, null); assert.equal(rows[0].command, "task.create"); assert.equal(rows[0].createdAt, task.createdAt);
    assert.deepEqual(rows[0].actor, request.actor); assert.equal(existsSync(w.pending), false);
    rmSync(path.join(w.root, "tasks", `${task.id}.json`));
    assert.deepEqual(ok(send(runner, w, request)).result, committed.result); assert.equal(existsSync(path.join(w.root, "tasks", `${task.id}.json`)), false);
    passed.push(`${prefix}: explicit allowlist/default refusal, preview/invalid input, UUID/time/defaults/classification, unchanged files, restart/identity, historical absence without resurrection`);

    for (const cut of ["stage-written", "published", "beforeCommit", "afterCommit"]) {
      console.error(`Checking ${prefix} unjournaled capture cut ${cut}`);
      const selected = workspace(`${prefix}-${cut}`), original = prepared(runner, selected), baseline = raw(selected);
      const child = run(runner, selected, original, cut);
      assert.equal(child.error, undefined); assert.notEqual(child.status, 0);
      assert.match(child.stderr, new RegExp(`TASKS_TEST_CUT:${cut}`));
      assert.equal(existsSync(selected.pending), false);
      assert.equal(readdirSync(selected.domain).some(name => name.startsWith("create-")), false);
      const extras = readdirSync(path.join(selected.root, "tasks")).filter(name => !baseline.some(([file]) => file === `tasks/${name}`));
      assert.equal(extras.length, 1);
      const interruptedPath = path.join(selected.root, "tasks", extras[0]), interruptedBytes = readFileSync(interruptedPath);
      assert.equal(extras[0].startsWith(".syncthing."), cut === "stage-written");
      assert.deepEqual(counts(selected), cut === "afterCommit" ? [1, 1] : [0, 0]);
      assert.equal(ok(send(runner, selected, { command: "workspace.info" })).result.state, "ready");
      fail(send(runner, selected, { command: "workspace.recovery.resume", args: { operationId: "unknown-create" }, writeContext: original.writeContext, idempotencyKey: "cannot-adopt" }), "OPERATION_UNAVAILABLE");
      const retry = ok(send(runner, selected, original));
      if (cut === "afterCommit") assert.equal(`${retry.result.task.id}.json`, extras[0]);
      else assert.notEqual(`${retry.result.task.id}.json`, extras[0]);
      assert.deepEqual(readFileSync(interruptedPath), interruptedBytes);
      assert.equal(raw(selected).length, baseline.length + (["published", "beforeCommit"].includes(cut) ? 2 : 1));
      assert.deepEqual(counts(selected), [1, 1]);
      assert.deepEqual(ok(send(runner, selected, original)).result, retry.result);
      passed.push(`${prefix}: unjournaled termination ${cut}, orphan preservation or accepted pre-receipt duplicate; committed receipt replays`);
    }
    for (const cut of ["destination", "parentChange", "unrelatedChange", "flushRefusal"]) {
      const selected = workspace(`${prefix}-${cut}`), original = prepared(runner, selected), baseline = raw(selected);
      original.args.parentId = id;
      const response = send(runner, selected, original, true, cut);
      if (cut === "unrelatedChange") ok(response);
      else fail(response, cut === "destination" ? "STALE_SCOPE" : cut === "parentChange" ? "STALE_FILE" : "INVALID_STORAGE");
      assert.equal(existsSync(selected.pending), false);
      if (["destination", "parentChange"].includes(cut)) {
        assert.deepEqual(counts(selected), [0, 0]);
        assert.equal(readdirSync(path.join(selected.root, "tasks")).filter(name => name.startsWith(".syncthing.taskdb-create-")).length, 1);
      }
      if (cut === "destination") {
        const added = raw(selected).filter(([file]) => !baseline.some(([name]) => name === file));
        assert.equal(added.length, 1); assert.equal(Buffer.from(added[0][1], "base64").toString(), "preserve arriving destination");
      }
      if (cut === "flushRefusal") {
        assert.deepEqual(counts(selected), [0, 0]); assert.equal(raw(selected).length, baseline.length + 1);
        ok(send(runner, selected, original)); assert.equal(raw(selected).length, baseline.length + 2); assert.deepEqual(counts(selected), [1, 1]);
      }
      passed.push(`${prefix}: selected ${cut}, no new pending/progress evidence`);
    }
  }
  console.log(JSON.stringify({ runtime: { platform: process.platform, os: os.release(), arch: process.arch, node: process.version, libuv: process.versions.uv, volume }, checkout,
    sourceBundle: { path: bundle, sha256: createHash("sha256").update(source).digest("hex"), bytes: Buffer.byteLength(source) }, artifacts, passed, count: passed.length,
    implementation: "unjournaled same-directory native rename; this run does not remeasure the old pending-create journal", limitations: "One fixed local NTFS host only. Rename is not a no-clobber CAS; final-check races, power-loss, hostile reparse races, native UI, network/provider and release acceptance are not proved.", scratchWillBeRemoved: true }, null, 2));
  completedProof = true;
} finally {
  if (completedProof) rmSync(scratch, { recursive: true, force: true });
  else console.error(`Incomplete disposable proof retained at ${scratch}`);
}
