import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createV2CopyTestWorkspace as setup } from "./v2CopyTestWorkspace.js";
import type { V2CopyTestWorkspace as Workspace } from "./v2CopyTestWorkspace.js";
import { readV2RootDescriptor } from "./v2CanonicalReader.js";
import type { V2CreateIntent } from "./v2CreateJournal.js";
import { executeV2Line } from "./v2Gateway.js";
import { pendingV2Path, v2LocalDomain } from "./v2LocalDomain.js";
import type { V2Response } from "./v2Protocol.js";
import { V2_STATUS_COMMANDS } from "./v2TaskStatus.js";
import type { V2CanonicalTask } from "./v2TaskModel.js";

const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
const id = "c8d4206d-c25a-4317-baa4-a2c5443060e9";
const linuxOnly = { skip: process.platform !== "linux" };
function send(workspace: Workspace, envelope: object): V2Response { return executeV2Line(Buffer.from(JSON.stringify({ version: 2, ...envelope })), workspace.root, workspace.cache); }
function success(response: V2Response): Extract<V2Response, { ok: true }> {
  assert.equal(response.ok, true, JSON.stringify(response));
  if (!response.ok) throw Error("failed");
  return response;
}
function fail(response: V2Response, code: string) { assert.equal(response.ok, false); if (!response.ok) assert.equal(response.error.code, code, JSON.stringify(response)); }
function run(workspace: Workspace, request: object, loader?: string) {
  return spawnSync(process.execPath, [...(loader ? ["--import", loader] : []), cli, "--stdio", "--v2-root", workspace.root, "--database", workspace.cache], { input: JSON.stringify(request), env: process.env, encoding: "utf8", timeout: 10_000 });
}
function recover(workspace: Workspace, operationId: string, key = "resume") {
  const info = success(send(workspace, { command: "workspace.info" }));
  return send(workspace, { command: "workspace.recovery.resume", args: { operationId }, writeContext: info.writeContext, idempotencyKey: key });
}
function crashCreate(workspace: Workspace, cut: string) {
  const info = success(send(workspace, { command: "workspace.info" }));
  const request = { version: 2, command: "task.create", args: { text: "Fixed capture @Work #TODO", description: "Fixed\r\n**Markdown**" }, writeContext: info.writeContext, idempotencyKey: "original-capture" };
  const root = readV2RootDescriptor(workspace.root);
  const pending = pendingV2Path(root);
  const loader = path.join(workspace.directory, "capture-kill-loader.mjs");
  writeFileSync(loader, `import {registerHooks} from 'node:module';import {existsSync} from 'node:fs';import {DatabaseSync} from 'node:sqlite';
const cut=${JSON.stringify(cut)}, pending=${JSON.stringify(pending)};
if(cut==='beforeCommit'||cut==='afterCommit'){const exec=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){if(sql==='COMMIT'&&existsSync(pending)&&cut==='beforeCommit')process.kill(process.pid,'SIGKILL');const result=exec.call(this,sql);if(sql==='COMMIT'&&existsSync(pending)&&cut==='afterCommit')process.kill(process.pid,'SIGKILL');return result;};}
registerHooks({load(url,context,next){const result=next(url,context);if(!result.source)return result;let source=result.source.toString();
function replace(needle,value){if(source.split(needle).length!==2)throw Error('cut must be unique: '+needle);source=source.replace(needle,value);}
if(cut==='intent'&&url.endsWith('/v2CreateWriter.js')){const n='persistV2Pending(root, intent);';replace(n,n+'process.kill(process.pid,"SIGKILL");');}
if(url.endsWith('/v2CreateJournal.js')){
 if(['stage-bound','publication-started','verified'].includes(cut)){source='let records=0;'+source;const n='syncV2Directory(v2LocalDomain(intent.root));';const at=source.indexOf(n);if(at<0)throw Error('missing progress');source=source.slice(0,at)+n+'if(++records==='+(['stage-bound','publication-started','verified'].indexOf(cut)+1)+')process.kill(process.pid,"SIGKILL");'+source.slice(at+n.length);}
 for(const [at,needle] of [['stage-written','writeV2DurableFile(stage, Buffer.from(intent.nextBytes, "base64"));'],['published','linkSync(stage, targetPath(intent));'],['retiring-stage','unlinkSync(stage);'],['retiring-evidence','unlinkSync(progressPath(intent));']])if(cut===at)replace(needle,needle+'process.kill(process.pid,"SIGKILL");');
 if(cut==='progress-preparing'){const n='renameSync(\x60\x24{file}.preparing\x60, file);';replace(n,'process.kill(process.pid,"SIGKILL");'+n);}
}
return {...result,source};}});`);
  const child = run(workspace, request, loader);
  assert.equal(child.signal, "SIGKILL", child.stderr);
  assert.equal(existsSync(pending), true);
  const intent = JSON.parse(readFileSync(pending, "utf8")) as V2CreateIntent;
  const progress = path.join(v2LocalDomain(root), `create-${intent.operationId}.progress.json`);
  const stage = path.join(root.rootPath, "tasks", `.syncthing.taskdb-create-${intent.operationId}.tmp`);
  return { request, pending, intent, progress, stage, target: path.join(root.rootPath, "tasks", `${intent.taskId}.json`) };
}

for (const cut of ["intent", "stage-written", "stage-bound", "published", "verified", "beforeCommit", "afterCommit", "retiring-stage", "retiring-evidence"]) {
  test(`capture CLI SIGKILL at ${cut} resumes one fixed UUID/time/key/result`, linuxOnly, (t) => {
    const workspace = setup(t);
    const before = readdirSync(path.join(workspace.root, "tasks")).sort().map(name => [name, readFileSync(path.join(workspace.root, "tasks", name)).toString("base64")]);
    const { request, pending, intent, target } = crashCreate(workspace, cut);
    const info = success(send(workspace, { command: "workspace.info" }));
    assert.equal(info.result.state, "recovery_pending");
    assert.equal(info.result.pendingOperationId, intent.operationId);
    fail(send(workspace, { command: "task.list" }), "RECOVERY_PENDING");
    const retry = send(workspace, request);
    if (["afterCommit", "retiring-stage", "retiring-evidence"].includes(cut)) success(retry); else fail(retry, "RECOVERY_PENDING");
    const resumed = success(recover(workspace, intent.operationId));
    assert.equal(resumed.result.outcome, "complete");
    assert.equal(existsSync(pending), false);
    assert.equal(readFileSync(target).toString("base64"), intent.nextBytes);
    for (const [name, bytes] of before) assert.equal(readFileSync(path.join(workspace.root, "tasks", name)).toString("base64"), bytes);
    const child = run(workspace, request);
    assert.equal(child.status, 0, child.stderr);
    const replay = success(JSON.parse(child.stdout));
    assert.deepEqual(replay.result, resumed.result.originalResult);
    const task = replay.result.task as V2CanonicalTask;
    assert.equal(task.id, intent.taskId);
    assert.equal(task.createdAt, intent.at);
    assert.equal(task.updatedAt, intent.at);
    assert.equal(replay.result.operationId, intent.operationId);
    const rows = success(send(workspace, { command: "activity.list" })).result.activity as { before: unknown; command: string; createdAt: string }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].before, null);
    assert.equal(rows[0].command, "task.create");
    assert.equal(rows[0].createdAt, intent.at);
    assert.equal((success(send(workspace, { command: "task.list" })).result.tasks as object[]).length, 5);
  });
}

test("already-linked capture recovery must flush publication before receipt or evidence retirement", linuxOnly, t => {
  const workspace = setup(t);
  const { request, pending, intent, progress, stage, target } = crashCreate(workspace, "published");
  const pendingBytes = readFileSync(pending), progressBytes = readFileSync(progress), targetBytes = readFileSync(target);
  const loader = path.join(workspace.directory, "capture-flush-refusal.mjs");
  writeFileSync(loader, `import {registerHooks} from 'node:module';registerHooks({load(url,context,next){const result=next(url,context);
if(!url.endsWith('/v2CreateJournal.js'))return result;let source=result.source.toString();
const needle='syncV2Directory(path.dirname(stage));\\n        const snapshot = guardCreate(intent, progress);';
if(source.split(needle).length!==2)throw Error('unique publication flush required');
return {...result,source:source.replace(needle,'throw Object.assign(new Error("test-only capture directory flush refusal"),{code:"EPERM"});'+needle)};}});`);
  const recovery = { version: 2, command: "workspace.recovery.resume", args: { operationId: intent.operationId }, writeContext: intent.request.writeContext, idempotencyKey: "capture-flush-resume" };
  const child = run(workspace, recovery, loader);
  assert.equal(child.status, 0, child.stderr);
  fail(JSON.parse(child.stdout), "RECOVERY_CONFLICT");
  assert.deepEqual(readFileSync(pending), pendingBytes);
  assert.deepEqual(readFileSync(progress), progressBytes);
  assert.deepEqual(readFileSync(target), targetBytes);
  assert.equal(existsSync(stage), true);
  const database = new DatabaseSync(workspace.cache);
  assert.equal(database.prepare("SELECT count(*) AS n FROM v2_receipts").get()!.n, 0);
  assert.equal(database.prepare("SELECT count(*) AS n FROM v2_operations").get()!.n, 0);
  database.close();
  success(send(workspace, recovery));
  success(send(workspace, request));
  assert.equal(existsSync(pending), false);
  assert.deepEqual(readFileSync(target), targetBytes);
});

for (const cut of ["publication-started", "progress-preparing"]) {
  test(`capture ${cut} preserves uncertain absence/evidence instead of recreating or adopting`, linuxOnly, (t) => {
    const workspace = setup(t);
    const { pending, intent, target } = crashCreate(workspace, cut);
    fail(recover(workspace, intent.operationId), "RECOVERY_CONFLICT");
    assert.equal(existsSync(pending), true);
    assert.equal(existsSync(target), false);
  });
}

for (const fault of ["other-edit", "arrival", "conflict-arrival", "task-directory", "stage-partial", "stage-edit", "stage-missing", "stage-replaced", "target-arrival", "target-same-bytes", "target-missing", "target-missing-before-progress", "target-edit", "target-replaced", "progress-missing", "progress-partial", "intent-payload", "intent-key", "different-cache", "copied-cache"]) {
  test(`capture recovery preserves and refuses ${fault}`, linuxOnly, (t) => {
    const workspace = setup(t);
    const cut = fault === "target-missing-before-progress" ? "published" : fault.startsWith("target-") && !["target-arrival", "target-same-bytes"].includes(fault) ? "verified" : "stage-bound";
    const { pending, intent, progress, stage, target } = crashCreate(workspace, cut);
    if (fault === "other-edit") writeFileSync(path.join(workspace.root, "tasks", `${id}.json`), `${readFileSync(path.join(workspace.root, "tasks", `${id}.json`), "utf8")} `);
    if (fault === "arrival") writeFileSync(path.join(workspace.root, "tasks/late.json"), "preserve late record");
    if (fault === "conflict-arrival") writeFileSync(path.join(workspace.root, "tasks", `${id}.sync-conflict-external.json`), "preserve conflict bytes");
    if (fault === "task-directory") { renameSync(path.join(workspace.root, "tasks"), path.join(workspace.directory, "kept-tasks")); cpSync(path.join(workspace.directory, "kept-tasks"), path.join(workspace.root, "tasks"), { recursive: true }); }
    if (fault === "stage-partial" || fault === "stage-edit") writeFileSync(stage, fault === "stage-partial" ? "{" : JSON.stringify({ ...JSON.parse(Buffer.from(intent.nextBytes, "base64").toString()), title: "preserve external edit" }));
    if (fault === "stage-missing") rmSync(stage);
    if (fault === "stage-replaced") { renameSync(stage, path.join(workspace.directory, "kept-stage")); writeFileSync(stage, Buffer.from(intent.nextBytes, "base64")); }
    if (fault === "target-arrival") writeFileSync(target, "preserve arriving bytes");
    if (fault === "target-same-bytes") writeFileSync(target, Buffer.from(intent.nextBytes, "base64"));
    if (fault === "target-missing" || fault === "target-missing-before-progress") rmSync(target);
    if (fault === "target-edit") writeFileSync(target, JSON.stringify({ ...JSON.parse(readFileSync(target, "utf8")), title: "preserve external edit" }));
    if (fault === "target-replaced") { rmSync(target); writeFileSync(target, Buffer.from(intent.nextBytes, "base64")); }
    if (fault === "progress-missing") rmSync(progress);
    if (fault === "progress-partial") writeFileSync(progress, "{");
    if (fault === "intent-payload" || fault === "intent-key") {
      const value = JSON.parse(readFileSync(pending, "utf8"));
      if (fault === "intent-payload") value.request.args.text = "Changed intent";
      else value.nextBytes = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(value.nextBytes, "base64").toString()), orderKey: "a5" })).toString("base64");
      writeFileSync(pending, JSON.stringify(value));
    }
    let selected = workspace;
    if (fault === "different-cache" || fault === "copied-cache") { const cache = path.join(workspace.directory, "other.db"); if (fault === "copied-cache") cpSync(workspace.cache, cache); selected = { ...workspace, cache }; }
    const bytes = existsSync(target) ? readFileSync(target) : null;
    fail(recover(selected, intent.operationId), "RECOVERY_CONFLICT");
    assert.equal(existsSync(pending), true);
    assert.deepEqual(existsSync(target) ? readFileSync(target) : null, bytes);
  });
}

test("capture cache loss permits explicit original-location journal recovery, never original-context retry", linuxOnly, (t) => {
  const workspace = setup(t);
  const { request, intent, target } = crashCreate(workspace, "published");
  rmSync(workspace.cache);
  const info = success(send(workspace, { command: "workspace.info" }));
  assert.notEqual(info.writeContext, request.writeContext);
  fail(send(workspace, request), "STALE_WRITE_CONTEXT");
  success(recover(workspace, intent.operationId));
  assert.equal(readFileSync(target).toString("base64"), intent.nextBytes);
  fail(send(workspace, request), "STALE_WRITE_CONTEXT");
});

test("capture recovery's own lost reply and corrupt cleanup remain safely historical", linuxOnly, (t) => {
  const workspace = setup(t);
  const { pending, intent, progress } = crashCreate(workspace, "published");
  const info = success(send(workspace, { command: "workspace.info" }));
  const request = { version: 2, command: "workspace.recovery.resume", args: { operationId: intent.operationId }, writeContext: info.writeContext, idempotencyKey: "resume-lost" };
  const loader = path.join(workspace.directory, "recovery-kill-loader.mjs");
  writeFileSync(loader, `import {DatabaseSync} from 'node:sqlite';import {existsSync} from 'node:fs';const exec=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){const result=exec.call(this,sql);if(sql==='COMMIT'&&existsSync(${JSON.stringify(pending)}))process.kill(process.pid,'SIGKILL');return result;};`);
  assert.equal(run(workspace, request, loader).signal, "SIGKILL");
  const keptProgress = readFileSync(progress);
  writeFileSync(progress, "{");
  const historical = success(send(workspace, request));
  assert.equal(historical.result.outcome, "complete");
  assert.equal(existsSync(pending), true);
  writeFileSync(progress, keptProgress);
  assert.deepEqual(success(send(workspace, request)).result, historical.result);
  assert.equal(existsSync(pending), false);
});

test("capture publication never overwrites an ID arriving after the final guard", linuxOnly, (t) => {
  const workspace = setup(t);
  const info = success(send(workspace, { command: "workspace.info" }));
  const loader = path.join(workspace.directory, "capture-race-loader.mjs");
  writeFileSync(loader, `import {registerHooks} from 'node:module';registerHooks({load(url,context,next){const result=next(url,context);if(!url.endsWith('/v2CreateJournal.js'))return result;let source=result.source.toString();const n='linkSync(stage, targetPath(intent));';if(source.split(n).length!==2)throw Error('unique publication required');source='import {writeFileSync as faultWrite} from "node:fs";'+source.replace(n,'faultWrite(targetPath(intent), "preserve arriving task");'+n);return {...result,source};}});`);
  const child = run(workspace, { version: 2, command: "task.create", args: { title: "New" }, writeContext: info.writeContext, idempotencyKey: "late-collision" }, loader);
  assert.equal(child.status, 0, child.stderr);
  fail(JSON.parse(child.stdout), "RECOVERY_CONFLICT");
  const pending = pendingV2Path(readV2RootDescriptor(workspace.root));
  const intent = JSON.parse(readFileSync(pending, "utf8")) as V2CreateIntent;
  assert.equal(readFileSync(path.join(workspace.root, "tasks", `${intent.taskId}.json`), "utf8"), "preserve arriving task");
  fail(recover(workspace, intent.operationId), "RECOVERY_CONFLICT");
});

for (const command of V2_STATUS_COMMANDS) for (const cut of ["intent", "replaced", "beforeCommit", "afterCommit"]) {
  test(`${command} CLI SIGKILL ${cut} retains fixed status/closure and one activity group`, linuxOnly, (t) => {
    const workspace = setup(t);
    const taskId = command === "task.reopen" ? "62f159c1-22a7-45cb-89a0-c0c35aaeb1ed" : command === "task.delete" ? "f3e5499b-402e-4d7d-8b61-eefc4409ca32" : id;
    const read = success(send(workspace, { command: "task.get", args: { id: taskId } }));
    const before = read.result.task as V2CanonicalTask & { version: number };
    const request = { version: 2, command, args: { id: taskId, expectedVersion: before.version }, writeContext: read.writeContext, idempotencyKey: "original-status" };
    const pending = pendingV2Path(readV2RootDescriptor(workspace.root));
    const loader = path.join(workspace.directory, "status-kill-loader.mjs");
    writeFileSync(loader, `import {registerHooks} from 'node:module';import {existsSync} from 'node:fs';import {DatabaseSync} from 'node:sqlite';const cut=${JSON.stringify(cut)},pending=${JSON.stringify(pending)};
if(cut==='beforeCommit'||cut==='afterCommit'){const exec=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){if(sql==='COMMIT'&&existsSync(pending)&&cut==='beforeCommit')process.kill(process.pid,'SIGKILL');const result=exec.call(this,sql);if(sql==='COMMIT'&&existsSync(pending)&&cut==='afterCommit')process.kill(process.pid,'SIGKILL');return result;};}
registerHooks({load(url,context,next){const result=next(url,context);if(!result.source)return result;let source=result.source.toString();const module=cut==='intent'?'v2UpdateWriter.js':cut==='replaced'?'v2UpdateJournal.js':'';if(!url.endsWith('/'+module))return result;const n=cut==='intent'?'persistV2Pending(root, intent);':'renameSync(temporary, target);';if(source.split(n).length!==2)throw Error('unique status cut required');return {...result,source:source.replace(n,n+'process.kill(process.pid,"SIGKILL");')};}});`);
    const child = run(workspace, request, loader);
    assert.equal(child.signal, "SIGKILL", child.stderr);
    const intent = JSON.parse(readFileSync(pending, "utf8"));
    const retry = send(workspace, request);
    if (cut === "afterCommit") success(retry); else fail(retry, "RECOVERY_PENDING");
    const resumed = success(recover(workspace, intent.operationId));
    const replay = success(send(workspace, request));
    assert.deepEqual(replay.result, resumed.result.originalResult);
    const task = replay.result.task as V2CanonicalTask;
    assert.equal(task.updatedAt, before.updatedAt);
    assert.equal(task.createdAt, before.createdAt);
    assert.equal(task.closedAt, task.status === "done" || task.status === "canceled" ? intent.at : null);
    assert.equal(task.orderKey, before.orderKey);
    const rows = success(send(workspace, { command: "activity.list" })).result.activity as { command: string; createdAt: string }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].command, command);
    assert.equal(rows[0].createdAt, intent.at);
    assert.equal(existsSync(pending), false);
  });
}

for (const collision of ["canonical", "conflict"]) {
  test(`capture refuses generated-ID ${collision} collision before staging instead of silently replacing it`, linuxOnly, (t) => {
    const workspace = setup(t);
    const collisionId = "62f159c1-22a7-45cb-89a0-c0c35aaeb1ed";
    if (collision === "conflict") {
      rmSync(path.join(workspace.root, "tasks", `${collisionId}.json`));
      writeFileSync(path.join(workspace.root, "tasks", `${collisionId}.sync-conflict-peer.json`), "preserve raw conflict bytes");
    }
    const info = success(send(workspace, { command: "workspace.info" }));
    const before = readdirSync(path.join(workspace.root, "tasks")).sort().map(name => [name, readFileSync(path.join(workspace.root, "tasks", name)).toString("base64")]);
    const loader = path.join(workspace.directory, "capture-collision-loader.mjs");
    writeFileSync(loader, `import {registerHooks} from 'node:module';registerHooks({load(url,context,next){const result=next(url,context);if(!url.endsWith('/v2CreateWriter.js'))return result;const source=result.source.toString(),n='const taskId = randomUUID();';if(source.split(n).length!==2)throw Error('unique allocation required');return {...result,source:source.replace(n,'const taskId = '+${JSON.stringify(JSON.stringify(collisionId))}+';')};}});`);
    const request = { version: 2, command: "task.create", args: { title: "New" }, writeContext: info.writeContext, idempotencyKey: "colliding-plan" };
    const child = run(workspace, request, loader);
    assert.equal(child.status, 0, child.stderr);
    fail(JSON.parse(child.stdout), "STALE_SCOPE");
    assert.deepEqual(readdirSync(path.join(workspace.root, "tasks")).sort().map(name => [name, readFileSync(path.join(workspace.root, "tasks", name)).toString("base64")]), before);
    assert.equal(existsSync(pendingV2Path(readV2RootDescriptor(workspace.root))), false);
    const explicit = run(workspace, { ...request, idempotencyKey: "explicit-new-plan" });
    assert.equal(explicit.status, 0, explicit.stderr);
    success(JSON.parse(explicit.stdout));
  });
}

for (const fault of ["source-bytes", "source-arrival"]) {
  test(`capture pre-intent ${fault} leaves zero canonical effects, pending or progress`, linuxOnly, (t) => {
    const workspace = setup(t);
    const info = success(send(workspace, { command: "workspace.info" }));
    const loader = path.join(workspace.directory, "capture-preflight-loader.mjs");
    const file = path.join(workspace.root, "tasks", `${id}.json`);
    const mutation = fault === "source-bytes" ? `faultAppend(${JSON.stringify(file)}, ' ');` : `faultWrite(${JSON.stringify(path.join(workspace.root, "tasks/late.json"))}, JSON.stringify({...JSON.parse(faultRead(${JSON.stringify(file)}, 'utf8')),id:'late',parentId:null}));`;
    writeFileSync(loader, `import {registerHooks} from 'node:module';registerHooks({load(url,context,next){const result=next(url,context);if(!url.endsWith('/v2CreateWriter.js'))return result;let source=result.source.toString(),n='guardCopySource(snapshot);',at=source.lastIndexOf(n);if(at<0)throw Error('missing preflight');source='import {appendFileSync as faultAppend,writeFileSync as faultWrite,readFileSync as faultRead} from "node:fs";'+source.slice(0,at)+${JSON.stringify(mutation)}+source.slice(at);return {...result,source};}});`);
    const child = run(workspace, { version: 2, command: "task.create", args: { title: "New" }, writeContext: info.writeContext, idempotencyKey: "preflight" }, loader);
    assert.equal(child.status, 0, child.stderr);
    fail(JSON.parse(child.stdout), fault === "source-bytes" ? "STALE_FILE" : "STALE_SCOPE");
    const root = readV2RootDescriptor(workspace.root);
    assert.equal(existsSync(pendingV2Path(root)), false);
    assert.equal(readdirSync(v2LocalDomain(root)).some(name => name.startsWith("create-")), false);
    assert.equal(readdirSync(path.join(workspace.root, "tasks")).some(name => name.startsWith(".syncthing.taskdb-create-")), false);
  });
}

for (const fault of ["missing-target", "divergent-target", "invalid-at", "wrong-next-time"]) {
  test(`status recovery preserves and refuses ${fault} rather than refreshing closure or resurrecting`, linuxOnly, (t) => {
    const workspace = setup(t);
    const read = success(send(workspace, { command: "task.get", args: { id } }));
    const pending = pendingV2Path(readV2RootDescriptor(workspace.root));
    const request = { version: 2, command: "task.complete", args: { id, expectedVersion: (read.result.task as { version: number }).version }, writeContext: read.writeContext, idempotencyKey: "fixed-complete" };
    const loader = path.join(workspace.directory, "status-evidence-loader.mjs");
    writeFileSync(loader, `import {registerHooks} from 'node:module';registerHooks({load(url,context,next){const result=next(url,context);if(!url.endsWith('/v2UpdateWriter.js'))return result;const source=result.source.toString(),n='persistV2Pending(root, intent);';if(source.split(n).length!==2)throw Error('unique intent cut required');return {...result,source:source.replace(n,n+'process.kill(process.pid,"SIGKILL");')};}});`);
    assert.equal(run(workspace, request, loader).signal, "SIGKILL");
    const intent = JSON.parse(readFileSync(pending, "utf8"));
    const target = path.join(workspace.root, "tasks", `${id}.json`);
    if (fault === "missing-target") rmSync(target);
    if (fault === "divergent-target") writeFileSync(target, JSON.stringify({ ...JSON.parse(readFileSync(target, "utf8")), title: "Preserve external title" }));
    if (fault === "invalid-at") { intent.at = "not an instant"; writeFileSync(pending, JSON.stringify(intent)); }
    if (fault === "wrong-next-time") { const next = JSON.parse(Buffer.from(intent.nextBytes, "base64").toString()); next.updatedAt = intent.at; intent.nextBytes = Buffer.from(JSON.stringify(next)).toString("base64"); writeFileSync(pending, JSON.stringify(intent)); }
    const before = existsSync(target) ? readFileSync(target) : null;
    fail(recover(workspace, intent.operationId), "RECOVERY_CONFLICT");
    assert.equal(existsSync(pending), true);
    assert.deepEqual(existsSync(target) ? readFileSync(target) : null, before);
  });
}
