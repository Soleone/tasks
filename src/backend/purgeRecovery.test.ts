import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
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
import { readCanonicalRoot, readRootDescriptor } from "./canonicalReader.js";
import { pendingIntentPath } from "./localDomain.js";
import { purgeRecoveryLocation } from "./purgeJournal.js";
import type { PurgeFile, PurgeIntent } from "./purgeJournal.js";
const corpus = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../scripts/fixtures/workspace/cases.json", import.meta.url)),
    "utf8",
  ),
);
const linux = { skip: process.platform !== "linux" };
function raw(w: Workspace) {
  return readdirSync(path.join(w.root, "tasks"))
    .sort()
    .map((file) => [file, readFileSync(path.join(w.root, "tasks", file)).toString("base64")]);
}
function scenario(t: TestContext, linked = true) {
  const w = setup(t);
  for (const file of readdirSync(path.join(w.root, "tasks")))
    rmSync(path.join(w.root, "tasks", file));
  for (const [index, id] of ["a", "b", "c", "z"].entries())
    writeFileSync(
      path.join(w.root, "tasks", `${id}.json`),
      JSON.stringify({
        ...corpus.taskTemplate,
        id,
        orderKey: `a${index}`,
        ...(id === "z"
          ? {}
          : {
              status: "canceled",
              closedAt: "2026-09-08T14:00:00.000Z",
              ...(linked && id !== "a"
                ? {
                    parentId: id === "b" ? "a" : "b",
                    dependencyIds: id === "b" ? ["a"] : ["a", "b"],
                  }
                : {}),
            }),
      }) + "\n",
    );
  writeFileSync(path.join(w.root, "tasks/a.sync-conflict-test.json"), "Preserve raw conflict\xff");
  const context = success(send(w, { command: "workspace.info" })).writeContext;
  return {
    w,
    request: {
      version: 2,
      command: "task.purgeCanceled",
      args: {},
      writeContext: context,
      idempotencyKey: "purge-key",
      actor: { kind: "human", label: "fixed purge" },
    },
  };
}
function crash(w: Workspace, request: object, cut: string) {
  const pending = pendingIntentPath(readRootDescriptor(w.root)),
    loader = path.join(w.directory, "purge-kill-loader.mjs");
  writeFileSync(
    loader,
    `import{registerHooks}from'node:module';import{existsSync}from'node:fs';import{DatabaseSync}from'node:sqlite';const cut=${JSON.stringify(cut)},pending=${JSON.stringify(pending)};
if(cut==='beforeCommit'||cut==='afterCommit'){const exec=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){if(sql==='COMMIT'&&existsSync(pending)&&cut==='beforeCommit')process.kill(process.pid,'SIGKILL');const r=exec.call(this,sql);if(sql==='COMMIT'&&existsSync(pending)&&cut==='afterCommit')process.kill(process.pid,'SIGKILL');return r;};}
registerHooks({load(url,context,next){const r=next(url,context);if(!r.source)return r;let source=r.source.toString();function replace(n,v){if(source.split(n).length!==2)throw Error('unique purge cut required: '+n);source=source.replace(n,v);}
if(url.endsWith('/purgeWriter.js')){if(cut==='archive'){const n='persistPurgeArchive(intent);';replace(n,n+'process.kill(process.pid,"SIGKILL");');}if(cut==='intent'||cut==='prefix-0'){const n='persistPending(root, intent);';replace(n,n+'process.kill(process.pid,"SIGKILL");');}if(cut==='verified'){const n='const snapshot = applyPurgeJournal(intent);';replace(n,n+'process.kill(process.pid,"SIGKILL");');}}
if(url.endsWith('/purgeJournal.js')){if(cut.startsWith('prefix-')&&cut!=='prefix-0'){source='let deletions=0;'+source;const n='renameSync(target, quarantinePath(intent, index));';replace(n,n+'if(++deletions==='+Number(cut.slice(7))+')process.kill(process.pid,"SIGKILL");');}if(cut==='deletion-synced'){const n='syncDirectory(path.dirname(target));';replace(n,n+'process.kill(process.pid,"SIGKILL");');}if(cut.startsWith('cleanup-')){source='let cleaned=0;'+source;const n='unlinkSync(quarantinePath(intent, index));';replace(n,n+'if(++cleaned==='+Number(cut.slice(8))+')process.kill(process.pid,"SIGKILL");');}}
if(url.endsWith('/localDomain.js')){if(cut==='preparing'){const n='writeDurableFile(temporary, bytes);';replace(n,n+'process.kill(process.pid,"SIGKILL");');}if(cut==='retired'){const n='unlinkSync(pendingIntentPath(root));';replace(n,n+'process.kill(process.pid,"SIGKILL");');}}
return{...r,source};}});`,
  );
  const child = run(w, request, loader);
  assert.equal(child.signal, "SIGKILL", child.stderr);
  return {
    pending,
    intent: existsSync(pending)
      ? (JSON.parse(readFileSync(pending, "utf8")) as PurgeIntent)
      : undefined,
  };
}
for (const linked of [false, true])
  for (const cut of [
    "intent",
    "prefix-0",
    "prefix-1",
    "prefix-2",
    "prefix-3",
    "deletion-synced",
    "verified",
    "beforeCommit",
    "afterCommit",
    "cleanup-1",
    "cleanup-2",
    "cleanup-3",
    "retired",
  ])
    test(
      `actual CLI ${linked ? "linked" : "disjoint"} purge ${cut} recognizes only fixed authored deletion prefixes`,
      linux,
      (t) => {
        const { w, request } = scenario(t, linked),
          before = raw(w),
          { pending, intent } = crash(w, request, cut);
        const retained = raw(w)
          .filter(([name]) => name.startsWith(".syncthing."))
          .map(
            ([name, bytes]) =>
              [name, bytes, lstatSync(path.join(w.root, "tasks", name)).ino] as const,
          );
        if (linked && cut === "prefix-1")
          assert.throws(() => readCanonicalRoot(w.root), /parent|graph|canonical/i);
        if (["afterCommit", "cleanup-1", "cleanup-2", "cleanup-3", "retired"].includes(cut))
          success(send(w, request));
        else fail(send(w, request), "RECOVERY_PENDING");
        if (intent) {
          assert.deepEqual(
            JSON.parse(readFileSync(purgeRecoveryLocation(intent), "utf8"))
              .files.filter((file: { relativePath: string }) =>
                file.relativePath.startsWith("tasks/"),
              )
              .map((file: { relativePath: string; beforeBytes: string }) => [
                path.basename(file.relativePath),
                file.beforeBytes,
              ]),
            before,
          );
          fail(send(w, { command: "task.list" }), "RECOVERY_PENDING");
          assert.equal(
            success(send(w, { command: "workspace.info" })).result.pendingOperationId,
            intent.operationId,
          );
          const resumed = success(recover(w, intent.operationId));
          assert.deepEqual(resumed.result.originalResult, success(send(w, request)).result);
          for (const [name, bytes, inode] of retained) {
            const saved: PurgeFile | undefined = intent.files.find(
              (file) => file.beforeBytes === bytes,
            );
            assert.ok(saved);
            assert.equal(saved.identity.split(":")[1], String(inode));
            assert.equal(existsSync(path.join(w.root, "tasks", name as string)), false);
          }
          assert.equal(existsSync(purgeRecoveryLocation(intent)), true);
        }
        const restarted = run(w, request);
        assert.equal(restarted.status, 0, restarted.stderr);
        const result = success(JSON.parse(restarted.stdout)).result;
        assert.deepEqual(result.purgedIds, ["a", "b", "c"]);
        assert.deepEqual(
          raw(w),
          before.filter(([name]) => !["a.json", "b.json", "c.json"].includes(name)),
        );
        const rows = success(send(w, { command: "activity.list" })).result.activity as {
          operationId: string;
          command: string;
          actor: object;
          createdAt: string;
        }[];
        assert.equal(rows.length, 1);
        assert.equal(rows[0].command, request.command);
        assert.equal(rows[0].operationId, result.operationId);
        assert.deepEqual(rows[0].actor, request.actor);
        if (intent) assert.equal(rows[0].createdAt, intent.at);
        assert.equal(existsSync(pending), false);
      },
    );
for (const cut of ["archive", "preparing"])
  test(
    `actual purge ${cut} preserves canonical bytes and does not auto-adopt private evidence`,
    linux,
    (t) => {
      const { w, request } = scenario(t),
        before = raw(w),
        { pending } = crash(w, request, cut);
      assert.deepEqual(raw(w), before);
      assert.equal(existsSync(pending), false);
      const copies = readdirSync(path.dirname(pending)).filter((file) =>
        file.endsWith(".recovery.json"),
      );
      assert.equal(copies.length, 1);
      const copy = JSON.parse(readFileSync(path.join(path.dirname(pending), copies[0]), "utf8"));
      fail(
        recover(w, copy.operationId),
        cut === "archive" ? "OPERATION_UNAVAILABLE" : "RECOVERY_CONFLICT",
      );
      assert.deepEqual(raw(w), before);
    },
  );
for (const fault of [
  "arrival",
  "foreign-delete-planned",
  "foreign-delete-survivor",
  "foreign-edit",
  "formatting",
  "conflict-arrival",
  "conflict-delete",
  "foreign-entry",
  "manifest-format",
  "descriptor-conflict",
  "task-directory",
  "same-byte-replacement",
  "quarantine-missing",
  "quarantine-divergent",
  "quarantine-replaced",
  "quarantine-symlink",
  "reintroduced",
  "archive-missing",
  "archive-divergent",
  "archive-symlink",
  "intent-partial",
  "intent-canceled-set",
  "intent-preimage",
  "intent-identity",
  "intent-time",
  "intent-actor",
  "intent-key",
  "different-cache",
  "copied-cache",
])
  test(
    `actual pending purge refuses ${fault} without further effects or resurrection`,
    linux,
    (t) => {
      const { w, request } = scenario(t),
        { pending, intent: captured } = crash(w, request, "prefix-1"),
        intent = captured!;
      const target = (id: string) => path.join(w.root, "tasks", `${id}.json`),
        quarantine = path.join(
          w.root,
          "tasks",
          `.syncthing.taskdb-purge-${intent.operationId}-0.tmp`,
        ),
        archive = purgeRecoveryLocation(intent);
      if (fault === "arrival")
        writeFileSync(target("new"), JSON.stringify({ ...corpus.taskTemplate, id: "new" }));
      if (fault === "foreign-delete-planned") rmSync(target("b"));
      if (fault === "foreign-delete-survivor") rmSync(target("z"));
      if (fault === "foreign-edit")
        writeFileSync(
          target("z"),
          JSON.stringify({
            ...JSON.parse(readFileSync(target("z"), "utf8")),
            description: "preserve external edit",
          }),
        );
      if (fault === "formatting")
        writeFileSync(target("b"), readFileSync(target("b"), "utf8") + " ");
      if (fault === "conflict-arrival")
        writeFileSync(path.join(w.root, "tasks/b.sync-conflict-extra.json"), "raw extra");
      if (fault === "conflict-delete") rmSync(path.join(w.root, "tasks/a.sync-conflict-test.json"));
      if (fault === "foreign-entry")
        writeFileSync(path.join(w.root, "tasks/unknown.txt"), "preserve");
      if (fault === "manifest-format")
        writeFileSync(path.join(w.root, "workspace.json"), '{ "schemaVersion": 2 }\n');
      if (fault === "descriptor-conflict")
        writeFileSync(
          path.join(w.root, "workspace.sync-conflict-test.json"),
          '{"schemaVersion":1}',
        );
      if (fault === "task-directory") {
        renameSync(path.join(w.root, "tasks"), path.join(w.directory, "saved-tasks"));
        mkdirSync(path.join(w.root, "tasks"));
        cpSync(path.join(w.directory, "saved-tasks"), path.join(w.root, "tasks"), {
          recursive: true,
        });
      }
      if (fault === "same-byte-replacement") {
        writeFileSync(path.join(w.directory, "replacement"), readFileSync(target("b")));
        renameSync(path.join(w.directory, "replacement"), target("b"));
      }
      if (fault === "quarantine-missing") rmSync(quarantine);
      if (fault === "quarantine-divergent") writeFileSync(quarantine, "partial");
      if (fault === "quarantine-replaced") {
        writeFileSync(path.join(w.directory, "replacement"), readFileSync(quarantine));
        renameSync(path.join(w.directory, "replacement"), quarantine);
      }
      if (fault === "quarantine-symlink") {
        renameSync(quarantine, path.join(w.directory, "preserved"));
        symlinkSync(path.join(w.directory, "preserved"), quarantine);
      }
      if (fault === "reintroduced")
        writeFileSync(
          target("a"),
          Buffer.from(
            intent.files.find((file) => file.relativePath === "tasks/a.json")!.beforeBytes,
            "base64",
          ),
        );
      if (fault === "archive-missing") rmSync(archive);
      if (fault === "archive-divergent") writeFileSync(archive, "{}");
      if (fault === "archive-symlink") {
        renameSync(archive, path.join(w.directory, "saved-copy"));
        symlinkSync(path.join(w.directory, "saved-copy"), archive);
      }
      if (fault === "intent-partial") writeFileSync(pending, "{");
      if (fault.startsWith("intent-") && fault !== "intent-partial") {
        const value = JSON.parse(readFileSync(pending, "utf8"));
        if (fault === "intent-canceled-set") value.purgedIds.pop();
        if (fault === "intent-preimage")
          value.files.find(
            (file: { relativePath: string }) => file.relativePath === "tasks/b.json",
          ).beforeBytes = Buffer.from(JSON.stringify({ ...corpus.taskTemplate, id: "b" })).toString(
            "base64",
          );
        if (fault === "intent-identity")
          value.files.find(
            (file: { relativePath: string }) => file.relativePath === "tasks/a.json",
          ).identity = "1:2";
        if (fault === "intent-time") value.at = "2030-01-01T00:00:00.000Z";
        if (fault === "intent-actor") value.request.actor.label = "altered actor";
        if (fault === "intent-key") value.request.idempotencyKey = "altered key";
        writeFileSync(pending, JSON.stringify(value));
      }
      let selected = w;
      if (fault.endsWith("cache")) {
        const cache = path.join(w.directory, "other.db");
        if (fault === "copied-cache") cpSync(w.cache, cache);
        selected = { ...w, cache };
      }
      const before = raw(w),
        evidence = readFileSync(pending);
      fail(
        recover(selected, intent.operationId),
        fault === "copied-cache" ? "CACHE_FROM_ELSEWHERE" : "RECOVERY_CONFLICT",
      );
      assert.deepEqual(raw(w), before);
      assert.deepEqual(readFileSync(pending), evidence);
    },
  );
for (const prefix of [0, 1, 2, 3])
  test(
    `original-location cache loss after deletion prefix ${prefix} permits explicit fixed recovery, never old-context retry`,
    linux,
    (t) => {
      const { w, request } = scenario(t),
        { intent: captured } = crash(w, request, `prefix-${prefix}`),
        intent = captured!;
      for (const suffix of ["", "-wal", "-shm"]) rmSync(w.cache + suffix, { force: true });
      const context = success(send(w, { command: "workspace.info" })).writeContext;
      assert.notEqual(context, request.writeContext);
      fail(send(w, request), "STALE_WRITE_CONTEXT");
      assert.equal(success(recover(w, intent.operationId)).result.outcome, "complete");
      fail(send(w, request), "STALE_WRITE_CONTEXT");
      assert.deepEqual(
        readCanonicalRoot(w.root).tasks.map((task) => task.id),
        ["z"],
      );
      assert.equal(existsSync(purgeRecoveryLocation(intent)), true);
    },
  );
for (const field of ["counter", "revision"])
  test(`pending purge ${field} budget refuses before further deletion`, linux, (t) => {
    const { w, request } = scenario(t),
      { intent } = crash(w, request, "prefix-1"),
      db = new DatabaseSync(w.cache);
    db.prepare(`UPDATE v2_query_state SET ${field} = ?`).run(Number.MAX_SAFE_INTEGER - 2);
    db.close();
    const before = raw(w);
    fail(recover(w, intent!.operationId), "UNSUPPORTED_COMMAND");
    assert.deepEqual(raw(w), before);
  });
test(
  "recovery's own lost committed reply replays one purge group and retires evidence",
  linux,
  (t) => {
    const { w, request } = scenario(t),
      { intent } = crash(w, request, "prefix-1");
    const context = success(send(w, { command: "workspace.info" })).writeContext;
    const resume = {
      version: 2,
      command: "workspace.recovery.resume",
      writeContext: context,
      idempotencyKey: "recovery-key",
      args: { operationId: intent!.operationId },
    };
    crash(w, resume, "afterCommit");
    const result = success(send(w, resume)).result;
    assert.equal(result.outcome, "complete");
    assert.deepEqual(success(send(w, request)).result, result.originalResult);
    assert.equal(
      (success(send(w, { command: "activity.list" })).result.activity as unknown[]).length,
      1,
    );
  },
);
test(
  "committed receipt remains historical with divergent cleanup; exact quarantine correction retires without a second group",
  linux,
  (t) => {
    const { w, request } = scenario(t),
      { intent: captured } = crash(w, request, "afterCommit"),
      intent = captured!;
    const quarantine = path.join(
        w.root,
        "tasks",
        `.syncthing.taskdb-purge-${intent.operationId}-1.tmp`,
      ),
      fixed = readFileSync(quarantine);
    writeFileSync(quarantine, "bad");
    fail(recover(w, intent.operationId), "RECOVERY_CONFLICT");
    const before = raw(w);
    assert.equal(success(recover(w, intent.operationId)).result.outcome, "complete");
    assert.deepEqual(raw(w), before);
    assert.equal(existsSync(pendingIntentPath(intent.root)), true);
    assert.equal(success(send(w, request)).result.operationId, intent.operationId);
    writeFileSync(quarantine, fixed);
    success(recover(w, intent.operationId));
    assert.equal(existsSync(pendingIntentPath(intent.root)), false);
    assert.equal(
      (success(send(w, { command: "activity.list" })).result.activity as unknown[]).length,
      1,
    );
  },
);
for (const fault of [
  "arrival",
  "descriptor-conflict",
  "formatting",
  "same-byte-replacement",
  "status",
  "incoming-link",
  "task-directory",
])
  test(
    `actual pre-intent purge ${fault} race preserves external edits and writes no canonical files`,
    linux,
    (t) => {
      const { w, request } = scenario(t, false),
        loader = path.join(w.directory, "purge-race.mjs"),
        target = path.join(w.root, "tasks/b.json");
      const mutate =
        fault === "arrival"
          ? `writeFileSync(${JSON.stringify(path.join(w.root, "tasks/new.json"))},${JSON.stringify(JSON.stringify({ ...corpus.taskTemplate, id: "new" }))});`
          : fault === "descriptor-conflict"
            ? `writeFileSync(${JSON.stringify(path.join(w.root, "workspace.sync-conflict-test.json"))},'{"schemaVersion":1}');`
            : fault === "formatting"
              ? `writeFileSync(${JSON.stringify(target)},readFileSync(${JSON.stringify(target)},'utf8')+' ');`
              : fault === "same-byte-replacement"
                ? `writeFileSync(${JSON.stringify(path.join(w.directory, "swap"))},readFileSync(${JSON.stringify(target)}));renameSync(${JSON.stringify(path.join(w.directory, "swap"))},${JSON.stringify(target)});`
                : fault === "status"
                  ? `writeFileSync(${JSON.stringify(target)},JSON.stringify({...JSON.parse(readFileSync(${JSON.stringify(target)},'utf8')),status:'open',closedAt:null}));`
                  : fault === "incoming-link"
                    ? `writeFileSync(${JSON.stringify(path.join(w.root, "tasks/z.json"))},JSON.stringify({...JSON.parse(readFileSync(${JSON.stringify(path.join(w.root, "tasks/z.json"))},'utf8')),parentId:'a'}));`
                    : `renameSync(${JSON.stringify(path.join(w.root, "tasks"))},${JSON.stringify(path.join(w.directory, "saved"))});mkdirSync(${JSON.stringify(path.join(w.root, "tasks"))});cpSync(${JSON.stringify(path.join(w.directory, "saved"))},${JSON.stringify(path.join(w.root, "tasks"))},{recursive:true});`;
      writeFileSync(
        loader,
        `import{registerHooks}from'node:module';registerHooks({load(url,ctx,next){const r=next(url,ctx);if(!url.endsWith('/purgeWriter.js'))return r;let s=r.source.toString(),n='persistPurgeArchive(intent);';if(s.split(n).length!==2)throw Error('unique race cut required');s="import{readFileSync,writeFileSync,renameSync,mkdirSync,cpSync}from'node:fs';"+s.replace(n,n+${JSON.stringify(mutate)});return{...r,source:s};}});`,
      );
      const child = run(w, request, loader);
      assert.equal(child.status, 0, child.stderr);
      fail(
        JSON.parse(child.stdout),
        fault === "arrival" || fault === "descriptor-conflict" || fault === "task-directory"
          ? "STALE_SCOPE"
          : "STALE_FILE",
      );
      for (const id of ["a", "b", "c"])
        assert.equal(existsSync(path.join(w.root, "tasks", `${id}.json`)), true);
      assert.equal(existsSync(pendingIntentPath(readRootDescriptor(w.root))), false);
      assert.equal(
        raw(w).some(([name]) => name.startsWith(".syncthing.")),
        false,
      );
      const db = new DatabaseSync(w.cache);
      assert.equal(db.prepare("SELECT count(*) AS n FROM v2_receipts").get()!.n, 0);
      db.close();
    },
  );

test(
  "cache loss after committed partial cleanup refuses unexplained absence without rebuilding proof",
  linux,
  (t) => {
    const { w, request } = scenario(t),
      { intent } = crash(w, request, "cleanup-1");
    rmSync(w.cache);
    const before = raw(w);
    fail(recover(w, intent!.operationId), "RECOVERY_CONFLICT");
    assert.deepEqual(raw(w), before);
    assert.equal(existsSync(purgeRecoveryLocation(intent!)), true);
  },
);
