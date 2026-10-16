import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { TestContext } from "node:test";
import {
  createDoctorWorkspace as setup,
  doctorCorpus as corpus,
  doctorRaw as raw,
} from "./doctorTestWorkspace.js";
import { fail, run, send, success } from "./copyTestWorkspace.js";
import type { CopyTestWorkspace as Workspace } from "./copyTestWorkspace.js";
import { readRootDescriptor } from "./canonicalReader.js";
import { pendingIntentPath } from "./localDomain.js";
import type { DoctorIssue, DoctorVersion } from "./doctorSource.js";
const linux = { skip: process.platform !== "linux" };
function scenario(t: TestContext) {
  const w = setup(t, { a: { title: "Original" } }, { a: { title: "Other" } });
  const inspect = success(send(w, { command: "workspace.doctor.inspect" })),
    issue = (inspect.result.issues as DoctorIssue[]).find(
      (issue) => issue.code === "CONFLICT_COPY",
    )!,
    original = (inspect.result.versionRefs as DoctorVersion[]).find(
      (version) => version.canonical,
    )!;
  return {
    w,
    request: {
      version: 2,
      command: "workspace.doctor.plan",
      writeContext: inspect.writeContext,
      idempotencyKey: "plan-key",
      args: {
        kind: "keep-both",
        issueIds: [issue.issueId],
        canonicalVersions: [{ issueId: issue.issueId, versionRef: original.versionRef }],
        linkChoices: [],
      },
      actor: { kind: "human", label: "plan process" },
    },
  };
}
function counts(w: Workspace) {
  const db = new DatabaseSync(w.cache);
  try {
    return ["v2_doctor_plans", "v2_receipts", "v2_operations"].map(
      (table) => db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n,
    );
  } finally {
    db.close();
  }
}
// The plan insert's last line; the race runs right after the plan row is written.
const inserted = ".run(plan.planId, authority.writeContext, JSON.stringify(plan));";
for (const cut of ["allocated", "stored", "receipted", "beforeCommit", "afterCommit"])
  test(
    `actual plan CLI ${cut} leaves canonical bytes untouched and commits plan/receipt together`,
    linux,
    (t) => {
      const { w, request } = scenario(t),
        before = raw(w),
        loader = path.join(w.directory, "plan-kill.mjs"),
        witness = path.join(w.directory, "allocation.json");
      writeFileSync(
        loader,
        `import{registerHooks}from'node:module';import{DatabaseSync}from'node:sqlite';const cut=${JSON.stringify(cut)};
if(cut==='beforeCommit'||cut==='afterCommit'){const exec=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){if(sql==='COMMIT'&&cut==='beforeCommit')process.kill(process.pid,'SIGKILL');const r=exec.call(this,sql);if(sql==='COMMIT'&&cut==='afterCommit')process.kill(process.pid,'SIGKILL');return r;};}
registerHooks({load(url,ctx,next){const r=next(url,ctx);if(!url.endsWith('/doctorWriter.js'))return r;let source=r.source.toString(),n='const plan = buildDoctorPlan(input, source, allocation);';if(source.split(n).length!==2)throw Error('unique allocation cut required');source="import{writeFileSync}from'node:fs';"+source.replace(n,n+'writeFileSync('+${JSON.stringify(JSON.stringify(witness))}+',JSON.stringify(allocation));');
const statement=cut==='allocated'?'writeFileSync('+${JSON.stringify(JSON.stringify(witness))}+',JSON.stringify(allocation));':cut==='stored'?${JSON.stringify(inserted)}:cut==='receipted'?'storeReceipt(database, request, result);':null;
if(statement){if(source.split(statement).length!==2)throw Error('unique plan cut required');source=source.replace(statement,statement+'process.kill(process.pid,"SIGKILL");');}return{...r,source};}});`,
      );
      const child = run(w, request, loader);
      assert.equal(child.signal, "SIGKILL", child.stderr);
      assert.deepEqual(raw(w), before);
      assert.deepEqual(counts(w), cut === "afterCommit" ? [1, 1, 0] : [0, 0, 0]);
      const allocation = JSON.parse(readFileSync(witness, "utf8")),
        replay = run(w, request);
      assert.equal(replay.status, 0, replay.stderr);
      const response = success(JSON.parse(replay.stdout));
      if (cut === "afterCommit") assert.equal(response.result.planId, allocation.planId);
      else assert.notEqual(response.result.planId, allocation.planId);
      assert.deepEqual(counts(w), [1, 1, 0]);
      assert.deepEqual(raw(w), before);
      assert.equal(existsSync(response.result.recoveryLocation as string), false);
      assert.deepEqual(success(send(w, request)).result, response.result);
    },
  );
for (const fault of [
  "canonical-format",
  "canonical-edit",
  "canonical-missing",
  "conflict-format",
  "conflict-missing",
  "arrival",
  "conflict-arrival",
  "manifest",
  "descriptor-conflict",
  "task-directory",
  "same-byte-replacement",
])
  test(
    `actual plan transaction ${fault} race rolls back plan and receipt, preserving changed source`,
    linux,
    (t) => {
      const { w, request } = scenario(t),
        loader = path.join(w.directory, "plan-race.mjs"),
        root = w.root;
      const target = path.join(
        root,
        "tasks",
        fault.startsWith("conflict-") ? "a.sync-conflict-test.json" : "a.json",
      );
      const mutate = fault.endsWith("format")
        ? `writeFileSync(${JSON.stringify(target)},readFileSync(${JSON.stringify(target)},'utf8')+' ');`
        : fault === "canonical-edit"
          ? `writeFileSync(${JSON.stringify(target)},JSON.stringify({...JSON.parse(readFileSync(${JSON.stringify(target)},'utf8')),description:'Preserve external note'}));`
          : fault.endsWith("missing")
            ? `rmSync(${JSON.stringify(target)});`
            : fault === "arrival" || fault === "conflict-arrival"
              ? `writeFileSync(${JSON.stringify(path.join(root, "tasks", fault === "arrival" ? "new.json" : "a.sync-conflict-extra.json"))},${JSON.stringify(JSON.stringify({ ...corpus.taskTemplate, id: fault === "arrival" ? "new" : "a" }))});`
              : fault === "manifest"
                ? `writeFileSync(${JSON.stringify(path.join(root, "workspace.json"))},'{ "schemaVersion": 2 }');`
                : fault === "descriptor-conflict"
                  ? `writeFileSync(${JSON.stringify(path.join(root, "workspace.sync-conflict-test.json"))},'{"schemaVersion":1}');`
                  : fault === "same-byte-replacement"
                    ? `writeFileSync(${JSON.stringify(path.join(w.directory, "swap"))},readFileSync(${JSON.stringify(target)}));renameSync(${JSON.stringify(path.join(w.directory, "swap"))},${JSON.stringify(target)});`
                    : `renameSync(${JSON.stringify(path.join(root, "tasks"))},${JSON.stringify(path.join(w.directory, "old"))});mkdirSync(${JSON.stringify(path.join(root, "tasks"))});cpSync(${JSON.stringify(path.join(w.directory, "old"))},${JSON.stringify(path.join(root, "tasks"))},{recursive:true});`;
      writeFileSync(
        loader,
        `import{registerHooks}from'node:module';registerHooks({load(url,ctx,next){const r=next(url,ctx);if(!url.endsWith('/doctorWriter.js'))return r;let source=r.source.toString(),n=${JSON.stringify(inserted)};if(source.split(n).length!==2)throw Error('unique plan race cut required');source="import{readFileSync,writeFileSync,rmSync,renameSync,mkdirSync,cpSync}from'node:fs';"+source.replace(n,n+${JSON.stringify(mutate)});return{...r,source};}});`,
      );
      const child = run(w, request, loader);
      assert.equal(child.status, 0, child.stderr);
      fail(JSON.parse(child.stdout), "STALE_REPAIR_PLAN");
      assert.deepEqual(counts(w), [0, 0, 0]);
      assert.equal(existsSync(pendingIntentPath(readRootDescriptor(w.root))), false);
      assert.equal(
        readdirSync(path.join(root, "tasks")).some((name) => name.startsWith(".syncthing.")),
        false,
      );
      if (fault === "canonical-edit")
        assert.equal(
          JSON.parse(readFileSync(target, "utf8")).description,
          "Preserve external note",
        );
    },
  );
test(
  "actual CLI fixed clone collision refuses without resampling identities or changing files",
  linux,
  (t) => {
    const { w, request } = scenario(t),
      id = "00000000-0000-4000-8000-000000000001";
    writeFileSync(
      path.join(w.root, "tasks", `${id}.json`),
      JSON.stringify({ ...corpus.taskTemplate, id }),
    );
    const before = raw(w),
      loader = path.join(w.directory, "plan-collision.mjs");
    writeFileSync(
      loader,
      `import crypto from'node:crypto';import{syncBuiltinESMExports}from'node:module';crypto.randomUUID=()=>${JSON.stringify(id)};syncBuiltinESMExports();`,
    );
    const child = run(w, request, loader);
    assert.equal(child.status, 0, child.stderr);
    fail(JSON.parse(child.stdout), "STALE_REPAIR_PLAN");
    assert.deepEqual(raw(w), before);
    assert.deepEqual(counts(w), [0, 0, 0]);
  },
);
test(
  "doctor inspection stays available during actual ordering pending work, while planning cannot resume or bypass it",
  linux,
  (t) => {
    const { w, request } = scenario(t);
    writeFileSync(
      path.join(w.root, "tasks/b.json"),
      JSON.stringify({ ...corpus.taskTemplate, id: "b", orderKey: "a1" }),
    );
    const tasks = success(send(w, { command: "task.list" })).result.tasks as {
        id: string;
        version: number;
      }[],
      selected = tasks.find((task) => task.id === "b")!,
      loader = path.join(w.directory, "order-pending.mjs");
    writeFileSync(
      loader,
      `import{registerHooks}from'node:module';registerHooks({load(url,ctx,next){const r=next(url,ctx);if(!url.endsWith('/orderWriter.js'))return r;let s=r.source.toString(),n='persistPending(root, intent);';if(s.split(n).length!==2)throw Error('unique intent cut required');return{...r,source:s.replace(n,n+'process.kill(process.pid,"SIGKILL");')};}});`,
    );
    const child = run(
      w,
      {
        version: 2,
        command: "task.reorder",
        writeContext: request.writeContext,
        idempotencyKey: "order",
        args: {
          tasks: [{ id: selected.id, expectedVersion: selected.version }],
          placement: { first: true },
        },
      },
      loader,
    );
    assert.equal(child.signal, "SIGKILL", child.stderr);
    const pending = pendingIntentPath(readRootDescriptor(w.root)),
      intent = JSON.parse(readFileSync(pending, "utf8")),
      before = raw(w);
    const inspection = run(w, { version: 2, command: "workspace.doctor.inspect" });
    assert.equal(inspection.status, 0, inspection.stderr);
    assert.equal(
      success(JSON.parse(inspection.stdout)).result.pendingOperationId,
      intent.operationId,
    );
    fail(send(w, request), "RECOVERY_PENDING");
    fail(send(w, { ...request, dryRun: true, idempotencyKey: undefined }), "RECOVERY_PENDING");
    assert.deepEqual(raw(w), before);
    assert.equal(existsSync(pending), true);
  },
);
test(
  "malformed/unpublished local pending evidence remains visible and blocks fresh planning without guessed recovery",
  linux,
  (t) => {
    const { w, request } = scenario(t),
      pending = pendingIntentPath(readRootDescriptor(w.root));
    mkdirSync(path.dirname(pending), { recursive: true });
    writeFileSync(`${pending}.preparing`, "{");
    const before = raw(w);
    const inspect = success(send(w, { command: "workspace.doctor.inspect" }));
    assert.equal(
      (inspect.result.issues as { code: string }[]).some(
        (issue) => issue.code === "RECOVERY_CONFLICT",
      ),
      true,
    );
    fail(send(w, request), "RECOVERY_CONFLICT");
    assert.deepEqual(raw(w), before);
    assert.equal(existsSync(`${pending}.preparing`), true);
  },
);
