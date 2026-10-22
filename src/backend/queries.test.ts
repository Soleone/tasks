import assert from "node:assert/strict";
import test from "node:test";
import { CommandError } from "./errors.js";
import { executeQuery, type TaskProjection } from "./queries.js";
import type { TaskStatus } from "./taskModel.js";

function task(id: string, status: TaskStatus, closedAt: string | null): TaskProjection {
  return {
    id,
    title: id,
    text: null,
    description: "",
    status,
    priority: 2,
    category: null,
    tags: [],
    parentId: null,
    dependencyIds: [],
    attachments: [],
    due: null,
    orderKey: `a${id}`,
    createdAt: "2026-10-20T08:00:00.000Z",
    updatedAt: "2026-10-20T08:00:00.000Z",
    closedAt,
    version: 1,
    blockedByIds: [],
  };
}

const tasks = [
  task("1", "done", "2026-10-20T11:59:59.999Z"),
  task("2", "done", "2026-10-20T12:00:00.000Z"),
  task("3", "canceled", "2026-10-21T09:00:00.000Z"),
  task("4", "open", null),
];

function ids(args: Record<string, unknown>): string[] {
  const result = executeQuery("task.list", args, tasks, 1) as { tasks: TaskProjection[] };
  return result.tasks.map((entry) => entry.id).sort();
}

test("list.closed-since: closed tasks at or after the time match; active tasks never do", () => {
  assert.deepEqual(ids({ closedSince: "2026-10-20T12:00:00.000Z" }), ["2", "3"]);
  assert.deepEqual(ids({ closedSince: "2026-10-20T12:00:00.000Z", status: "done" }), ["2"]);
  for (const closedSince of ["2026-10-20", "2026-10-20T12:00:00Z", 0, null]) {
    assert.throws(
      () => ids({ closedSince }),
      (error: unknown) => error instanceof CommandError && error.code === "INVALID_ARGUMENT",
    );
  }
});

test("list.sort-due: soonest first, same day by priority, undated last either way", () => {
  const dated = [
    { ...task("late", "open", null), due: "2026-11-02" },
    { ...task("undated", "open", null) },
    { ...task("soon-p3", "open", null), due: "2026-10-23", priority: 3 as const },
    { ...task("soon-p1", "open", null), due: "2026-10-23", priority: 1 as const },
  ];
  const order = (args: Record<string, unknown>): string[] =>
    (
      executeQuery("task.list", { sort: "due", ...args }, dated, 1) as { tasks: TaskProjection[] }
    ).tasks.map((entry) => entry.id);
  assert.deepEqual(order({}), ["soon-p1", "soon-p3", "late", "undated"]);
  assert.deepEqual(order({ direction: "desc" }), ["late", "soon-p1", "soon-p3", "undated"]);
});
