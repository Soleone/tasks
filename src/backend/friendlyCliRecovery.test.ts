import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCopyTestWorkspace as setup } from "./copyTestWorkspace.js";
import type { CopyTestWorkspace as Workspace } from "./copyTestWorkspace.js";
import { readRootDescriptor } from "./canonicalReader.js";
import { pendingIntentPath } from "./localDomain.js";

const cli = fileURLToPath(new URL("./tasks-cli.js", import.meta.url));
const linux = { skip: process.platform !== "linux" };
const parent = "c8d4206d-c25a-4317-baa4-a2c5443060e9";
const original = ["add", "--title", "Private capture @literal", "--description", "Private **Markdown**", "--category", "WORK", "--tag", "TODO", "--actor-kind", "human", "--actor-label", "operator", "--json"];
function run(workspace: Workspace, argv: string[], loader?: string, profile = process.env.XDG_DATA_HOME) {
  return spawnSync(process.execPath, [...(loader ? ["--import", loader] : []), cli, "--v2-root", workspace.root, "--database", workspace.cache, ...argv], {
    env: { ...process.env, XDG_DATA_HOME: profile, TASKS_SYNC_ROOT: path.join(workspace.directory, "v1-trap"), TASKS_SOURCE_REGISTRY_PATH: path.join(workspace.directory, "v1-registry-trap") }, encoding: "utf8", timeout: 10_000,
  });
}
function ok(result: ReturnType<typeof run>) { assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout); }
function fail(result: ReturnType<typeof run>, code: string, status = 1) {
  assert.equal(result.status, status, result.stderr);assert.equal(result.stdout, "");
  const error = result.stderr.split("\n").find(line => line.startsWith('{"ok":false'));
  assert.ok(error, result.stderr);assert.equal(JSON.parse(error).error.code, code, result.stderr);
}
function metadata(result: ReturnType<typeof run>) {
  const line = result.stderr.split("\n").find(line => line.startsWith("tasks-cli retry: "));
  assert.ok(line, result.stderr);
  return JSON.parse(line.slice("tasks-cli retry: ".length)) as { writeContext: string; idempotencyKey: string; expectedVersion?: number; requestHash: string; rootPath: string; cachePath: string; profileDirectory: string };
}
function retained(result: ReturnType<typeof run>) {
  const value = metadata(result);
  return ["--write-context", value.writeContext, "--idempotency-key", value.idempotencyKey, "--request-hash", value.requestHash, ...(value.expectedVersion === undefined ? [] : ["--expected-version", String(value.expectedVersion)])];
}
function raw(workspace: Workspace) {
  return readdirSync(path.join(workspace.root, "tasks")).sort().map(name => [name, readFileSync(path.join(workspace.root, "tasks", name)).toString("base64")]);
}
function loaderFor(workspace: Workspace, cut: string): string {
  const loader = path.join(workspace.directory, `${cut}-loader.mjs`), pending = pendingIntentPath(readRootDescriptor(workspace.root));
  writeFileSync(loader, `import {registerHooks,syncBuiltinESMExports} from 'node:module';import fs from 'node:fs';import {DatabaseSync} from 'node:sqlite';
const cut=${JSON.stringify(cut)}, pending=${JSON.stringify(pending)}, cache=${JSON.stringify(workspace.cache)}, task=${JSON.stringify(path.join(workspace.root, "tasks", `${parent}.json`))};
if(cut==='beforeCommit'||cut==='afterCommit'){const exec=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){if(sql==='COMMIT'&&(fs.existsSync(pending)||globalThis.createStaged)&&cut==='beforeCommit')process.kill(process.pid,'SIGKILL');const result=exec.call(this,sql);if(sql==='COMMIT'&&(fs.existsSync(pending)||globalThis.createStaged)&&cut==='afterCommit')process.kill(process.pid,'SIGKILL');return result;};}
if(['metadata-failure','metadata-short','metadata-zero'].includes(cut)){const write=fs.writeSync;fs.writeSync=function(fd,buffer,offset,length){if(fd===2&&Buffer.isBuffer(buffer)&&buffer.toString().startsWith('tasks-cli retry: ')){if(cut==='metadata-failure')throw Object.assign(Error('private failing sink'),{code:'EIO'});if(cut==='metadata-zero')return 0;return write.call(this,fd,buffer,offset,Math.min(length,7));}return write.call(this,fd,buffer,offset,length);};syncBuiltinESMExports();}
registerHooks({load(url,context,next){const result=next(url,context);if(!result.source)return result;let source=result.source.toString();function replace(needle,value){if(source.split(needle).length!==2)throw Error('cut must be unique: '+needle);source=source.replace(needle,value);}
if(url.endsWith('/friendlyCli.js')){
 if(cut==='prepared')replace('const response = dispatch(invocation, request);','process.kill(process.pid,"SIGKILL");const response = dispatch(invocation, request);');
 if(cut==='lostReply')replace('printHumanResult(request.command, response, json);','process.kill(process.pid,"SIGKILL");');
 if(cut==='context-race')replace('const observed = query(invocation, "task.get", { id: request.args.id });','fs.rmSync(cache);const observed = query(invocation, "task.get", { id: request.args.id });');
 if(cut==='version-race')replace('reportRetry(invocation, request);','reportRetry(invocation, request);const changed=JSON.parse(fs.readFileSync(task,"utf8"));changed.title="External newer content";fs.writeFileSync(task,JSON.stringify(changed));');
 if(['context-race','version-race'].includes(cut))source='import fs from "node:fs";const cache='+JSON.stringify(cache)+',task='+JSON.stringify(task)+';'+source;
}
if(url.endsWith('/createWriter.js')){
 replace('writeDurableFile(stage, bytes);','writeDurableFile(stage, bytes);globalThis.createStaged=true;'+(cut==='stage-written'?'process.kill(process.pid,"SIGKILL");':''));
 if(cut==='published')replace('renameSync(stage, target);','renameSync(stage, target);process.kill(process.pid,"SIGKILL");');
}
return {...result,source};}});`);
  return loader;
}

for (const cut of ["prepared", "stage-written", "published", "beforeCommit", "afterCommit", "lostReply"]) {
  test(`actual human CLI SIGKILL at ${cut} retains original request, replays committed receipts and accepts pre-receipt duplicates`, linux, t => {
    const workspace = setup(t), before = raw(workspace), result = run(workspace, original, loaderFor(workspace, cut));
    assert.equal(result.signal, "SIGKILL", result.stderr);assert.equal(result.stdout, "");
    const retry = retained(result), recorded = metadata(result);
    assert.equal(recorded.rootPath, workspace.root);assert.equal(recorded.cachePath, workspace.cache);assert.match(recorded.profileDirectory, /tasks$/);
    assert.equal(result.stderr.includes("Private capture"), false);assert.equal(result.stderr.includes("Private **Markdown**"), false);
    const pending = pendingIntentPath(readRootDescriptor(workspace.root));
    if (cut === "prepared") assert.deepEqual(raw(workspace), before);
    assert.equal(existsSync(pending), false);
    const beforeRetry = raw(workspace), replay = run(workspace, [...original, ...retry]);
    const retried = ok(replay);
    if (["afterCommit", "lostReply"].includes(cut)) assert.deepEqual(raw(workspace), beforeRetry);
    if (cut === "stage-written") {
      const orphan = beforeRetry.find(([name]) => name.startsWith(".syncthing.taskdb-create-"))!;
      assert.equal(readFileSync(path.join(workspace.root, "tasks", orphan[0])).toString("base64"), orphan[1]);
    }
    const final = ok(run(workspace, [...original, ...retry]));
    assert.equal(final.task.title, "Private capture @literal");assert.equal(final.task.description, "Private **Markdown**");
    assert.deepEqual(final, retried);
    assert.equal(ok(run(workspace, ["list", "--json"])).total, ["published", "beforeCommit"].includes(cut) ? 6 : 5);
    const activity = ok(run(workspace, ["activity", "--json"])).activity;
    assert.equal(activity.length, 1);assert.equal(activity[0].operationId, final.operationId);assert.equal(activity[0].actor.label, "operator");
    for (const [name, bytes] of before) assert.equal(readFileSync(path.join(workspace.root, "tasks", name)).toString("base64"), bytes);
  });
}

for (const cut of ["metadata-failure", "metadata-zero", "metadata-short"]) {
  test(`human CLI ${cut} finishes retry reporting before canonical effects or refuses`, linux, t => {
    const workspace = setup(t), before = raw(workspace), result = run(workspace, original, loaderFor(workspace, cut));
    if (cut === "metadata-short") { const task = ok(result).task;assert.equal(metadata(result).idempotencyKey.length, 36);assert.equal(task.title, "Private capture @literal"); }
    else { fail(result, "INVALID_STORAGE");assert.deepEqual(raw(workspace), before);assert.equal(existsSync(pendingIntentPath(readRootDescriptor(workspace.root))), false); }
    assert.equal(result.stderr.includes("Private capture"), false);assert.equal(result.stderr.includes("Private **Markdown**"), false);
  });
}

test("human initial preparation refuses a context change between info and task lookup, not mixed authority", linux, t => {
  const workspace = setup(t), before = raw(workspace);
  const result = run(workspace, ["update", parent, "--title", "New", "--json"], loaderFor(workspace, "context-race"));
  fail(result, "STALE_WRITE_CONTEXT");assert.deepEqual(raw(workspace), before);assert.equal(result.stderr.includes("tasks-cli retry:"), false);
});

test("human initial preparation keeps its observed task version if a concurrent editor changes the file", linux, t => {
  const workspace = setup(t), result = run(workspace, ["update", parent, "--title", "Our edit", "--json"], loaderFor(workspace, "version-race"));
  fail(result, "STALE_TASK_VERSION", 3);assert.ok(metadata(result).expectedVersion);
  assert.equal(JSON.parse(readFileSync(path.join(workspace.root, "tasks", `${parent}.json`), "utf8")).title, "External newer content");
  assert.deepEqual(ok(run(workspace, ["activity", "--json"])).activity, []);
});

for (const change of ["profile", "root", "cache", "cache-copy", "payload", "actor", "flags", "placement"]) {
  test(`prepared CLI hash refuses a changed ${change} before any retry dispatch`, linux, t => {
    const workspace = setup(t), killed = run(workspace, original, loaderFor(workspace, "stage-written"));assert.equal(killed.signal, "SIGKILL", killed.stderr);
    const pending = pendingIntentPath(readRootDescriptor(workspace.root)), before = raw(workspace), changed = { ...workspace };
    let argv = [...original, ...retained(killed)], profile = process.env.XDG_DATA_HOME;
    if (change === "profile") profile = path.join(workspace.directory, "different-profile");
    if (change === "root") { changed.root = path.join(workspace.directory, "copied-root");cpSync(workspace.root, changed.root, { recursive: true }); }
    if (change === "cache" || change === "cache-copy") { changed.cache = path.join(workspace.directory, "different.db");if (change === "cache-copy") cpSync(workspace.cache, changed.cache); }
    if (change === "payload") argv = argv.map(word => word === "Private capture @literal" ? "Different payload" : word);
    if (change === "actor") argv = argv.map(word => word === "operator" ? "another" : word);
    if (change === "flags") argv.push("--dry-run");
    if (change === "placement") argv.push("--parent", parent);
    fail(run(changed, argv, undefined, profile), "IDEMPOTENCY_KEY_REUSED");
    assert.deepEqual(raw(workspace), before);assert.equal(existsSync(pending), false);
    if (change === "profile") assert.equal(existsSync(path.join(profile!, "tasks")), false);
    if (change === "cache") assert.equal(existsSync(changed.cache), false);
  });
}

test("human cache loss after unreceipted publication refuses old authority without adopting or recovering the task", linux, t => {
  const workspace = setup(t), killed = run(workspace, original, loaderFor(workspace, "published"));assert.equal(killed.signal, "SIGKILL", killed.stderr);
  const pending = pendingIntentPath(readRootDescriptor(workspace.root)), before = raw(workspace);
  assert.equal(existsSync(pending), false);
  rmSync(workspace.cache);
  fail(run(workspace, [...original, ...retained(killed)]), "STALE_WRITE_CONTEXT");assert.deepEqual(raw(workspace), before);
  const fresh = ok(run(workspace, ["info", "--json"]));assert.notEqual(fresh.writeContext, metadata(killed).writeContext);assert.equal(fresh.pendingOperationId, null);
  fail(run(workspace, ["recover", "unknown-create", "--json"]), "OPERATION_UNAVAILABLE");
  fail(run(workspace, [...original, ...retained(killed)]), "STALE_WRITE_CONTEXT");assert.equal(ok(run(workspace, ["list", "--json"])).total, 5);
  assert.deepEqual(ok(run(workspace, ["activity", "--json"])).activity, []);
});

for (const cut of ["prepared", "beforeCommit", "afterCommit", "lostReply"]) {
  test(`human existing-task ${cut} keeps original positive version after uncertain effects`, linux, t => {
    const workspace = setup(t), argv = ["update", parent, "--title", "Fixed literal @a", "--description", "Fixed Markdown", "--json"];
    const result = run(workspace, argv, loaderFor(workspace, cut));
    assert.equal(result.signal, "SIGKILL", result.stderr);assert.ok(metadata(result).expectedVersion);
    const pending = pendingIntentPath(readRootDescriptor(workspace.root));
    const intent = existsSync(pending) ? JSON.parse(readFileSync(pending, "utf8")) : undefined;
    if (intent) assert.equal(intent.request.args.expectedVersion, metadata(result).expectedVersion);
    const replay = run(workspace, [...argv, ...retained(result)]);
    if (cut === "beforeCommit") fail(replay, "RECOVERY_PENDING");else assert.equal(replay.status, 0, replay.stderr);
    if (intent) ok(run(workspace, ["recover", intent.operationId, "--json"]));
    const final = ok(run(workspace, [...argv, ...retained(result)]));
    assert.equal(final.task.title, "Fixed literal @a");assert.equal(final.task.description, "Fixed Markdown");
    if (intent) assert.equal(final.operationId, intent.operationId);
    assert.equal(ok(run(workspace, ["activity", "--json"])).activity.length, 1);
  });
}

test("human retained directory request hash rejects changed relative-path resolution before dispatch", linux, t => {
  const workspace = setup(t), firstDirectory = path.join(workspace.directory, "first"), laterDirectory = path.join(workspace.directory, "later");
  mkdirSync(firstDirectory);mkdirSync(laterDirectory);
  const command = [cli, "--v2-root", workspace.root, "--database", workspace.cache, "archive", "relative-target", "--json"];
  const killed = spawnSync(process.execPath, ["--import", loaderFor(workspace, "prepared"), ...command], { cwd: firstDirectory, env: process.env, encoding: "utf8" });
  assert.equal(killed.signal, "SIGKILL", killed.stderr);
  const retry = spawnSync(process.execPath, [...command, ...retained(killed)], { cwd: laterDirectory, env: process.env, encoding: "utf8" });
  fail(retry, "IDEMPOTENCY_KEY_REUSED");
  assert.equal(existsSync(path.join(firstDirectory, "relative-target")), false);assert.equal(existsSync(path.join(laterDirectory, "relative-target")), false);
});

test("client capability negotiation and replay use withheld-write refusal, not fabricated native acceptance", linux, t => {
  const workspace = setup(t), loader = path.join(workspace.directory, "withheld-loader.mjs"), before = raw(workspace);
  writeFileSync(loader, 'Object.defineProperty(process,"platform",{value:"darwin"});');
  fail(run(workspace, original, loader), "UNSUPPORTED_COMMAND");assert.deepEqual(raw(workspace), before);assert.equal(existsSync(pendingIntentPath(readRootDescriptor(workspace.root))), false);
});
