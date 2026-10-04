import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { TestContext } from "node:test";
import { executeV2Line } from "./v2Gateway.js";
import { readV2CanonicalRoot, readV2RootDescriptor } from "./v2CanonicalReader.js";
import { pendingV2Path } from "./v2LocalDomain.js";
import type { V2Response } from "./v2Protocol.js";

const golden = fileURLToPath(new URL("../../scripts/fixtures/taskdb-v2/root/", import.meta.url));
const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
const id = "c8d4206d-c25a-4317-baa4-a2c5443060e9";
type Workspace = { directory: string; root: string; cache: string };
function setup(t: TestContext): Workspace {
  const directory = mkdtempSync(path.join(os.tmpdir(), "taskdb-v2-crash-"));
  const before = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = path.join(directory, "local");
  t.after(() => { if (before === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = before; rmSync(directory, { recursive: true, force: true }); });
  const root = path.join(directory, "root");
  cpSync(golden, root, { recursive: true });
  return { directory, root, cache: path.join(directory, "cache.db") };
}
function send(workspace: Workspace, envelope: object): V2Response {
  return executeV2Line(Buffer.from(JSON.stringify({ version: 2, ...envelope })), workspace.root, workspace.cache);
}
function success(response: V2Response): Extract<V2Response, { ok: true }> {
  assert.equal(response.ok, true, JSON.stringify(response));
  if (!response.ok) throw new Error("failed");
  return response;
}
function crash(workspace: Workspace, cut: string): { request: object; pending: string } {
  const read = success(send(workspace, { command: "task.get", args: { id } }));
  const request = { version: 2, command: "task.update", args: { id, expectedVersion: (read.result.task as { version: number }).version, title: "Fixed crash edit" }, writeContext: read.writeContext, idempotencyKey: "original" };
  const pending = pendingV2Path(readV2RootDescriptor(workspace.root));
  const loader = path.join(workspace.directory, "crash-loader.mjs");
  // Only test processes load this transform. No production fault flag changes engine behavior.
  writeFileSync(loader, `import {registerHooks} from 'node:module';
const cut=${JSON.stringify(cut)};
registerHooks({load(url,context,next){const result=next(url,context);let source=result.source?.toString();
const module=cut==='staged'?'v2UpdateWriter.js':cut==='replaced'?'v2UpdateJournal.js':'v2QueryCache.js';
if(!url.endsWith('/'+module)||!source)return result;
const needle=cut==='staged'?'persistV2Pending(root, intent);':cut==='replaced'?'renameSync(temporary, target);':'database.exec("COMMIT");';
if(source.split(needle).length!==2)throw Error('cut must be unique');
const stop='if (cutExists(process.env.TASKDB_TEST_PENDING)) process.kill(process.pid,"SIGKILL");';
source='import {existsSync as cutExists} from "node:fs";\\n'+source.replace(needle,cut==='beforeCommit'?stop+needle:needle+stop);
return {...result,source};}});`);
  const child = spawnSync(process.execPath, ["--import", loader, cli, "--stdio", "--v2-root", workspace.root, "--database", workspace.cache], {
    input: JSON.stringify(request), timeout: 10_000,
    env: { ...process.env, TASKDB_TEST_PENDING: pending },
  });
  assert.equal(child.signal, "SIGKILL", child.stderr.toString());
  assert.equal(existsSync(pending), true);
  return { request, pending };
}

for (const cut of ["staged", "replaced", "beforeCommit", "afterCommit"]) {
  test(`v2 real subprocess kill at ${cut} retains fixed update and explicitly resumes`, { skip: process.platform !== "linux" }, (t) => {
    const workspace = setup(t);
    const { request, pending } = crash(workspace, cut);
    const intent = JSON.parse(readFileSync(pending, "utf8"));
    const info = success(send(workspace, { command: "workspace.info" }));
    assert.equal(info.result.state, "recovery_pending");
    assert.equal(info.result.pendingOperationId, intent.operationId);
    const query = send(workspace, { command: "task.list" });
    assert.equal(query.ok, false);
    if (!query.ok) assert.equal(query.error.code, "RECOVERY_PENDING");
    const retry = send(workspace, request);
    if (cut === "afterCommit") assert.equal(retry.ok, true);
    else { assert.equal(retry.ok, false); if (!retry.ok) assert.equal(retry.error.code, "RECOVERY_PENDING"); }
    const recovered = success(send(workspace, { command: "workspace.recovery.resume", args: { operationId: intent.operationId }, writeContext: info.writeContext, idempotencyKey: "resume" }));
    assert.equal(recovered.result.outcome, "complete");
    assert.equal(existsSync(pending), false);
    const replay = success(send(workspace, request));
    assert.equal(replay.result.operationId, intent.operationId);
    assert.equal((replay.result.task as { title: string }).title, "Fixed crash edit");
    assert.deepEqual(recovered.result.originalResult, replay.result);
    assert.equal((success(send(workspace, { command: "activity.list" })).result.activity as object[]).length, 1);
  });
}

test("malformed completed-update receipt preserves pending evidence and recovery retry authority", { skip: process.platform !== "linux" }, t => {
  const workspace = setup(t), { request, pending } = crash(workspace, "afterCommit");
  const pendingBytes = readFileSync(pending), intent = JSON.parse(pendingBytes.toString());
  const file = path.join(workspace.root, "tasks", `${id}.json`), taskBytes = readFileSync(file);
  const database = new DatabaseSync(workspace.cache);
  const stored = database.prepare("SELECT result FROM v2_receipts").get()!.result as string;
  database.prepare("UPDATE v2_receipts SET result = ?").run(JSON.stringify({ ...JSON.parse(stored), operationId: undefined }));
  database.close();
  const recovery = { command: "workspace.recovery.resume", args: { operationId: intent.operationId }, writeContext: intent.request.writeContext, idempotencyKey: "typed-resume" };
  const refused = send(workspace, recovery);
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.error.code, "INVALID_STORAGE");
  assert.deepEqual(readFileSync(pending), pendingBytes);
  assert.deepEqual(readFileSync(file), taskBytes);
  const restore = new DatabaseSync(workspace.cache);
  assert.equal(restore.prepare("SELECT count(*) AS n FROM v2_receipts").get()!.n, 1);
  assert.equal(restore.prepare("SELECT count(*) AS n FROM v2_operations").get()!.n, 1);
  restore.prepare("UPDATE v2_receipts SET result = ?").run(stored);
  restore.close();
  const completed = success(send(workspace, recovery));
  assert.deepEqual(completed.result.originalResult, JSON.parse(stored));
  assert.deepEqual(success(send(workspace, request)).result, JSON.parse(stored));
  assert.equal(existsSync(pending), false);
  assert.deepEqual(readFileSync(file), taskBytes);
});

test("already-replaced recovery requires directory flush before committing receipts or retiring evidence", { skip: process.platform !== "linux" }, t => {
  const workspace = setup(t);
  const { request, pending } = crash(workspace, "replaced");
  const pendingBytes = readFileSync(pending), taskBytes = readFileSync(path.join(workspace.root, "tasks", `${id}.json`));
  const intent = JSON.parse(pendingBytes.toString());
  const recovery = { version: 2, command: "workspace.recovery.resume", args: { operationId: intent.operationId }, writeContext: intent.request.writeContext, idempotencyKey: "flush-resume" };
  const loader = path.join(workspace.directory, "refuse-directory-flush.mjs");
  writeFileSync(loader, `import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){const result=next(url,context);let source=result.source?.toString();
if(!url.endsWith('/v2UpdateJournal.js')||!source)return result;
const needle='syncV2Directory(path.dirname(target));';if(source.split(needle).length!==2)throw Error('flush must be unique');
return {...result,source:source.replace(needle,'throw Object.assign(new Error("test-only flush refusal"),{code:"EPERM"});'+needle)};}});`);
  const child = spawnSync(process.execPath, ["--import", loader, cli, "--stdio", "--v2-root", workspace.root, "--database", workspace.cache], { input: JSON.stringify(recovery), timeout: 10_000 });
  assert.equal(child.status, 0, child.stderr.toString());
  const refused = JSON.parse(child.stdout.toString());
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "INVALID_STORAGE");
  assert.deepEqual(readFileSync(pending), pendingBytes);
  assert.deepEqual(readFileSync(path.join(workspace.root, "tasks", `${id}.json`)), taskBytes);
  const database = new DatabaseSync(workspace.cache);
  assert.equal(database.prepare("SELECT count(*) AS n FROM v2_receipts").get()!.n, 0);
  assert.equal(database.prepare("SELECT count(*) AS n FROM v2_operations").get()!.n, 0);
  database.close();
  success(send(workspace, recovery));
  success(send(workspace, request));
  assert.equal(existsSync(pending), false);
  assert.deepEqual(readFileSync(path.join(workspace.root, "tasks", `${id}.json`)), taskBytes);
});

test("schema-5 sibling-array cache preserves a pending update through compact observation refresh and original replay", { skip: process.platform !== "linux" }, t => {
  const workspace = setup(t);
  const { request, pending } = crash(workspace, "replaced");
  const pendingBytes = readFileSync(pending);
  const intent = JSON.parse(pendingBytes.toString());
  const snapshot = readV2CanonicalRoot(workspace.root);
  const database = new DatabaseSync(workspace.cache);
  const rows = database.prepare("SELECT id, fingerprint FROM v2_query_tasks").all();
  const update = database.prepare("UPDATE v2_query_tasks SET fingerprint = ? WHERE id = ?");
  for (const row of rows) {
    const task = snapshot.tasks.find(task => task.id === row.id)!;
    const siblings = snapshot.tasks.filter(sibling => sibling.parentId === task.parentId).map(sibling => sibling.id);
    update.run(JSON.stringify([JSON.parse(row.fingerprint as string)[0], siblings]), task.id);
  }
  assert.equal(database.prepare("PRAGMA user_version").get()!.user_version, 5);
  database.close();
  const info = success(send(workspace, { command: "workspace.info" }));
  assert.equal(info.writeContext, intent.request.writeContext);
  assert.equal(info.result.pendingOperationId, intent.operationId);
  assert.deepEqual(readFileSync(pending), pendingBytes);
  const recovery = success(send(workspace, { command: "workspace.recovery.resume", args: { operationId: intent.operationId }, writeContext: info.writeContext, idempotencyKey: "schema-5-resume" }));
  assert.equal(existsSync(pending), false);
  const replay = success(send(workspace, request));
  assert.deepEqual(replay.result, recovery.result.originalResult);
  assert.equal(replay.result.operationId, intent.operationId);
  assert.equal((success(send(workspace, { command: "activity.list" })).result.activity as object[]).length, 1);
  const verify = new DatabaseSync(workspace.cache);
  assert.equal(verify.prepare("SELECT max(length(fingerprint)) AS size FROM v2_query_tasks").get()!.size, 135);
  verify.close();
});

for (const fault of ["divergence", "missing", "partial", "arrival"]) {
  test(`v2 recovery refuses ${fault} without rollback/resurrection`, { skip: process.platform !== "linux" }, (t) => {
    const workspace = setup(t);
    const { pending } = crash(workspace, "staged");
    const intent = JSON.parse(readFileSync(pending, "utf8"));
    const file = path.join(workspace.root, "tasks", `${id}.json`);
    if (fault === "missing") rmSync(file);
    if (fault === "partial") writeFileSync(file, '{"id":');
    if (fault === "divergence") writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), title: "External edit" }));
    if (fault === "arrival") writeFileSync(path.join(workspace.root, "tasks", "late.json"), JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), id: "late" }));
    const before = existsSync(file) ? readFileSync(file) : null;
    const info = success(send(workspace, { command: "workspace.info" }));
    const response = send(workspace, { command: "workspace.recovery.resume", args: { operationId: intent.operationId }, writeContext: info.writeContext, idempotencyKey: "resume" });
    assert.equal(response.ok, false);
    if (!response.ok) assert.equal(response.error.code, "RECOVERY_CONFLICT");
    assert.deepEqual(existsSync(file) ? readFileSync(file) : null, before);
    assert.equal(existsSync(pending), true);
  });
}

test("v2 same recovery key finishes retirement after its own receipt commit loses the reply", { skip: process.platform !== "linux" }, (t) => {
  const workspace = setup(t);
  const { pending } = crash(workspace, "staged");
  const intent = JSON.parse(readFileSync(pending, "utf8"));
  const info = success(send(workspace, { command: "workspace.info" }));
  const recovery = { version: 2, command: "workspace.recovery.resume", args: { operationId: intent.operationId }, writeContext: info.writeContext, idempotencyKey: "same-resume" };
  const preload = path.join(workspace.directory, "kill-recovery-commit.mjs");
  writeFileSync(preload, `import {DatabaseSync} from 'node:sqlite'; import {existsSync} from 'node:fs';
const original=DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec=function(sql){const result=original.call(this,sql); if(sql==='COMMIT'&&existsSync(process.env.TASKDB_TEST_PENDING))process.kill(process.pid,'SIGKILL'); return result;};`);
  const child = spawnSync(process.execPath, ["--import", preload, cli, "--stdio", "--v2-root", workspace.root, "--database", workspace.cache], { input: JSON.stringify(recovery), timeout: 10_000, env: { ...process.env, TASKDB_TEST_PENDING: pending } });
  assert.equal(child.signal, "SIGKILL", child.stderr.toString());
  assert.equal(existsSync(pending), true);
  const replay = success(send(workspace, recovery));
  assert.equal(replay.result.outcome, "complete");
  assert.equal(existsSync(pending), false);
  assert.equal((success(send(workspace, { command: "activity.list" })).result.activity as object[]).length, 1);
});

test("v2 root pending state is shared across caches, but a different cache cannot adopt its receipts", { skip: process.platform !== "linux" }, (t) => {
  const workspace = setup(t);
  const { pending } = crash(workspace, "staged");
  const intent = JSON.parse(readFileSync(pending, "utf8"));
  const other = { ...workspace, cache: path.join(workspace.directory, "other-cache.db") };
  const info = success(send(other, { command: "workspace.info" }));
  assert.equal(info.result.pendingOperationId, intent.operationId);
  const blocked = send(other, { command: "task.list" });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.error.code, "RECOVERY_PENDING");
  const refused = send(other, { command: "workspace.recovery.resume", args: { operationId: intent.operationId }, writeContext: info.writeContext, idempotencyKey: "other-resume" });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.error.code, "RECOVERY_CONFLICT");
  assert.equal(existsSync(pending), true);
});

test("v2 malformed local intent preserves evidence and info reports manual inspection", { skip: process.platform !== "linux" }, (t) => {
  const workspace = setup(t);
  const { pending } = crash(workspace, "staged");
  const bytes = readFileSync(path.join(workspace.root, "tasks", `${id}.json`));
  writeFileSync(pending, '{"format":');
  const info = success(send(workspace, { command: "workspace.info" }));
  assert.equal(info.result.state, "recovery_pending");
  assert.equal(info.result.pendingOperationId, null);
  assert.equal((info.result.issues as { code: string }[]).at(-1)!.code, "RECOVERY_CONFLICT");
  const blocked = send(workspace, { command: "task.list" });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.error.code, "RECOVERY_CONFLICT");
  assert.deepEqual(readFileSync(path.join(workspace.root, "tasks", `${id}.json`)), bytes);
  assert.equal(readFileSync(pending, "utf8"), '{"format":');
});

test("v2 cache loss rejects original retry while explicit fixed-journal recovery uses fresh authority", { skip: process.platform !== "linux" }, (t) => {
  const workspace = setup(t);
  const { request, pending } = crash(workspace, "replaced");
  const intent = JSON.parse(readFileSync(pending, "utf8"));
  rmSync(workspace.cache);
  const info = success(send(workspace, { command: "workspace.info" }));
  const old = send(workspace, request);
  assert.equal(old.ok, false);
  if (!old.ok) assert.equal(old.error.code, "STALE_WRITE_CONTEXT");
  success(send(workspace, { command: "workspace.recovery.resume", args: { operationId: intent.operationId }, writeContext: info.writeContext, idempotencyKey: "fresh-resume" }));
  assert.equal(existsSync(pending), false);
  const oldAgain = send(workspace, request);
  assert.equal(oldAgain.ok, false);
  if (!oldAgain.ok) assert.equal(oldAgain.error.code, "STALE_WRITE_CONTEXT");
});
