// Disposable local-NTFS capture proof through the shared gateway, Windows Node and existing SEA route.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
const cuts = ["intent", "stage-written", "stage-bound", "publication-started", "published", "verified", "beforeCommit", "afterCommit", "retiring-stage", "retiring-evidence", "progress-preparing", "lostReply", "flushRefusal", "lateCollision"];
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
      TASKS_SYNC_ROOT: path.join(w.directory, "v1-root-trap"), TASKS_TEST_PENDING: w.pending },
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
function paths(w, intent) { return { target: path.join(w.root, "tasks", `${intent.taskId}.json`), stage: path.join(w.root, "tasks", `.syncthing.taskdb-create-${intent.operationId}.tmp`), progress: path.join(w.domain, `create-${intent.operationId}.progress.json`) }; }
function interrupted(runner, w, cut) {
  const request = prepared(runner, w), child = run(runner, w, request, cut);
  assert.equal(child.error, undefined); assert.notEqual(child.status, 0, `${cut}: ${child.stdout} ${child.stderr}`);
  assert.match(child.stderr, new RegExp(`TASKS_TEST_CUT:${cut}`), `${cut}: ${child.stderr}`);
  assert.equal(existsSync(w.pending), cut !== "lostReply");
  const intent = cut === "lostReply" ? null : JSON.parse(readFileSync(w.pending, "utf8"));
  return { request, intent, ...(intent ? paths(w, intent) : {}) };
}
function recovery(runner, w, intent, key = "resume-capture") {
  return { command: "workspace.recovery.resume", args: { operationId: intent.operationId }, writeContext: ok(send(runner, w, { command: "workspace.info" })).writeContext,
    idempotencyKey: key, actor: { kind: "human", label: "Windows capture recovery" }, readOnly: false, dryRun: false };
}
function faultBundle(cut) {
  const name = ["beforeCommit", "afterCommit"].includes(cut) ? "withV2CacheTransaction"
    : ["stage-bound", "publication-started", "verified", "progress-preparing"].includes(cut) ? "saveProgress"
    : ["intent", "lostReply"].includes(cut) ? "executeV2Create"
    : ["retiring-stage", "retiring-evidence"].includes(cut) ? "retireV2Create" : "applyV2CreateJournal";
  const moduleName = name === "withV2CacheTransaction" ? "v2QueryCache" : name === "executeV2Create" ? "v2CreateWriter" : "v2CreateJournal";
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
  if (cut === "intent") needle = "persistV2Pending(root, intent);";
  else if (cut === "lostReply") needle = "if (completed) retireV2Create(completed);";
  else if (cut === "stage-written") needle = 'writeV2DurableFile(stage, Buffer.from(intent.nextBytes, "base64"));';
  else if (["stage-bound", "publication-started", "verified"].includes(cut)) needle = "syncV2Directory(v2LocalDomain(intent.root));";
  else if (cut === "progress-preparing") needle = section.match(/\(0, import_node_fs\d+\.renameSync\)\(`\$\{file\}\.preparing`, file\);/)[0];
  else if (["published", "lateCollision"].includes(cut)) needle = section.match(/\(0, import_node_fs\d+\.linkSync\)\(stage, targetPath\(intent\)\);/)[0];
  else if (cut === "retiring-stage") needle = section.match(/\(0, import_node_fs\d+\.unlinkSync\)\(stage\);/)[0];
  else if (cut === "retiring-evidence") needle = section.match(/\(0, import_node_fs\d+\.unlinkSync\)\(progressPath\d*\(intent\)\);/)[0];
  else if (cut === "flushRefusal") needle = section.match(/syncV2Directory\(import_node_path\d+\.default\.dirname\(stage\)\);\n\s*const snapshot = guardCreate\(intent, progress\);/)[0];
  else needle = 'database.exec("COMMIT");';
  assert.equal(section.split(needle).length, 2, `unique ${cut} cut required`);
  const stop = `if(require("node:fs").existsSync(process.env.TASKS_TEST_PENDING)${cut === "lostReply" ? "===false" : ""}){require("node:fs").writeSync(2,"TASKS_TEST_CUT:${cut}\\n");process.kill(process.pid,"SIGKILL");}`;
  let replacement = ["beforeCommit", "progress-preparing"].includes(cut) ? stop + needle : needle + stop;
  if (["stage-bound", "publication-started", "verified"].includes(cut)) replacement = needle + `if(++__captureRecords===${["stage-bound", "publication-started", "verified"].indexOf(cut) + 1}){${stop}}`;
  if (cut === "flushRefusal") replacement = 'throw Object.assign(new Error("test-only capture directory flush refusal"),{code:"EPERM"});' + needle;
  if (cut === "lateCollision") replacement = 'require("node:fs").writeFileSync(targetPath(intent),"preserve late collision");' + needle;
  return source.slice(0, start) + (["stage-bound", "publication-started", "verified"].includes(cut) ? "let __captureRecords=0;\n" : "") + section.replace(needle, replacement) + source.slice(end);
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
    assert.deepEqual(advertised, ["activity.list", "category.list", "tag.list", "task.create", "task.get", "task.list", "task.update", "workspace.info", "workspace.recovery.resume"].sort());
    fail(send(runner, w, request, false), "UNSUPPORTED_COMMAND");
    for (const command of ["task.start", "task.pause", "task.complete", "task.reopen", "task.cancel", "task.delete", "task.status.undo", "task.move", "task.dependency.add", "task.reorder", "task.transitionMany", "operation.undo", "task.purgeCanceled", "workspace.init", "workspace.archive", "workspace.restore", "workspace.migrateV1", "workspace.doctor.apply"]) fail(send(runner, w, { ...request, command }), "UNSUPPORTED_COMMAND");
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

    for (const cut of cuts.filter(value => !["flushRefusal", "lateCollision"].includes(value))) {
      console.error(`Checking ${prefix} capture cut ${cut}`);
      const selected = workspace(`${prefix}-${cut}`), baseline = raw(selected), interruptedState = interrupted(runner, selected, cut);
      const { request: original, intent } = interruptedState;
      if (cut === "lostReply") {
        const replay = ok(send(runner, selected, original)); assert.match(replay.result.task.id, uuid); assert.deepEqual(counts(selected), [1, 1]);
        assert.equal(raw(selected).length, baseline.length + 1);
      } else if (["publication-started", "progress-preparing"].includes(cut)) {
        const pendingBytes = readFileSync(selected.pending), targetBefore = existsSync(interruptedState.target) ? readFileSync(interruptedState.target) : null;
        fail(send(runner, selected, recovery(runner, selected, intent)), "RECOVERY_CONFLICT");
        assert.deepEqual(readFileSync(selected.pending), pendingBytes);
        assert.deepEqual(existsSync(interruptedState.target) ? readFileSync(interruptedState.target) : null, targetBefore); assert.deepEqual(counts(selected), [0, 0]);
      } else {
        assert.equal(ok(send(runner, selected, { command: "workspace.info" })).result.state, "recovery_pending");
        fail(send(runner, selected, { command: "task.list" }), "RECOVERY_PENDING");
        const retry = send(runner, selected, original);
        if (["afterCommit", "retiring-stage", "retiring-evidence"].includes(cut)) ok(retry); else fail(retry, "RECOVERY_PENDING");
        const resumed = ok(send(runner, selected, recovery(runner, selected, intent)));
        const replay = ok(send(runner, selected, original)); assert.deepEqual(replay.result, resumed.result.originalResult);
        assert.equal(replay.result.task.id, intent.taskId); assert.equal(replay.result.task.createdAt, intent.at); assert.equal(replay.result.task.updatedAt, intent.at);
        assert.equal(replay.result.operationId, intent.operationId); assert.equal(readFileSync(interruptedState.target).toString("base64"), intent.nextBytes);
        assert.deepEqual(raw(selected).filter(([name]) => name !== `tasks/${intent.taskId}.json`), baseline);
        assert.equal(existsSync(selected.pending), false); assert.deepEqual(counts(selected), [2, 1]);
      }
      passed.push(`${prefix}: actual termination ${cut}, fixed original authority or preserved uncertain absence`);
    }

    const unflushed = workspace(`${prefix}-flush-refusal`), flushState = interrupted(runner, unflushed, "published");
    const resume = recovery(runner, unflushed, flushState.intent), pendingBytes = readFileSync(unflushed.pending), progressBytes = readFileSync(flushState.progress), targetBytes = readFileSync(flushState.target);
    fail(send(runner, unflushed, resume, true, "flushRefusal"), "RECOVERY_CONFLICT");
    assert.deepEqual(readFileSync(unflushed.pending), pendingBytes); assert.deepEqual(readFileSync(flushState.progress), progressBytes); assert.deepEqual(readFileSync(flushState.target), targetBytes);
    assert.deepEqual(counts(unflushed), [0, 0]); ok(send(runner, unflushed, resume)); ok(send(runner, unflushed, flushState.request)); assert.deepEqual(counts(unflushed), [2, 1]);
    passed.push(`${prefix}: already-linked publication requires directory flush before history/receipts/retirement`);

    for (const fault of ["formatting", "arrival", "target-arrival", "target-same-bytes", "target-missing", "target-replaced", "target-divergent", "stage-missing", "stage-replaced", "stage-partial", "progress-missing", "progress-partial", "task-directory", "other-cache", "copied-cache"]) {
      const selected = workspace(`${prefix}-refuse-${fault}`);
      const state = interrupted(runner, selected, ["target-missing", "target-replaced", "target-divergent"].includes(fault) ? "published" : "stage-bound");
      if (fault === "formatting") writeFileSync(path.join(selected.root, "tasks", `${id}.json`), " " + readFileSync(path.join(selected.root, "tasks", `${id}.json`), "utf8"));
      if (fault === "arrival") writeFileSync(path.join(selected.root, "tasks/late.json"), "preserve arrival");
      if (fault === "target-arrival") writeFileSync(state.target, "preserve colliding target");
      if (fault === "target-same-bytes") writeFileSync(state.target, Buffer.from(state.intent.nextBytes, "base64"));
      if (fault === "target-missing") rmSync(state.target);
      if (fault === "target-replaced") { renameSync(state.target, path.join(selected.directory, "kept-target")); writeFileSync(state.target, Buffer.from(state.intent.nextBytes, "base64")); }
      if (fault === "target-divergent") writeFileSync(state.target, JSON.stringify({ ...JSON.parse(readFileSync(state.target)), title: "preserve changed title" }));
      if (fault === "stage-missing") rmSync(state.stage);
      if (fault === "stage-replaced") { renameSync(state.stage, path.join(selected.directory, "kept-stage")); writeFileSync(state.stage, Buffer.from(state.intent.nextBytes, "base64")); }
      if (fault === "stage-partial") writeFileSync(state.stage, "{");
      if (fault === "progress-missing") rmSync(state.progress);
      if (fault === "progress-partial") writeFileSync(state.progress, "{");
      if (fault === "task-directory") { renameSync(path.join(selected.root, "tasks"), path.join(selected.directory, "kept-tasks")); cpSync(path.join(selected.directory, "kept-tasks"), path.join(selected.root, "tasks"), { recursive: true }); }
      const chosen = ["other-cache", "copied-cache"].includes(fault) ? { ...selected, cache: path.join(selected.directory, "other.db") } : selected;
      if (fault === "copied-cache") cpSync(selected.cache, chosen.cache);
      const retained = readFileSync(selected.pending), targetBefore = existsSync(state.target) ? readFileSync(state.target) : null;
      fail(send(runner, chosen, recovery(runner, chosen, state.intent)), "RECOVERY_CONFLICT");
      assert.deepEqual(readFileSync(selected.pending), retained); assert.deepEqual(existsSync(state.target) ? readFileSync(state.target) : null, targetBefore);
      assert.deepEqual(counts(selected), [0, 0]); passed.push(`${prefix}: preserves evidence on ${fault}`);
    }
    const race = workspace(`${prefix}-late-collision`), raceRequest = prepared(runner, race);
    fail(send(runner, race, raceRequest, true, "lateCollision"), "RECOVERY_CONFLICT");
    const raceIntent = JSON.parse(readFileSync(race.pending)); assert.equal(readFileSync(paths(race, raceIntent).target, "utf8"), "preserve late collision");
    fail(send(runner, race, recovery(runner, race, raceIntent)), "RECOVERY_CONFLICT"); assert.deepEqual(counts(race), [0, 0]);
    passed.push(`${prefix}: no-clobber target arriving after final guard is never overwritten`);
    const recoveryLost = workspace(`${prefix}-recovery-lost`), recoveryState = interrupted(runner, recoveryLost, "published");
    const originalResume = recovery(runner, recoveryLost, recoveryState.intent, "original-resume-lost");
    const recoveryChild = run(runner, recoveryLost, originalResume, "afterCommit");
    assert.notEqual(recoveryChild.status, 0); assert.match(recoveryChild.stderr, /TASKS_TEST_CUT:afterCommit/);
    const keptProgress = readFileSync(recoveryState.progress), retainedTarget = readFileSync(recoveryState.target);
    writeFileSync(recoveryState.progress, "{");
    const historicalResume = ok(send(runner, recoveryLost, originalResume));
    assert.equal(historicalResume.result.outcome, "complete"); assert.equal(existsSync(recoveryLost.pending), true);
    assert.deepEqual(readFileSync(recoveryState.target), retainedTarget); assert.equal(readFileSync(recoveryState.progress, "utf8"), "{");
    writeFileSync(recoveryState.progress, keptProgress);
    assert.deepEqual(ok(send(runner, recoveryLost, originalResume)).result, historicalResume.result);
    assert.equal(existsSync(recoveryLost.pending), false); assert.deepEqual(counts(recoveryLost), [2, 1]);
    assert.deepEqual(ok(send(runner, recoveryLost, recoveryState.request)).result, historicalResume.result.originalResult);
    passed.push(`${prefix}: recovery lost reply replays its own receipt; corrupt cleanup evidence stays pending without resurrection`);
    const lost = workspace(`${prefix}-cache-loss`), lostState = interrupted(runner, lost, "published"); rmSync(lost.cache);
    const fresh = ok(send(runner, lost, { command: "workspace.info" })); assert.notEqual(fresh.writeContext, lostState.request.writeContext);
    fail(send(runner, lost, lostState.request), "STALE_WRITE_CONTEXT"); ok(send(runner, lost, recovery(runner, lost, lostState.intent)));
    fail(send(runner, lost, lostState.request), "STALE_WRITE_CONTEXT"); assert.equal(readFileSync(lostState.target).toString("base64"), lostState.intent.nextBytes); assert.deepEqual(counts(lost), [1, 1]);
    passed.push(`${prefix}: original-location cache loss permits explicit fixed recovery, never old-context replay`);
  }
  console.log(JSON.stringify({ runtime: { platform: process.platform, os: os.release(), arch: process.arch, node: process.version, libuv: process.versions.uv, volume }, checkout,
    sourceBundle: { path: bundle, sha256: createHash("sha256").update(source).digest("hex"), bytes: Buffer.byteLength(source) }, artifacts, passed, count: passed.length,
    limitations: "Capture/update explicit profile on one fixed local NTFS host. No native UI, status/undo/control port, power-loss, hostile reparse race, network/provider or release acceptance.", scratchWillBeRemoved: true }, null, 2));
  completedProof = true;
} finally {
  if (completedProof) rmSync(scratch, { recursive: true, force: true });
  else console.error(`Incomplete disposable proof retained at ${scratch}`);
}
