import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createV2CopyTestWorkspace as setup } from "./v2CopyTestWorkspace.js";
import type { V2CopyTestWorkspace as Workspace } from "./v2CopyTestWorkspace.js";
import { readV2CanonicalRoot, readV2RootDescriptor } from "./v2CanonicalReader.js";
import { executeV2Line } from "./v2Gateway.js";
import { pendingV2Path, v2LocalDomain } from "./v2LocalDomain.js";
import type { V2Response } from "./v2Protocol.js";

const golden = fileURLToPath(new URL("../../scripts/fixtures/taskdb-v2/root/", import.meta.url));
const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
const id = "c8d4206d-c25a-4317-baa4-a2c5443060e9";
function send(workspace: Workspace, envelope: object): V2Response { return executeV2Line(Buffer.from(JSON.stringify({ version: 2, ...envelope })), workspace.root, workspace.cache); }
function success(response: V2Response): Extract<V2Response, { ok: true }> {
  assert.equal(response.ok, true, JSON.stringify(response));
  if (!response.ok) throw new Error("failed");
  return response;
}
function fail(response: V2Response, code: string) { assert.equal(response.ok, false); if (!response.ok) assert.equal(response.error.code, code, JSON.stringify(response)); }
function run(workspace: Workspace, request: object, loader: string) {
  return spawnSync(process.execPath, ["--import", loader, cli, "--stdio", "--v2-root", workspace.root, "--database", workspace.cache], { input: JSON.stringify(request), env: process.env, encoding: "utf8", timeout: 10_000 });
}
function crash(workspace: Workspace, cut: string, source?: string) {
  const info = success(send(workspace, { command: "workspace.info" }));
  const request = { version: 2, command: source ? "workspace.restore" : "workspace.archive", writeContext: info.writeContext, idempotencyKey: "original-copy", args: { destinationDirectory: workspace.destination, ...(source ? { sourceDirectory: source } : {}) } };
  const pending = pendingV2Path(readV2RootDescriptor(workspace.root));
  const loader = path.join(workspace.directory, "copy-kill-loader.mjs");
  // Fault instrumentation exists only in these subprocesses, never as a production caller option.
  writeFileSync(loader, `import {registerHooks} from 'node:module';import {existsSync} from 'node:fs';import {DatabaseSync} from 'node:sqlite';
const cut=${JSON.stringify(cut)}, pending=${JSON.stringify(pending)};
if(cut==='beforeCommit'||cut==='afterCommit'){const exec=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){if(sql==='COMMIT'&&existsSync(pending)&&cut==='beforeCommit')process.kill(process.pid,'SIGKILL');const result=exec.call(this,sql);if(sql==='COMMIT'&&existsSync(pending)&&cut==='afterCommit')process.kill(process.pid,'SIGKILL');return result;};}
registerHooks({load(url,context,next){const result=next(url,context);if(!result.source)return result;let source=result.source.toString();
function replace(needle,value){if(source.split(needle).length!==2)throw Error('cut must be unique: '+needle);source=source.replace(needle,value);}
if(cut==='intent'&&url.endsWith('/v2CopyWriter.js')){const n='persistV2Pending(root, intent);';replace(n,n+'process.kill(process.pid,"SIGKILL");');}
if(url.endsWith('/v2CopyJournal.js')){
 if(cut==='prefix-0'){const n='persistCopyProgress(intent, progress);';const at=source.indexOf(n);if(at<0)throw Error('missing prefix');source=source.slice(0,at)+n+'process.kill(process.pid,"SIGKILL");'+source.slice(at+n.length);}
 if(cut.startsWith('prefix-')&&cut!=='prefix-0'){source='let copied=0;\\n'+source;const n='writeV2DurableFile(path.join(intent.stageDirectory, file.relativePath), Buffer.from(file.bytes, "base64"));';replace(n,n+'if(++copied==='+Number(cut.slice(7))+')process.kill(process.pid,"SIGKILL");');}
 if(cut==='verified'){const n='recordVerifiedCopy(intent, progress);';replace(n,n+'process.kill(process.pid,"SIGKILL");');}
 if(cut==='reserved'){const n='reserveCopyTarget(intent, progress);';replace(n,n+'process.kill(process.pid,"SIGKILL");');}
 if(cut==='published'){const n='renameSync(intent.stageDirectory, intent.destination.directory);';replace(n,n+'process.kill(process.pid,"SIGKILL");');}
 if(cut==='unbound-directory'){const n='mkdirSync(intent.stageDirectory, { mode: 0o700 });';replace(n,n+'process.kill(process.pid,"SIGKILL");');}
 if(cut==='retiring-target'){const n='withV2RootWriterLock(target.root, () => retireV2Pending(target.root));';replace(n,n+'process.kill(process.pid,"SIGKILL");');}
 if(cut==='retiring-evidence'){const n='unlinkSync(file);';replace(n,n+'process.kill(process.pid,"SIGKILL");');}
}
return {...result,source};}});`);
  const child = run(workspace, request, loader);
  assert.equal(child.signal, "SIGKILL", child.stderr);
  assert.equal(existsSync(pending), true);
  const intent = JSON.parse(readFileSync(pending, "utf8"));
  return { request, pending, intent };
}
function recover(workspace: Workspace, operationId: string, key = "resume-copy") {
  const info = success(send(workspace, { command: "workspace.info" }));
  return send(workspace, { command: "workspace.recovery.resume", args: { operationId }, writeContext: info.writeContext, idempotencyKey: key });
}
const cuts = ["intent", ...Array.from({ length: 6 }, (_, prefix) => `prefix-${prefix}`), "verified", "reserved", "published", "beforeCommit", "afterCommit", "retiring-target", "retiring-evidence"];
for (const command of ["archive", "restore"]) for (const cut of cuts) {
  test(`v2 real ${command} CLI kill at ${cut} resumes the same fixed operation without changing source`, { skip: process.platform !== "linux" }, (t) => {
    const workspace = setup(t);
    const before = readV2CanonicalRoot(workspace.root).files;
    const source = command === "restore" ? path.join(workspace.directory, "external-source") : undefined;
    if (source) cpSync(golden, source, { recursive: true });
    const { request, pending, intent } = crash(workspace, cut, source);
    const info = success(send(workspace, { command: "workspace.info" }));
    assert.equal(info.result.state, "recovery_pending");
    assert.equal(info.result.pendingOperationId, intent.operationId);
    fail(send(workspace, { command: "task.list" }), "RECOVERY_PENDING");
    const retry = send(workspace, request);
    if (["afterCommit", "retiring-target", "retiring-evidence"].includes(cut)) assert.equal(retry.ok, true);
    else fail(retry, "RECOVERY_PENDING");
    if (existsSync(workspace.destination) && !["retiring-target", "retiring-evidence"].includes(cut)) {
      const target = { ...workspace, root: workspace.destination, cache: path.join(workspace.directory, "target.db") };
      assert.equal(success(send(target, { command: "workspace.info" })).result.state, "recovery_pending");
      fail(send(target, { command: "task.list" }), "RECOVERY_PENDING");
      fail(recover(target, intent.operationId), "RECOVERY_CONFLICT");
    }
    const resumed = success(recover(workspace, intent.operationId));
    assert.equal(resumed.result.outcome, "complete");
    assert.equal(existsSync(pending), false);
    assert.equal(existsSync(intent.stageDirectory), false);
    assert.deepEqual(readV2CanonicalRoot(workspace.root).files, before);
    assert.deepEqual(readV2CanonicalRoot(workspace.destination).files, before);
    const replay = success(send(workspace, request));
    assert.equal(replay.result.operationId, intent.operationId);
    assert.deepEqual(resumed.result.originalResult, replay.result);
    const target = { ...workspace, root: workspace.destination, cache: path.join(workspace.directory, "target.db") };
    assert.equal(success(send(target, { command: "workspace.info" })).result.state, "ready");
    assert.deepEqual(success(send(workspace, { command: "activity.list" })).result.activity, []);
  });
}

for (const fault of ["source-edit", "source-arrival", "stage-edit", "stage-missing", "stage-partial", "stage-arrival", "destination-arrival", "published-edit", "progress-loss", "progress-partial", "stage-binding", "published-binding", "published-report-loss", "target-reservation-loss"]) {
  test(`v2 copy recovery preserves and refuses ${fault}`, { skip: process.platform !== "linux" }, (t) => {
    const workspace = setup(t);
    const cut = fault.startsWith("published-") || fault === "target-reservation-loss" ? "published" : "prefix-2";
    const { intent, pending } = crash(workspace, cut);
    const sourceFile = path.join(workspace.root, "tasks", `${id}.json`);
    const stageFile = path.join(intent.stageDirectory, intent.files.filter((file: { relativePath: string }) => file.relativePath !== "workspace.json")[0].relativePath);
    if (fault === "source-edit") writeFileSync(sourceFile, JSON.stringify({ ...JSON.parse(readFileSync(sourceFile, "utf8")), title: "External edit" }));
    if (fault === "source-arrival") writeFileSync(path.join(workspace.root, "tasks", "late.json"), JSON.stringify({ ...JSON.parse(readFileSync(sourceFile, "utf8")), id: "late" }));
    if (fault === "stage-edit") writeFileSync(stageFile, JSON.stringify({ ...JSON.parse(readFileSync(stageFile, "utf8")), title: "Other bytes" }));
    if (fault === "stage-missing") rmSync(stageFile);
    if (fault === "stage-partial") writeFileSync(stageFile, "{");
    if (fault === "stage-arrival") writeFileSync(path.join(intent.stageDirectory, "foreign"), "keep");
    if (fault === "destination-arrival") cpSync(golden, workspace.destination, { recursive: true });
    if (fault === "published-edit") writeFileSync(path.join(workspace.destination, "tasks", `${id}.json`), JSON.stringify({ ...JSON.parse(readFileSync(sourceFile, "utf8")), title: "Edit after publication" }));
    const domain = v2LocalDomain(readV2RootDescriptor(workspace.root));
    if (fault === "progress-loss") rmSync(path.join(domain, `copy-${intent.operationId}.progress.json`));
    if (fault === "progress-partial") writeFileSync(path.join(domain, `copy-${intent.operationId}.progress.json`), "{");
    if (fault === "published-report-loss") rmSync(path.join(domain, `copy-${intent.operationId}.verified.json`));
    if (fault === "target-reservation-loss") rmSync(pendingV2Path(readV2RootDescriptor(workspace.destination)));
    if (fault === "stage-binding" || fault === "published-binding") {
      const changed = fault === "stage-binding" ? intent.stageDirectory : workspace.destination;
      renameSync(changed, `${changed}.preserved`);
      cpSync(`${changed}.preserved`, changed, { recursive: true });
    }
    const bytes = readFileSync(sourceFile);
    fail(recover(workspace, intent.operationId), "RECOVERY_CONFLICT");
    assert.equal(existsSync(pending), true);
    assert.deepEqual(readFileSync(sourceFile), bytes);
    if (fault === "stage-partial") assert.equal(readFileSync(stageFile, "utf8"), "{");
    if (fault === "stage-missing") assert.equal(existsSync(stageFile), false);
    if (fault === "stage-arrival") assert.equal(readFileSync(path.join(intent.stageDirectory, "foreign"), "utf8"), "keep");
  });
}

test("v2 copy recovery refuses unbound directory creation rather than guessing ownership", { skip: process.platform !== "linux" }, (t) => {
  const workspace = setup(t);
  const { intent, pending } = crash(workspace, "unbound-directory");
  fail(recover(workspace, intent.operationId), "RECOVERY_CONFLICT");
  assert.equal(existsSync(intent.stageDirectory), true);
  assert.equal(existsSync(workspace.destination), false);
  assert.equal(existsSync(pending), true);
});

test("v2 copy same recovery receipt finishes target/source retirement after a lost reply", { skip: process.platform !== "linux" }, (t) => {
  const workspace = setup(t);
  const { intent, pending } = crash(workspace, "verified");
  const info = success(send(workspace, { command: "workspace.info" }));
  const recovery = { version: 2, command: "workspace.recovery.resume", args: { operationId: intent.operationId }, writeContext: info.writeContext, idempotencyKey: "same-recovery" };
  const loader = path.join(workspace.directory, "kill-recovery.mjs");
  writeFileSync(loader, `import {DatabaseSync} from 'node:sqlite';import {existsSync} from 'node:fs';const exec=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){const result=exec.call(this,sql);if(sql==='COMMIT'&&existsSync(${JSON.stringify(pending)}))process.kill(process.pid,'SIGKILL');return result;};`);
  assert.equal(run(workspace, recovery, loader).signal, "SIGKILL");
  assert.equal(existsSync(pending), true);
  success(send(workspace, recovery));
  assert.equal(existsSync(pending), false);
  const target = { ...workspace, root: workspace.destination, cache: path.join(workspace.directory, "target.db") };
  assert.equal(success(send(target, { command: "workspace.info" })).result.state, "ready");
});

test("v2 copy cache loss and other-cache refusal preserve old authority boundaries", { skip: process.platform !== "linux" }, (t) => {
  const workspace = setup(t);
  const { request, intent, pending } = crash(workspace, "published");
  const other = { ...workspace, cache: path.join(workspace.directory, "other.db") };
  assert.equal(success(send(other, { command: "workspace.info" })).result.pendingOperationId, intent.operationId);
  fail(recover(other, intent.operationId), "RECOVERY_CONFLICT");
  rmSync(workspace.cache);
  fail(send(workspace, request), "STALE_WRITE_CONTEXT");
  success(recover(workspace, intent.operationId));
  assert.equal(existsSync(pending), false);
  fail(send(workspace, request), "STALE_WRITE_CONTEXT");
});

test("v2 restore resumes a separate fixed source and refuses changes to that source", { skip: process.platform !== "linux" }, (t) => {
  const workspace = setup(t);
  const source = path.join(workspace.directory, "source");
  cpSync(golden, source, { recursive: true });
  const { intent, pending } = crash(workspace, "prefix-1", source);
  const sourceFile = path.join(source, "tasks", `${id}.json`);
  const original = readFileSync(sourceFile);
  writeFileSync(sourceFile, "{");
  fail(recover(workspace, intent.operationId), "RECOVERY_CONFLICT");
  assert.equal(existsSync(pending), true);
  assert.equal(readFileSync(sourceFile, "utf8"), "{");
  writeFileSync(sourceFile, original);
  success(recover(workspace, intent.operationId));
  assert.deepEqual(readV2CanonicalRoot(workspace.destination).files, readV2CanonicalRoot(source).files);
});

test("v2 actual JSON-lines CLI archives and restores across ordinary subprocess restarts", { skip: process.platform !== "linux" }, (t) => {
  const workspace = setup(t);
  const invoke = (request: object) => {
    const child = spawnSync(process.execPath, [cli, "--stdio", "--v2-root", workspace.root, "--database", workspace.cache], { input: JSON.stringify({ version: 2, ...request }), env: process.env, encoding: "utf8", timeout: 10_000 });
    assert.equal(child.status, 0, child.stderr);
    return success(JSON.parse(child.stdout));
  };
  const info = invoke({ command: "workspace.info" });
  const archive = { command: "workspace.archive", writeContext: info.writeContext, idempotencyKey: "actual-copy", args: { destinationDirectory: workspace.destination } };
  const first = invoke(archive);
  assert.deepEqual(invoke({ ...archive, requestId: "restarted" }).result, first.result);
  const restored = path.join(workspace.directory, "restored");
  invoke({ command: "workspace.restore", writeContext: info.writeContext, idempotencyKey: "actual-restore", args: { sourceDirectory: workspace.destination, destinationDirectory: restored } });
  assert.deepEqual(readV2CanonicalRoot(restored).files, readV2CanonicalRoot(workspace.root).files);
});

test("v2 historical recovery success survives corrupt cleanup evidence without deleting it", { skip: process.platform !== "linux" }, (t) => {
  const workspace = setup(t);
  const { intent, pending } = crash(workspace, "verified");
  const info = success(send(workspace, { command: "workspace.info" }));
  const recovery = { version: 2, command: "workspace.recovery.resume", args: { operationId: intent.operationId }, writeContext: info.writeContext, idempotencyKey: "historical-recovery" };
  const loader = path.join(workspace.directory, "kill-historical-recovery.mjs");
  writeFileSync(loader, `import {DatabaseSync} from 'node:sqlite';import {existsSync} from 'node:fs';const exec=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){const result=exec.call(this,sql);if(sql==='COMMIT'&&existsSync(${JSON.stringify(pending)}))process.kill(process.pid,'SIGKILL');return result;};`);
  assert.equal(run(workspace, recovery, loader).signal, "SIGKILL");
  const progress = path.join(v2LocalDomain(readV2RootDescriptor(workspace.root)), `copy-${intent.operationId}.progress.json`);
  writeFileSync(progress, "{");
  assert.equal(success(send(workspace, recovery)).result.outcome, "complete");
  assert.equal(existsSync(pending), true);
  assert.equal(readFileSync(progress, "utf8"), "{");
});
