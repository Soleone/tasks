import assert from "node:assert/strict";
import test from "node:test";
import { AndroidUndoError, planAndroidUndo } from "../src/legacy/platform/androidUndo.ts";

const now = "2026-09-10T00:00:00.000Z";
function task(id, changes = {}) {
  return {
    id,
    title: id,
    descriptionMarkdown: "",
    status: "open",
    priority: 2,
    category: null,
    tags: [],
    parentId: null,
    dependencyIds: [],
    blockedByIds: [],
    version: 1,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    canceledAt: null,
    ...changes,
  };
}
function operation(before, after, changes = {}) {
  return {
    id: "op",
    kind: "mutation",
    before: [before],
    after: [after],
    beforeOrders: [],
    afterOrders: [],
    ...changes,
  };
}
function fails(code, fn) {
  assert.throws(fn, (error) => error instanceof AndroidUndoError && error.code === code);
}

test("Android undo restores a status with a new version, not the stale old version", () => {
  const before = task("one");
  const after = task("one", { version: 2, status: "done", completedAt: now });
  const [plan] = planAndroidUndo(operation(before, after), "op", [after], "later");
  assert.equal(plan.restored.status, "open");
  assert.equal(plan.restored.completedAt, null);
  assert.equal(plan.restored.version, 3);
  assert.equal(plan.restored.updatedAt, "later");
  fails("OPERATION_CONFLICT", () =>
    planAndroidUndo(operation(before, after), "op", [{ ...after, version: 3 }], "later"),
  );
  fails("OPERATION_CONFLICT", () =>
    planAndroidUndo(
      operation(before, after),
      "op",
      [{ ...after, title: "edited elsewhere" }],
      "later",
    ),
  );
  fails("OPERATION_UNAVAILABLE", () =>
    planAndroidUndo(operation(before, after), "different", [after], "later"),
  );
});

test("Android undo preserves reorder timestamps and rejects a changed sibling scope", () => {
  const before = task("one");
  const after = { ...before, version: 2 };
  const two = task("two");
  const record = operation(before, after, {
    kind: "reorder",
    beforeOrders: [{ parentId: null, taskIds: ["one", "two"] }],
    afterOrders: [{ parentId: null, taskIds: ["two", "one"] }],
  });
  assert.equal(planAndroidUndo(record, "op", [two, after], "later")[0].restored.updatedAt, now);
  fails("OPERATION_CONFLICT", () => planAndroidUndo(record, "op", [after, two], "later"));
});

test("Android undo recalculates active blockers when restoring dependencies", () => {
  const before = task("one", { dependencyIds: ["blocker"], blockedByIds: ["blocker"] });
  const after = task("one", { version: 2 });
  const canceled = task("blocker", { status: "canceled", canceledAt: now });
  const [plan] = planAndroidUndo(operation(before, after), "op", [after, canceled], "later");
  assert.deepEqual(plan.restored.dependencyIds, ["blocker"]);
  assert.deepEqual(plan.restored.blockedByIds, []);
});

test("Android undo rejects a dependency cycle introduced by a valid external edit", () => {
  const before = task("one", { dependencyIds: ["two"], blockedByIds: ["two"] });
  const after = task("one", { version: 2 });
  const external = task("two", { dependencyIds: ["one"], blockedByIds: ["one"] });
  fails("OPERATION_CONFLICT", () =>
    planAndroidUndo(operation(before, after), "op", [after, external], "later"),
  );
});

test("Android undo rejects a parent cycle introduced by a valid external move", () => {
  const before = task("one", { parentId: "two" });
  const after = task("one", { version: 2 });
  const external = task("two", { parentId: "one" });
  fails("OPERATION_CONFLICT", () =>
    planAndroidUndo(operation(before, after), "op", [after, external], "later"),
  );
});

test("Android undo permits an unrelated external edit when the prospective graph stays valid", () => {
  const before = task("one", { status: "open" });
  const after = task("one", { version: 2, status: "done", completedAt: now });
  const external = task("other", { version: 2, title: "Edited elsewhere" });
  const [plan] = planAndroidUndo(operation(before, after), "op", [after, external], "later");
  assert.equal(plan.restored.status, "open");
  assert.equal(plan.restored.version, 3);
});
