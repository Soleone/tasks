import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { TestContext } from "node:test";
import {
  createCopyTestWorkspace as setup,
  fail,
  recover,
  run,
  send,
  success,
} from "./copyTestWorkspace.js";
import type { CopyTestWorkspace as Workspace } from "./copyTestWorkspace.js";
import { readPhysicalRoot } from "./canonicalReader.js";
import type { InitIntent } from "./initJournal.js";
import { pendingIntentPath, localDomain } from "./localDomain.js";

const linuxOnly = { skip: process.platform !== "linux" };
function emptyWorkspace(t: TestContext) {
  const workspace = setup(t);
  for (const name of readdirSync(workspace.root))
    rmSync(path.join(workspace.root, name), { recursive: true });
  return workspace;
}
function crash(workspace: Workspace, cut: string) {
  const info = success(send(workspace, { command: "workspace.info" }));
  const request = {
    version: 2,
    command: "workspace.init",
    writeContext: info.writeContext,
    idempotencyKey: "original-init",
  };
  const root = readPhysicalRoot(workspace.root);
  const pending = pendingIntentPath(root);
  const loader = path.join(workspace.directory, "init-kill-loader.mjs");
  writeFileSync(
    loader,
    `import {registerHooks} from 'node:module';import {existsSync} from 'node:fs';import {DatabaseSync} from 'node:sqlite';
const cut=${JSON.stringify(cut)}, pending=${JSON.stringify(pending)};
if(cut==='beforeCommit'||cut==='afterCommit'){const exec=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){if(sql==='COMMIT'&&existsSync(pending)&&cut==='beforeCommit')process.kill(process.pid,'SIGKILL');const result=exec.call(this,sql);if(sql==='COMMIT'&&existsSync(pending)&&cut==='afterCommit')process.kill(process.pid,'SIGKILL');return result;};}
registerHooks({load(url,context,next){const result=next(url,context);if(!result.source)return result;let source=result.source.toString();
function replace(needle,value){if(source.split(needle).length!==2)throw Error('cut must be unique: '+needle);source=source.replace(needle,value);}
if(cut==='intent'&&url.endsWith('/lifecycleWriter.js')){const n='persistPending(root, intent);';replace(n,n+'process.kill(process.pid,"SIGKILL");');}
if(url.endsWith('/initJournal.js')){
 if(['tasks-bound','stage-bound','verified'].includes(cut)){source='let records=0;'+source;const n='syncDirectory(localDomain(intent.root));';const at=source.indexOf(n);if(at<0)throw Error('missing progress');source=source.slice(0,at)+n+'if(++records==='+(['tasks-bound','stage-bound','verified'].indexOf(cut)+1)+')process.kill(process.pid,"SIGKILL");'+source.slice(at+n.length);}
 for(const [at,needle] of [['unbound','mkdirSync(tasks, { mode: 0o700 });'],['stage-written','writeDurableFile(stage, Buffer.from(INIT_DESCRIPTOR));'],['published','linkSync(stage, manifest);'],['retiring-stage','unlinkSync(stage);'],['retiring-evidence','unlinkSync(progressPath(intent));']])if(cut===at)replace(needle,needle+'process.kill(process.pid,"SIGKILL");');
 if(cut==='progress-preparing'){const n='renameSync(\x60\x24{file}.preparing\x60, file);';replace(n,'process.kill(process.pid,"SIGKILL");'+n);}
}
return {...result,source};}});`,
  );
  const child = run(workspace, request, loader);
  assert.equal(child.signal, "SIGKILL", child.stderr);
  assert.equal(existsSync(pending), true);
  const intent = JSON.parse(readFileSync(pending, "utf8")) as InitIntent;
  const progress = path.join(localDomain(root), `init-${intent.operationId}.progress.json`);
  const stage = path.join(root.rootPath, `.syncthing.taskdb-init-${intent.operationId}.tmp`);
  return { request, pending, intent, progress, stage };
}

for (const cut of [
  "intent",
  "tasks-bound",
  "stage-written",
  "stage-bound",
  "published",
  "verified",
  "beforeCommit",
  "afterCommit",
  "retiring-stage",
  "retiring-evidence",
]) {
  test(
    `init CLI SIGKILL at ${cut} recovers exact fixed descriptor without guessing a new operation`,
    linuxOnly,
    (t) => {
      const workspace = emptyWorkspace(t);
      const { request, pending, intent } = crash(workspace, cut);
      const info = success(send(workspace, { command: "workspace.info" }));
      assert.equal(info.result.state, "recovery_pending");
      assert.equal(info.result.pendingOperationId, intent.operationId);
      fail(send(workspace, { command: "task.list" }), "RECOVERY_PENDING");
      const retry = send(workspace, request);
      if (["afterCommit", "retiring-stage", "retiring-evidence"].includes(cut)) success(retry);
      else fail(retry, "RECOVERY_PENDING");
      const resumed = success(recover(workspace, intent.operationId));
      assert.equal(resumed.result.outcome, "complete");
      assert.equal(existsSync(pending), false);
      assert.equal(
        readFileSync(path.join(workspace.root, "workspace.json"), "utf8"),
        '{"schemaVersion":2}\n',
      );
      assert.deepEqual(readdirSync(workspace.root).sort(), ["tasks", "workspace.json"]);
      assert.equal(success(send(workspace, { command: "task.list" })).result.total, 0);
      assert.deepEqual(success(send(workspace, request)).result, resumed.result.originalResult);
    },
  );
}

for (const cut of ["unbound", "progress-preparing"]) {
  test(`init ${cut} is retained for explicit inspection, not adopted`, linuxOnly, (t) => {
    const workspace = emptyWorkspace(t);
    const { pending, intent } = crash(workspace, cut);
    fail(recover(workspace, intent.operationId), "RECOVERY_CONFLICT");
    assert.equal(existsSync(pending), true);
    assert.equal(existsSync(path.join(workspace.root, "workspace.json")), false);
  });
}

for (const fault of [
  "task-arrival",
  "foreign-arrival",
  "tasks-replaced",
  "tasks-missing",
  "stage-edit",
  "stage-partial",
  "stage-missing",
  "manifest-arrival",
  "manifest-edit",
  "manifest-missing",
  "manifest-replaced",
  "progress-missing",
  "progress-partial",
  "intent-partial",
  "intent-context",
  "different-cache",
  "copied-cache",
]) {
  test(`init recovery preserves and refuses ${fault}`, linuxOnly, (t) => {
    const workspace = emptyWorkspace(t);
    const { pending, intent, progress, stage } = crash(
      workspace,
      fault.startsWith("manifest-") && fault !== "manifest-arrival" ? "verified" : "stage-bound",
    );
    const manifest = path.join(workspace.root, "workspace.json");
    if (fault === "task-arrival")
      writeFileSync(path.join(workspace.root, "tasks/late.json"), "preserve late bytes");
    if (fault === "foreign-arrival")
      writeFileSync(path.join(workspace.root, "keep.txt"), "preserve late bytes");
    if (fault === "tasks-replaced") {
      renameSync(path.join(workspace.root, "tasks"), path.join(workspace.directory, "kept-tasks"));
      mkdirSync(path.join(workspace.root, "tasks"));
    }
    if (fault === "tasks-missing") rmSync(path.join(workspace.root, "tasks"), { recursive: true });
    if (fault === "stage-edit" || fault === "stage-partial")
      writeFileSync(stage, fault === "stage-edit" ? '{"schemaVersion":3}\n' : "{");
    if (fault === "stage-missing") rmSync(stage);
    if (fault === "manifest-arrival") writeFileSync(manifest, '{"schemaVersion":1}\n');
    if (fault === "manifest-edit") writeFileSync(manifest, '{"schemaVersion":2} ');
    if (fault === "manifest-missing") rmSync(manifest);
    if (fault === "manifest-replaced") {
      rmSync(manifest);
      writeFileSync(manifest, '{"schemaVersion":2}\n');
    }
    if (fault === "progress-missing") rmSync(progress);
    if (fault === "progress-partial") writeFileSync(progress, "{");
    if (fault === "intent-partial") writeFileSync(pending, "{");
    if (fault === "intent-context") {
      const value = JSON.parse(readFileSync(pending, "utf8"));
      value.request.dryRun = true;
      writeFileSync(pending, JSON.stringify(value));
    }
    let selected = workspace;
    if (fault === "different-cache" || fault === "copied-cache") {
      const cache = path.join(workspace.directory, "other.db");
      if (fault === "copied-cache") cpSync(workspace.cache, cache);
      selected = { ...workspace, cache };
    }
    fail(recover(selected, intent.operationId), "RECOVERY_CONFLICT");
    assert.equal(existsSync(pending), true);
    if (fault === "task-arrival")
      assert.equal(
        readFileSync(path.join(workspace.root, "tasks/late.json"), "utf8"),
        "preserve late bytes",
      );
    if (fault === "manifest-arrival")
      assert.equal(readFileSync(manifest, "utf8"), '{"schemaVersion":1}\n');
    if (fault === "manifest-missing") assert.equal(existsSync(manifest), false);
  });
}

test(
  "init cache loss needs explicit fresh-context recovery, never old-context replay",
  linuxOnly,
  (t) => {
    const workspace = emptyWorkspace(t);
    const { request, intent } = crash(workspace, "published");
    rmSync(workspace.cache);
    const info = success(send(workspace, { command: "workspace.info" }));
    assert.notEqual(info.writeContext, request.writeContext);
    fail(send(workspace, request), "STALE_WRITE_CONTEXT");
    success(recover(workspace, intent.operationId));
    fail(send(workspace, request), "STALE_WRITE_CONTEXT");
    assert.equal(success(send(workspace, { command: "workspace.info" })).result.state, "ready");
  },
);

test("init recovery's own lost reply replays and finishes retirement", linuxOnly, (t) => {
  const workspace = emptyWorkspace(t);
  const { pending, intent } = crash(workspace, "published");
  const info = success(send(workspace, { command: "workspace.info" }));
  const request = {
    version: 2,
    command: "workspace.recovery.resume",
    args: { operationId: intent.operationId },
    writeContext: info.writeContext,
    idempotencyKey: "recover-lost-reply",
  };
  const loader = path.join(workspace.directory, "recovery-kill-loader.mjs");
  writeFileSync(
    loader,
    `import {DatabaseSync} from 'node:sqlite';import {existsSync} from 'node:fs';const exec=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){const result=exec.call(this,sql);if(sql==='COMMIT'&&existsSync(${JSON.stringify(pending)}))process.kill(process.pid,'SIGKILL');return result;};`,
  );
  assert.equal(run(workspace, request, loader).signal, "SIGKILL");
  const replay = success(send(workspace, request));
  assert.equal(replay.result.outcome, "complete");
  assert.equal(existsSync(pending), false);
  assert.deepEqual(success(send(workspace, request)).result, replay.result);
});

test(
  "init publication refuses a descriptor racing after the final guard, without overwriting it",
  linuxOnly,
  (t) => {
    const workspace = emptyWorkspace(t);
    const info = success(send(workspace, { command: "workspace.info" }));
    const loader = path.join(workspace.directory, "init-race-loader.mjs");
    writeFileSync(
      loader,
      `import {registerHooks} from 'node:module';registerHooks({load(url,context,next){const result=next(url,context);if(!url.endsWith('/initJournal.js'))return result;let source=result.source.toString();const n='linkSync(stage, manifest);';if(source.split(n).length!==2)throw Error('unique publication required');source='import {writeFileSync as faultWrite} from "node:fs";'+source.replace(n,'faultWrite(manifest, "preserve arriving descriptor");'+n);return {...result,source};}});`,
    );
    const child = run(
      workspace,
      {
        version: 2,
        command: "workspace.init",
        writeContext: info.writeContext,
        idempotencyKey: "racing-init",
      },
      loader,
    );
    assert.equal(child.status, 0, child.stderr);
    fail(JSON.parse(child.stdout), "RECOVERY_CONFLICT");
    assert.equal(
      readFileSync(path.join(workspace.root, "workspace.json"), "utf8"),
      "preserve arriving descriptor",
    );
    assert.equal(existsSync(pendingIntentPath(readPhysicalRoot(workspace.root))), true);
  },
);

for (const cut of ["beforeCommit", "afterCommit"]) {
  test(
    `rebuild CLI SIGKILL ${cut} leaves atomic SQLite outcome and unchanged canonical bytes`,
    linuxOnly,
    (t) => {
      const workspace = setup(t);
      const before = success(send(workspace, { command: "task.list" }));
      const files = [
        "workspace.json",
        ...readdirSync(path.join(workspace.root, "tasks"))
          .sort()
          .map((name) => `tasks/${name}`),
      ];
      const bytes = files.map((file) =>
        readFileSync(path.join(workspace.root, file)).toString("base64"),
      );
      const request = {
        version: 2,
        command: "workspace.rebuild",
        writeContext: before.writeContext,
        idempotencyKey: "rebuild-once",
      };
      const loader = path.join(workspace.directory, "rebuild-kill-loader.mjs");
      writeFileSync(
        loader,
        `import {DatabaseSync} from 'node:sqlite';const exec=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){if(sql==='COMMIT'&&${JSON.stringify(cut)}==='beforeCommit')process.kill(process.pid,'SIGKILL');const result=exec.call(this,sql);if(sql==='COMMIT'&&${JSON.stringify(cut)}==='afterCommit')process.kill(process.pid,'SIGKILL');return result;};`,
      );
      assert.equal(run(workspace, request, loader).signal, "SIGKILL");
      const current = success(send(workspace, { command: "task.list" }));
      if (cut === "beforeCommit") assert.deepEqual(current, before);
      else
        assert.ok(
          (current.result.workspaceRevision as number) >
            (before.result.workspaceRevision as number),
        );
      const restarted = run(workspace, request);
      assert.equal(restarted.status, 0, restarted.stderr);
      const replay = success(JSON.parse(restarted.stdout));
      assert.deepEqual(success(send(workspace, request)).result, replay.result);
      assert.deepEqual(
        files.map((file) => readFileSync(path.join(workspace.root, file)).toString("base64")),
        bytes,
      );
    },
  );
}

test(
  "rebuild rolls back projection/receipt changes if source bytes change before commit",
  linuxOnly,
  (t) => {
    const workspace = setup(t);
    const before = success(send(workspace, { command: "task.list" }));
    const loader = path.join(workspace.directory, "rebuild-race-loader.mjs");
    const file = path.join(workspace.root, "tasks", "c8d4206d-c25a-4317-baa4-a2c5443060e9.json");
    writeFileSync(
      loader,
      `import {registerHooks} from 'node:module';registerHooks({load(url,context,next){const result=next(url,context);if(!url.endsWith('/lifecycleWriter.js'))return result;let source=result.source.toString();const n='const rebuilt = rebuildQueryAuthority(database, root, snapshot);';if(source.split(n).length!==2)throw Error('unique rebuild required');source='import {appendFileSync as faultAppend} from "node:fs";'+source.replace(n,n+'faultAppend('+${JSON.stringify(JSON.stringify(file))}+'," ");');return {...result,source};}});`,
    );
    const request = {
      version: 2,
      command: "workspace.rebuild",
      writeContext: before.writeContext,
      idempotencyKey: "changed-source",
    };
    const child = run(workspace, request, loader);
    assert.equal(child.status, 0, child.stderr);
    fail(JSON.parse(child.stdout), "STALE_FILE");
    const db = new DatabaseSync(workspace.cache);
    try {
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM v2_receipts").get()!.count, 0);
      assert.equal(
        db.prepare("SELECT revision FROM v2_query_state").get()!.revision,
        before.result.workspaceRevision,
      );
    } finally {
      db.close();
    }
    success(send(workspace, request));
  },
);
