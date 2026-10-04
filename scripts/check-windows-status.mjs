// Single-task status/inverse process evidence only. Independent transforms keep each writer-family audit explicit.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

assert.equal(process.platform, "win32", "Run with actual Windows Node on disposable local NTFS");
const checkout = realpathSync(path.join(import.meta.dirname, "..")); assert.match(checkout, /^[A-Za-z]:\\/);
const volume = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$v=Get-Volume -DriveLetter ${checkout[0]}; @{filesystem=$v.FileSystem;driveType=$v.DriveType.ToString()} | ConvertTo-Json -Compress`], { encoding: "utf8" }));
assert.deepEqual(volume, { filesystem: "NTFS", driveType: "Fixed" });
const bundle = path.join(checkout, "dist/sidecar/cli.cjs"), source = readFileSync(bundle, "utf8");
const { inject } = createRequire(import.meta.url)(path.join(checkout, "node_modules/postject/dist/api.js"));
mkdirSync(path.join(checkout, ".tmp"), { recursive: true }); const scratch = mkdtempSync(path.join(checkout, ".tmp/windows-status-"));
const id = "c8d4206d-c25a-4317-baa4-a2c5443060e9", golden = path.join(checkout, "scripts/fixtures/taskdb-v2/root");
const states = ["open", "in_progress", "paused", "done", "canceled"];
const matrix = { start: [["open", "in_progress", "paused", "done"], "in_progress"], pause: [["open", "in_progress", "paused"], "paused"], complete: [["open", "in_progress", "paused", "done"], "done"], reopen: [states, "open"], cancel: [["open", "in_progress", "paused", "canceled"], "canceled"], delete: [states, "canceled"] };
const commands = ["activity.list", "category.list", "tag.list", "task.create", "task.get", "task.list", "task.update", "workspace.info", "workspace.recovery.resume", ...Object.keys(matrix).map(suffix => `task.${suffix}`), "task.status.undo"].sort();
const cuts = ["intent", "staged", "replaced", "verified", "beforeCommit", "afterCommit", "lostReply"];
const faultNames = [...cuts.filter(cut => !["beforeCommit", "afterCommit"].includes(cut)).flatMap(cut => [`status-${cut}`, `undo-${cut}`]), "beforeCommit", "afterCommit", "undo-flushRefusal"];
const passed = [], artifacts = []; let index = 0, complete = false;
function workspace(name, status = "open") {
  const directory = path.join(scratch, String(index++)), root = path.join(directory, "root"); mkdirSync(directory); cpSync(golden, root, { recursive: true });
  const file = path.join(root, "tasks", `${id}.json`), task = JSON.parse(readFileSync(file));
  writeFileSync(file, JSON.stringify({ ...task, description: "**Retained Markdown**\r\n", status, closedAt: ["done", "canceled"].includes(status) ? "2026-09-27T14:00:00.000Z" : null }));
  const stat = lstatSync(root, { bigint: true }), key = createHash("sha256").update(JSON.stringify([realpathSync(root), `${stat.dev}:${stat.ino}`])).digest("hex");
  const profile = path.join(directory, "profile"), domain = path.join(profile, "com.soleone.tasks/taskdb-v2/roots", key);
  return { name, directory, root, file, profile, domain, cache: path.join(directory, "cache.db"), pending: path.join(domain, "pending.json") };
}
function run(runner, w, request, cut, proof = true) {
  const program = cut ? runner.faults[cut] : runner.normal;
  const argv = ["--stdio", "--v2-root", w.root, "--database", w.cache, ...(proof ? ["--windows-task-proof", "--local-profile", w.profile] : [])];
  return spawnSync(runner.command ?? program, runner.command ? [program, ...argv] : argv, { input: JSON.stringify(request) + "\n", encoding: "utf8", timeout: 20_000,
    env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: process.env.TEMP, TMP: process.env.TMP, APPDATA: path.join(w.directory, "profile-trap"), TASKS_DATABASE_PATH: path.join(w.directory, "v1-trap.db"), TASKS_SYNC_ROOT: path.join(w.directory, "v1-root-trap"), TASKS_TEST_PENDING: w.pending } });
}
function send(runner, w, request, cut, proof = true) {
  const child = run(runner, w, { version: 2, requestId: "status-proof", ...request }, cut, proof); assert.equal(child.error, undefined); assert.equal(child.status, 0, `${w.name}: ${child.stderr}`);
  const lines = child.stdout.trim().split(/\r?\n/); assert.equal(lines.length, 1, child.stdout); const response = JSON.parse(lines[0]); assert.equal(response.requestId, request.requestId ?? "status-proof");
  for (const trap of ["profile-trap", "v1-trap.db", "v1-root-trap"]) assert.equal(existsSync(path.join(w.directory, trap)), false);
  return response;
}
function ok(response) { assert.equal(response.ok, true, JSON.stringify(response)); return response; }
function fail(response, code) { assert.equal(response.ok, false, JSON.stringify(response)); assert.equal(response.error.code, code, JSON.stringify(response)); }
function prepared(runner, w, command, key = command) {
  const read = ok(send(runner, w, { command: "task.get", args: { id } }));
  return { version: 2, requestId: "status-proof", command, writeContext: read.writeContext, idempotencyKey: key, args: { id, expectedVersion: read.result.task.version }, actor: { kind: "human", label: "Windows status proof" }, dryRun: false, readOnly: false };
}
function raw(w) { return ["workspace.json", ...readdirSync(path.join(w.root, "tasks")).filter(file => file.endsWith(".json")).sort().map(file => `tasks/${file}`)].map(file => [file, readFileSync(path.join(w.root, file)).toString("base64")]); }
function counts(w) { const db = new DatabaseSync(w.cache); try { return ["v2_receipts", "v2_operations", "v2_undo_claims"].map(table => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n); } finally { db.close(); } }
function editCache(w, sql, ...args) { const db = new DatabaseSync(w.cache); try { db.prepare(sql).run(...args); } finally { db.close(); } }
function activity(runner, w) { return ok(send(runner, w, { command: "activity.list" })).result.activity; }
function unaffected(w, baseline) { assert.deepEqual(raw(w).filter(([file]) => file !== `tasks/${id}.json`), baseline.filter(([file]) => file !== `tasks/${id}.json`)); }
function inverseSetup(runner, w) { const forward = prepared(runner, w, "task.complete"); const result = ok(send(runner, w, forward)).result; return { forward, result, request: prepared(runner, w, "task.status.undo") }; }
function interrupted(runner, w, request, cut) {
  const family = request.command === "task.status.undo" ? "undo" : "status", name = ["beforeCommit", "afterCommit"].includes(cut) ? cut : `${family}-${cut}`;
  const child = run(runner, w, request, name); assert.equal(child.error, undefined); assert.notEqual(child.status, 0, child.stdout + child.stderr); assert.match(child.stderr, new RegExp(`TASKS_TEST_CUT:${name}`));
  assert.equal(existsSync(w.pending), cut !== "lostReply"); return cut === "lostReply" ? null : JSON.parse(readFileSync(w.pending));
}
function recovery(runner, w, intent, key = "resume-status") { return { version: 2, requestId: "status-proof", command: "workspace.recovery.resume", writeContext: ok(send(runner, w, { command: "workspace.info" })).writeContext, idempotencyKey: key, args: { operationId: intent.operationId }, actor: { kind: "human", label: "Windows status recovery" }, dryRun: false, readOnly: false }; }
function faultBundle(name) {
  const [family, cut] = name.includes("-") ? name.split("-") : [null, name];
  const functionName = ["beforeCommit", "afterCommit"].includes(cut) ? "withV2CacheTransaction" : cut === "verified" && family === "undo" ? "commitV2Undo" : ["intent", "lostReply", "verified"].includes(cut) ? family === "undo" ? "executeV2Undo" : "executeV2Update" : family === "undo" ? "applyV2BatchJournal" : "applyV2Journal";
  const start = source.indexOf(`function ${functionName}(`); assert.ok(start >= 0); assert.equal(source.indexOf(`function ${functionName}(`, start + 1), -1);
  const moduleEnd = source.indexOf("\n// src/", start), nextFunction = source.indexOf("\nfunction ", start + 1); assert.ok(moduleEnd > start);
  const end = nextFunction >= 0 ? Math.min(nextFunction, moduleEnd) : moduleEnd, section = source.slice(start, end);
  let needle;
  if (cut === "intent") needle = "persistV2Pending(root, intent);";
  else if (cut === "lostReply") needle = family === "undo" ? "retireV2Pending(root);" : "if (retire) retireV2Pending(root);";
  else if (cut === "verified") needle = family === "undo" ? "const snapshot = applyV2BatchJournal(intent);" : "const result = commitV2Update(database, intent, verified);";
  else if (cut === "staged") needle = family === "undo" ? "writeV2DurableFile(temporary, next);" : "writeV2DurableFile(temporary, bytes);";
  else if (cut === "replaced") needle = section.match(/\(0, import_node_fs\d+\.renameSync\)\(temporary, target\);/)[0];
  else if (cut === "flushRefusal") needle = section.match(/syncV2Directory\(import_node_path\d+\.default\.dirname\(target\)\);\n\s*continue;/)[0];
  else needle = 'database.exec("COMMIT");';
  assert.equal(section.split(needle).length, 2, `unique ${name} fault transform required`);
  const stop = `if(require("node:fs").existsSync(process.env.TASKS_TEST_PENDING)${cut === "lostReply" ? "===false" : ""}){require("node:fs").writeSync(2,"TASKS_TEST_CUT:${name}\\n");process.kill(process.pid,"SIGKILL");}`;
  // Stage writes sit in an unbraced conditional. Replace its statement with a block, not a dangling cut.
  const replacement = cut === "flushRefusal" ? 'throw Object.assign(new Error("test-only inverse directory flush refusal"),{code:"EPERM"});' + needle
    : cut === "staged" ? `{${needle}${stop}}` : cut === "beforeCommit" || (cut === "verified" && family === "status") ? stop + needle : needle + stop;
  return source.slice(0, start) + section.replace(needle, replacement) + source.slice(end);
}
async function sea(name, input) {
  const main = path.join(scratch, `${name}.cjs`), blob = path.join(scratch, `${name}.blob`), config = path.join(scratch, `${name}.json`), executable = path.join(scratch, `${name}.exe`);
  writeFileSync(main, input); writeFileSync(config, JSON.stringify({ main, output: blob, disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false }));
  execFileSync(process.execPath, ["--experimental-sea-config", config], { stdio: "pipe" }); copyFileSync(process.execPath, executable);
  await inject(executable, "NODE_SEA_BLOB", readFileSync(blob), { sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2" });
  artifacts.push({ name, sha256: createHash("sha256").update(readFileSync(executable)).digest("hex"), bytes: lstatSync(executable).size }); return executable;
}
try {
  const faultSources = new Map(faultNames.map(name => [name, faultBundle(name)]));
  const node = { command: process.execPath, normal: bundle, faults: {} }, native = { command: null, normal: null, faults: {} };
  for (const [name, fault] of faultSources) { node.faults[name] = path.join(scratch, `node-${name}.cjs`); writeFileSync(node.faults[name], fault); }
  for (const [prefix, runner] of [["node", node], ["sea", native]]) {
    if (prefix === "sea") { native.normal = await sea("tasks-backend", source); for (const [name, fault] of faultSources) native.faults[name] = await sea(`sea-${name}`, fault); }
    const allow = workspace(`${prefix}-allowlist`), baseline = raw(allow), request = prepared(runner, allow, "task.start");
    assert.deepEqual(ok(send(runner, allow, { command: "workspace.info" })).result.commands, commands);
    for (const command of [...Object.keys(matrix).map(suffix => `task.${suffix}`), "task.status.undo"]) fail(send(runner, allow, { ...request, command }, undefined, false), "UNSUPPORTED_COMMAND");
    for (const command of ["task.transitionMany", "task.status.undoMany", "operation.undo", "task.move", "task.dependency.add", "task.reorder", "task.purgeCanceled", "workspace.archive", "workspace.restore", "workspace.doctor.apply"]) fail(send(runner, allow, { ...request, command }), "UNSUPPORTED_COMMAND");
    assert.deepEqual(raw(allow), baseline); assert.deepEqual(counts(allow), [0, 0, 0]); passed.push(`${prefix}: exact private allowlist; defaults/grouped/arbitrary/control refusals`);
    for (const [suffix, [sources, target]] of Object.entries(matrix)) for (const status of states) {
      const w = workspace(`${prefix}-${suffix}-${status}`, status), command = `task.${suffix}`, request = prepared(runner, w, command), before = JSON.parse(readFileSync(w.file)), baseline = raw(w);
      if (!sources.includes(status)) { fail(send(runner, w, request), "INVALID_TRANSITION"); assert.deepEqual(raw(w), baseline); assert.deepEqual(counts(w), [0, 0, 0]); }
      else {
        for (const flags of [{ dryRun: true }, { readOnly: true }]) { const preview = ok(send(runner, w, { ...request, ...flags, idempotencyKey: undefined })); assert.equal(preview.result.task.status, target); assert.equal(preview.result.operationId, undefined); assert.deepEqual(raw(w), baseline); assert.deepEqual(counts(w), [0, 0, 0]); }
        const changed = status !== target, result = ok(send(runner, w, request)).result, saved = JSON.parse(readFileSync(w.file)); assert.equal(result.changed, changed); assert.equal(saved.status, target);
        assert.deepEqual({ ...saved, status: before.status, closedAt: before.closedAt }, before); unaffected(w, baseline); assert.deepEqual(counts(w), [1, changed ? 1 : 0, 0]);
        if (changed) { const row = activity(runner, w)[0]; assert.deepEqual(row.actor, request.actor); assert.equal(row.command, command); assert.equal(saved.closedAt, ["done", "canceled"].includes(target) ? row.createdAt : null); }
        else assert.deepEqual(raw(w), baseline);
        assert.deepEqual(ok(send(runner, w, { ...request, requestId: "restart" })).result, result);
        const undo = prepared(runner, w, "task.status.undo");
        if (!changed) fail(send(runner, w, undo), "UNDO_UNAVAILABLE");
        else {
          const preview = ok(send(runner, w, { ...undo, dryRun: true, idempotencyKey: undefined })); assert.equal(preview.result.task.closedAt, before.closedAt); assert.deepEqual(counts(w), [1, 1, 0]);
          const undone = ok(send(runner, w, undo)).result; assert.deepEqual(JSON.parse(readFileSync(w.file)), before); assert.deepEqual(counts(w), [2, 2, 1]); unaffected(w, baseline);
          assert.deepEqual(ok(send(runner, w, undo)).result, undone); fail(send(runner, w, prepared(runner, w, "task.status.undo", "second-inverse")), "UNDO_UNAVAILABLE");
        }
      }
      passed.push(`${prefix}: ${command} from ${status}, preview/refusal/no-op/effect and eligible exact inverse`);
    }
    for (const family of ["status", "undo"]) for (const cut of cuts) {
      const w = workspace(`${prefix}-${family}-${cut}`), initial = JSON.parse(readFileSync(w.file)), baseline = raw(w);
      const setup = family === "undo" ? inverseSetup(runner, w) : null, request = setup?.request ?? prepared(runner, w, "task.complete");
      const intent = interrupted(runner, w, request, cut);
      if (cut === "lostReply") { ok(send(runner, w, request)); assert.deepEqual(counts(w), family === "undo" ? [2, 2, 1] : [1, 1, 0]); }
      else {
        assert.deepEqual(intent.request, request); assert.equal(ok(send(runner, w, { command: "workspace.info" })).result.state, "recovery_pending"); fail(send(runner, w, { command: "task.list" }), "RECOVERY_PENDING");
        if (cut === "afterCommit") ok(send(runner, w, request)); else fail(send(runner, w, request), "RECOVERY_PENDING");
        const nextBytes = family === "undo" ? intent.files.find(file => file.taskId === id).nextBytes : intent.nextBytes;
        if (["replaced", "verified", "beforeCommit", "afterCommit"].includes(cut)) assert.equal(readFileSync(w.file).toString("base64"), nextBytes, "cut must follow the actual replacement");
        const resume = recovery(runner, w, intent), result = ok(send(runner, w, resume)).result; assert.deepEqual(ok(send(runner, w, request)).result, result.originalResult); assert.deepEqual(ok(send(runner, w, resume)).result, result);
        assert.equal(readFileSync(w.file).toString("base64"), nextBytes); assert.equal(existsSync(w.pending), false); assert.deepEqual(counts(w), family === "undo" ? [3, 2, 1] : [2, 1, 0]);
        const row = activity(runner, w)[0]; assert.equal(row.operationId, intent.operationId); assert.equal(row.createdAt, intent.at); assert.deepEqual(row.actor, request.actor);
      }
      if (family === "undo") assert.deepEqual(JSON.parse(readFileSync(w.file)), initial); unaffected(w, baseline);
      passed.push(`${prefix}: ${family} actual ${cut}, fixed request/time/bytes/history/claims, guarded replay/recovery`);
    }
    for (const fault of ["no-history", "missing-history", "malformed-history", "grouped-history", "consumed", "local-edit", "imported-edit", "stale", "missing-target", "lost-cache"]) {
      const w = workspace(`${prefix}-eligibility-${fault}`); const setup = fault === "no-history" ? null : inverseSetup(runner, w); const request = setup?.request ?? prepared(runner, w, "task.status.undo");
      if (fault === "missing-history") editCache(w, "DELETE FROM v2_operations");
      if (fault === "malformed-history") editCache(w, "UPDATE v2_operations SET before_record = ?", "{");
      if (fault === "grouped-history") editCache(w, "UPDATE v2_operations SET command = ?", "task.transitionMany");
      if (fault === "consumed") editCache(w, "INSERT INTO v2_undo_claims VALUES (?, ?, ?)", setup.result.operationId, id, "already-used");
      if (fault === "local-edit" || fault === "stale") ok(send(runner, w, { ...prepared(runner, w, "task.update"), args: { ...prepared(runner, w, "task.update").args, title: "Intervening edit" } }));
      if (fault === "imported-edit") writeFileSync(w.file, JSON.stringify({ ...JSON.parse(readFileSync(w.file)), title: "Imported edit" }));
      if (fault === "missing-target") rmSync(w.file); if (fault === "lost-cache") rmSync(w.cache);
      const selected = ["local-edit", "imported-edit", "lost-cache"].includes(fault) ? prepared(runner, w, "task.status.undo", "fresh-refusal") : request;
      const baseline = raw(w), before = counts(w); fail(send(runner, w, selected), fault === "stale" ? "STALE_TASK_VERSION" : fault === "missing-target" ? "INVALID_CANONICAL" : "UNDO_UNAVAILABLE");
      assert.deepEqual(raw(w), baseline); assert.deepEqual(counts(w), before); assert.equal(existsSync(w.pending), false);
      if (fault === "lost-cache") fail(send(runner, w, request), "STALE_WRITE_CONTEXT");
      passed.push(`${prefix}: inverse eligibility refuses ${fault} without consuming evidence/key`);
    }
    for (const family of ["status", "undo"]) for (const fault of ["missing", "divergence", "formatting", "arrival", "other-cache", "copied-cache", "unrelated-intent", "multi-task", "grouped-source"]) {
      if (family === "status" && ["multi-task", "grouped-source"].includes(fault)) continue;
      const w = workspace(`${prefix}-${family}-refusal-${fault}`), setup = family === "undo" ? inverseSetup(runner, w) : null, request = setup?.request ?? prepared(runner, w, "task.complete");
      const intent = interrupted(runner, w, request, "intent");
      if (fault === "missing") rmSync(w.file); if (fault === "divergence") writeFileSync(w.file, JSON.stringify({ ...JSON.parse(readFileSync(w.file)), title: "Preserve divergence" })); if (fault === "formatting") writeFileSync(w.file, " " + readFileSync(w.file, "utf8"));
      if (fault === "arrival") writeFileSync(path.join(w.root, "tasks/late.json"), JSON.stringify({ ...JSON.parse(readFileSync(w.file)), id: "late" }));
      if (fault === "unrelated-intent") {
        if (family === "undo") { intent.request.command = "operation.undo"; intent.request.args = { operationId: intent.sources[0].id }; }
        else { const before = JSON.parse(Buffer.from(intent.beforeBytes, "base64")); intent.request.command = "task.dependency.add"; intent.request.args = { id, expectedVersion: request.args.expectedVersion, dependsOnId: "62f159c1-22a7-45cb-89a0-c0c35aaeb1ed" }; intent.nextBytes = Buffer.from(JSON.stringify({ ...before, dependencyIds: [intent.request.args.dependsOnId], updatedAt: intent.at }) + "\n").toString("base64"); }
        writeFileSync(w.pending, JSON.stringify(intent));
      }
      if (fault === "grouped-source") { intent.sources[0].command = "task.transitionMany"; writeFileSync(w.pending, JSON.stringify(intent)); }
      if (fault === "multi-task") {
        // A valid two-task inverse, not merely an unsupported name or malformed journal.
        const other = intent.files.find(file => file.taskId !== id), before = JSON.parse(Buffer.from(other.beforeBytes, "base64"));
        const post = { ...before, status: "done", closedAt: intent.at };
        other.beforeBytes = Buffer.from(JSON.stringify(post) + "\n").toString("base64");
        other.nextBytes = Buffer.from(JSON.stringify(before) + "\n").toString("base64");
        intent.guards.find(guard => guard.relativePath === `tasks/${other.taskId}.json`).sha256 = createHash("sha256").update(Buffer.from(other.beforeBytes, "base64")).digest("hex");
        writeFileSync(path.join(w.root, "tasks", `${other.taskId}.json`), Buffer.from(other.beforeBytes, "base64"));
        intent.request.command = "task.status.undoMany"; intent.request.args = { tasks: [request.args, { id: other.taskId, expectedVersion: 1 }] };
        intent.sources.push({ id: "retained-second-status", command: "task.complete", before, after: post });
        writeFileSync(w.pending, JSON.stringify(intent));
      }
      const selected = ["other-cache", "copied-cache"].includes(fault) ? { ...w, cache: path.join(w.directory, "other.db") } : w; if (fault === "copied-cache") cpSync(w.cache, selected.cache);
      const retained = readFileSync(w.pending), baseline = raw(w), before = counts(w);
      fail(send(runner, selected, recovery(runner, selected, intent)), ["unrelated-intent", "multi-task", "grouped-source"].includes(fault) ? "UNSUPPORTED_COMMAND" : "RECOVERY_CONFLICT");
      assert.deepEqual(readFileSync(w.pending), retained); assert.deepEqual(raw(w), baseline); assert.deepEqual(counts(w), before); passed.push(`${prefix}: ${family} recovery preserves ${fault}`);
    }
    const flush = workspace(`${prefix}-inverse-flush`), setup = inverseSetup(runner, flush), intent = interrupted(runner, flush, setup.request, "replaced"), resume = recovery(runner, flush, intent), retained = readFileSync(flush.pending), target = readFileSync(flush.file);
    fail(send(runner, flush, resume, "undo-flushRefusal"), "INVALID_STORAGE"); assert.deepEqual(readFileSync(flush.pending), retained); assert.deepEqual(readFileSync(flush.file), target); assert.deepEqual(counts(flush), [1, 1, 0]); ok(send(runner, flush, resume)); assert.deepEqual(counts(flush), [3, 2, 1]); passed.push(`${prefix}: already-applied inverse must reflush before receipt/history/claim/retirement`);
    for (const family of ["status", "undo"]) {
      const w = workspace(`${prefix}-${family}-identity`), setup = family === "undo" ? inverseSetup(runner, w) : null, request = setup?.request ?? prepared(runner, w, "task.complete"), result = ok(send(runner, w, request)).result;
      for (const change of [{ actor: { kind: "agent", label: "changed" } }, { readOnly: true }, { dryRun: true }, { args: { ...request.args, expectedVersion: request.args.expectedVersion + 1 } }, { command: "task.reopen" }]) fail(send(runner, w, { ...request, ...change }), "IDEMPOTENCY_KEY_REUSED");
      rmSync(w.file); assert.deepEqual(ok(send(runner, w, request)).result, result); assert.equal(existsSync(w.file), false); passed.push(`${prefix}: ${family} raw identity refusals and historical absence without resurrection`);
      const pending = workspace(`${prefix}-${family}-resume-lost`), preparedState = family === "undo" ? inverseSetup(runner, pending) : null, original = preparedState?.request ?? prepared(runner, pending, "task.complete"), intent = interrupted(runner, pending, original, "replaced"), resume = recovery(runner, pending, intent);
      const child = run(runner, pending, resume, "afterCommit"); assert.notEqual(child.status, 0); assert.match(child.stderr, /TASKS_TEST_CUT:afterCommit/);
      const historical = ok(send(runner, pending, resume)); assert.equal(existsSync(pending.pending), false); assert.deepEqual(ok(send(runner, pending, original)).result, historical.result.originalResult); passed.push(`${prefix}: ${family} explicit recovery lost reply replays durable acknowledgment`);
      const cleanup = workspace(`${prefix}-${family}-cleanup-scope`), seed = family === "undo" ? inverseSetup(runner, cleanup) : null, outward = seed?.request ?? prepared(runner, cleanup, "task.complete"), journal = interrupted(runner, cleanup, outward, "replaced"), recoveryRequest = recovery(runner, cleanup, journal);
      const stopped = run(runner, cleanup, recoveryRequest, "afterCommit"); assert.notEqual(stopped.status, 0); assert.match(stopped.stderr, /TASKS_TEST_CUT:afterCommit/);
      if (family === "undo") journal.sources[0].command = "task.transitionMany";
      else { const before = JSON.parse(Buffer.from(journal.beforeBytes, "base64")); journal.request.command = "task.dependency.add"; journal.request.args = { id, expectedVersion: outward.args.expectedVersion, dependsOnId: "62f159c1-22a7-45cb-89a0-c0c35aaeb1ed" }; journal.nextBytes = Buffer.from(JSON.stringify({ ...before, dependencyIds: [journal.request.args.dependsOnId], updatedAt: journal.at }) + "\n").toString("base64"); }
      writeFileSync(cleanup.pending, JSON.stringify(journal)); const bytes = readFileSync(cleanup.pending), canonical = raw(cleanup), counted = counts(cleanup);
      fail(send(runner, cleanup, recoveryRequest), "UNSUPPORTED_COMMAND"); assert.deepEqual(readFileSync(cleanup.pending), bytes); assert.deepEqual(raw(cleanup), canonical); assert.deepEqual(counts(cleanup), counted); passed.push(`${prefix}: ${family} historical recovery receipt cannot retire unsupported-family evidence`);
    }
  }
  const report = { runtime: { platform: process.platform, os: os.release(), arch: process.arch, node: process.version, libuv: process.versions.uv, volume }, checkout,
    sourceBundle: { path: bundle, sha256: createHash("sha256").update(source).digest("hex"), bytes: Buffer.byteLength(source) }, artifacts, passed, count: passed.length,
    limitations: "Private single-task profile on one local NTFS host/short paths. No native UI, grouped/arbitrary inverse, control port, hardware power-loss, hostile filesystem race, network/provider, long-path or release acceptance.", scratchWillBeRemoved: true };
  // Persist proof before stdout so a parent command-window timeout cannot lose completed evidence.
  writeFileSync(path.join(checkout, ".tmp/windows-status-proof.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2)); complete = true;
} finally { if (complete) rmSync(scratch, { recursive: true, force: true }); else console.error(`Incomplete disposable proof retained at ${scratch}`); }
