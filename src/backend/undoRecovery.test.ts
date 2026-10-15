import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { TestContext } from "node:test";
import { createV2CopyTestWorkspace as setup } from "./copyTestWorkspace.js";
import type { V2CopyTestWorkspace as Workspace } from "./copyTestWorkspace.js";
import { readV2RootDescriptor } from "./canonicalReader.js";
import { executeV2Line } from "./gateway.js";
import { pendingV2Path } from "./localDomain.js";
import { v2UndoRecoveryLocation } from "./batchJournal.js";
import type { V2BatchIntent } from "./batchJournal.js";
import type { V2Response } from "./protocol.js";
import { isV2WindowsProofIntent } from "./windowsTaskProof.js";
const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
const corpus = JSON.parse(readFileSync(fileURLToPath(new URL("../../scripts/fixtures/taskdb-v2/cases.json", import.meta.url)), "utf8"));
const linux = { skip: process.platform !== "linux" };
function send(w: Workspace, request: object): V2Response { return executeV2Line(Buffer.from(JSON.stringify({ version: 2, ...request })), w.root, w.cache); }
function ok(r: V2Response): Extract<V2Response, { ok: true }> { assert.equal(r.ok, true, JSON.stringify(r)); if (!r.ok) throw Error("failed"); return r; }
function fail(r: V2Response, code: string) { assert.equal(r.ok, false, JSON.stringify(r)); if (!r.ok) assert.equal(r.error.code, code); }
function raw(w: Workspace) { return readdirSync(path.join(w.root, "tasks")).sort().map(file => [file, readFileSync(path.join(w.root, "tasks", file)).toString("base64")]); }
function prepared(w: Workspace, command: string, args: Record<string, unknown>) {
  const read = ok(send(w, { command: "task.list", args: { sort: "manual" } }));
  const versions = new Map((read.result.tasks as { id: string; version: number }[]).map(task => [task.id, task.version]));
  return { version: 2, command, writeContext: read.writeContext, idempotencyKey: command, actor: { kind: "human", label: "undo test" }, args: { ...args, ...(typeof args.id === "string" ? { expectedVersion: versions.get(args.id) } : {}), ...(Array.isArray(args.tasks) ? { tasks: args.tasks.map(task => ({ ...task, expectedVersion: versions.get(task.id) })) } : {}) } };
}
function scenario(t: TestContext, kind: string) {
  const w = setup(t);
  for (const file of readdirSync(path.join(w.root, "tasks"))) rmSync(path.join(w.root, "tasks", file));
  const records = kind === "order" ? corpus.cases.find((entry: { id: string }) => entry.id === "reorder-tied").given.records
    : kind === "create" ? {} : { a: {}, b: { orderKey: "a1" }, c: { orderKey: "a2" } };
  for (const [id, patch] of Object.entries(records)) writeFileSync(path.join(w.root, "tasks", `${id}.json`), JSON.stringify({ ...corpus.taskTemplate, ...(patch as object), id }));
  let forward;
  if (kind === "transition" || kind === "undoMany") {
    const args = { tasks: [{ id: "a", command: "task.complete" }, { id: "b", command: "task.pause" }, { id: "c", command: "task.start" }] };
    if (kind === "transition") return { w, request: prepared(w, "task.transitionMany", args), groupsBefore: 0 };
    forward = ok(send(w, prepared(w, "task.transitionMany", args)));
    return { w, request: prepared(w, "task.status.undoMany", { tasks: [{ id: "a" }, { id: "b" }, { id: "c" }] }), groupsBefore: 1 };
  }
  if (kind === "status") forward = ok(send(w, prepared(w, "task.complete", { id: "a" })));
  if (kind === "create") forward = ok(send(w, prepared(w, "task.create", { title: "Preserve raw creation", description: "**Raw**\r\n" })));
  if (kind === "order") forward = ok(send(w, prepared(w, "task.reorder", { tasks: [{ id: "move" }], placement: { beforeId: "b" } })));
  if (kind === "content") { forward = ok(send(w, prepared(w, "task.update", { id: "a", priority: 0 })));const file = path.join(w.root, "tasks/a.json");writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), description: "Preserve unrelated edit", updatedAt: "2030-01-01T00:00:00.000Z" })); }
  assert.ok(forward);
  return { w, request: prepared(w, kind === "status" ? "task.status.undo" : "operation.undo", kind === "status" ? { id: "a" } : { operationId: forward.result.operationId }), groupsBefore: 1 };
}
function run(w: Workspace, request: object, loader?: string) { return spawnSync(process.execPath, [...(loader ? ["--import", loader] : []), cli, "--stdio", "--v2-root", w.root, "--database", w.cache], { input: JSON.stringify(request), encoding: "utf8", env: process.env, timeout: 10_000 }); }
function recover(w: Workspace, operationId: string, key = "resume") { const context = ok(send(w, { command: "workspace.info" })).writeContext;return send(w, { command: "workspace.recovery.resume", writeContext: context, idempotencyKey: key, args: { operationId } }); }
function crash(w: Workspace, request: object, cut: string) {
  const pending = pendingV2Path(readV2RootDescriptor(w.root));
  const loader = path.join(w.directory, "undo-kill-loader.mjs");
  writeFileSync(loader, `import{registerHooks}from'node:module';import{existsSync}from'node:fs';import{DatabaseSync}from'node:sqlite';const cut=${JSON.stringify(cut)},pending=${JSON.stringify(pending)};
if(cut==='beforeCommit'||cut==='afterCommit'){const exec=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){if(sql==='COMMIT'&&existsSync(pending)&&cut==='beforeCommit')process.kill(process.pid,'SIGKILL');const result=exec.call(this,sql);if(sql==='COMMIT'&&existsSync(pending)&&cut==='afterCommit')process.kill(process.pid,'SIGKILL');return result;};}
registerHooks({load(url,context,next){const result=next(url,context);if(!result.source)return result;let source=result.source.toString();function replace(n,v){if(source.split(n).length!==2)throw Error('unique undo cut required: '+n);source=source.replace(n,v);}
if(url.endsWith('/undoWriter.js')){if(cut==='intent'||cut==='prefix-0'){const n='persistV2Pending(root, intent);';replace(n,n+'process.kill(process.pid,"SIGKILL");');}if(cut==='verified'){const n='const snapshot = applyV2BatchJournal(intent);';replace(n,n+'process.kill(process.pid,"SIGKILL");');}if(cut==='archive'){const n='persistV2UndoArchive(intent);';replace(n,n+'process.kill(process.pid,"SIGKILL");');}}
if(url.endsWith('/batchJournal.js')){if(cut==='staged'){const n='writeV2DurableFile(temporary, next);';replace(n,n+'process.kill(process.pid,"SIGKILL");');}if(cut.startsWith('prefix-')&&cut!=='prefix-0'){source='let changed=0;'+source;const kill='if(++changed==='+Number(cut.slice(7))+')process.kill(process.pid,"SIGKILL");';for(const n of ['renameSync(temporary, target);','unlinkSync(target);'])replace(n,n+kill);}}
if(url.endsWith('/localDomain.js')&&cut==='retired'){const n='unlinkSync(pendingV2Path(root));';replace(n,n+'process.kill(process.pid,"SIGKILL");');}
return{...result,source};}});`);
  const child = run(w, request, loader);assert.equal(child.signal, "SIGKILL", child.stderr);
  return { pending, intent: existsSync(pending) ? JSON.parse(readFileSync(pending, "utf8")) as V2BatchIntent : undefined };
}

test("Windows proof accepts only single-status undo evidence, never grouped/arbitrary batch history", linux, t => {
  for (const kind of ["status", "transition", "undoMany", "order", "create", "content"]) {
    const { w, request } = scenario(t, kind), { intent } = crash(w, request, "intent");
    assert.ok(intent);
    assert.equal(isV2WindowsProofIntent(intent), kind === "status");
    if (kind === "undoMany") {
      const disguised = { ...intent, request: { ...intent.request, command: "task.status.undo", args: { id: "a", expectedVersion: 1 } }, sources: [intent.sources[0]] };
      assert.equal(isV2WindowsProofIntent(disguised), false);
    }
  }
});

test("already-applied single-status inverse requires directory flush before history/claim/receipt", linux, t => {
  const { w, request } = scenario(t, "status"), { pending, intent } = crash(w, request, "prefix-1");
  assert.ok(intent);
  const pendingBytes = readFileSync(pending), target = path.join(w.root, "tasks/a.json"), targetBytes = readFileSync(target);
  const loader = path.join(w.directory, "undo-flush-refusal.mjs");
  writeFileSync(loader, `import {registerHooks} from 'node:module';registerHooks({load(url,context,next){const result=next(url,context);
if(!url.endsWith('/batchJournal.js'))return result;let source=result.source.toString();
const needle='syncV2Directory(path.dirname(target));\\n            continue;';
if(source.split(needle).length!==2)throw Error('unique already-applied flush required');
return {...result,source:source.replace(needle,'throw Object.assign(new Error("test-only inverse flush refusal"),{code:"EPERM"});'+needle)};}});`);
  const resume = { version: 2, command: "workspace.recovery.resume", args: { operationId: intent.operationId }, writeContext: request.writeContext, idempotencyKey: "flush-inverse" };
  const child = run(w, resume, loader); assert.equal(child.status, 0, child.stderr);
  fail(JSON.parse(child.stdout), "INVALID_STORAGE");
  assert.deepEqual(readFileSync(pending), pendingBytes); assert.deepEqual(readFileSync(target), targetBytes);
  const db = new DatabaseSync(w.cache);
  assert.equal(db.prepare("SELECT count(*) AS n FROM v2_operations").get()!.n, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM v2_receipts").get()!.n, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM v2_undo_claims").get()!.n, 0); db.close();
  ok(send(w, resume)); ok(send(w, request)); assert.equal(existsSync(pending), false);
  assert.deepEqual(readFileSync(target), targetBytes);
});

for (const [kind, writes] of [["transition", 3], ["undoMany", 3], ["order", 3], ["status", 1], ["create", 1], ["content", 1]] as const) {
  const cuts = ["intent", ...(kind === "create" ? [] : ["staged"]), ...Array.from({ length: writes + 1 }, (_, index) => `prefix-${index}`), "verified", "beforeCommit", "afterCommit", "retired"];
  for (const cut of cuts) test(`${kind} actual CLI ${cut} retains fixed group/time/claims/bytes without replaying applied effects`, linux, t => {
    const { w, request, groupsBefore } = scenario(t, kind);
    const { pending, intent } = crash(w, request, cut);
    const applied = intent?.files.flatMap(file => {
      const target = path.join(w.root, "tasks", `${file.taskId}.json`);
      if (!existsSync(target) || file.nextBytes === null || file.nextBytes === file.beforeBytes || readFileSync(target).toString("base64") !== file.nextBytes) return [];
      return [[file.taskId, lstatSync(target).ino] as const];
    }) ?? [];
    if (cut === "afterCommit" || cut === "retired") ok(send(w, request));else fail(send(w, request), "RECOVERY_PENDING");
    if (intent) {
      const info = ok(send(w, { command: "workspace.info" }));assert.equal(info.result.pendingOperationId, intent.operationId);fail(send(w, { command: "task.list" }), "RECOVERY_PENDING");
      const resumed = ok(recover(w, intent.operationId));assert.equal(resumed.result.outcome, "complete");assert.deepEqual(ok(send(w, request)).result, resumed.result.originalResult);
      for (const [id, inode] of applied) assert.equal(lstatSync(path.join(w.root, "tasks", `${id}.json`)).ino, inode);
      for (const file of intent.files) if (file.nextBytes === null) assert.equal(existsSync(path.join(w.root, "tasks", `${file.taskId}.json`)), false);else assert.equal(readFileSync(path.join(w.root, "tasks", `${file.taskId}.json`)).toString("base64"), file.nextBytes);
    }
    const replay = run(w, request);assert.equal(replay.status, 0, replay.stderr);const result = ok(JSON.parse(replay.stdout)).result;
    const history = ok(send(w, { command: "activity.list" })).result.activity as { operationId: string; actor: object; createdAt: string }[];
    assert.equal(history.length, groupsBefore + 1);assert.equal(history[0].operationId, result.operationId);assert.deepEqual(history[0].actor, request.actor);if (intent) assert.equal(history[0].createdAt, intent.at);
    if (kind === "create") { const archived = JSON.parse(readFileSync(result.recoveryLocation as string, "utf8"));assert.equal(archived.operationId, result.operationId);if (intent) assert.equal(archived.files[0].beforeBytes, intent.files.find(file => file.nextBytes === null)!.beforeBytes); }
    assert.equal(existsSync(pending), false);
  });
}

test("creation archive before pending survives interruption without canonical deletion or automatic adoption", linux, t => {
  const { w, request } = scenario(t, "create");const before = raw(w);const { pending } = crash(w, request, "archive");assert.equal(existsSync(pending), false);assert.deepEqual(raw(w), before);
  const domain = path.dirname(pending);const archived = readdirSync(domain).filter(file => file.endsWith(".recovery.json"));assert.equal(archived.length, 1);
  const artifact = JSON.parse(readFileSync(path.join(domain, archived[0]), "utf8"));fail(recover(w, artifact.operationId), "OPERATION_UNAVAILABLE");assert.deepEqual(raw(w), before);assert.equal(existsSync(path.join(domain, archived[0])), true);
});

for (const fault of ["arrival", "delete-before", "applied-edit", "formatting", "conflict-arrival", "foreign-entry", "manifest-format", "stage-partial", "applied-stage", "intent-partial", "intent-next-time", "intent-history", "intent-absence", "different-cache", "copied-cache"]) {
  test(`undo recovery refuses ${fault} preserving all external/pending bytes`, linux, t => {
    const { w, request } = scenario(t, "undoMany");const { pending, intent: captured } = crash(w, request, fault === "stage-partial" ? "staged" : "prefix-1");const intent = captured!;
    const patch = (id: string, fields: object) => { const file = path.join(w.root, "tasks", `${id}.json`);writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), ...fields })); };
    if (fault === "arrival") writeFileSync(path.join(w.root, "tasks/new.json"), JSON.stringify({ ...corpus.taskTemplate, id: "new" }));
    if (fault === "delete-before") rmSync(path.join(w.root, "tasks/b.json"));
    if (fault === "applied-edit") patch("a", { description: "Preserve this external change" });
    if (fault === "formatting") writeFileSync(path.join(w.root, "tasks/c.json"), readFileSync(path.join(w.root, "tasks/c.json"), "utf8") + " ");
    if (fault === "conflict-arrival") writeFileSync(path.join(w.root, "tasks/a.sync-conflict-test.json"), "raw alternate");
    if (fault === "foreign-entry") writeFileSync(path.join(w.root, "tasks/unknown.txt"), "preserve unknown");
    if (fault === "manifest-format") writeFileSync(path.join(w.root, "workspace.json"), '{ "schemaVersion":2 }\n');
    if (fault === "stage-partial" || fault === "applied-stage") writeFileSync(path.join(w.root, "tasks", `.syncthing.taskdb-batch-${intent.operationId}-0.tmp`), "{");
    if (fault === "intent-partial") writeFileSync(pending, "{");
    if (fault.startsWith("intent-") && fault !== "intent-partial") {
      const value = JSON.parse(readFileSync(pending, "utf8"));
      if (fault === "intent-history") value.sources[0].before.tasks[0].closedAt = "2020-01-01T00:00:00.000Z";
      if (fault === "intent-absence") value.files[1].nextBytes = null;
      if (fault === "intent-next-time") { const file = value.files[0];file.nextBytes = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(file.nextBytes, "base64").toString()), updatedAt: "2024-01-01T00:00:00.000Z" })).toString("base64"); }
      writeFileSync(pending, JSON.stringify(value));
    }
    let selected = w;
    if (fault.endsWith("cache")) { const cache = path.join(w.directory, "other.db");if (fault === "copied-cache") cpSync(w.cache, cache);selected = { ...w, cache }; }
    const before = raw(w);fail(recover(selected, intent.operationId), "RECOVERY_CONFLICT");assert.deepEqual(raw(w), before);assert.equal(existsSync(pending), true);
  });
}

for (const fault of ["archive-missing", "archive-partial", "archive-divergent", "target-divergent", "target-reappeared", "new-child", "intent-old-bytes"]) {
  test(`creation removal fixed archive/absence refuses ${fault}, never restores deleted canonical files`, linux, t => {
    const { w, request } = scenario(t, "create");const { pending, intent } = crash(w, request, fault === "target-divergent" || fault === "new-child" ? "intent" : "prefix-1");
    const removed = intent!.files.find(file => file.nextBytes === null)!;const archive = v2UndoRecoveryLocation(intent!)!;
    if (fault === "archive-missing") rmSync(archive);
    if (fault === "archive-partial") writeFileSync(archive, "{");
    if (fault === "archive-divergent") writeFileSync(archive, "Preserve divergent archive");
    if (fault === "target-divergent" || fault === "target-reappeared") writeFileSync(path.join(w.root, "tasks", `${removed.taskId}.json`), JSON.stringify({ ...JSON.parse(Buffer.from(removed.beforeBytes, "base64").toString()), description: "New writer bytes" }));
    if (fault === "new-child") writeFileSync(path.join(w.root, "tasks/new.json"), JSON.stringify({ ...corpus.taskTemplate, id: "new", parentId: removed.taskId }));
    if (fault === "intent-old-bytes") { const value = JSON.parse(readFileSync(pending, "utf8"));value.files[0].beforeBytes = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(value.files[0].beforeBytes, "base64").toString()), title: "Wrong original" })).toString("base64");writeFileSync(pending, JSON.stringify(value)); }
    const before = raw(w);fail(recover(w, intent!.operationId), "RECOVERY_CONFLICT");assert.deepEqual(raw(w), before);assert.equal(existsSync(pending), true);
  });
}

for (const kind of ["transition", "undoMany", "order", "status", "create", "content"]) {
  test(`${kind} original cache loss permits fixed explicit recovery, not old-context request/history`, linux, t => {
    const { w, request } = scenario(t, kind);const { pending, intent } = crash(w, request, "prefix-1");rmSync(w.cache);
    assert.notEqual(ok(send(w, { command: "workspace.info" })).writeContext, request.writeContext);fail(send(w, request), "STALE_WRITE_CONTEXT");
    const result = ok(recover(w, intent!.operationId));assert.equal(result.result.outcome, "complete");fail(send(w, request), "STALE_WRITE_CONTEXT");assert.equal(existsSync(pending), false);
    assert.equal((ok(send(w, { command: "activity.list" })).result.activity as object[]).length, 1);
  });
}

for (const kind of ["undoMany", "create"]) {
  test(`${kind} recovery lost reply retires only its own group/intent and retains raw archive`, linux, t => {
    const { w, request } = scenario(t, kind);const { pending, intent } = crash(w, request, "prefix-1");const ctx = ok(send(w, { command: "workspace.info" })).writeContext;
    const recovery = { version: 2, command: "workspace.recovery.resume", writeContext: ctx, idempotencyKey: "resume-lost", args: { operationId: intent!.operationId } };
    const loader = path.join(w.directory, "undo-resume-kill.mjs");writeFileSync(loader, `import{DatabaseSync}from'node:sqlite';import{existsSync}from'node:fs';const exec=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){const result=exec.call(this,sql);if(sql==='COMMIT'&&existsSync(${JSON.stringify(pending)}))process.kill(process.pid,'SIGKILL');return result;};`);
    assert.equal(run(w, recovery, loader).signal, "SIGKILL");const replay = ok(send(w, recovery));assert.deepEqual(ok(send(w, recovery)).result, replay.result);assert.equal(existsSync(pending), false);
    if (kind === "create") assert.equal(existsSync(v2UndoRecoveryLocation(intent!)!), true);
  });
}

test("pending undo budget exhaustion preserves fixed remaining effects and original authority", linux, t => {
  const { w, request } = scenario(t, "undoMany");const { pending, intent } = crash(w, request, "prefix-1");
  const db = new DatabaseSync(w.cache);db.prepare("UPDATE v2_query_state SET counter = ?, revision = ?").run(Number.MAX_SAFE_INTEGER - 3, Number.MAX_SAFE_INTEGER - 1);db.close();
  const before = raw(w);fail(recover(w, intent!.operationId), "UNSUPPORTED_COMMAND");assert.deepEqual(raw(w), before);assert.equal(existsSync(pending), true);
});

test("completed creation inverse keeps historical recovery despite corrupt archive cleanup until manually corrected", linux, t => {
  const { w, request } = scenario(t, "create");const { pending, intent } = crash(w, request, "afterCommit");const result = ok(send(w, request));
  const archive = v2UndoRecoveryLocation(intent!)!, original = readFileSync(archive);writeFileSync(archive, "preserve divergent recovery copy");
  fail(recover(w, intent!.operationId), "RECOVERY_CONFLICT");const historical = ok(recover(w, intent!.operationId));assert.deepEqual(historical.result.originalResult, result.result);assert.equal(existsSync(pending), true);
  assert.deepEqual(raw(w), []);writeFileSync(archive, original);assert.deepEqual(ok(recover(w, intent!.operationId)).result, historical.result);assert.equal(existsSync(pending), false);assert.equal(existsSync(archive), true);
});

for (const fault of ["arrival", "formatting", "delete", "budget", "claims"]) {
  test(`pre-intent undo ${fault} refuses without intended file writes/archive/pending effects`, linux, t => {
    const { w, request } = scenario(t, "undoMany");const pending = pendingV2Path(readV2RootDescriptor(w.root));
    if (fault === "budget") { const db = new DatabaseSync(w.cache);db.prepare("UPDATE v2_query_state SET counter = ?, revision = ?").run(Number.MAX_SAFE_INTEGER - 3, Number.MAX_SAFE_INTEGER - 1);db.close();const before = raw(w);fail(send(w, request), "UNSUPPORTED_COMMAND");assert.deepEqual(raw(w), before);assert.equal(existsSync(pending), false);return; }
    if (fault === "claims") { const db = new DatabaseSync(w.cache);const row = db.prepare("SELECT id FROM v2_operations").get()!;db.prepare("INSERT INTO v2_undo_claims VALUES (?, ?, ?)").run(row.id, "b", "already-used");db.close();const before = raw(w);fail(send(w, request), "UNDO_UNAVAILABLE");assert.deepEqual(raw(w), before);assert.equal(existsSync(pending), false);return; }
    const target = path.join(w.root, "tasks/b.json");const loader = path.join(w.directory, "undo-guard-fault.mjs");
    const mutation = fault === "arrival" ? `faultWrite(${JSON.stringify(path.join(w.root, "tasks/new.json"))},${JSON.stringify(JSON.stringify({ ...corpus.taskTemplate, id: "new" }))});` : fault === "delete" ? `faultRemove(${JSON.stringify(target)});` : `faultAppend(${JSON.stringify(target)},' ');`;
    writeFileSync(loader, `import{registerHooks}from'node:module';registerHooks({load(url,context,next){const result=next(url,context);if(!url.endsWith('/undoWriter.js'))return result;let source=result.source.toString();const n='guardV2Batch(intent, false);';if(source.split(n).length!==3)throw Error('exact two guards required');source='import{writeFileSync as faultWrite,rmSync as faultRemove,appendFileSync as faultAppend}from"node:fs";'+source.replace(n,${JSON.stringify(mutation)}+n);return{...result,source};}});`);
    const child = run(w, request, loader);assert.equal(child.status, 0, child.stderr);fail(JSON.parse(child.stdout), fault === "formatting" ? "STALE_FILE" : "STALE_SCOPE");assert.equal(existsSync(pending), false);
    assert.equal(JSON.parse(readFileSync(path.join(w.root, "tasks/a.json"), "utf8")).status, "done");if (fault === "delete") assert.equal(existsSync(target), false);
  });
}
