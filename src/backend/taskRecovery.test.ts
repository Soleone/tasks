import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  createCopyTestWorkspace as setup,
  fail,
  recover,
  run,
  send,
  success,
} from "./copyTestWorkspace.js";
import { readRootDescriptor } from "./canonicalReader.js";
import { pendingIntentPath, localDomain } from "./localDomain.js";
import type { CanonicalTask } from "./taskModel.js";

const id = "c8d4206d-c25a-4317-baa4-a2c5443060e9";
const linuxOnly = { skip: process.platform !== "linux" };
for (const collision of ["canonical", "conflict"]) {
  test(
    `capture refuses generated-ID ${collision} collision before staging instead of silently replacing it`,
    linuxOnly,
    (t) => {
      const workspace = setup(t);
      const collisionId = "62f159c1-22a7-45cb-89a0-c0c35aaeb1ed";
      if (collision === "conflict") {
        rmSync(path.join(workspace.root, "tasks", `${collisionId}.json`));
        writeFileSync(
          path.join(workspace.root, "tasks", `${collisionId}.sync-conflict-peer.json`),
          "preserve raw conflict bytes",
        );
      }
      const info = success(send(workspace, { command: "workspace.info" }));
      const before = readdirSync(path.join(workspace.root, "tasks"))
        .sort()
        .map((name) => [
          name,
          readFileSync(path.join(workspace.root, "tasks", name)).toString("base64"),
        ]);
      const loader = path.join(workspace.directory, "capture-collision-loader.mjs");
      writeFileSync(
        loader,
        `import {registerHooks} from 'node:module';registerHooks({load(url,context,next){const result=next(url,context);if(!url.endsWith('/createWriter.js'))return result;const source=result.source.toString(),n='const taskId = randomUUID();';if(source.split(n).length!==2)throw Error('unique allocation required');return {...result,source:source.replace(n,'const taskId = '+${JSON.stringify(JSON.stringify(collisionId))}+';')};}});`,
      );
      const request = {
        version: 2,
        command: "task.create",
        args: { title: "New" },
        writeContext: info.writeContext,
        idempotencyKey: "colliding-plan",
      };
      const child = run(workspace, request, loader);
      assert.equal(child.status, 0, child.stderr);
      fail(JSON.parse(child.stdout), "STALE_SCOPE");
      assert.deepEqual(
        readdirSync(path.join(workspace.root, "tasks"))
          .sort()
          .map((name) => [
            name,
            readFileSync(path.join(workspace.root, "tasks", name)).toString("base64"),
          ]),
        before,
      );
      assert.equal(existsSync(pendingIntentPath(readRootDescriptor(workspace.root))), false);
      const explicit = run(workspace, { ...request, idempotencyKey: "explicit-new-plan" });
      assert.equal(explicit.status, 0, explicit.stderr);
      success(JSON.parse(explicit.stdout));
    },
  );
}

for (const cut of ["stage-written", "published", "beforeCommit", "afterCommit", "flush-refusal"]) {
  test(
    `unjournaled capture interruption ${cut} leaves orphans or accepts the publish-before-receipt duplicate window`,
    linuxOnly,
    (t) => {
      const workspace = setup(t);
      const info = success(send(workspace, { command: "workspace.info" }));
      const request = {
        version: 2,
        command: "task.create",
        args: { title: "Unjournaled capture" },
        writeContext: info.writeContext,
        idempotencyKey: "unjournaled",
      };
      const tasks = path.join(workspace.root, "tasks");
      const before = readdirSync(tasks).sort();
      const loader = path.join(workspace.directory, "unjournaled-kill.mjs");
      writeFileSync(
        loader,
        `import {registerHooks} from 'node:module';import {DatabaseSync} from 'node:sqlite';
const cut=${JSON.stringify(cut)};
if(cut==='beforeCommit'||cut==='afterCommit'){const exec=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){if(sql==='COMMIT'&&cut==='beforeCommit')process.kill(process.pid,'SIGKILL');const result=exec.call(this,sql);if(sql==='COMMIT'&&cut==='afterCommit')process.kill(process.pid,'SIGKILL');return result;};}
registerHooks({load(url,context,next){const result=next(url,context);if(!url.endsWith('/createWriter.js')||!['stage-written','published','flush-refusal'].includes(cut))return result;
const source=result.source.toString(),needle=cut==='stage-written'?'writeDurableFile(stage, bytes);':cut==='flush-refusal'?'syncDirectory(taskDirectory);':'renameSync(stage, target);';
if(source.split(needle).length!==2)throw Error('unique create cut required');return {...result,source:source.replace(needle,cut==='flush-refusal'?'throw Object.assign(new Error("test-only directory flush refusal"),{code:"EPERM"});'+needle:needle+'process.kill(process.pid,"SIGKILL");')};}});`,
      );
      const interruptedRun = run(workspace, request, loader);
      if (cut === "flush-refusal") {
        assert.equal(interruptedRun.status, 0, interruptedRun.stderr);
        fail(JSON.parse(interruptedRun.stdout), "INVALID_STORAGE");
      } else assert.equal(interruptedRun.signal, "SIGKILL", interruptedRun.stderr);
      const root = readRootDescriptor(workspace.root);
      assert.equal(existsSync(pendingIntentPath(root)), false);
      assert.equal(
        readdirSync(localDomain(root)).some((name) => name.startsWith("create-")),
        false,
      );
      const extra = readdirSync(tasks).filter((name) => !before.includes(name));
      assert.equal(extra.length, 1);
      const interrupted = path.join(tasks, extra[0]);
      const interruptedBytes = readFileSync(interrupted);
      assert.equal(extra[0].startsWith(".syncthing."), cut === "stage-written");
      const database = new DatabaseSync(workspace.cache);
      const committed = cut === "afterCommit" ? 1 : 0;
      assert.equal(database.prepare("SELECT count(*) AS n FROM v2_receipts").get()!.n, committed);
      assert.equal(database.prepare("SELECT count(*) AS n FROM v2_operations").get()!.n, committed);
      database.close();
      assert.equal(success(send(workspace, { command: "workspace.info" })).result.state, "ready");
      fail(recover(workspace, "unknown-interrupted-create"), "OPERATION_UNAVAILABLE");
      const retry = success(send(workspace, request));
      const created = retry.result.task as CanonicalTask;
      if (cut === "afterCommit") assert.equal(`${created.id}.json`, extra[0]);
      else assert.notEqual(`${created.id}.json`, extra[0]);
      assert.deepEqual(readFileSync(interrupted), interruptedBytes);
      const canonical = readdirSync(tasks).filter((name) => name.endsWith(".json"));
      assert.equal(
        canonical.length,
        before.length + (["published", "beforeCommit", "flush-refusal"].includes(cut) ? 2 : 1),
      );
      assert.deepEqual(success(send(workspace, request)).result, retry.result);
      const rows = success(send(workspace, { command: "activity.list" })).result.activity as {
        after: CanonicalTask;
      }[];
      assert.equal(rows.length, 1);
      assert.equal(rows[0].after.id, created.id);
      for (const name of before) assert.ok(existsSync(path.join(tasks, name)));
    },
  );
}

for (const fault of [
  "parent-edit",
  "parent-missing",
  "destination",
  "destination-conflict",
  "task-directory",
  "physical-root",
  "unrelated-edit",
  "unrelated-arrival",
]) {
  test(
    `unjournaled capture pre-publication ${fault} rechecks only selected scope and physical bindings`,
    linuxOnly,
    (t) => {
      const workspace = setup(t);
      const info = success(send(workspace, { command: "workspace.info" }));
      const loader = path.join(workspace.directory, "capture-selected-guard.mjs");
      const parent = path.join(workspace.root, "tasks", `${id}.json`);
      const other = path.join(workspace.root, "tasks", "62f159c1-22a7-45cb-89a0-c0c35aaeb1ed.json");
      const mutations: Record<string, string> = {
        "parent-edit": `faultWrite(${JSON.stringify(parent)}, JSON.stringify({...JSON.parse(faultRead(${JSON.stringify(parent)},'utf8')), status:'canceled',closedAt:new Date().toISOString()}));`,
        "parent-missing": `faultRemove(${JSON.stringify(parent)});`,
        destination: 'faultWrite(target,"preserve arriving destination");',
        "destination-conflict":
          'faultWrite(target.replace(".json",".sync-conflict-peer.json"),"preserve arriving conflict");',
        "task-directory": `faultRename(taskDirectory, ${JSON.stringify(path.join(workspace.directory, "kept-tasks"))});faultCopy(${JSON.stringify(path.join(workspace.directory, "kept-tasks"))},taskDirectory,{recursive:true});`,
        "physical-root": `faultRename(root.rootPath,${JSON.stringify(path.join(workspace.directory, "kept-root"))});faultCopy(${JSON.stringify(path.join(workspace.directory, "kept-root"))},root.rootPath,{recursive:true});`,
        "unrelated-edit": `faultWrite(${JSON.stringify(other)},' '+faultRead(${JSON.stringify(other)},'utf8'));`,
        "unrelated-arrival": `faultWrite(taskDirectory+'/late.json',JSON.stringify({...JSON.parse(faultRead(${JSON.stringify(other)},'utf8')),id:'late'}));`,
      };
      writeFileSync(
        loader,
        `import {registerHooks} from 'node:module';registerHooks({load(url,context,next){const result=next(url,context);if(!url.endsWith('/createWriter.js'))return result;
const source=result.source.toString(),needle='guardCreateDestination(snapshot, taskDirectoryIdentity, taskId, task.parentId);';
if(source.split(needle).length!==2)throw Error('unique selected guard required');return {...result,source:'import {writeFileSync as faultWrite,readFileSync as faultRead,rmSync as faultRemove,renameSync as faultRename,cpSync as faultCopy} from "node:fs";'+source.replace(needle,${JSON.stringify(mutations[fault])}+needle)};}});`,
      );
      const child = run(
        workspace,
        {
          version: 2,
          command: "task.create",
          args: { title: "Child", parentId: id },
          writeContext: info.writeContext,
          idempotencyKey: "selected-guard",
        },
        loader,
      );
      assert.equal(child.status, 0, child.stderr);
      const response = JSON.parse(child.stdout);
      if (fault.startsWith("unrelated-")) success(response);
      else fail(response, fault.startsWith("parent-") ? "STALE_FILE" : "STALE_SCOPE");
      const root = readRootDescriptor(workspace.root);
      assert.equal(existsSync(pendingIntentPath(root)), false);
      if (!fault.startsWith("unrelated-")) {
        assert.equal(
          readdirSync(path.join(workspace.root, "tasks")).filter((name) =>
            name.startsWith(".syncthing.taskdb-create-"),
          ).length,
          1,
        );
        const database = new DatabaseSync(workspace.cache);
        assert.equal(database.prepare("SELECT count(*) AS n FROM v2_receipts").get()!.n, 0);
        assert.equal(database.prepare("SELECT count(*) AS n FROM v2_operations").get()!.n, 0);
        database.close();
      }
      if (fault === "destination") {
        const target = readdirSync(path.join(workspace.root, "tasks")).find(
          (name) =>
            name.endsWith(".json") &&
            readFileSync(path.join(workspace.root, "tasks", name), "utf8") ===
              "preserve arriving destination",
        );
        assert.ok(target);
      }
    },
  );
}

test(
  "unjournaled capture uses one full canonical snapshot, no recovery journal, and stable post-success authority",
  linuxOnly,
  (t) => {
    const workspace = setup(t);
    const info = success(send(workspace, { command: "workspace.info" }));
    const log = path.join(workspace.directory, "create-scans.txt");
    const loader = path.join(workspace.directory, "create-scans.mjs");
    writeFileSync(
      loader,
      `import {registerHooks} from 'node:module';registerHooks({load(url,context,next){const result=next(url,context);if(!url.endsWith('/canonicalReader.js'))return result;
const source=result.source.toString(),needle='export function readCanonicalRoot(directory) {';
if(source.split(needle).length!==2)throw Error('unique full scan required');return {...result,source:'import {appendFileSync as scanLog} from "node:fs";'+source.replace(needle,needle+'scanLog('+${JSON.stringify(JSON.stringify(log))}+',"scan");')};}});`,
    );
    const request = {
      version: 2,
      command: "task.create",
      args: { title: "One snapshot", parentId: id },
      writeContext: info.writeContext,
      idempotencyKey: "one-snapshot",
    };
    const child = run(workspace, request, loader);
    assert.equal(child.status, 0, child.stderr);
    const response = success(JSON.parse(child.stdout));
    assert.equal(readFileSync(log, "utf8"), "scan");
    const task = response.result.task as CanonicalTask & { version: number };
    assert.equal(
      (
        success(send(workspace, { command: "task.get", args: { id: task.id } })).result.task as {
          version: number;
        }
      ).version,
      task.version,
    );
    const root = readRootDescriptor(workspace.root);
    assert.equal(existsSync(pendingIntentPath(root)), false);
    assert.equal(
      readdirSync(localDomain(root)).some((name) => name.startsWith("create-")),
      false,
    );
    assert.equal(
      readdirSync(path.join(workspace.root, "tasks")).some((name) =>
        name.startsWith(".syncthing.taskdb-create-"),
      ),
      false,
    );
    const replay = run(workspace, request, loader);
    assert.equal(replay.status, 0, replay.stderr);
    assert.deepEqual(success(JSON.parse(replay.stdout)).result, response.result);
    assert.equal(readFileSync(log, "utf8"), "scan");
  },
);
