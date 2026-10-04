// Bounded Windows content-update proof. No native UI or power-loss acceptance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";

assert.equal(process.platform, "win32", "Run with Windows Node from a local Windows checkout");
const checkout = realpathSync(path.join(import.meta.dirname, ".."));
assert.match(checkout, /^[A-Za-z]:\\/, "WSL/UNC checkouts are not the Windows writer profile");
const volume = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
  `$v=Get-Volume -DriveLetter ${checkout[0]}; @{filesystem=$v.FileSystem; driveType=$v.DriveType.ToString()} | ConvertTo-Json -Compress`,
], { encoding: "utf8" }));
assert.deepEqual(volume, { filesystem: "NTFS", driveType: "Fixed" }, "Only the declared local NTFS profile is exercised");
const bundle = path.join(checkout, "dist/sidecar/cli.cjs");
const source = readFileSync(bundle, "utf8");
const { inject } = createRequire(import.meta.url)(path.join(checkout, "node_modules/postject/dist/api.js"));
const temporary = path.join(checkout, ".tmp");
mkdirSync(temporary, { recursive: true });
const scratch = mkdtempSync(path.join(temporary, "windows-update-"));
const golden = path.join(checkout, "scripts/fixtures/taskdb-v2/root");
const id = "c8d4206d-c25a-4317-baa4-a2c5443060e9";
const cuts = ["staged", "replaced", "beforeCommit", "afterCommit", "lostReply"];
const passed = [];
const runtime = { platform: process.platform, os: os.release(), arch: process.arch, node: process.version, libuv: process.versions.uv, volume };
const artifacts = [];

function workspace(name) {
  const directory = path.join(scratch, name);
  mkdirSync(directory);
  const root = path.join(directory, "root");
  cpSync(golden, root, { recursive: true });
  const profile = path.join(directory, "profile");
  const stat = lstatSync(root, { bigint: true });
  const key = createHash("sha256").update(JSON.stringify([realpathSync(root), `${stat.dev}:${stat.ino}`])).digest("hex");
  const domain = path.join(profile, "com.soleone.tasks/taskdb-v2/roots", key);
  return { directory, root, profile, cache: path.join(directory, "cache.db"), domain, pending: path.join(domain, "pending.json"), file: path.join(root, "tasks", `${id}.json`) };
}
function argv(w, proof = true) {
  return ["--stdio", "--v2-root", w.root, "--database", w.cache, ...(proof ? ["--windows-update-proof", "--local-profile", w.profile] : [])];
}
function run(runner, w, request, proof = true, cut) {
  const program = cut ? runner.faults[cut] : runner.normal;
  return spawnSync(runner.command ?? program, runner.command ? [program, ...argv(w, proof)] : argv(w, proof), {
    input: JSON.stringify({ version: 2, requestId: "proof", ...request }) + "\n", encoding: "utf8", timeout: 15_000,
    env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: process.env.TEMP, TMP: process.env.TMP,
      APPDATA: path.join(w.directory, "default-profile-trap"), TASKS_DATABASE_PATH: path.join(w.directory, "v1-trap.db"),
      TASKS_SYNC_ROOT: path.join(w.directory, "v1-root-trap"), TASKS_SOURCE_REGISTRY_PATH: path.join(w.directory, "missing-registry.json"), TASKS_TEST_PENDING: w.pending },
  });
}
function send(runner, w, request, proof = true) {
  const child = run(runner, w, request, proof);
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
  const lines = child.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, child.stdout);
  const response = JSON.parse(lines[0]);
  assert.equal(response.version, 2);
  assert.equal(response.requestId, request.requestId ?? "proof");
  for (const name of ["v1-trap.db", "v1-root-trap", "default-profile-trap"]) assert.equal(existsSync(path.join(w.directory, name)), false);
  return response;
}
function ok(response) { assert.equal(response.ok, true, JSON.stringify(response)); return response; }
function fail(response, code) { assert.equal(response.ok, false); assert.equal(response.error.code, code, JSON.stringify(response)); }
function prepared(runner, w) {
  const current = ok(send(runner, w, { command: "task.get", args: { id } }));
  return { version: 2, requestId: "proof", command: "task.update", writeContext: current.writeContext, idempotencyKey: "original",
    args: { id, expectedVersion: current.result.task.version, title: "Windows literal @alice", description: "**Windows notes**\r\n" },
    actor: { kind: "human", label: "Windows proof" }, readOnly: false, dryRun: false };
}
function raw(w) {
  return ["workspace.json", ...readdirSync(path.join(w.root, "tasks")).filter(name => name.endsWith(".json")).sort().map(name => `tasks/${name}`)]
    .map(name => [name, readFileSync(path.join(w.root, name)).toString("base64")]);
}
function counts(w) {
  const database = new DatabaseSync(w.cache);
  try { return ["v2_receipts", "v2_operations"].map(table => database.prepare(`SELECT count(*) AS n FROM ${table}`).get().n); }
  finally { database.close(); }
}
function activity(runner, w) { return ok(send(runner, w, { command: "activity.list" })).result.activity; }
function interrupted(runner, w, cut) {
  const request = prepared(runner, w);
  const child = run(runner, w, request, true, cut);
  assert.equal(child.error, undefined);
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, new RegExp(`TASKS_TEST_CUT:${cut}`), child.stderr);
  assert.equal(existsSync(w.pending), cut !== "lostReply");
  return request;
}
function faultBundle(cut) {
  const functionName = ["replaced", "flushRefusal"].includes(cut) ? "applyV2Journal" : ["beforeCommit", "afterCommit"].includes(cut) ? "withV2CacheTransaction" : "executeV2Update";
  const start = source.indexOf(`function ${functionName}(`);
  assert.ok(start >= 0 && source.indexOf(`function ${functionName}(`, start + 1) === -1, "unique function required");
  const nextModule = source.indexOf("\n// src/", start);
  assert.ok(nextModule > start);
  const section = source.slice(start, nextModule);
  const needle = cut === "staged" ? "persistV2Pending(root, intent);" : cut === "lostReply" ? "if (retire) retireV2Pending(root);"
    : cut === "replaced" ? section.match(/\(0, import_node_fs\d+\.renameSync\)\(temporary, target\);/)[0]
    : cut === "flushRefusal" ? section.match(/syncV2Directory\(import_node_path\d+\.default\.dirname\(target\)\);/)[0] : 'database.exec("COMMIT");';
  assert.equal(section.split(needle).length, 2, "unique fault cut required");
  const stop = `if(require("node:fs").existsSync(process.env.TASKS_TEST_PENDING)${cut === "lostReply" ? "===false" : ""}){require("node:fs").writeSync(2,"TASKS_TEST_CUT:${cut}\\n");process.kill(process.pid,"SIGKILL");}`;
  const replacement = cut === "flushRefusal" ? `throw Object.assign(new Error("test-only directory flush refusal"),{code:"EPERM"});${needle}`
    : cut === "beforeCommit" ? stop + needle : needle + stop;
  return source.slice(0, start) + section.replace(needle, replacement) + source.slice(nextModule);
}
async function sea(name, input) {
  const main = path.join(scratch, `${name}.cjs`), blob = path.join(scratch, `${name}.blob`), config = path.join(scratch, `${name}.json`), executable = path.join(scratch, `${name}.exe`);
  writeFileSync(main, input);
  writeFileSync(config, JSON.stringify({ main, output: blob, disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false }));
  execFileSync(process.execPath, ["--experimental-sea-config", config], { stdio: "pipe" });
  copyFileSync(process.execPath, executable);
  await inject(executable, "NODE_SEA_BLOB", readFileSync(blob), { sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2" });
  artifacts.push({ name, sha256: createHash("sha256").update(readFileSync(executable)).digest("hex"), bytes: lstatSync(executable).size });
  return executable;
}

try {
  const node = { name: "Windows Node bundled CLI", command: process.execPath, normal: bundle, faults: {} };
  const executable = await sea("tasks-backend", source);
  const native = { name: "Windows SEA sidecar", command: null, normal: executable, faults: {} };
  for (const cut of [...cuts, "flushRefusal"]) {
    node.faults[cut] = path.join(scratch, `node-${cut}.cjs`);
    writeFileSync(node.faults[cut], faultBundle(cut));
    native.faults[cut] = await sea(`sea-${cut}`, faultBundle(cut));
  }
  for (const runner of [node, native]) {
    const prefix = runner === node ? "node" : "sea";
    const w = workspace(`${prefix}-content`);
    const info = ok(send(runner, w, { command: "workspace.info" }));
    assert.deepEqual(info.result.commands, ["activity.list", "category.list", "tag.list", "task.get", "task.list", "task.update", "workspace.info", "workspace.recovery.resume"].sort());
    const request = prepared(runner, w), before = raw(w), original = JSON.parse(readFileSync(w.file, "utf8"));
    fail(send(runner, w, request, false), "UNSUPPORTED_COMMAND");
    for (const command of ["task.create", "task.start", "task.pause", "task.complete", "task.reopen", "task.cancel", "task.delete", "task.status.undo", "task.move", "task.dependency.add", "task.reorder", "operation.undo", "task.purgeCanceled", "workspace.init", "workspace.rebuild", "workspace.archive", "workspace.restore", "workspace.migrateV1", "workspace.doctor.inspect", "workspace.doctor.plan", "workspace.doctor.apply"]) fail(send(runner, w, { ...request, command }), "UNSUPPORTED_COMMAND");
    assert.deepEqual(raw(w), before);
    assert.deepEqual(counts(w), [0, 0]);
    const preview = ok(send(runner, w, { ...request, dryRun: true, idempotencyKey: undefined }));
    assert.equal(preview.result.changed, true);
    assert.deepEqual(counts(w), [0, 0]);
    assert.deepEqual(raw(w), before);
    const noop = { ...request, idempotencyKey: "noop", args: { id, expectedVersion: request.args.expectedVersion, title: original.title } };
    assert.equal(ok(send(runner, w, noop)).result.changed, false);
    assert.deepEqual(raw(w), before);
    assert.deepEqual(counts(w), [1, 0]);
    const changed = ok(send(runner, w, request));
    assert.equal(changed.result.changed, true);
    const saved = JSON.parse(readFileSync(w.file, "utf8"));
    assert.equal(saved.title, request.args.title);
    assert.equal(saved.description, request.args.description);
    assert.deepEqual({ ...saved, title: original.title, description: original.description, updatedAt: original.updatedAt }, original);
    assert.deepEqual(raw(w).filter(([name]) => name !== `tasks/${id}.json`), before.filter(([name]) => name !== `tasks/${id}.json`));
    assert.deepEqual(counts(w), [2, 1]);
    assert.deepEqual(ok(send(runner, w, { ...request, requestId: "restart-replay" })).result, changed.result);
    assert.ok(ok(send(runner, w, { command: "task.get", args: { id } })).result.task.version > request.args.expectedVersion);
    fail(send(runner, w, { ...request, idempotencyKey: "stale-new-intent" }), "STALE_TASK_VERSION");
    fail(send(runner, w, { ...request, args: { ...request.args, title: "Different identity" } }), "IDEMPOTENCY_KEY_REUSED");
    assert.equal(activity(runner, w).length, 1);
    const canonical = raw(w);
    fail(send(runner, { ...w, cache: path.join(w.root, "bad-cache.db") }, { command: "workspace.info" }), "INVALID_STORAGE");
    const badProfile = run(runner, { ...w, profile: path.join(w.root, "bad-profile") }, { command: "workspace.info" });
    assert.notEqual(badProfile.status, 0);
    assert.match(badProfile.stderr, /outside the canonical root/);
    assert.deepEqual(raw(w), canonical);
    assert.equal(existsSync(path.join(w.root, "bad-cache.db")), false);
    assert.equal(existsSync(path.join(w.root, "bad-profile")), false);
    passed.push(`${prefix}: allowlist/default refusal, preview/no-op, content/untouched fields, restart/historical replay, stale/identity refusal, outside-root selection`);
    const rootAlias = path.join(w.directory, "root-junction"), cacheAlias = path.join(scratch, `${prefix}-cache-parent-junction`);
    symlinkSync(w.root, rootAlias, "junction");
    symlinkSync(w.directory, cacheAlias, "junction");
    const aliased = { ...w, root: rootAlias, cache: path.join(cacheAlias, "cache.db") };
    assert.equal(ok(send(runner, aliased, { command: "workspace.info" })).writeContext, request.writeContext);
    assert.deepEqual(ok(send(runner, aliased, request)).result, changed.result);
    assert.deepEqual(counts(w), [2, 1]);
    assert.deepEqual(raw(w), canonical);
    passed.push(`${prefix}: authorized root/cache-parent junction resolves to retained physical authority`);
    rmSync(w.file);
    assert.deepEqual(ok(send(runner, w, request)).result, changed.result);
    assert.equal(existsSync(w.file), false);
    assert.deepEqual(counts(w), [2, 1]);
    passed.push(`${prefix}: historical receipt after target absence never resurrects the file`);

    for (const cut of cuts) {
      const w = workspace(`${prefix}-${cut}`), before = raw(w);
      const request = interrupted(runner, w, cut);
      const info = ok(send(runner, w, { command: "workspace.info" }));
      assert.equal(info.writeContext, request.writeContext);
      if (cut === "lostReply") {
        assert.equal(info.result.state, "ready");
        ok(send(runner, w, request));
        assert.deepEqual(counts(w), [1, 1]);
      } else {
        assert.equal(info.result.state, "recovery_pending");
        const intent = JSON.parse(readFileSync(w.pending, "utf8"));
        assert.deepEqual(intent.request, request);
        fail(send(runner, w, { command: "task.list" }), "RECOVERY_PENDING");
        if (cut === "afterCommit") ok(send(runner, w, request));
        else fail(send(runner, w, request), "RECOVERY_PENDING");
        if (cut === "staged") assert.deepEqual(raw(w), before);
        const recovery = { command: "workspace.recovery.resume", writeContext: info.writeContext, idempotencyKey: "resume", args: { operationId: intent.operationId } };
        const resumed = ok(send(runner, w, recovery));
        assert.equal(resumed.result.outcome, "complete");
        assert.equal(existsSync(w.pending), false);
        assert.deepEqual(ok(send(runner, w, request)).result, resumed.result.originalResult);
        assert.deepEqual(ok(send(runner, w, recovery)).result, resumed.result);
        assert.equal(JSON.parse(readFileSync(w.file, "utf8")).updatedAt, intent.at);
        assert.deepEqual(counts(w), [2, 1]);
      }
      assert.equal(activity(runner, w).length, 1);
      assert.deepEqual(raw(w).filter(([name]) => name !== `tasks/${id}.json`), before.filter(([name]) => name !== `tasks/${id}.json`));
      passed.push(`${prefix}: actual process termination ${cut}, fixed retry/recovery, one effect/history`);
    }

    const unflushed = workspace(`${prefix}-flush-refusal`), unflushedRequest = interrupted(runner, unflushed, "replaced");
    const pendingBytes = readFileSync(unflushed.pending), savedBytes = readFileSync(unflushed.file);
    const unflushedIntent = JSON.parse(pendingBytes.toString());
    const resume = { command: "workspace.recovery.resume", writeContext: unflushedRequest.writeContext, idempotencyKey: "flush-resume", args: { operationId: unflushedIntent.operationId } };
    const refusedFlush = run(runner, unflushed, resume, true, "flushRefusal");
    assert.equal(refusedFlush.status, 0, refusedFlush.stderr);
    fail(JSON.parse(refusedFlush.stdout), "INVALID_STORAGE");
    assert.deepEqual(readFileSync(unflushed.pending), pendingBytes);
    assert.deepEqual(readFileSync(unflushed.file), savedBytes);
    assert.deepEqual(counts(unflushed), [0, 0]);
    const recoveredFlush = ok(send(runner, unflushed, resume));
    assert.deepEqual(ok(send(runner, unflushed, unflushedRequest)).result, recoveredFlush.result.originalResult);
    assert.deepEqual(readFileSync(unflushed.file), savedBytes);
    assert.deepEqual(counts(unflushed), [2, 1]);
    passed.push(`${prefix}: already-replaced recovery must flush the directory before receipt/retirement`);

    for (const fault of ["divergence", "formatting", "missing", "arrival", "other-cache", "status-intent"]) {
      const w = workspace(`${prefix}-${fault}`), request = interrupted(runner, w, "staged");
      const intent = JSON.parse(readFileSync(w.pending, "utf8"));
      if (fault === "divergence") writeFileSync(w.file, JSON.stringify({ ...JSON.parse(readFileSync(w.file, "utf8")), title: "External divergence" }));
      if (fault === "formatting") writeFileSync(w.file, " " + readFileSync(w.file, "utf8"));
      if (fault === "missing") rmSync(w.file);
      if (fault === "arrival") writeFileSync(path.join(w.root, "tasks/late.json"), JSON.stringify({ ...JSON.parse(readFileSync(w.file, "utf8")), id: "late" }));
      if (fault === "status-intent") {
        intent.request.command = "task.start";
        intent.request.args = { id, expectedVersion: request.args.expectedVersion };
        const before = JSON.parse(Buffer.from(intent.beforeBytes, "base64").toString());
        intent.nextBytes = Buffer.from(JSON.stringify({ ...before, status: "in_progress", closedAt: null }) + "\n").toString("base64");
        writeFileSync(w.pending, JSON.stringify(intent) + "\n");
      }
      const guarded = fault === "other-cache" ? { ...w, cache: path.join(w.directory, "other.db") } : w;
      const info = ok(send(runner, guarded, { command: "workspace.info" }));
      const pendingBytes = readFileSync(w.pending), canonical = raw(w);
      fail(send(runner, guarded, { command: "workspace.recovery.resume", writeContext: info.writeContext, idempotencyKey: "refused-resume", args: { operationId: intent.operationId } }), fault === "status-intent" ? "UNSUPPORTED_COMMAND" : "RECOVERY_CONFLICT");
      assert.deepEqual(readFileSync(w.pending), pendingBytes);
      assert.deepEqual(raw(w), canonical);
      assert.deepEqual(counts(w), [0, 0]);
      passed.push(`${prefix}: preserves evidence on ${fault}`);
    }

    const lost = workspace(`${prefix}-cache-loss`), originalRequest = interrupted(runner, lost, "replaced");
    const intent = JSON.parse(readFileSync(lost.pending, "utf8"));
    rmSync(lost.cache);
    const fresh = ok(send(runner, lost, { command: "workspace.info" }));
    assert.notEqual(fresh.writeContext, originalRequest.writeContext);
    fail(send(runner, lost, originalRequest), "STALE_WRITE_CONTEXT");
    ok(send(runner, lost, { command: "workspace.recovery.resume", writeContext: fresh.writeContext, idempotencyKey: "fresh-resume", args: { operationId: intent.operationId } }));
    fail(send(runner, lost, originalRequest), "STALE_WRITE_CONTEXT");
    assert.deepEqual(counts(lost), [1, 1]);
    assert.equal(JSON.parse(readFileSync(lost.file, "utf8")).updatedAt, intent.at);
    passed.push(`${prefix}: cache loss uses explicit recovery, never old-context replay`);

    const caseAlias = workspace(`${prefix}-case-alias`), caseRequest = prepared(runner, caseAlias);
    renameSync(caseAlias.file, path.join(caseAlias.root, "tasks", `${id.toUpperCase()}.json`));
    const caseBytes = raw(caseAlias);
    assert.equal(ok(send(runner, caseAlias, { command: "workspace.info" })).result.state, "incomplete");
    fail(send(runner, caseAlias, caseRequest), "INVALID_CANONICAL");
    assert.deepEqual(raw(caseAlias), caseBytes);
    assert.deepEqual(counts(caseAlias), [0, 0]);
    passed.push(`${prefix}: record/filename case alias refusal without rewriting`);

    const alias = workspace(`${prefix}-junction`);
    prepared(runner, alias);
    const outside = path.join(alias.directory, "outside");
    mkdirSync(outside);
    rmSync(path.join(alias.root, "tasks"), { recursive: true });
    symlinkSync(outside, path.join(alias.root, "tasks"), "junction");
    assert.equal(ok(send(runner, alias, { command: "workspace.info" })).result.state, "incomplete");
    assert.deepEqual(readdirSync(outside), []);
    passed.push(`${prefix}: static task-directory junction refusal`);

    const locked = workspace(`${prefix}-lock`), lockedRequest = prepared(runner, locked), beforeLock = raw(locked);
    // An initial no-op creates the cooperating root domain without task effects.
    const title = JSON.parse(readFileSync(locked.file, "utf8")).title;
    ok(send(runner, locked, { ...lockedRequest, idempotencyKey: "seed-lock", args: { ...lockedRequest.args, title, description: JSON.parse(readFileSync(locked.file, "utf8")).description } }));
    const holder = path.join(scratch, `${prefix}-lock.cjs`);
    writeFileSync(holder, 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[2]);d.exec("BEGIN IMMEDIATE");console.log("locked");setInterval(()=>{},1000);');
    const child = spawn(process.execPath, [holder, path.join(locked.domain, "lock.db")], { stdio: ["ignore", "pipe", "ignore"] });
    try {
      await once(child.stdout, "data");
      fail(send(runner, locked, lockedRequest), "INVALID_STORAGE");
      assert.deepEqual(raw(locked), beforeLock);
      assert.equal(existsSync(locked.pending), false);
    } finally { child.kill("SIGKILL"); await once(child, "exit"); }
    ok(send(runner, locked, lockedRequest));
    assert.equal(activity(runner, locked).length, 1);
    passed.push(`${prefix}: cooperating cross-process root lock and post-termination release`);
  }
  console.log(JSON.stringify({ runtime, checkout, artifacts, passed, count: passed.length,
    limitations: "Content-update opt-in profile only, local NTFS on the declared host. No native UI, capture/status/undo/control port, hardware power-loss, hostile reparse race, network filesystem or release acceptance.", scratchWillBeRemoved: true }, null, 2));
} finally { rmSync(scratch, { recursive: true, force: true }); }
