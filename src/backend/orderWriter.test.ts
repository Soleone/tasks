import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { TestContext } from "node:test";
import { createCopyTestWorkspace as setup, fail, send, success } from "./copyTestWorkspace.js";
import type { CopyTestWorkspace as Workspace } from "./copyTestWorkspace.js";
import { readRootDescriptor } from "./canonicalReader.js";
import { pendingIntentPath } from "./localDomain.js";
import type { CanonicalTask } from "./taskModel.js";

const corpus = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../scripts/fixtures/workspace/cases.json", import.meta.url)),
    "utf8",
  ),
);
const linuxOnly = { skip: process.platform !== "linux" };
type Projection = CanonicalTask & { version: number; blockedByIds: string[] };
function materialize(t: TestContext, records: Record<string, Partial<CanonicalTask>> = { a: {} }) {
  const w = setup(t);
  for (const f of readdirSync(path.join(w.root, "tasks"))) rmSync(path.join(w.root, "tasks", f));
  for (const [id, patch] of Object.entries(records))
    writeFileSync(
      path.join(w.root, "tasks", `${id}.json`),
      JSON.stringify({ ...corpus.taskTemplate, ...patch, id }),
    );
  return w;
}
function list(w: Workspace) {
  return success(send(w, { command: "task.list", args: { sort: "manual" } })).result
    .tasks as Projection[];
}
function raw(w: Workspace) {
  return readdirSync(path.join(w.root, "tasks"))
    .sort()
    .map((file) => [file, readFileSync(path.join(w.root, "tasks", file)).toString("base64")]);
}
function request(
  w: Workspace,
  command: string,
  args: { tasks: { id: string }[] } & Record<string, unknown>,
) {
  const read = success(send(w, { command: "task.list", args: { sort: "manual" } }));
  const tasks = new Map((read.result.tasks as Projection[]).map((task) => [task.id, task]));
  return {
    command,
    args: {
      ...args,
      tasks: args.tasks.map((task) => ({ ...task, expectedVersion: tasks.get(task.id)!.version })),
    },
    writeContext: read.writeContext,
    idempotencyKey: "order",
  };
}
function activity(w: Workspace, taskId?: string) {
  return success(send(w, { command: "activity.list", args: taskId ? { taskId } : {} })).result
    .activity as {
    operationId: string;
    command: string;
    before: {
      scope: { id: string; orderKey: string }[];
      tasks: CanonicalTask[];
      selectedIds: string[];
      rewrittenIds: string[];
    };
    after: { scope: { id: string; orderKey: string }[]; tasks: CanonicalTask[] };
  }[];
}
function receipts(w: Workspace) {
  const db = new DatabaseSync(w.cache);
  try {
    return db.prepare("SELECT count(*) AS n FROM v2_receipts").get()!.n;
  } finally {
    db.close();
  }
}

for (const id of [
  "key-overflow",
  "reorder-tied",
  "reorder-selected-unchanged",
  "reorder-noop",
  "reorder-hidden",
  "normalize",
  "normalize-noop",
  "time-reorder",
]) {
  test(`public ordering executes independent corpus ${id}`, linuxOnly, (t) => {
    const entry = corpus.cases.find((entry: { id: string }) => entry.id === id);
    const w = materialize(t, entry.given.records);
    const before = list(w),
      bytes = raw(w);
    const req = request(w, entry.action.command, entry.action.args);
    const response = send(w, req);
    if (entry.expect.error) {
      fail(response, entry.expect.error);
      assert.deepEqual(raw(w), bytes);
      assert.equal(receipts(w), 0);
      return;
    }
    const result = success(response).result;
    const after = list(w),
      rows = activity(w);
    if (entry.expect.order)
      assert.deepEqual(
        after.map((task) => task.id),
        entry.expect.order,
      );
    if (entry.expect.keys)
      for (const [id, key] of Object.entries(entry.expect.keys))
        assert.equal(after.find((task) => task.id === id)!.orderKey, key);
    if (entry.expect.rewrittenIds) assert.deepEqual(result.rewrittenIds, entry.expect.rewrittenIds);
    if (entry.expect.changed !== undefined) assert.equal(result.changed, entry.expect.changed);
    if (entry.expect.activityGroups !== undefined)
      assert.equal(rows.length, entry.expect.activityGroups);
    if (entry.expect.canonicalWrites === 0) assert.deepEqual(raw(w), bytes);
    for (const old of before) {
      const next = after.find((task) => task.id === old.id)!;
      for (const field of Object.keys(corpus.taskTemplate).filter((field) => field !== "orderKey"))
        assert.deepEqual(next[field as keyof CanonicalTask], old[field as keyof CanonicalTask]);
      if (entry.expect.versionsChanged?.includes(old.id)) assert.ok(next.version > old.version);
      if (!(result.rewrittenIds as string[]).includes(old.id))
        assert.deepEqual(
          raw(w).find(([file]) => file === `${old.id}.json`),
          bytes.find(([file]) => file === `${old.id}.json`),
        );
    }
    if (result.changed) {
      assert.equal(rows.length, 1);
      assert.deepEqual(
        rows[0].before.scope,
        before.map(({ id, orderKey }) => ({ id, orderKey })),
      );
      assert.deepEqual(
        rows[0].after.scope,
        after.map(({ id, orderKey }) => ({ id, orderKey })),
      );
      for (const task of rows[0].after.tasks) assert.equal(activity(w, task.id).length, 1);
    }
    assert.deepEqual(success(send(w, { ...req, requestId: "later" })).result, result);
  });
}

const vectors = corpus.cases.find((entry: { id: string }) => entry.id === "key-vectors");
for (const [index, vector] of vectors.action.vectors.entries()) {
  test(
    `public key-vectors allocation ${index} through normalization/reorder with exact declared bounds`,
    linuxOnly,
    (t) => {
      const records: Record<string, Partial<CanonicalTask>> = {};
      const selected = Array.from({ length: vector.count }, (_, i) => `s${i}`);
      for (const [i, id] of selected.entries())
        records[id] = {
          orderKey: vector.upper === null && vector.lower !== null ? "Zz" : `a${i + 2}`,
        };
      if (vector.lower !== null) records.lower = { orderKey: vector.lower };
      if (vector.upper !== null) records.upper = { orderKey: vector.upper };
      const w = materialize(t, records);
      const command =
        vector.lower === null && vector.upper === null ? "task.order.normalize" : "task.reorder";
      const req = request(w, command, {
        tasks: selected.map((id) => ({ id })),
        ...(command === "task.order.normalize"
          ? { parentId: null }
          : { placement: vector.upper !== null ? { beforeId: "upper" } : { last: true } }),
      });
      const result = success(send(w, req)).result;
      assert.deepEqual(
        (result.tasks as Projection[]).map((task) => task.orderKey),
        vectors.expect.keys[index],
      );
    },
  );
}

const supplementalAllocations = [
  { lower: "a0", upper: "a0V", count: 1, keys: ["a0G"] },
  { lower: "Zz", upper: "a0", count: 1, keys: ["ZzV"] },
  { lower: null, upper: null, count: 4, keys: ["a0", "a1", "a2", "a3"] },
];
for (const vector of supplementalAllocations) {
  test(
    `public supplemental allocation (${vector.lower},${vector.upper},${vector.count}) preserves literal keys`,
    linuxOnly,
    (t) => {
      const selected = Array.from({ length: vector.count }, (_, index) => `s${index}`);
      const records: Record<string, Partial<CanonicalTask>> = Object.fromEntries(
        selected.map((id, index) => [id, { orderKey: `a${index + 2}` }]),
      );
      if (vector.lower !== null) records.lower = { orderKey: vector.lower };
      if (vector.upper !== null) records.upper = { orderKey: vector.upper };
      const w = materialize(t, records);
      const command = vector.upper === null ? "task.order.normalize" : "task.reorder";
      const req = request(w, command, {
        tasks: selected.map((id) => ({ id })),
        ...(command === "task.order.normalize"
          ? { parentId: null }
          : { placement: { beforeId: "upper" } }),
      });
      const result = success(send(w, req)).result;
      assert.equal(result.changed, true);
      assert.deepEqual(
        (result.tasks as Projection[]).map((task) => task.orderKey),
        vector.keys,
      );
      assert.deepEqual(
        list(w)
          .filter((task) => selected.includes(task.id))
          .map((task) => task.orderKey),
        vector.keys,
      );
    },
  );
}

for (const id of ["key-invalid", "key-limit", "key-too-long", "key-byte-order"]) {
  test(`public reader materializes ordering ${id}`, linuxOnly, (t) => {
    const entry = corpus.cases.find((entry: { id: string }) => entry.id === id);
    if (id === "key-invalid") {
      for (const key of entry.given.invalidKeys) {
        const w = materialize(t, { a: { orderKey: key } });
        const bytes = raw(w);
        fail(send(w, { command: "task.get", args: { id: "a" } }), entry.expect.error);
        assert.deepEqual(raw(w), bytes);
      }
      return;
    }
    const limit = corpus.cases.find((entry: { id: string }) => entry.id === "key-limit");
    const w = materialize(
      t,
      entry.given.records ?? {
        a:
          id === "key-too-long"
            ? { orderKey: limit.given.patch.orderKey + entry.given.appendKey }
            : entry.given.patch,
      },
    );
    if (entry.expect.error)
      fail(send(w, { command: "task.get", args: { id: "a" } }), entry.expect.error);
    else if (entry.expect.order)
      assert.deepEqual(
        list(w).map((task) => task.id),
        entry.expect.order,
      );
    else
      assert.equal(
        (success(send(w, { command: "task.get", args: { id: "a" } })).result.task as Projection)
          .orderKey.length,
        entry.expect.keyBytes,
      );
  });
}

// Every permutation runs against the pure planner in taskOrdering.test.ts; these run through the
// writer and check that only the planned keys reach disk.
const untied = { a: "a0", b: "a1", c: "a2", d: "a3", e: "a4" };
const tied = { a: "a0", b: "a0", c: "a0", d: "a0", e: "a0" };
const mixed = { t0: "a0", t1: "a0", t2: "a1", t3: "a1", t4: "a1", t5: "a2" };
const representativeReorders = [
  {
    name: "one untied task to first",
    keys: untied,
    selected: ["b"],
    placement: { first: true },
    order: ["b", "a", "c", "d", "e"],
    rewrittenIds: ["b"],
  },
  {
    name: "non-contiguous untied tasks after the last",
    keys: untied,
    selected: ["a", "c"],
    placement: { afterId: "e" },
    order: ["b", "d", "e", "a", "c"],
    rewrittenIds: ["a", "c"],
  },
  {
    name: "one tied task before another",
    keys: tied,
    selected: ["d"],
    placement: { beforeId: "b" },
    order: ["a", "d", "b", "c", "e"],
    rewrittenIds: ["d", "b", "c", "e"],
  },
  {
    name: "tied ends to last",
    keys: tied,
    selected: ["a", "e"],
    placement: { last: true },
    order: ["b", "c", "d", "a", "e"],
    rewrittenIds: ["a", "e"],
  },
  {
    name: "mixed ties into an equal-key run",
    keys: mixed,
    selected: ["t0", "t5"],
    placement: { beforeId: "t3" },
    order: ["t1", "t2", "t0", "t5", "t3", "t4"],
    rewrittenIds: ["t0", "t5", "t3", "t4"],
  },
  {
    name: "tied tasks to where they are",
    keys: tied,
    selected: ["b", "c"],
    placement: { afterId: "a" },
    order: ["a", "b", "c", "d", "e"],
    rewrittenIds: [],
  },
];
for (const reorder of representativeReorders) {
  test(`writer reorders ${reorder.name} and rewrites only planned keys`, linuxOnly, (t) => {
    const w = materialize(
      t,
      Object.fromEntries(Object.entries(reorder.keys).map(([id, orderKey]) => [id, { orderKey }])),
    );
    const bytes = raw(w);
    const req = request(w, "task.reorder", {
      tasks: reorder.selected.map((id) => ({ id })),
      placement: reorder.placement,
    });
    const result = success(send(w, req)).result;
    assert.deepEqual(
      list(w).map((task) => task.id),
      reorder.order,
    );
    assert.equal(result.changed, reorder.order.join() !== Object.keys(reorder.keys).join());
    assert.deepEqual(result.rewrittenIds, reorder.rewrittenIds);
    const rewritten = new Set(reorder.rewrittenIds.map((id) => `${id}.json`));
    assert.deepEqual(
      raw(w).filter(([file]) => !rewritten.has(file)),
      bytes.filter(([file]) => !rewritten.has(file)),
    );
  });
}

test(
  "ordering subtree keeps descendants/outside raw bytes and projects blockers outside the affected scope",
  linuxOnly,
  (t) => {
    const w = materialize(t, {
      parent: {},
      a: { parentId: "parent", dependencyIds: ["done", "gone"], orderKey: "a0V" },
      b: {
        parentId: "parent",
        orderKey: "a1V",
        status: "canceled",
        closedAt: "2026-09-08T14:00:00.000Z",
      },
      leaf: { parentId: "a" },
      done: { status: "done", closedAt: "2026-09-08T14:00:00.000Z" },
      gone: { status: "canceled", closedAt: "2026-09-08T14:00:00.000Z" },
    });
    const before = list(w),
      bytes = raw(w);
    const req = request(w, "task.order.normalize", {
      parentId: "parent",
      tasks: [{ id: "a" }, { id: "b" }],
    });
    const result = success(send(w, req)).result;
    assert.deepEqual((result.tasks as Projection[])[0].blockedByIds, ["done"]);
    for (const task of before.filter((task) => !["a", "b"].includes(task.id))) {
      assert.equal(list(w).find((next) => next.id === task.id)!.version, task.version);
      assert.deepEqual(
        raw(w).find(([file]) => file === `${task.id}.json`),
        bytes.find(([file]) => file === `${task.id}.json`),
      );
    }
    assert.equal(activity(w, "parent").length, 0);
  },
);

for (const command of ["task.reorder", "task.order.normalize"]) {
  test(
    `${command} strict shapes/versions/context/previews/replay and failed-key reuse`,
    linuxOnly,
    (t) => {
      const w = materialize(t, {
        a: { orderKey: "a0V" },
        b: { orderKey: "a1V" },
        c: { orderKey: "a2V" },
      });
      const req = request(w, command, {
        tasks: command === "task.reorder" ? [{ id: "a" }] : [{ id: "a" }, { id: "b" }, { id: "c" }],
        ...(command === "task.reorder" ? { placement: { last: true } } : { parentId: null }),
      });
      const bytes = raw(w);
      fail(send(w, { ...req, writeContext: undefined }), "WRITE_CONTEXT_REQUIRED");
      fail(send(w, { ...req, writeContext: "stale" }), "STALE_WRITE_CONTEXT");
      fail(send(w, { ...req, idempotencyKey: undefined }), "IDEMPOTENCY_REQUIRED");
      fail(
        send(w, {
          ...req,
          args: { ...req.args, tasks: req.args.tasks.map((task) => ({ id: task.id })) },
        }),
        "EXPECTED_VERSION_REQUIRED",
      );
      fail(
        send(w, {
          ...req,
          args: {
            ...req.args,
            tasks: req.args.tasks.map((task) => ({ ...task, expectedVersion: 98765 })),
          },
        }),
        "STALE_TASK_VERSION",
      );
      for (const field of ["readOnly", "dryRun"]) {
        assert.equal(
          success(send(w, { ...req, [field]: true, idempotencyKey: undefined })).result.changed,
          true,
        );
        assert.deepEqual(raw(w), bytes);
        assert.equal(receipts(w), 0);
        assert.equal(activity(w).length, 0);
      }
      const result = success(send(w, req)).result;
      for (const changed of [
        { actor: { kind: "human", label: "other" } },
        { dryRun: true },
        { args: { ...req.args, tasks: req.args.tasks.map((task) => ({ ...task })).reverse() } },
      ]) {
        if (command === "task.reorder" && changed.args) changed.args.tasks[0].expectedVersion += 1;
        fail(send(w, { ...req, ...changed }), "IDEMPOTENCY_KEY_REUSED");
      }
      assert.deepEqual(success(send(w, { ...req, requestId: "new-correlation" })).result, result);
      fail(send(w, { ...req, idempotencyKey: "another" }), "STALE_TASK_VERSION");
    },
  );
}

test(
  "selection/scope/placement/ref types refuse before writes without selecting a different gap",
  linuxOnly,
  (t) => {
    const w = materialize(t, {
      a: {},
      b: { orderKey: "a1" },
      parent: { orderKey: "a2" },
      child: { parentId: "parent" },
    });
    const req = request(w, "task.reorder", { tasks: [{ id: "a" }], placement: { last: true } });
    const before = raw(w);
    for (const tasks of [
      null,
      [],
      [1],
      [
        { id: "a", expectedVersion: 1 },
        { id: "a", expectedVersion: 1 },
      ],
    ])
      fail(send(w, { ...req, args: { ...req.args, tasks } }), "INVALID_ARGUMENT");
    for (const placement of [
      undefined,
      null,
      {},
      { first: false },
      { first: true, last: true },
      { beforeId: "../b" },
      { unknown: true },
      { beforeId: "a" },
      { beforeId: "child" },
      { beforeId: "absent" },
    ])
      fail(send(w, { ...req, args: { ...req.args, placement } }), "INVALID_ARGUMENT");
    for (const ids of [
      ["b", "a"],
      ["a", "child"],
    ])
      fail(
        send(
          w,
          request(w, "task.reorder", {
            tasks: ids.map((id) => ({ id })),
            placement: { last: true },
          }),
        ),
        "INVALID_ARGUMENT",
      );
    fail(
      send(w, request(w, "task.order.normalize", { parentId: null, tasks: [{ id: "a" }] })),
      "STALE_SCOPE",
    );
    fail(
      send(w, { ...req, args: { ...req.args, tasks: [{ id: "absent", expectedVersion: 1 }] } }),
      "TASK_NOT_FOUND",
    );
    assert.deepEqual(raw(w), before);
    assert.equal(receipts(w), 0);
    assert.equal(existsSync(pendingIntentPath(readRootDescriptor(w.root))), false);
  },
);

test(
  "empty normalization and all-matching keys are receipt-only, never a root initializer",
  linuxOnly,
  (t) => {
    const w = materialize(t, {});
    const context = success(send(w, { command: "workspace.info" })).writeContext;
    const response = success(
      send(w, {
        command: "task.order.normalize",
        args: { parentId: null, tasks: [] },
        writeContext: context,
        idempotencyKey: "empty",
      }),
    );
    assert.deepEqual(response.result, {
      tasks: [],
      parentId: null,
      changed: false,
      rewrittenIds: [],
    });
    assert.equal(activity(w).length, 0);
    rmSync(path.join(w.root, "workspace.json"));
    fail(
      send(w, {
        command: "task.order.normalize",
        args: { parentId: null, tasks: [] },
        writeContext: context,
        idempotencyKey: "not-init",
      }),
      "INVALID_STORAGE",
    );
    assert.equal(existsSync(path.join(w.root, "workspace.json")), false);
  },
);

test(
  "cache schema-2 upgrade preserves retained authority/receipts/history and rebuild retains grouped scope metadata",
  linuxOnly,
  (t) => {
    const w = materialize(t, { a: {}, b: { orderKey: "a0" }, move: { orderKey: "a1" } });
    const oldRead = success(send(w, { command: "task.get", args: { id: "a" } }));
    const oldRequest = {
      command: "task.update",
      args: {
        id: "a",
        expectedVersion: (oldRead.result.task as Projection).version,
        title: "Retained earlier edit",
      },
      writeContext: oldRead.writeContext,
      idempotencyKey: "retained-update",
    };
    const oldResult = success(send(w, oldRequest)).result;
    const oldHistory = activity(w);
    const req = request(w, "task.reorder", {
      tasks: [{ id: "move" }],
      placement: { beforeId: "b" },
    });
    const context = req.writeContext;
    const db = new DatabaseSync(w.cache);
    db.exec(
      "DROP TABLE v2_operation_members; DROP TABLE v2_undo_claims; DROP TABLE v2_doctor_plans; PRAGMA user_version = 2;",
    );
    db.close();
    assert.equal(success(send(w, { command: "workspace.info" })).writeContext, context);
    assert.deepEqual(success(send(w, oldRequest)).result, oldResult);
    assert.deepEqual(activity(w), oldHistory);
    const original = success(send(w, req));
    const history = activity(w);
    assert.equal(history.length, 2);
    assert.deepEqual(history[0].before.selectedIds, ["move"]);
    assert.deepEqual(history[0].before.rewrittenIds, ["b"]);
    assert.deepEqual(
      history[0].before.tasks.map((task) => task.id),
      ["b", "move"],
    );
    assert.equal(activity(w, "b").length, 1);
    const bytes = raw(w);
    success(
      send(w, { command: "workspace.rebuild", writeContext: context, idempotencyKey: "rebuild" }),
    );
    assert.deepEqual(activity(w), history);
    assert.deepEqual(success(send(w, req)).result, original.result);
    assert.deepEqual(raw(w), bytes);
    const verify = new DatabaseSync(w.cache);
    assert.equal(verify.prepare("PRAGMA user_version").get()!.user_version, 5);
    verify.close();
  },
);

for (const command of ["task.reorder", "task.order.normalize"]) {
  test(`${command} numeric exhaustion refuses before staging or token rotation`, linuxOnly, (t) => {
    const w = materialize(t, { a: { orderKey: "a0V" }, b: { orderKey: "a1V" } });
    const req = request(w, command, {
      tasks: command === "task.reorder" ? [{ id: "a" }] : [{ id: "a" }, { id: "b" }],
      ...(command === "task.reorder" ? { placement: { last: true } } : { parentId: null }),
    });
    const db = new DatabaseSync(w.cache);
    db.prepare("UPDATE v2_query_state SET counter = ?, revision = ?").run(
      Number.MAX_SAFE_INTEGER - 3,
      Number.MAX_SAFE_INTEGER - 1,
    );
    db.close();
    const before = raw(w);
    fail(send(w, req), "UNSUPPORTED_COMMAND");
    assert.deepEqual(raw(w), before);
    assert.equal(existsSync(pendingIntentPath(readRootDescriptor(w.root))), false);
  });
}
