import assert from "node:assert/strict";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { TestContext } from "node:test";
import { createCopyTestWorkspace as setup, fail, run, send, success } from "./copyTestWorkspace.js";
import type { CopyTestWorkspace as Workspace } from "./copyTestWorkspace.js";

const linuxOnly = { skip: process.platform !== "linux" };
function emptyWorkspace(t: TestContext) {
  const workspace = setup(t);
  for (const name of readdirSync(workspace.root))
    rmSync(path.join(workspace.root, name), { recursive: true });
  return workspace;
}
const initCuts: Record<string, string> = {
  "tasks-created": String.raw`mkdirSync\(path\.join\(root\.rootPath,\s*"tasks"\),\s*\{\s*recursive:\s*true,\s*mode:\s*0o700\s*\}\);`,
  "stage-written": String.raw`writeDurableFile\(stage,\s*Buffer\.from\(INIT_DESCRIPTOR\)\);`,
  published: String.raw`renameSync\(stage,\s*path\.join\(root\.rootPath,\s*"workspace\.json"\)\);`,
};
function crashInit(workspace: Workspace, cut: string) {
  const info = success(send(workspace, { command: "workspace.info" }));
  const request = {
    version: 2,
    command: "workspace.init",
    writeContext: info.writeContext,
    idempotencyKey: "original-init",
  };
  const loader = path.join(workspace.directory, "init-kill-loader.mjs");
  writeFileSync(
    loader,
    cut === "afterCommit"
      ? `import {DatabaseSync} from 'node:sqlite';const exec=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){const result=exec.call(this,sql);if(sql==='COMMIT')process.kill(process.pid,'SIGKILL');return result;};`
      : `import {registerHooks} from 'node:module';registerHooks({load(url,context,next){const result=next(url,context);if(!url.endsWith('/workspaceInit.js'))return result;const needle=new RegExp(${JSON.stringify(initCuts[cut])},'g');const source=result.source.toString();if(source.match(needle)?.length!==1)throw Error('cut must be unique: '+needle);return {...result,source:source.replace(needle,(found)=>found+'process.kill(process.pid,"SIGKILL");')};}});`,
  );
  const child = run(workspace, request, loader);
  assert.equal(child.signal, "SIGKILL", child.stderr);
  return request;
}

for (const cut of ["tasks-created", "stage-written"]) {
  test(`init CLI SIGKILL at ${cut} leaves an empty folder that init finishes`, linuxOnly, (t) => {
    const workspace = emptyWorkspace(t);
    const request = crashInit(workspace, cut);
    assert.equal(success(send(workspace, { command: "workspace.info" })).result.state, "empty");
    assert.deepEqual(success(send(workspace, request)).result, {
      schemaVersion: 2,
      changed: true,
    });
    assert.equal(
      readFileSync(path.join(workspace.root, "workspace.json"), "utf8"),
      '{"schemaVersion":2}\n',
    );
    assert.deepEqual(readdirSync(workspace.root).sort(), ["tasks", "workspace.json"]);
    assert.equal(success(send(workspace, { command: "task.list" })).result.total, 0);
  });
}

for (const cut of ["published", "afterCommit"]) {
  test(`init CLI SIGKILL at ${cut} leaves a ready empty workspace`, linuxOnly, (t) => {
    const workspace = emptyWorkspace(t);
    const request = crashInit(workspace, cut);
    assert.equal(success(send(workspace, { command: "workspace.info" })).result.state, "ready");
    assert.deepEqual(readdirSync(workspace.root).sort(), ["tasks", "workspace.json"]);
    assert.equal(success(send(workspace, { command: "task.list" })).result.total, 0);
    if (cut === "afterCommit")
      assert.deepEqual(success(send(workspace, request)).result, {
        schemaVersion: 2,
        changed: true,
      });
    else fail(send(workspace, request), "INVALID_CANONICAL");
  });
}

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
