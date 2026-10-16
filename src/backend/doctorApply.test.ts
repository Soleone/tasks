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
import { fail, send, success } from "./copyTestWorkspace.js";
import {
  createDoctorWorkspace as setup,
  doctorCorpus as corpus,
  doctorLinux as linux,
  doctorRaw as raw,
  planDoctor,
} from "./doctorTestWorkspace.js";
import type { CanonicalTask } from "./taskModel.js";
const task = (w: ReturnType<typeof setup>, id: string) =>
  JSON.parse(readFileSync(path.join(w.root, "tasks", `${id}.json`), "utf8")) as CanonicalTask;
function planCount(w: ReturnType<typeof setup>) {
  const db = new DatabaseSync(w.cache);
  try {
    return db.prepare("SELECT count(*) AS n FROM v2_doctor_plans").get()!.n;
  } finally {
    db.close();
  }
}
for (const id of ["doctor-replay", "doctor-stale", "doctor-cache-loss", "doctor-late-link"])
  test(`confirmed apply executes independent original corpus ${id}`, linux, (t) => {
    const entry = corpus.cases.find((entry: { id: string }) => entry.id === id),
      w = setup(t, { a: {} }, { a: entry.given.conflict.alternate }),
      before = raw(w),
      { plan, request } = planDoctor(w);
    if (id === "doctor-stale") {
      writeFileSync(
        path.join(w.root, "tasks/a.json"),
        JSON.stringify({ ...task(w, "a"), ...entry.action.steps[1].externalPatch.a }),
      );
      const changed = raw(w);
      fail(send(w, request), entry.expect.error);
      assert.deepEqual(raw(w), changed);
      assert.equal(task(w, "a").description, "Later edit");
      assert.equal(existsSync(path.join(w.root, "tasks", `${plan.clones[0].taskId}.json`)), false);
      return;
    }
    if (id === "doctor-cache-loss") {
      rmSync(w.cache);
      const changed = raw(w);
      fail(send(w, request), entry.expect.error);
      assert.deepEqual(raw(w), changed);
      assert.equal(
        raw(w).filter(([name]) => !name.includes("sync-conflict")).length,
        entry.expect.taskCount,
      );
      return;
    }
    assert.equal(planCount(w), 1);
    const result = success(send(w, request));
    assert.equal(planCount(w), 0);
    const archive = JSON.parse(readFileSync(result.result.recoveryLocation as string, "utf8"));
    assert.equal(archive.format, "taskdb.doctor-recovery");
    assert.deepEqual(
      archive.plan.source.files
        .filter((file: { relativePath: string }) => file.relativePath.startsWith("tasks/"))
        .map((file: { relativePath: string; beforeBytes: string }) => [
          path.basename(file.relativePath),
          file.beforeBytes,
        ]),
      before,
    );
    assert.equal(task(w, plan.clones[0].taskId).title, entry.given.conflict.alternate.title);
    assert.equal(raw(w).length, 2);
    if (id === "doctor-replay") {
      assert.deepEqual(success(send(w, request)).result, result.result);
      assert.equal(raw(w).length, entry.expect.taskCount);
      fail(send(w, { ...request, idempotencyKey: "second-confirmation" }), "STALE_REPAIR_PLAN");
    } else {
      writeFileSync(
        path.join(w.root, "tasks/child.json"),
        JSON.stringify({
          ...corpus.taskTemplate,
          id: "child",
          ...entry.action.steps[2].arrival.child,
        }),
      );
      const changed = raw(w),
        inspected = success(send(w, { command: entry.action.steps[3].command })).result;
      assert.deepEqual(
        (inspected.unreviewedIncomingLinks as { taskId: string }[]).map((link) => link.taskId),
        entry.expect.unreviewedIncomingLinks,
      );
      assert.deepEqual(raw(w), changed);
      assert.equal(task(w, "child").parentId, "a");
    }
  });
test(
  "original doctor-dangling applies the complete declared unlink plan with one observed fixed edit instant",
  linux,
  (t) => {
    const entry = corpus.cases.find((entry: { id: string }) => entry.id === "doctor-dangling"),
      w = setup(t, { a: entry.given.patch }, {}),
      before = raw(w),
      inspected = success(send(w, { command: "workspace.doctor.inspect" }));
    const planned = success(
        send(w, {
          ...entry.action.steps[0],
          writeContext: inspected.writeContext,
          idempotencyKey: "plan",
        }),
      ),
      start = Date.now(),
      result = success(
        send(w, {
          command: "workspace.doctor.apply",
          writeContext: inspected.writeContext,
          idempotencyKey: "apply",
          args: { planId: planned.result.planId },
        }),
      ),
      end = Date.now();
    const archive = JSON.parse(readFileSync(result.result.recoveryLocation as string, "utf8"));
    assert.ok(Date.parse(archive.at) >= start && Date.parse(archive.at) <= end);
    const expected = { ...entry.expect.fields, updatedAt: archive.at };
    for (const [key, value] of Object.entries(expected))
      assert.deepEqual(task(w, "a")[key as keyof CanonicalTask], value);
    assert.equal(
      archive.plan.source.files.find(
        (file: { relativePath: string }) => file.relativePath === "tasks/a.json",
      ).beforeBytes,
      before[0][1],
    );
    assert.equal(task(w, "a").createdAt, corpus.taskTemplate.createdAt);
    assert.equal(task(w, "a").closedAt, corpus.taskTemplate.closedAt);
  },
);
for (const alternate of [false, true])
  test(
    `apply ${alternate ? "alternate" : "canonical"} winner preserves exact recovery bytes, source times/keys and untouched sibling bytes`,
    linux,
    (t) => {
      const w = setup(
          t,
          {
            a: { title: "Original", description: "**Notes**\r\n", orderKey: "a0" },
            z: { title: "Untouched", orderKey: "a2" },
          },
          { a: { title: "Other", description: "Other\r\n", orderKey: "a1" } },
        ),
        z = readFileSync(path.join(w.root, "tasks/z.json")),
        { plan, request } = planDoctor(w, alternate),
        result = success(send(w, request));
      assert.equal(task(w, "a").title, alternate ? "Other" : "Original");
      assert.equal(task(w, "a").orderKey, alternate ? "a1" : "a0");
      assert.equal(task(w, plan.clones[0].taskId).orderKey, alternate ? "a0" : "a1");
      assert.equal(task(w, plan.clones[0].taskId).updatedAt, corpus.taskTemplate.updatedAt);
      assert.equal(task(w, "a").updatedAt, corpus.taskTemplate.updatedAt);
      assert.deepEqual(readFileSync(path.join(w.root, "tasks/z.json")), z);
      assert.equal(result.result.recoveryReady, true);
      assert.ok(existsSync(result.result.recoveryLocation as string));
      assert.equal(
        readdirSync(path.join(w.root, "tasks")).some((name) => name.startsWith(".syncthing.")),
        false,
      );
      const groups = success(send(w, { command: "activity.list" })).result.activity as {
        operationId: string;
        command: string;
      }[];
      assert.equal(groups.length, 1);
      assert.equal(groups[0].command, request.command);
      for (const id of ["a", plan.clones[0].taskId])
        assert.equal(
          (
            success(send(w, { command: "activity.list", args: { taskId: id } })).result
              .activity as object[]
          ).length,
          1,
        );
      fail(
        send(w, {
          command: "operation.undo",
          writeContext: result.writeContext,
          idempotencyKey: "undo",
          args: { operationId: result.result.operationId },
        }),
        "OPERATION_UNAVAILABLE",
      );
    },
  );
test(
  "reviewed surviving links use fixed targets/first keys and only changed-link records receive apply time",
  linux,
  (t) => {
    const w = setup(t, {
        a: {},
        child: {
          parentId: "a",
          dependencyIds: ["a"],
          description: "**Child**",
          status: "done",
          closedAt: corpus.taskTemplate.updatedAt,
        },
        z: { orderKey: "a2" },
      }),
      { plan, request } = planDoctor(w, false, true),
      result = success(send(w, request)),
      archive = JSON.parse(readFileSync(result.result.recoveryLocation as string, "utf8")),
      child = task(w, "child");
    assert.equal(child.parentId, plan.clones[0].taskId);
    assert.deepEqual(child.dependencyIds, [plan.clones[0].taskId]);
    assert.equal(child.orderKey, plan.nextTasks.find((task) => task.id === "child")!.orderKey);
    assert.equal(child.updatedAt, archive.at);
    assert.equal(child.closedAt, corpus.taskTemplate.updatedAt);
    assert.equal(child.description, "**Child**");
    assert.equal(task(w, plan.clones[0].taskId).updatedAt, corpus.taskTemplate.updatedAt);
    assert.deepEqual(
      success(send(w, { command: "workspace.doctor.inspect" })).result.unreviewedIncomingLinks,
      [],
    );
  },
);
for (const flags of [{ dryRun: true }, { readOnly: true }, { dryRun: true, readOnly: true }])
  test(
    `apply preview ${JSON.stringify(flags)} never creates archive/intent/receipt/task changes`,
    linux,
    (t) => {
      const w = setup(t),
        { request } = planDoctor(w),
        before = raw(w),
        result = success(send(w, { ...request, idempotencyKey: undefined, ...flags }));
      assert.deepEqual(raw(w), before);
      assert.equal(existsSync(result.result.recoveryLocation as string), false);
      assert.equal(result.result.recoveryReady, false);
      const db = new DatabaseSync(w.cache);
      assert.equal(db.prepare("SELECT count(*) AS n FROM v2_receipts").get()!.n, 1);
      db.close();
      success(send(w, request));
    },
  );
for (const fault of [
  "formatting",
  "arrival",
  "conflict-removal",
  "conflict-edit",
  "same-byte-inode",
  "clone-collision",
  "bad-plan",
  "bad-raw",
  "bad-request",
])
  test(
    `preflight ${fault} refuses entire apply without consuming key or deleting evidence`,
    linux,
    (t) => {
      const w = setup(t),
        { plan, request } = planDoctor(w),
        target = path.join(w.root, "tasks/a.json");
      if (fault === "formatting") writeFileSync(target, readFileSync(target, "utf8") + " ");
      if (fault === "arrival")
        writeFileSync(
          path.join(w.root, "tasks/b.json"),
          JSON.stringify({ ...corpus.taskTemplate, id: "b" }),
        );
      if (fault === "conflict-removal")
        rmSync(path.join(w.root, "tasks/a.sync-conflict-test.json"));
      if (fault === "conflict-edit")
        writeFileSync(path.join(w.root, "tasks/a.sync-conflict-test.json"), "{}");
      if (fault === "same-byte-inode") {
        const bytes = readFileSync(target);
        renameSync(target, path.join(w.directory, "old-task"));
        writeFileSync(target, bytes);
      }
      if (fault === "clone-collision")
        writeFileSync(
          path.join(w.root, "tasks", `${plan.clones[0].taskId}.json`),
          JSON.stringify({ ...corpus.taskTemplate, id: plan.clones[0].taskId }),
        );
      if (fault.startsWith("bad-")) {
        const db = new DatabaseSync(w.cache);
        if (fault === "bad-plan") plan.nextTasks[0].title = "Tampered";
        if (fault === "bad-raw")
          plan.source.files[1].beforeBytes = Buffer.from("{}").toString("base64");
        db.prepare("UPDATE v2_doctor_plans SET payload = ?").run(
          fault === "bad-request" ? "{" : JSON.stringify(plan),
        );
        db.close();
      }
      const before = raw(w);
      fail(send(w, request), "STALE_REPAIR_PLAN");
      assert.deepEqual(raw(w), before);
      const db = new DatabaseSync(w.cache);
      assert.equal(db.prepare("SELECT count(*) AS n FROM v2_receipts").get()!.n, 1);
      assert.equal(db.prepare("SELECT count(*) AS n FROM v2_operations").get()!.n, 0);
      db.close();
    },
  );
test(
  "historical apply replay precedes lost archive/invalid live graph, while changed actor/flags/plan cannot reuse key",
  linux,
  (t) => {
    const w = setup(t),
      { request } = planDoctor(w),
      result = success(send(w, request));
    rmSync(result.result.recoveryLocation as string);
    writeFileSync(path.join(w.root, "tasks/a.json"), "{");
    assert.deepEqual(success(send(w, request)).result, result.result);
    for (const patch of [
      { actor: { kind: "human", label: "different" } },
      { dryRun: true },
      { args: { planId: "other" } },
    ])
      fail(send(w, { ...request, ...patch }), "IDEMPOTENCY_KEY_REUSED");
  },
);
test(
  "retained rebuild/restart preserves the applied receipt and late-link history; copied cache cannot adopt it",
  linux,
  (t) => {
    const w = setup(t),
      { request } = planDoctor(w),
      result = success(send(w, request));
    success(
      send(w, {
        command: "workspace.rebuild",
        writeContext: result.writeContext,
        idempotencyKey: "rebuild",
      }),
    );
    assert.deepEqual(success(send(w, request)).result, result.result);
    writeFileSync(
      path.join(w.root, "tasks/child.json"),
      JSON.stringify({ ...corpus.taskTemplate, id: "child", dependencyIds: ["a"] }),
    );
    assert.equal(
      (
        success(send(w, { command: "workspace.doctor.inspect" })).result
          .unreviewedIncomingLinks as object[]
      ).length,
      1,
    );
    const copied = `${w.cache}.copy`;
    cpSync(w.cache, copied);
    renameSync(w.cache, `${w.cache}.old`);
    cpSync(copied, w.cache);
    fail(send(w, request), "STALE_WRITE_CONTEXT");
    assert.deepEqual(
      success(send(w, { command: "workspace.doctor.inspect" })).result.unreviewedIncomingLinks,
      [],
    );
  },
);
for (const shape of [
  { args: {} },
  { args: { planId: "x", force: true } },
  { writeContext: undefined },
  { writeContext: "other" },
  { idempotencyKey: undefined },
])
  test(`apply requires exact authority/shape ${JSON.stringify(shape)}`, linux, (t) => {
    const w = setup(t),
      { request } = planDoctor(w),
      before = raw(w);
    fail(
      send(w, { ...request, ...shape }),
      "args" in shape
        ? "INVALID_ARGUMENT"
        : "writeContext" in shape
          ? shape.writeContext === undefined
            ? "WRITE_CONTEXT_REQUIRED"
            : "STALE_WRITE_CONTEXT"
          : "IDEMPOTENCY_REQUIRED",
    );
    assert.deepEqual(raw(w), before);
  });
test(
  "previously empty legacy order acquiring content invalidates apply before any canonical effect",
  linux,
  (t) => {
    const w = setup(t);
    mkdirSync(path.join(w.root, "order"));
    const { request } = planDoctor(w);
    writeFileSync(path.join(w.root, "order/root.json"), "{}");
    const before = raw(w);
    fail(send(w, request), "STALE_REPAIR_PLAN");
    assert.deepEqual(raw(w), before);
  },
);

test("unsafe numeric budget refuses before creating archive or changing authority", linux, (t) => {
  const w = setup(t),
    { request } = planDoctor(w),
    before = raw(w),
    db = new DatabaseSync(w.cache);
  db.exec(`UPDATE v2_query_state SET counter = ${Number.MAX_SAFE_INTEGER - 1}`);
  db.close();
  fail(send(w, request), "UNSUPPORTED_COMMAND");
  assert.deepEqual(raw(w), before);
  assert.equal(
    success(send(w, { command: "workspace.doctor.inspect" })).writeContext,
    request.writeContext,
  );
});
