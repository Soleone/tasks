import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
import { readRootDescriptor } from "./canonicalReader.js";
import { pendingIntentPath } from "./localDomain.js";
import { fail, send, success } from "./copyTestWorkspace.js";
import {
  createDoctorWorkspace as setup,
  doctorCorpus as corpus,
  doctorLinux as linux,
  doctorRaw as raw,
  planDoctor,
} from "./doctorTestWorkspace.js";
import type { DoctorIntent } from "./doctorJournal.js";
const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
function run(w: ReturnType<typeof setup>, request: object, loader?: string) {
  return spawnSync(
    process.execPath,
    [
      ...(loader ? ["--import", loader] : []),
      cli,
      "--stdio",
      "--root",
      w.root,
      "--database",
      w.cache,
    ],
    { input: JSON.stringify(request), encoding: "utf8", env: process.env, timeout: 10000 },
  );
}
function response(w: ReturnType<typeof setup>, request: object) {
  const child = run(w, request);
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}
function pending(w: ReturnType<typeof setup>): DoctorIntent {
  return JSON.parse(readFileSync(pendingIntentPath(readRootDescriptor(w.root)), "utf8"));
}
function scenario(t: TestContext, kind = "complex") {
  const w = setup(
    t,
    kind === "complex" || kind === "multiple"
      ? {
          a: { title: "Original" },
          child: { parentId: "a", dependencyIds: ["a"] },
          z: { orderKey: "a2" },
        }
      : kind === "dangling"
        ? { a: { parentId: "missing", dependencyIds: ["missing"] } }
        : { a: {} },
    kind === "dangling" ? {} : { a: { title: "Other" } },
  );
  if (kind === "multiple")
    writeFileSync(
      path.join(w.root, "tasks/a.sync-conflict-extra.json"),
      JSON.stringify({ ...corpus.taskTemplate, id: "a", title: "Extra" }),
    );
  if (kind !== "dangling") return { w, ...planDoctor(w, kind !== "simple", kind !== "simple") };
  const inspected = success(send(w, { command: "workspace.doctor.inspect" })),
    planned = success(
      send(w, {
        command: "workspace.doctor.plan",
        writeContext: inspected.writeContext,
        idempotencyKey: "plan",
        args: {
          kind: "repair-links",
          edits: [{ taskId: "a", parentId: null, removeDependencyIds: ["missing"] }],
        },
      }),
    );
  const db = new DatabaseSync(w.cache),
    plan = JSON.parse(db.prepare("SELECT payload FROM v2_doctor_plans").get()!.payload as string);
  db.close();
  return {
    w,
    plan,
    request: {
      version: 2,
      command: "workspace.doctor.apply",
      writeContext: inspected.writeContext,
      idempotencyKey: "apply",
      args: { planId: planned.result.planId },
    },
  };
}
function kill(w: ReturnType<typeof setup>, request: object, cut: string) {
  const loader = path.join(w.directory, "doctor-kill.mjs");
  writeFileSync(
    loader,
    `import{registerHooks}from'node:module';import{DatabaseSync}from'node:sqlite';let publications=0,cleanups=0,retirements=0;const cut=${JSON.stringify(cut)};
if(cut==='beforeCommit'||cut==='afterCommit'){const exec=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){if(sql==='COMMIT'&&cut==='beforeCommit')process.kill(process.pid,'SIGKILL');const out=exec.call(this,sql);if(sql==='COMMIT'&&cut==='afterCommit')process.kill(process.pid,'SIGKILL');return out;};}
registerHooks({load(url,ctx,next){const r=next(url,ctx);let s=r.source?.toString(),needle,patch;if(url.endsWith('/doctorApply.js')){needle=cut==='archive'?'persistDoctorArchive(intent);':cut==='intent'?'persistPending(root, intent);':null;}
if(url.endsWith('/doctorJournal.js')){needle=cut==='prefix-0'?'const progress = readProgress(intent);':cut.startsWith('prefix-')?'state.published = true;':cut==='stage-written'?'syncDirectory(path.dirname(stage));':cut==='stage-bound'?'state.stageIdentity = fileIdentity(stage);':cut==='publication-started'?'state.started = true;':cut==='verified'?'        verifyOutputs(intent);':cut.startsWith('cleanup-')?'renameSync(path.join(intent.root.rootPath, relative), quarantinePath(intent, index));':cut.startsWith('retirement-')?'unlinkSync(file);':null;
if(cut.startsWith('prefix-')&&cut!=='prefix-0')patch='if(++publications===Number(cut.split("-")[1]))process.kill(process.pid,"SIGKILL");';
if(cut.startsWith('cleanup-'))patch='if(++cleanups===Number(cut.split("-")[1]))process.kill(process.pid,"SIGKILL");';if(cut.startsWith('retirement-'))patch='if(++retirements===Number(cut.split("-")[1]))process.kill(process.pid,"SIGKILL");';
if(cut==='publication-started'||cut==='stage-bound')patch='saveProgress(intent,progress);process.kill(process.pid,"SIGKILL");';
}
if(url.endsWith('/localDomain.js')&&cut==='retired')needle='unlinkSync(pendingIntentPath(root));';
if(needle){if(s.split(needle).length!==2)throw Error('unique doctor cut required: '+needle);s='let publications=0,cleanups=0,retirements=0;const cut='+JSON.stringify(cut)+';'+s.replace(needle,needle+(patch||'process.kill(process.pid,"SIGKILL");'));return{...r,source:s};}return r;}});`,
  );
  const child = run(w, request, loader);
  assert.equal(child.signal, "SIGKILL", child.stderr);
}
function resume(w: ReturnType<typeof setup>, intent: DoctorIntent, key = "resume") {
  const info = success(send(w, { command: "workspace.info" }));
  return {
    version: 2,
    command: "workspace.recovery.resume",
    writeContext: info.writeContext,
    idempotencyKey: key,
    args: { operationId: intent.operationId },
  };
}
for (const [kind, count, cleanups] of [
  ["simple", 1, 1],
  ["complex", 3, 1],
  ["multiple", 4, 2],
  ["dangling", 1, 0],
] as const) {
  const cuts = [
    "intent",
    ...Array.from({ length: count + 1 }, (_, n) => `prefix-${n}`),
    "stage-written",
    "stage-bound",
    "verified",
    ...Array.from({ length: cleanups }, (_, n) => `cleanup-${n + 1}`),
    "beforeCommit",
    "afterCommit",
    // Retirement deletes quarantined conflict copies; a dangling repair quarantines none.
    ...(cleanups ? ["retirement-1"] : []),
    "retired",
  ];
  for (const cut of cuts)
    test(
      `actual doctor ${kind} ${cut} retains fixed IDs/bytes/time and resumes only confirmed evidence`,
      linux,
      (t) => {
        const { w, request, plan } = scenario(t, kind),
          before = raw(w);
        kill(w, request, cut);
        const location = pendingIntentPath(readRootDescriptor(w.root)),
          intent: DoctorIntent = existsSync(location)
            ? pending(w)
            : JSON.parse(
                readFileSync(
                  path.join(path.dirname(location), `doctor-${plan.planId}.recovery.json`),
                  "utf8",
                ),
              );
        const archive = readFileSync(
          path.join(path.dirname(location), `doctor-${plan.planId}.recovery.json`),
        );
        assert.deepEqual(
          intent.plan.source.files
            .filter((file) => file.relativePath.startsWith("tasks/"))
            .map((file) => [path.basename(file.relativePath), file.beforeBytes]),
          before,
        );
        let result;
        if (cut === "retired") result = success(response(w, request)).result;
        else {
          fail(send(w, { command: "task.list" }), "RECOVERY_PENDING");
          assert.equal(
            success(send(w, { command: "workspace.doctor.inspect" })).result.pendingOperationId,
            intent.operationId,
          );
          const resumed = success(response(w, resume(w, intent))).result;
          result = resumed.originalResult as Record<string, unknown>;
        }
        assert.equal(result.planId, plan.planId);
        assert.deepEqual(success(response(w, request)).result, result);
        assert.equal(existsSync(location), false);
        const actual = success(send(w, { command: "task.list", args: { limit: 100 } })).result
          .tasks as { id: string; updatedAt: string }[];
        assert.equal(actual.length, plan.nextTasks.length);
        for (const file of intent.writes)
          assert.equal(
            readFileSync(path.join(w.root, "tasks", `${file.taskId}.json`)).toString("base64"),
            file.nextBytes,
          );
        for (const id of plan.editedIds)
          assert.equal(actual.find((task) => task.id === id)!.updatedAt, intent.at);
        assert.deepEqual(readFileSync(result.recoveryLocation as string), archive);
        assert.equal(
          readdirSync(path.join(w.root, "tasks")).some((name) => name.startsWith(".syncthing.")),
          false,
        );
        const activity = success(send(w, { command: "activity.list" })).result.activity as {
          operationId: string;
          createdAt: string;
          actor: object;
        }[];
        assert.equal(activity.length, 1);
        assert.equal(activity[0].operationId, intent.operationId);
        assert.equal(activity[0].createdAt, intent.at);
        assert.deepEqual(activity[0].actor, intent.request.actor);
      },
    );
}
test(
  "original doctor-cleanup pauses before conflict removal, then recovery preserves all versions and fixed clone identity",
  linux,
  (t) => {
    const entry = corpus.cases.find((entry: { id: string }) => entry.id === "doctor-cleanup"),
      { w, request, plan } = scenario(t, "simple"),
      original = raw(w);
    assert.equal(entry.action.kind, "interrupt-before-conflict-cleanup");
    kill(w, request, "verified");
    const intent = pending(w);
    assert.ok(existsSync(path.join(w.root, "tasks/a.sync-conflict-test.json")));
    assert.ok(existsSync(path.join(w.root, "tasks", `${plan.clones[0].taskId}.json`)));
    const result = success(response(w, resume(w, intent))).result.originalResult as Record<
      string,
      unknown
    >;
    assert.equal(raw(w).length, entry.expect.taskCount);
    assert.equal((result.repairedIds as string[]).includes(plan.clones[0].taskId), true);
    const archive = JSON.parse(readFileSync(result.recoveryLocation as string, "utf8"));
    assert.deepEqual(
      archive.plan.source.files
        .filter((file: { relativePath: string }) => file.relativePath.startsWith("tasks/"))
        .map((file: { relativePath: string; beforeBytes: string }) => [
          path.basename(file.relativePath),
          file.beforeBytes,
        ]),
      original,
    );
    assert.equal(existsSync(path.join(w.root, "tasks/a.sync-conflict-test.json")), false);
  },
);
for (const cut of ["intent", "prefix-1", "prefix-2", "prefix-3", "cleanup-1"])
  test(
    `original-location fresh cache can explicitly finish doctor ${cut}, never adopt old request authority`,
    linux,
    (t) => {
      const { w, request, plan } = scenario(t);
      kill(w, request, cut);
      const intent = pending(w);
      renameSync(w.cache, `${w.cache}.lost`);
      const fresh = resume(w, intent);
      assert.notEqual(fresh.writeContext, request.writeContext);
      const result = success(response(w, fresh)).result.originalResult as Record<string, unknown>;
      assert.equal(result.planId, plan.planId);
      fail(send(w, request), "STALE_WRITE_CONTEXT");
      assert.equal(raw(w).length, plan.nextTasks.length);
      assert.equal(
        (success(send(w, { command: "activity.list" })).result.activity as object[]).length,
        1,
      );
    },
  );
for (const fault of [
  "canonical-edit",
  "canonical-missing",
  "arrival",
  "conflict-edit",
  "conflict-missing",
  "manifest",
  "descriptor-conflict",
  "task-directory",
  "stage-missing",
  "stage-edit",
  "stage-replaced",
  "stage-symlink",
  "target-missing",
  "target-same-byte",
  "quarantine-missing",
  "quarantine-edit",
  "quarantine-replaced",
  "quarantine-symlink",
  "reintroduced-conflict",
  "archive-missing",
  "archive-edit",
  "archive-symlink",
  "progress-missing",
  "progress-partial",
  "progress-preparing",
  "intent-partial",
  "pending-symlink",
  "intent-next",
  "intent-source",
  "intent-time",
  "intent-key",
  "intent-actor",
  "different-cache",
  "copied-cache",
])
  test(
    `doctor recovery ${fault} preserves prefix/divergence and refuses any further publication or deletion`,
    linux,
    (t) => {
      const { w, request } = scenario(t),
        cleaned = fault.startsWith("quarantine-") || fault === "reintroduced-conflict";
      kill(
        w,
        request,
        cleaned
          ? "cleanup-1"
          : fault.startsWith("stage-")
            ? "stage-bound"
            : fault.startsWith("target-")
              ? "prefix-1"
              : "intent",
      );
      const intent = pending(w),
        domain = path.dirname(pendingIntentPath(readRootDescriptor(w.root))),
        archive = path.join(domain, `doctor-${intent.plan.planId}.recovery.json`),
        progress = path.join(domain, `doctor-${intent.operationId}.progress.json`),
        stage = path.join(w.root, "tasks", `.syncthing.taskdb-doctor-${intent.operationId}-0.tmp`),
        quarantine = path.join(
          w.root,
          "tasks",
          `.syncthing.taskdb-doctor-conflict-${intent.operationId}-0.tmp`,
        ),
        target = path.join(w.root, "tasks", `${intent.writes[0].taskId}.json`),
        original = path.join(w.root, "tasks/a.json"),
        conflict = path.join(w.root, "tasks/a.sync-conflict-test.json");
      if (fault === "canonical-edit") writeFileSync(original, readFileSync(original, "utf8") + " ");
      if (fault === "canonical-missing") rmSync(original);
      if (fault === "arrival")
        writeFileSync(
          path.join(w.root, "tasks/new.json"),
          JSON.stringify({ ...corpus.taskTemplate, id: "new" }),
        );
      if (fault === "conflict-edit") writeFileSync(conflict, "{}");
      if (fault === "conflict-missing") rmSync(conflict);
      if (fault === "manifest")
        writeFileSync(path.join(w.root, "workspace.json"), '{ "schemaVersion":2 }');
      if (fault === "descriptor-conflict")
        writeFileSync(
          path.join(w.root, "workspace.sync-conflict-test.json"),
          '{"schemaVersion":1}',
        );
      if (fault === "task-directory") {
        renameSync(path.join(w.root, "tasks"), path.join(w.directory, "old-tasks"));
        mkdirSync(path.join(w.root, "tasks"));
        cpSync(path.join(w.directory, "old-tasks"), path.join(w.root, "tasks"), {
          recursive: true,
        });
      }
      if (fault === "stage-missing") rmSync(stage);
      if (fault === "stage-edit") writeFileSync(stage, "{}");
      if (fault === "stage-replaced") {
        const bytes = readFileSync(stage);
        renameSync(stage, path.join(w.directory, "old-stage"));
        writeFileSync(stage, bytes);
      }
      if (fault === "stage-symlink") {
        renameSync(stage, path.join(w.directory, "old-stage"));
        symlinkSync(path.join(w.directory, "old-stage"), stage);
      }
      if (fault === "target-missing") rmSync(target);
      if (fault === "target-same-byte") {
        const bytes = readFileSync(target);
        renameSync(target, path.join(w.directory, "old-target"));
        writeFileSync(target, bytes);
      }
      if (fault === "quarantine-missing") rmSync(quarantine);
      if (fault === "quarantine-edit") writeFileSync(quarantine, "{}");
      if (fault === "quarantine-replaced") {
        const bytes = readFileSync(quarantine);
        renameSync(quarantine, path.join(w.directory, "old-quarantine"));
        writeFileSync(quarantine, bytes);
      }
      if (fault === "quarantine-symlink") {
        renameSync(quarantine, path.join(w.directory, "old-quarantine"));
        symlinkSync(path.join(w.directory, "old-quarantine"), quarantine);
      }
      if (fault === "reintroduced-conflict") writeFileSync(conflict, readFileSync(quarantine));
      if (fault === "archive-missing") rmSync(archive);
      if (fault === "archive-edit") writeFileSync(archive, "{}");
      if (fault === "archive-symlink") {
        renameSync(archive, `${archive}.old`);
        symlinkSync(`${archive}.old`, archive);
      }
      if (fault === "progress-missing") rmSync(progress);
      if (fault === "progress-partial") writeFileSync(progress, "{");
      if (fault === "progress-preparing") writeFileSync(`${progress}.preparing`, "{");
      if (fault.startsWith("intent-")) {
        const file = pendingIntentPath(readRootDescriptor(w.root));
        if (fault === "intent-next")
          intent.writes[0].nextBytes = Buffer.from("{}").toString("base64");
        if (fault === "intent-source") intent.plan.nextTasks[0].title = "Changed";
        if (fault === "intent-time") intent.at = corpus.taskTemplate.updatedAt;
        if (fault === "intent-key") intent.request.idempotencyKey = "other";
        if (fault === "intent-actor") intent.request.actor.label = "other";
        writeFileSync(file, fault === "intent-partial" ? "{" : JSON.stringify(intent));
      }
      if (fault === "pending-symlink") {
        const file = pendingIntentPath(readRootDescriptor(w.root));
        renameSync(file, `${file}.old`);
        symlinkSync(path.join(w.directory, "missing-intent"), file);
      }
      if (fault === "different-cache") w.cache = path.join(w.directory, "different.db");
      if (fault === "copied-cache") {
        cpSync(w.cache, `${w.cache}.copy`);
        w.cache = `${w.cache}.copy`;
      }
      const before = raw(w),
        result = response(w, resume(w, intent));
      fail(result, "RECOVERY_CONFLICT");
      assert.deepEqual(raw(w), before);
      assert.ok(
        lstatSync(pendingIntentPath(readRootDescriptor(w.root)), { throwIfNoEntry: false }),
      );
    },
  );
test(
  "broken unpublished-intent symlink remains pending evidence, never an empty intent slot",
  linux,
  (t) => {
    const { w, request } = scenario(t),
      file = `${pendingIntentPath(readRootDescriptor(w.root))}.preparing`,
      before = raw(w);
    symlinkSync(path.join(w.directory, "missing-intent"), file);
    assert.equal(success(send(w, { command: "workspace.info" })).result.state, "recovery_pending");
    fail(send(w, request), "RECOVERY_CONFLICT");
    assert.deepEqual(raw(w), before);
  },
);

test(
  "unpublished archive has no canonical effects and is never auto-adopted as an applied plan",
  linux,
  (t) => {
    const { w, request } = scenario(t),
      before = raw(w);
    kill(w, request, "archive");
    assert.deepEqual(raw(w), before);
    assert.equal(existsSync(pendingIntentPath(readRootDescriptor(w.root))), false);
    fail(send(w, request), "INVALID_STORAGE");
    assert.deepEqual(raw(w), before);
  },
);
test(
  "publication-started absent clone is uncertain, never permission to re-create it",
  linux,
  (t) => {
    const { w, request } = scenario(t, "simple"),
      before = raw(w);
    kill(w, request, "publication-started");
    const intent = pending(w);
    fail(response(w, resume(w, intent)), "RECOVERY_CONFLICT");
    assert.deepEqual(raw(w), before);
  },
);
test("recovery lost reply replays one fixed result/group, not a second clone", linux, (t) => {
  const { w, request } = scenario(t);
  kill(w, request, "prefix-1");
  const intent = pending(w),
    recovery = resume(w, intent);
  kill(w, recovery, "afterCommit");
  const result = success(response(w, recovery)).result;
  assert.equal(result.operationId, intent.operationId);
  assert.equal(raw(w).length, intent.plan.nextTasks.length);
  assert.equal(
    (success(send(w, { command: "activity.list" })).result.activity as object[]).length,
    1,
  );
  assert.deepEqual(success(response(w, recovery)).result, result);
});
test(
  "lost cache after committed private retirement refuses missing publication evidence rather than regenerate it",
  linux,
  (t) => {
    const { w, request } = scenario(t);
    kill(w, request, "retirement-1");
    const intent = pending(w);
    renameSync(w.cache, `${w.cache}.lost`);
    const before = raw(w);
    fail(response(w, resume(w, intent)), "RECOVERY_CONFLICT");
    assert.deepEqual(raw(w), before);
  },
);
for (const fault of [
  "arrival",
  "formatting",
  "incoming-link",
  "descriptor-conflict",
  "same-byte-inode",
  "task-directory",
])
  test(
    `actual pre-intent doctor ${fault} race retains originals/archive without canonical effects or consumed apply key`,
    linux,
    (t) => {
      const { w, request } = scenario(t),
        loader = path.join(w.directory, "pre-intent-race.mjs"),
        target = path.join(w.root, "tasks/a.json");
      const mutate =
        fault === "arrival"
          ? `writeFileSync(${JSON.stringify(path.join(w.root, "tasks/new.json"))},${JSON.stringify(JSON.stringify({ ...corpus.taskTemplate, id: "new" }))});`
          : fault === "formatting"
            ? `writeFileSync(${JSON.stringify(target)},readFileSync(${JSON.stringify(target)},'utf8')+' ');`
            : fault === "incoming-link"
              ? `writeFileSync(${JSON.stringify(path.join(w.root, "tasks/new.json"))},${JSON.stringify(JSON.stringify({ ...corpus.taskTemplate, id: "new", parentId: "a" }))});`
              : fault === "descriptor-conflict"
                ? `writeFileSync(${JSON.stringify(path.join(w.root, "workspace.sync-conflict-test.json"))},'{"schemaVersion":1}');`
                : fault === "same-byte-inode"
                  ? `writeFileSync(${JSON.stringify(path.join(w.directory, "swap"))},readFileSync(${JSON.stringify(target)}));renameSync(${JSON.stringify(path.join(w.directory, "swap"))},${JSON.stringify(target)});`
                  : `renameSync(${JSON.stringify(path.join(w.root, "tasks"))},${JSON.stringify(path.join(w.directory, "old-tasks"))});cpSync(${JSON.stringify(path.join(w.directory, "old-tasks"))},${JSON.stringify(path.join(w.root, "tasks"))},{recursive:true});`;
      writeFileSync(
        loader,
        `import{registerHooks}from'node:module';registerHooks({load(url,ctx,next){const r=next(url,ctx);if(!url.endsWith('/doctorApply.js'))return r;let s=r.source.toString(),n='prepareDoctorProgress(intent);';if(s.split(n).length!==2)throw Error('unique race cut');return{...r,source:"import{readFileSync,writeFileSync,renameSync,cpSync}from'node:fs';"+s.replace(n,n+${JSON.stringify(mutate)})};}});`,
      );
      const child = run(w, request, loader);
      assert.equal(child.status, 0, child.stderr);
      fail(JSON.parse(child.stdout), "STALE_REPAIR_PLAN");
      assert.equal(existsSync(pendingIntentPath(readRootDescriptor(w.root))), false);
      assert.ok(existsSync(path.join(w.root, "tasks/a.sync-conflict-test.json")));
      assert.equal(
        readdirSync(path.join(w.root, "tasks")).some((name) => name.startsWith(".syncthing.")),
        false,
      );
      const db = new DatabaseSync(w.cache);
      assert.equal(db.prepare("SELECT count(*) AS n FROM v2_operations").get()!.n, 0);
      assert.equal(db.prepare("SELECT count(*) AS n FROM v2_receipts").get()!.n, 1);
      db.close();
    },
  );
test(
  "unsafe recovery budget refuses before further doctor publication or conflict deletion",
  linux,
  (t) => {
    const { w, request } = scenario(t);
    kill(w, request, "prefix-1");
    const intent = pending(w),
      before = raw(w),
      db = new DatabaseSync(w.cache);
    db.exec(`UPDATE v2_query_state SET counter = ${Number.MAX_SAFE_INTEGER - 1}`);
    db.close();
    fail(response(w, resume(w, intent)), "UNSUPPORTED_COMMAND");
    assert.deepEqual(raw(w), before);
    assert.ok(existsSync(pendingIntentPath(readRootDescriptor(w.root))));
  },
);

test(
  "historical recovery receipt survives divergent cleanup until exact evidence correction, with no new group/effects",
  linux,
  (t) => {
    const { w, request } = scenario(t);
    kill(w, request, "afterCommit");
    const intent = pending(w),
      quarantine = path.join(
        w.root,
        "tasks",
        `.syncthing.taskdb-doctor-conflict-${intent.operationId}-0.tmp`,
      ),
      bytes = readFileSync(quarantine),
      recovery = resume(w, intent);
    writeFileSync(quarantine, "{}");
    const before = raw(w);
    fail(response(w, recovery), "RECOVERY_CONFLICT");
    success(response(w, recovery));
    assert.ok(existsSync(pendingIntentPath(readRootDescriptor(w.root))));
    assert.deepEqual(raw(w), before);
    writeFileSync(quarantine, bytes);
    success(response(w, recovery));
    assert.equal(existsSync(pendingIntentPath(readRootDescriptor(w.root))), false);
    assert.equal(
      (success(send(w, { command: "activity.list" })).result.activity as object[]).length,
      1,
    );
  },
);
