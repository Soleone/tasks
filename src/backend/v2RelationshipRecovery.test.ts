import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { TestContext } from "node:test";
import { createV2CopyTestWorkspace as setup } from "./v2CopyTestWorkspace.js";
import type { V2CopyTestWorkspace as Workspace } from "./v2CopyTestWorkspace.js";
import { readV2RootDescriptor } from "./v2CanonicalReader.js";
import { executeV2Line } from "./v2Gateway.js";
import { pendingV2Path } from "./v2LocalDomain.js";
import type { V2Response } from "./v2Protocol.js";
import type { V2CanonicalTask } from "./v2TaskModel.js";
import { V2_RELATIONSHIP_COMMANDS } from "./v2TaskRelationships.js";
import type { V2UpdateIntent } from "./v2UpdateJournal.js";

const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
const template = JSON.parse(readFileSync(fileURLToPath(new URL("../../scripts/fixtures/taskdb-v2/cases.json", import.meta.url)), "utf8")).taskTemplate as V2CanonicalTask;
const linuxOnly = { skip: process.platform !== "linux" };
type Projection = V2CanonicalTask & { version: number };
function send(workspace: Workspace, envelope: object): V2Response { return executeV2Line(Buffer.from(JSON.stringify({ version: 2, ...envelope })), workspace.root, workspace.cache); }
function success(response: V2Response): Extract<V2Response, { ok: true }> {
  assert.equal(response.ok, true, JSON.stringify(response));
  if (!response.ok) throw Error("failed");
  return response;
}
function fail(response: V2Response, code: string) { assert.equal(response.ok, false); if (!response.ok) assert.equal(response.error.code, code, JSON.stringify(response)); }
function makeTask(workspace: Workspace, id: string, patch: Partial<V2CanonicalTask> = {}) {
  writeFileSync(path.join(workspace.root, "tasks", `${id}.json`), JSON.stringify({ ...template, ...patch, id }));
}
function materialize(t: TestContext) {
  const workspace = setup(t);
  for (const file of readdirSync(path.join(workspace.root, "tasks"))) rmSync(path.join(workspace.root, "tasks", file));
  for (const [id, patch] of Object.entries({ a: { parentId: "old", dependencyIds: ["d"], status: "done", closedAt: "2026-09-08T14:00:00.000Z" }, old: {}, next: { orderKey: "a1" }, d: {}, blocker: { status: "done", closedAt: "2026-09-08T14:00:00.000Z" }, leaf: { parentId: "a" }, oldSibling: { parentId: "old", orderKey: "a1" }, hidden: { parentId: "next", status: "canceled", closedAt: "2026-09-08T14:00:00.000Z" }, tie: { parentId: "next", status: "paused" } }) as [string, Partial<V2CanonicalTask>][]) makeTask(workspace, id, patch);
  return workspace;
}
function bytes(workspace: Workspace) { return readdirSync(path.join(workspace.root, "tasks")).sort().map(file => [file, readFileSync(path.join(workspace.root, "tasks", file)).toString("base64")]); }
function prepare(workspace: Workspace, command = "task.move") {
  const info = success(send(workspace, { command: "workspace.info" }));
  const task = success(send(workspace, { command: "task.get", args: { id: "a" } })).result.task as Projection;
  return { version: 2, command, writeContext: info.writeContext, idempotencyKey: "fixed-relationship", actor: { kind: "human", label: "relationship test" }, args: { id: "a", expectedVersion: task.version, ...(command === "task.move" ? { parentId: "next" } : { dependsOnId: command === "task.dependency.add" ? "blocker" : "d" }) } };
}
function run(workspace: Workspace, request: object, loader?: string) {
  return spawnSync(process.execPath, [...(loader ? ["--import", loader] : []), cli, "--stdio", "--v2-root", workspace.root, "--database", workspace.cache], { input: JSON.stringify(request), env: process.env, encoding: "utf8", timeout: 10_000 });
}
function recover(workspace: Workspace, operationId: string, key = "resume") {
  const info = success(send(workspace, { command: "workspace.info" }));
  return send(workspace, { command: "workspace.recovery.resume", writeContext: info.writeContext, idempotencyKey: key, args: { operationId } });
}
function crash(workspace: Workspace, command: string, cut: string) {
  const request = prepare(workspace, command);
  const pending = pendingV2Path(readV2RootDescriptor(workspace.root));
  const loader = path.join(workspace.directory, "relationship-kill-loader.mjs");
  writeFileSync(loader, `import {registerHooks} from 'node:module';import {existsSync} from 'node:fs';import {DatabaseSync} from 'node:sqlite';const cut=${JSON.stringify(cut)},pending=${JSON.stringify(pending)};
if(cut==='beforeCommit'||cut==='afterCommit'){const exec=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){if(sql==='COMMIT'&&existsSync(pending)&&cut==='beforeCommit')process.kill(process.pid,'SIGKILL');const result=exec.call(this,sql);if(sql==='COMMIT'&&existsSync(pending)&&cut==='afterCommit')process.kill(process.pid,'SIGKILL');return result;};}
registerHooks({load(url,context,next){const result=next(url,context);if(!result.source)return result;let source=result.source.toString();
for(const [at,module,needle] of [['intent','v2UpdateWriter.js','persistV2Pending(root, intent);'],['staged','v2UpdateJournal.js','writeV2DurableFile(temporary, bytes);'],['replaced','v2UpdateJournal.js','renameSync(temporary, target);'],['retired','v2LocalDomain.js','unlinkSync(pendingV2Path(root));']]){if(cut===at&&url.endsWith('/'+module)){if(source.split(needle).length!==2)throw Error('unique relationship cut required');source=source.replace(needle,needle+'process.kill(process.pid,"SIGKILL");');}}
return {...result,source};}});`);
  const child = run(workspace, request, loader);
  assert.equal(child.signal, "SIGKILL", child.stderr);
  const intent = existsSync(pending) ? JSON.parse(readFileSync(pending, "utf8")) as V2UpdateIntent : undefined;
  return { request, pending, intent };
}

for (const command of V2_RELATIONSHIP_COMMANDS) for (const cut of ["intent", "staged", "replaced", "beforeCommit", "afterCommit", "retired"]) {
  test(`${command} actual CLI SIGKILL ${cut} preserves graph/scopes/key/time/closure and one activity group`, linuxOnly, (t) => {
    const workspace = materialize(t);
    const before = bytes(workspace);
    const { request, pending, intent } = crash(workspace, command, cut);
    const retry = send(workspace, request);
    if (["afterCommit", "retired"].includes(cut)) success(retry); else fail(retry, "RECOVERY_PENDING");
    if (cut !== "retired") {
      assert.equal(success(send(workspace, { command: "workspace.info" })).result.pendingOperationId, intent!.operationId);
      fail(send(workspace, { command: "task.list" }), "RECOVERY_PENDING");
      const resumed = success(recover(workspace, intent!.operationId));
      assert.equal(resumed.result.outcome, "complete");
      assert.deepEqual(success(send(workspace, request)).result, resumed.result.originalResult);
    }
    const child = run(workspace, request);
    assert.equal(child.status, 0, child.stderr);
    const replay = success(JSON.parse(child.stdout));
    const task = replay.result.task as Projection;
    assert.equal(task.createdAt, template.createdAt);
    assert.equal(task.closedAt, "2026-09-08T14:00:00.000Z");
    assert.equal(task.status, "done");
    assert.equal(task.parentId, command === "task.move" ? "next" : "old");
    assert.equal(task.orderKey, command === "task.move" ? "Zz" : "a0");
    assert.deepEqual(task.dependencyIds, command === "task.dependency.add" ? ["blocker", "d"] : command === "task.dependency.remove" ? [] : ["d"]);
    for (const [file, raw] of before.filter(([file]) => file !== "a.json")) assert.equal(readFileSync(path.join(workspace.root, "tasks", file)).toString("base64"), raw);
    const rows = success(send(workspace, { command: "activity.list" })).result.activity as { command: string; createdAt: string; actor: object }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].command, command);
    assert.deepEqual(rows[0].actor, request.actor);
    assert.equal(task.updatedAt, rows[0].createdAt);
    if (intent) { assert.equal(task.updatedAt, intent.at); assert.equal(readFileSync(path.join(workspace.root, "tasks/a.json")).toString("base64"), intent.nextBytes); }
    assert.equal(existsSync(pending), false);
  });
}

for (const fault of ["old-arrival", "new-arrival", "old-formatting", "new-formatting", "old-delete", "new-delete", "new-key", "target-canceled", "descendant-change", "blocker-status", "missing-selected", "divergent-selected", "conflict-arrival", "stage-partial", "intent-key", "intent-time", "intent-closure", "intent-parent", "different-cache", "copied-cache"]) {
  test(`relationship recovery refuses and preserves ${fault} rather than replan/reallocate/resurrect`, linuxOnly, (t) => {
    const workspace = materialize(t);
    const { pending, intent: captured } = crash(workspace, "task.move", fault === "stage-partial" ? "staged" : fault === "intent-key" ? "intent" : "replaced");
    const intent = captured!;
    if (fault === "old-arrival" || fault === "new-arrival") makeTask(workspace, "arrival", { parentId: fault === "old-arrival" ? "old" : "next" });
    if (fault === "old-formatting" || fault === "new-formatting") { const file = path.join(workspace.root, "tasks", fault === "old-formatting" ? "oldSibling.json" : "hidden.json"); writeFileSync(file, `${readFileSync(file, "utf8")} `); }
    if (fault === "old-delete" || fault === "new-delete") rmSync(path.join(workspace.root, "tasks", fault === "old-delete" ? "oldSibling.json" : "hidden.json"));
    if (fault === "new-key") makeTask(workspace, "hidden", { parentId: "next", status: "canceled", closedAt: "2026-09-08T14:00:00.000Z", orderKey: "Zz" });
    if (fault === "target-canceled") makeTask(workspace, "next", { orderKey: "a1", status: "canceled", closedAt: "2026-09-08T14:00:00.000Z" });
    if (fault === "descendant-change") makeTask(workspace, "leaf", { parentId: "old" });
    if (fault === "blocker-status") makeTask(workspace, "d", { status: "done", closedAt: "2026-09-08T14:00:00.000Z" });
    if (fault === "missing-selected") rmSync(path.join(workspace.root, "tasks/a.json"));
    if (fault === "divergent-selected") writeFileSync(path.join(workspace.root, "tasks/a.json"), JSON.stringify({ ...JSON.parse(readFileSync(path.join(workspace.root, "tasks/a.json"), "utf8")), title: "Preserve external title" }));
    if (fault === "conflict-arrival") writeFileSync(path.join(workspace.root, "tasks/a.sync-conflict-peer.json"), "preserve conflict bytes");
    if (fault === "stage-partial") writeFileSync(path.join(workspace.root, "tasks", `.syncthing.taskdb-${intent.operationId}.tmp`), "{");
    if (fault.startsWith("intent-")) {
      const value = JSON.parse(readFileSync(pending, "utf8"));
      const next = JSON.parse(Buffer.from(value.nextBytes, "base64").toString());
      if (fault === "intent-key") next.orderKey = "a4";
      if (fault === "intent-time") value.at = "2020-01-01T00:00:00.000Z";
      if (fault === "intent-closure") next.closedAt = value.at;
      if (fault === "intent-parent") next.parentId = "leaf";
      value.nextBytes = Buffer.from(JSON.stringify(next)).toString("base64");
      writeFileSync(pending, JSON.stringify(value));
    }
    let selected = workspace;
    if (fault === "different-cache" || fault === "copied-cache") { const cache = path.join(workspace.directory, "different.db"); if (fault === "copied-cache") cpSync(workspace.cache, cache); selected = { ...workspace, cache }; }
    const raw = bytes(workspace);
    fail(recover(selected, intent.operationId), "RECOVERY_CONFLICT");
    assert.deepEqual(bytes(workspace), raw);
    assert.equal(existsSync(pending), true);
  });
}

for (const command of V2_RELATIONSHIP_COMMANDS) {
  test(`${command} cache loss recovers fixed original intent only at original cache location with explicit fresh context`, linuxOnly, (t) => {
    const workspace = materialize(t);
    const { request, pending, intent } = crash(workspace, command, "replaced");
    rmSync(workspace.cache);
    const info = success(send(workspace, { command: "workspace.info" }));
    assert.notEqual(info.writeContext, request.writeContext);
    fail(send(workspace, request), "STALE_WRITE_CONTEXT");
    const resumed = success(recover(workspace, intent!.operationId));
    assert.equal(resumed.result.outcome, "complete");
    assert.equal(readFileSync(path.join(workspace.root, "tasks/a.json")).toString("base64"), intent!.nextBytes);
    fail(send(workspace, request), "STALE_WRITE_CONTEXT");
    assert.equal(existsSync(pending), false);
  });
  test(`${command} recovery's own lost reply replays one group and retires its own pending`, linuxOnly, (t) => {
    const workspace = materialize(t);
    const { pending, intent } = crash(workspace, command, "staged");
    const context = success(send(workspace, { command: "workspace.info" })).writeContext;
    const request = { version: 2, command: "workspace.recovery.resume", args: { operationId: intent!.operationId }, writeContext: context, idempotencyKey: "resume-lost" };
    const loader = path.join(workspace.directory, "relationship-resume-kill.mjs");
    writeFileSync(loader, `import {DatabaseSync} from 'node:sqlite';import {existsSync} from 'node:fs';const exec=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){const result=exec.call(this,sql);if(sql==='COMMIT'&&existsSync(${JSON.stringify(pending)}))process.kill(process.pid,'SIGKILL');return result;};`);
    assert.equal(run(workspace, request, loader).signal, "SIGKILL");
    assert.equal(existsSync(pending), true);
    const recovered = success(send(workspace, request));
    assert.equal(recovered.result.outcome, "complete");
    assert.deepEqual(success(send(workspace, request)).result, recovered.result);
    assert.equal(existsSync(pending), false);
    assert.equal((success(send(workspace, { command: "activity.list" })).result.activity as object[]).length, 1);
  });
}

for (const fault of ["old-arrival", "new-arrival", "old-delete", "new-delete", "formatting", "target-canceled"]) {
  test(`move pre-intent ${fault} refuses with zero intended canonical writes or pending`, linuxOnly, (t) => {
    const workspace = materialize(t);
    const request = prepare(workspace);
    const loader = path.join(workspace.directory, "relationship-preflight-race.mjs");
    let mutation = "";
    if (fault.endsWith("arrival")) mutation = `faultWrite(${JSON.stringify(path.join(workspace.root, "tasks/arrival.json"))},JSON.stringify({...${JSON.stringify(template)},id:'arrival',parentId:${JSON.stringify(fault === "old-arrival" ? "old" : "next")}}));`;
    if (fault.endsWith("delete")) mutation = `faultRemove(${JSON.stringify(path.join(workspace.root, "tasks", fault === "old-delete" ? "oldSibling.json" : "hidden.json"))});`;
    if (fault === "formatting") mutation = `faultAppend(${JSON.stringify(path.join(workspace.root, "tasks/hidden.json"))},' ');`;
    if (fault === "target-canceled") mutation = `faultWrite(${JSON.stringify(path.join(workspace.root, "tasks/next.json"))},JSON.stringify({...${JSON.stringify(template)},id:'next',orderKey:'a1',status:'canceled',closedAt:'2026-09-08T14:00:00.000Z'}));`;
    writeFileSync(loader, `import {registerHooks} from 'node:module';registerHooks({load(url,context,next){const result=next(url,context);if(!url.endsWith('/v2UpdateWriter.js'))return result;let source=result.source.toString(),n='guardV2Update(intent, false);';if(source.split(n).length!==2)throw Error('unique preflight cut required');source='import {writeFileSync as faultWrite,appendFileSync as faultAppend,rmSync as faultRemove} from "node:fs";'+source.replace(n,${JSON.stringify(mutation)}+n);return {...result,source};}});`);
    const child = run(workspace, request, loader);
    assert.equal(child.status, 0, child.stderr);
    fail(JSON.parse(child.stdout), fault.endsWith("arrival") || fault.endsWith("delete") ? "STALE_SCOPE" : "STALE_FILE");
    const task = JSON.parse(readFileSync(path.join(workspace.root, "tasks/a.json"), "utf8"));
    assert.equal(task.parentId, "old");
    assert.equal(task.updatedAt, template.updatedAt);
    assert.equal(existsSync(pendingV2Path(readV2RootDescriptor(workspace.root))), false);
    assert.equal(readdirSync(path.join(workspace.root, "tasks")).some(file => file.startsWith(".syncthing.taskdb-")), false);
  });
}
