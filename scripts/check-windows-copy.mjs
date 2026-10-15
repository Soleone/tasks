// Disposable absence-only archive/restore proof. Faults modify private bundles, never production options.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

assert.equal(process.platform, "win32", "Run with actual Windows Node on disposable local NTFS");
const checkout = realpathSync(path.join(import.meta.dirname, ".."));
assert.match(checkout, /^[A-Za-z]:\\/);
const volume = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$v=Get-Volume -DriveLetter ${checkout[0]}; @{filesystem=$v.FileSystem;driveType=$v.DriveType.ToString()} | ConvertTo-Json -Compress`], { encoding: "utf8" }));
assert.deepEqual(volume, { filesystem: "NTFS", driveType: "Fixed" });
const bundle = path.join(checkout, "dist/sidecar/cli.cjs"), source = readFileSync(bundle, "utf8");
const { inject } = createRequire(import.meta.url)(path.join(checkout, "node_modules/postject/dist/api.js"));
mkdirSync(path.join(checkout, ".tmp"), { recursive: true });
const scratch = mkdtempSync(path.join(checkout, ".tmp/wcopy-"));
const golden = path.join(checkout, "scripts/fixtures/taskdb-v2/root");
const id = "c8d4206d-c25a-4317-baa4-a2c5443060e9";
const cuts = ["intent", "prefix-0", "prefix-1", "prefix-2", "prefix-3", "prefix-4", "prefix-5", "verified", "reserved", "published", "beforeCommit", "afterCommit", "retiring-target", "retiring-evidence", "unbound", "preparing", "lostReply", "flushRefusal", "lateArrival"];
const passed = [], artifacts = [];
let workspaceIndex = 0, completedProof = false;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function identity(directory) { const stat = lstatSync(directory, { bigint: true }); return `${stat.dev}:${stat.ino}`; }
function domain(root, profile) { return path.join(profile, "com.soleone.tasks/taskdb-v2/roots", hash(JSON.stringify([realpathSync(root), identity(root)]))); }
function workspace(name, command) {
  const directory = path.join(scratch, String(workspaceIndex++)), root = path.join(directory, "r"), profile = path.join(directory, "p");
  mkdirSync(directory); cpSync(golden, root, { recursive: true });
  const w = { name, directory, root, profile, cache: path.join(directory, "c.db"), destination: path.join(directory, "d"), source: root };
  if (command === "workspace.restore") { w.source = path.join(directory, "s"); cpSync(golden, w.source, { recursive: true }); }
  w.domain = domain(root, profile); w.pending = path.join(w.domain, "pending.json");
  return w;
}
function argv(w, proof = true) { return ["--stdio", "--v2-root", w.root, "--database", w.cache, ...(proof ? ["--windows-task-proof", "--local-profile", w.profile] : [])]; }
function run(runner, w, request, cut, proof = true) {
  const program = cut ? runner.faults[cut] : runner.normal;
  return spawnSync(runner.command ?? program, runner.command ? [program, ...argv(w, proof)] : argv(w, proof), {
    input: JSON.stringify({ version: 2, requestId: "copy-proof", ...request }) + "\n", encoding: "utf8", timeout: 20_000,
    env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: process.env.TEMP, TMP: process.env.TMP,
      APPDATA: path.join(w.directory, "default-trap"), TASKS_DATABASE_PATH: path.join(w.directory, "v1-trap.db"), TASKS_SYNC_ROOT: path.join(w.directory, "v1-root-trap"), TASKS_TEST_PENDING: w.pending },
  });
}
function send(runner, w, request, cut, proof = true) {
  const child = run(runner, w, request, cut, proof);
  assert.equal(child.error, undefined); assert.equal(child.status, 0, `${w.name}: ${child.stderr}`);
  const lines = child.stdout.trim().split(/\r?\n/); assert.equal(lines.length, 1, child.stdout);
  const response = JSON.parse(lines[0]); assert.equal(response.requestId, request.requestId ?? "copy-proof");
  for (const trap of ["default-trap", "v1-trap.db", "v1-root-trap"]) assert.equal(existsSync(path.join(w.directory, trap)), false);
  return response;
}
function ok(response) { assert.equal(response.ok, true, JSON.stringify(response)); return response; }
function fail(response, code) { assert.equal(response.ok, false, JSON.stringify(response)); assert.equal(response.error.code, code, JSON.stringify(response)); }
function raw(root) {
  return ["workspace.json", ...readdirSync(path.join(root, "tasks")).filter(name => name.endsWith(".json")).sort().map(name => `tasks/${name}`)]
    .map(name => [name, readFileSync(path.join(root, name)).toString("base64")]);
}
function inventory(directory) {
  if (!existsSync(directory)) return null;
  return readdirSync(directory).sort().flatMap(name => {
    const file = path.join(directory, name), stat = lstatSync(file);
    return stat.isDirectory() && !stat.isSymbolicLink() ? [[name, "directory", identity(file)], ...inventory(file).map(row => [`${name}/${row[0]}`, ...row.slice(1)])] : [[name, stat.isSymbolicLink() ? "link" : "file", stat.isSymbolicLink() ? realpathSync(file) : readFileSync(file).toString("base64")]];
  });
}
// SQLite lock journals are transient lock machinery, not retained copy recovery witnesses.
function retainedEvidence(directory) { return inventory(directory)?.filter(([name]) => !/^lock\.db(?:-|$)/.test(name)); }
function counts(w) {
  const db = new DatabaseSync(w.cache);
  try { return ["v2_receipts", "v2_operations"].map(table => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n); }
  finally { db.close(); }
}
function prepared(runner, w, command) {
  return { version: 2, command, writeContext: ok(send(runner, w, { command: "workspace.info" })).writeContext,
    idempotencyKey: "original-copy", args: { destinationDirectory: w.destination, ...(command === "workspace.restore" ? { sourceDirectory: w.source } : {}) },
    actor: { kind: "human", label: "Windows copy proof" }, readOnly: false, dryRun: false };
}
function recovery(runner, w, intent, key = "resume-copy") {
  return { command: "workspace.recovery.resume", args: { operationId: intent.operationId }, writeContext: ok(send(runner, w, { command: "workspace.info" })).writeContext, idempotencyKey: key };
}
function evidence(w, intent) { return { progress: path.join(w.domain, `copy-${intent.operationId}.progress.json`), verified: path.join(w.domain, `copy-${intent.operationId}.verified.json`) }; }
function interrupted(runner, w, command, cut) {
  const request = prepared(runner, w, command), child = run(runner, w, request, cut);
  assert.equal(child.error, undefined); assert.notEqual(child.status, 0, `${cut}: ${child.stdout} ${child.stderr}`);
  assert.match(child.stderr, new RegExp(`TASKS_TEST_CUT:${cut}`)); assert.equal(existsSync(w.pending), cut !== "lostReply");
  const intent = cut === "lostReply" ? null : JSON.parse(readFileSync(w.pending));
  if (["published", "beforeCommit", "afterCommit", "retiring-target", "retiring-evidence", "lostReply"].includes(cut)) assert.deepEqual(raw(w.destination), raw(w.source));
  return { request, intent, ...(intent ? evidence(w, intent) : {}) };
}
function record(name) { passed.push(name); persistReport(false); }
function persistReport(complete) {
  const report = { complete, runtime: { platform: process.platform, os: os.release(), arch: process.arch, node: process.version, libuv: process.versions.uv, volume }, checkout,
    sourceBundle: { path: bundle, sha256: hash(source), bytes: Buffer.byteLength(source) }, checker: { sha256: hash(readFileSync(import.meta.filename)) }, artifacts, passed, count: passed.length,
    limitations: "Explicit absence-only archive/restore on one short-path local NTFS host. No existing-empty destination, migration, native UI, hardware power-loss, hostile race, network/provider, signing, release or personal-data acceptance.", scratch, scratchWillBeRemoved: complete };
  writeFileSync(path.join(checkout, ".tmp/windows-copy-proof.json"), JSON.stringify(report, null, 2) + "\n");
  return report;
}
function faultBundle(cut) {
  const name = ["beforeCommit", "afterCommit"].includes(cut) ? "withCacheTransaction" : cut === "preparing" ? "persistCopyProgress"
    : cut === "flushRefusal" ? "verifyPublishedCopy" : ["intent", "lostReply"].includes(cut) ? "executeCopy" : cut.startsWith("retiring-") ? "retireCopy" : "applyCopyJournal";
  const moduleName = name === "withCacheTransaction" ? "queryCache" : name === "executeCopy" ? "copyWriter" : "copyJournal";
  const matches = []; let marker = -1;
  while ((marker = source.indexOf(`// src/backend/${moduleName}.ts\n`, marker + 1)) >= 0) {
    const moduleEnd = source.indexOf("\n// src/", marker + 1); assert.ok(moduleEnd > marker);
    for (const definition of source.slice(marker, moduleEnd).matchAll(new RegExp(`\\nfunction ${name}\\d*\\(`, "g"))) matches.push({ start: marker + definition.index + 1, moduleEnd });
  }
  assert.equal(matches.length, 1, `unique ${name} required`);
  const { start, moduleEnd } = matches[0], next = source.indexOf("\nfunction ", start + 1), end = next < 0 ? moduleEnd : Math.min(next, moduleEnd);
  const section = source.slice(start, end); let needle;
  if (cut === "intent") needle = "persistPending(root, intent);";
  else if (cut === "lostReply") needle = "if (completed) retireCopy(completed);";
  else if (cut === "prefix-0") needle = "written: [] };\n      persistCopyProgress(intent, progress);";
  else if (cut.startsWith("prefix-")) needle = section.match(/writeDurableFile\(import_node_path\d+\.default\.join\(intent.stageDirectory, file.relativePath\), Buffer.from\(file.bytes, "base64"\)\);/)[0];
  else if (cut === "verified") needle = "recordVerifiedCopy(intent, progress);";
  else if (["reserved", "lateArrival"].includes(cut)) needle = "reserveCopyTarget(intent, progress);";
  else if (cut === "published") needle = section.match(/\(0, import_node_fs\d+\.renameSync\)\(intent.stageDirectory, intent.destination.directory\);/)[0];
  else if (cut === "unbound") needle = section.match(/\(0, import_node_fs\d+\.mkdirSync\)\(intent.stageDirectory, \{ mode: 448 \}\);/)[0];
  else if (cut === "preparing") needle = section.match(/\(0, import_node_fs\d+\.renameSync\)\(`\$\{file\}\.preparing`, file\);/)[0];
  else if (cut === "retiring-target") needle = "withRootWriterLock(target.root, () => retirePending(target.root));";
  else if (cut === "retiring-evidence") needle = section.match(/\(0, import_node_fs\d+\.unlinkSync\)\(file\);/)[0];
  else if (cut === "flushRefusal") needle = section.match(/syncDirectory\(import_node_path\d+\.default\.dirname\(intent.destination.directory\)\);/)[0];
  else needle = 'database.exec("COMMIT");';
  assert.equal(section.split(needle).length, 2, `unique ${cut} statement required`);
  const stop = `if(require("node:fs").existsSync(process.env.TASKS_TEST_PENDING)${cut === "lostReply" ? "===false" : ""}){require("node:fs").writeSync(2,"TASKS_TEST_CUT:${cut}\\n");process.kill(process.pid,"SIGKILL");}`;
  let replacement = ["beforeCommit", "preparing"].includes(cut) ? stop + needle : needle + stop;
  // Both writes/unlinks are conditional single statements: braces keep the cut inside their ownership branch.
  if (cut.startsWith("prefix-") && cut !== "prefix-0") replacement = `{${needle}if(++__copyFiles===${Number(cut.slice(7))}){${stop}}}`;
  if (cut === "retiring-evidence") replacement = `{${needle}${stop}}`;
  if (cut === "flushRefusal") replacement = 'throw new Error("test-only published-copy directory flush refusal");' + needle;
  if (cut === "lateArrival") replacement = needle + 'require("node:fs").mkdirSync(intent.destination.directory);require("node:fs").writeFileSync(require("node:path").join(intent.destination.directory,"foreign"),"preserve late arrival");';
  return source.slice(0, start) + (cut.startsWith("prefix-") && cut !== "prefix-0" ? "let __copyFiles=0;\n" : "") + section.replace(needle, replacement) + source.slice(end);
}
async function sea(name, input) {
  const main = path.join(scratch, `${name}.cjs`), blob = path.join(scratch, `${name}.blob`), config = path.join(scratch, `${name}.json`), exe = path.join(scratch, `${name}.exe`);
  writeFileSync(main, input); writeFileSync(config, JSON.stringify({ main, output: blob, disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false }));
  execFileSync(process.execPath, ["--experimental-sea-config", config], { stdio: "pipe" }); copyFileSync(process.execPath, exe);
  await inject(exe, "NODE_SEA_BLOB", readFileSync(blob), { sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2" });
  artifacts.push({ name, sha256: hash(readFileSync(exe)), bytes: lstatSync(exe).size }); return exe;
}
function ordinary(runner, prefix, command) {
  const w = workspace(`${prefix}-${command}`, command);
  const sourceSelection = w.source === w.root ? w : { ...w, root: w.source, cache: path.join(w.directory, "s.db") };
  const sourceTask = ok(send(runner, sourceSelection, { command: "task.get", args: { id } }));
  ok(send(runner, sourceSelection, { command: "task.update", writeContext: sourceTask.writeContext, idempotencyKey: "source-history", args: { id, expectedVersion: sourceTask.result.task.version, description: "**Retained source history**\r\n" } }));
  assert.deepEqual(counts(sourceSelection), [1, 1]);
  const request = prepared(runner, w, command), before = raw(w.source), selected = raw(w.root), baselineCounts = counts(w);
  const advertised = ok(send(runner, w, { command: "workspace.info" })).result.commands;
  assert.deepEqual(advertised, ["activity.list", "category.list", "tag.list", "task.create", "task.get", "task.list", "task.update", "task.start", "task.pause", "task.complete", "task.reopen", "task.cancel", "task.delete", "task.status.undo", "workspace.info", "workspace.archive", "workspace.restore", "workspace.recovery.resume"].sort());
  fail(send(runner, w, request, undefined, false), "UNSUPPORTED_COMMAND");
  for (const withheld of ["workspace.migrateV1", "workspace.init", "workspace.rebuild", "workspace.doctor.apply", "task.purgeCanceled", "task.transitionMany", "task.move"]) fail(send(runner, w, { ...request, command: withheld }), "UNSUPPORTED_COMMAND");
  const version = ok(send(runner, w, { command: "task.get", args: { id } })).result.task.version;
  for (const flag of ["readOnly", "dryRun"]) { const preview = ok(send(runner, w, { ...request, idempotencyKey: undefined, [flag]: true })); assert.equal(preview.result.operationId, undefined); }
  assert.equal(existsSync(w.destination), false); assert.equal(existsSync(w.pending), false); assert.deepEqual(counts(w), baselineCounts);
  mkdirSync(w.destination);
  for (const flags of [{}, { readOnly: true }, { dryRun: true }]) fail(send(runner, w, { ...request, ...flags }), "UNSUPPORTED_COMMAND");
  assert.deepEqual(readdirSync(w.destination), []); assert.equal(existsSync(w.pending), false); assert.deepEqual(counts(w), baselineCounts); rmdirSync(w.destination);
  const first = ok(send(runner, w, request)); assert.deepEqual(raw(w.destination), before); assert.deepEqual(raw(w.source), before); assert.deepEqual(raw(w.root), selected);
  assert.deepEqual(counts(w), [baselineCounts[0] + 1, baselineCounts[1]]); assert.equal(ok(send(runner, w, { command: "task.get", args: { id } })).result.task.version, version);
  assert.equal(ok(send(runner, w, { command: "activity.list" })).result.activity.length, baselineCounts[1]);
  assert.equal(ok(send(runner, sourceSelection, { command: "activity.list" })).result.activity.length, 1);
  assert.deepEqual(ok(send(runner, w, { ...request, requestId: "restart" })).result, first.result);
  for (const change of [{ actor: { kind: "human", label: "other actor" } }, { dryRun: true }, { args: { ...request.args, destinationDirectory: path.join(w.directory, "other") } }]) fail(send(runner, w, { ...request, ...change }), "IDEMPOTENCY_KEY_REUSED");
  const target = { ...w, root: w.destination, cache: path.join(w.directory, "t.db") };
  const fresh = ok(send(runner, target, { command: "workspace.info" })); assert.notEqual(fresh.writeContext, request.writeContext); assert.deepEqual(counts(target), [0, 0]);
  fail(send(runner, target, { command: "task.create", writeContext: request.writeContext, idempotencyKey: "old-authority", args: { title: "Not permitted" } }), "STALE_WRITE_CONTEXT");
  rmSync(w.destination, { recursive: true });
  if (w.source !== w.root) rmSync(w.source, { recursive: true });
  assert.deepEqual(ok(send(runner, w, request)).result, first.result); assert.equal(existsSync(w.destination), false);
  record(`${prefix}/${command}: allowlist/default, previews, early empty refusal/same key, exact bytes/source/version/activity, restart/identity, source history retained/not imported, fresh authority, historical absence`);

  const aliases = workspace(`${prefix}-aliases`, command), original = prepared(runner, aliases, command);
  symlinkSync(aliases.source, path.join(aliases.directory, "alias"), "junction");
  for (const destinationDirectory of [aliases.source, path.join(aliases.source, "nested"), aliases.directory, path.join(aliases.directory, "alias", "nested"), path.join(aliases.root, "nested")]) fail(send(runner, aliases, { ...original, args: { ...original.args, destinationDirectory } }), "INVALID_ARGUMENT");
  mkdirSync(path.join(aliases.directory, "parent")); symlinkSync(path.join(aliases.directory, "parent"), path.join(aliases.directory, "parent-alias"), "junction");
  const viaAlias = ok(send(runner, aliases, { ...original, args: { ...original.args, destinationDirectory: path.join(aliases.directory, "parent-alias", "copy") } }));
  assert.equal(viaAlias.result.destinationDirectory, path.join(realpathSync(path.join(aliases.directory, "parent")), "copy")); assert.deepEqual(raw(viaAlias.result.destinationDirectory), raw(aliases.source));
  record(`${prefix}/${command}: physical junction overlap refusal and disjoint aliased-parent publication`);

  const conflicts = workspace(`${prefix}-conflict`, command), conflictName = `${id}.sync-conflict-20261004-proof.json`;
  writeFileSync(path.join(conflicts.source, "tasks", conflictName), Buffer.from([0xff, 0xfe, 0x7b]));
  writeFileSync(path.join(conflicts.source, "tasks", ".syncthing.partial.tmp"), "not canonical");
  mkdirSync(path.join(conflicts.source, ".stversions")); writeFileSync(path.join(conflicts.source, ".stversions", "private"), "not copied");
  const bytes = raw(conflicts.source); ok(send(runner, conflicts, prepared(runner, conflicts, command)));
  assert.deepEqual(raw(conflicts.destination), bytes); assert.deepEqual(readdirSync(conflicts.destination).sort(), ["tasks", "workspace.json"]);
  assert.equal(existsSync(path.join(conflicts.destination, "tasks", ".syncthing.partial.tmp")), false); assert.deepEqual(raw(conflicts.source), bytes);
  record(`${prefix}/${command}: raw invalid-UTF8 known conflicts copied exactly; transport/history excluded`);
}
function cutScenes(runner, prefix, command) {
  for (const cut of cuts.filter(value => !["flushRefusal", "lateArrival"].includes(value))) {
    console.error(`Checking ${prefix} ${command} ${cut}`);
    const w = workspace(`${prefix}-${cut}`, command), before = raw(w.source), selected = raw(w.root), state = interrupted(runner, w, command, cut);
    if (cut === "lostReply") { ok(send(runner, w, state.request)); assert.deepEqual(counts(w), [1, 0]); }
    else if (["unbound", "preparing"].includes(cut)) {
      const retained = retainedEvidence(w.domain), stage = inventory(state.intent.stageDirectory);
      fail(send(runner, w, recovery(runner, w, state.intent)), "RECOVERY_CONFLICT");
      assert.deepEqual(retainedEvidence(w.domain), retained); assert.deepEqual(inventory(state.intent.stageDirectory), stage); assert.equal(existsSync(w.destination), false);
    } else {
      assert.equal(ok(send(runner, w, { command: "workspace.info" })).result.state, "recovery_pending"); fail(send(runner, w, { command: "task.list" }), "RECOVERY_PENDING");
      const retry = send(runner, w, state.request); if (["afterCommit", "retiring-target", "retiring-evidence"].includes(cut)) ok(retry); else fail(retry, "RECOVERY_PENDING");
      if (existsSync(w.destination) && !cut.startsWith("retiring-")) {
        const target = { ...w, root: w.destination, cache: path.join(w.directory, "t.db") };
        assert.equal(ok(send(runner, target, { command: "workspace.info" })).result.state, "recovery_pending"); fail(send(runner, target, recovery(runner, target, state.intent)), "UNSUPPORTED_COMMAND");
      }
      const resumed = ok(send(runner, w, recovery(runner, w, state.intent))), replay = ok(send(runner, w, state.request));
      assert.deepEqual(resumed.result.originalResult, replay.result); assert.equal(replay.result.operationId, state.intent.operationId);
      assert.equal(existsSync(w.pending), false); assert.equal(existsSync(state.intent.stageDirectory), false); assert.deepEqual(counts(w), [2, 0]);
    }
    assert.deepEqual(raw(w.source), before); assert.deepEqual(raw(w.root), selected);
    if (existsSync(w.destination)) assert.deepEqual(raw(w.destination), before);
    record(`${prefix}/${command}: actual ${cut}, fixed recovery/replay or preserved uncertain staging`);
  }
}
function faultScenes(runner, prefix, command) {
  const faults = ["source-edit", "source-arrival", "source-binding", "stage-missing", "stage-partial", "stage-arrival", "stage-binding", "stage-directory-loss", "destination-arrival", "published-edit", "published-missing", "published-binding", "published-tasks-binding", "progress-loss", "progress-partial", "verified-loss", "reservation-loss", "other-cache", "copied-cache"];
  for (const fault of faults.filter(fault => command === "workspace.restore" || fault !== "source-binding")) {
    const w = workspace(`${prefix}-${fault}`, command), state = interrupted(runner, w, command, fault.startsWith("published-") || ["verified-loss", "reservation-loss", "other-cache", "copied-cache"].includes(fault) ? "published" : "prefix-2");
    const file = path.join(w.source, "tasks", `${id}.json`), stageFile = path.join(state.intent.stageDirectory, state.intent.files.find(file => file.relativePath !== "workspace.json").relativePath);
    if (fault === "source-edit") writeFileSync(file, " " + readFileSync(file, "utf8"));
    if (fault === "source-arrival") writeFileSync(path.join(w.source, "tasks", "late.json"), "preserve arrival");
    if (fault === "source-binding") { renameSync(w.source, `${w.source}-kept`); cpSync(`${w.source}-kept`, w.source, { recursive: true }); }
    if (fault === "stage-partial") writeFileSync(stageFile, "{");
    if (fault === "stage-missing") rmSync(stageFile);
    if (fault === "stage-arrival") writeFileSync(path.join(state.intent.stageDirectory, "foreign"), "preserve arrival");
    if (fault === "stage-binding") { renameSync(state.intent.stageDirectory, `${state.intent.stageDirectory}-kept`); cpSync(`${state.intent.stageDirectory}-kept`, state.intent.stageDirectory, { recursive: true }); }
    if (fault === "stage-directory-loss") rmSync(state.intent.stageDirectory, { recursive: true });
    if (fault === "destination-arrival") cpSync(golden, w.destination, { recursive: true });
    if (fault === "published-edit") writeFileSync(path.join(w.destination, "tasks", `${id}.json`), "preserve changed output");
    if (fault === "published-missing") rmSync(w.destination, { recursive: true });
    if (["published-binding", "published-tasks-binding"].includes(fault)) { const changed = fault === "published-binding" ? w.destination : path.join(w.destination, "tasks"); renameSync(changed, `${changed}-kept`); cpSync(`${changed}-kept`, changed, { recursive: true }); }
    if (fault === "progress-loss") rmSync(state.progress);
    if (fault === "progress-partial") writeFileSync(state.progress, "{");
    if (fault === "verified-loss") rmSync(state.verified);
    if (fault === "reservation-loss") rmSync(path.join(domain(w.destination, w.profile), "pending.json"));
    const chosen = ["other-cache", "copied-cache"].includes(fault) ? { ...w, cache: path.join(w.directory, "o.db") } : w;
    if (fault === "copied-cache") copyFileSync(w.cache, chosen.cache);
    const retained = [inventory(w.source), inventory(w.root), inventory(w.destination), inventory(state.intent.stageDirectory), retainedEvidence(w.domain)], receipts = counts(w);
    fail(send(runner, chosen, recovery(runner, chosen, state.intent)), "RECOVERY_CONFLICT");
    assert.deepEqual([inventory(w.source), inventory(w.root), inventory(w.destination), inventory(state.intent.stageDirectory), retainedEvidence(w.domain)], retained); assert.deepEqual(counts(w), receipts);
    record(`${prefix}/${command}: preserves ${fault} without guessed ownership, overwrite or resurrection`);
  }
  const flush = workspace(`${prefix}-flush`, command), state = interrupted(runner, flush, command, "published"), resume = recovery(runner, flush, state.intent);
  const retained = [retainedEvidence(flush.domain), inventory(flush.destination)]; fail(send(runner, flush, resume, "flushRefusal"), "RECOVERY_CONFLICT");
  assert.deepEqual([retainedEvidence(flush.domain), inventory(flush.destination)], retained); assert.deepEqual(counts(flush), [0, 0]); ok(send(runner, flush, resume));
  record(`${prefix}/${command}: published destination reflush refusal preserves evidence and commits no receipt`);
  const race = workspace(`${prefix}-arrival`, command); fail(send(runner, race, prepared(runner, race, command), "lateArrival"), "RECOVERY_CONFLICT");
  assert.equal(readFileSync(path.join(race.destination, "foreign"), "utf8"), "preserve late arrival");
  fail(send(runner, race, recovery(runner, race, JSON.parse(readFileSync(race.pending)))), "RECOVERY_CONFLICT"); assert.deepEqual(counts(race), [0, 0]);
  record(`${prefix}/${command}: occupied destination arriving immediately before rename is preserved`);
  const lost = workspace(`${prefix}-lost-cache`, command), lostState = interrupted(runner, lost, command, "published"); rmSync(lost.cache);
  fail(send(runner, lost, lostState.request), "STALE_WRITE_CONTEXT"); ok(send(runner, lost, recovery(runner, lost, lostState.intent))); fail(send(runner, lost, lostState.request), "STALE_WRITE_CONTEXT");
  assert.deepEqual(raw(lost.destination), raw(lost.source)); assert.deepEqual(counts(lost), [1, 0]);
  record(`${prefix}/${command}: original-location cache loss permits fresh explicit recovery, not old-context replay`);
}
function cleanupScenes(runner, prefix, command) {
  const w = workspace(`${prefix}-recovery-lost`, command), state = interrupted(runner, w, command, "verified"), resume = recovery(runner, w, state.intent);
  const child = run(runner, w, resume, "afterCommit"); assert.notEqual(child.status, 0); assert.match(child.stderr, /TASKS_TEST_CUT:afterCommit/);
  const originalProgress = readFileSync(state.progress), target = raw(w.destination); writeFileSync(state.progress, "{");
  const historical = ok(send(runner, w, resume)); assert.equal(historical.result.outcome, "complete"); assert.equal(existsSync(w.pending), true);
  assert.equal(readFileSync(state.progress, "utf8"), "{"); assert.deepEqual(raw(w.destination), target);
  writeFileSync(state.progress, originalProgress); assert.deepEqual(ok(send(runner, w, resume)).result, historical.result); assert.equal(existsSync(w.pending), false); assert.deepEqual(counts(w), [2, 0]);
  rmSync(w.destination, { recursive: true }); assert.deepEqual(ok(send(runner, w, resume)).result, historical.result); assert.equal(existsSync(w.destination), false);
  record(`${prefix}/${command}: recovery lost reply, corrupt cleanup retained, historical absence never resurrected`);

  for (const historicalReceipt of [false, true]) {
    const scoped = workspace(`${prefix}-empty-intent`, command), original = interrupted(runner, scoped, command, "verified"), request = recovery(runner, scoped, original.intent);
    if (historicalReceipt) { const killed = run(runner, scoped, request, "afterCommit"); assert.notEqual(killed.status, 0); assert.match(killed.stderr, /TASKS_TEST_CUT:afterCommit/); }
    const modified = { ...original.intent, destination: { ...original.intent.destination, identity: identity(scoped.root) } };
    writeFileSync(scoped.pending, JSON.stringify(modified) + "\n");
    const retained = [retainedEvidence(scoped.domain), inventory(scoped.destination), inventory(original.intent.stageDirectory)];
    fail(send(runner, scoped, request), "UNSUPPORTED_COMMAND"); assert.deepEqual([retainedEvidence(scoped.domain), inventory(scoped.destination), inventory(original.intent.stageDirectory)], retained);
    record(`${prefix}/${command}: structurally valid existing-destination intent refused ${historicalReceipt ? "during receipt cleanup" : "before application"}`);
  }
}
try {
  const faultSources = new Map(cuts.map(cut => [cut, faultBundle(cut)]));
  const node = { command: process.execPath, normal: bundle, faults: {} }, native = { command: null, normal: null, faults: {} };
  for (const [cut, fault] of faultSources) { node.faults[cut] = path.join(scratch, `node-${cut}.cjs`); writeFileSync(node.faults[cut], fault); }
  for (const [prefix, runner] of [["node", node], ["sea", native]]) {
    if (prefix === "sea") { native.normal = await sea("tasks-backend", source); for (const [cut, fault] of faultSources) native.faults[cut] = await sea(`sea-${cut}`, fault); }
    for (const command of ["workspace.archive", "workspace.restore"]) { ordinary(runner, prefix, command); cutScenes(runner, prefix, command); faultScenes(runner, prefix, command); cleanupScenes(runner, prefix, command); }
  }
  const report = persistReport(true); console.log(JSON.stringify(report, null, 2)); completedProof = true;
} finally {
  if (completedProof) rmSync(scratch, { recursive: true, force: true });
  else { persistReport(false); console.error(`Incomplete disposable proof retained at ${scratch}`); }
}
