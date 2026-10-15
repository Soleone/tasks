import assert from "node:assert/strict";
import test from "node:test";
import { planAndroidPurgeCanonicalChanges } from "../src/legacy/platform/androidPurgePlan.ts";

const currentTask = (id, parentId, position) => ({ id, parentId, position });

function reparsePurgeResult(currentTasks, deletedTasks, affectedTasks, plan) {
  const tasksById = new Map(currentTasks.map((task) => [task.id, { ...task }]));
  const orders = new Map();
  for (const task of currentTasks) {
    const siblings = orders.get(task.parentId) ?? [];
    siblings.push(task);
    orders.set(task.parentId, siblings);
  }
  for (const [parentId, siblings] of orders) {
    orders.set(parentId, siblings.sort((left, right) => left.position - right.position || left.id.localeCompare(right.id)).map((task) => task.id));
  }

  for (const parentId of plan.deletedOrderParentIds) orders.delete(parentId);
  for (const task of affectedTasks) tasksById.set(task.id, { ...tasksById.get(task.id), parentId: task.parentId });
  for (const order of plan.orders) orders.set(order.parentId, order.taskIds);
  for (const task of deletedTasks) tasksById.delete(task.id);

  const tasks = [...tasksById.values()].map((task) => JSON.parse(JSON.stringify(task)));
  const parsedOrders = [...orders].map(([parentId, taskIds]) => JSON.parse(JSON.stringify({ parentId, taskIds })));
  const tasksByParsedId = new Map(tasks.map((task) => [task.id, task]));
  for (const task of tasks) {
    assert.ok(task.parentId === null || tasksByParsedId.has(task.parentId), `missing parent ${task.parentId}`);
  }
  for (const order of parsedOrders) {
    assert.ok(order.parentId === null || tasksByParsedId.has(order.parentId), `orphaned order parent ${order.parentId}`);
    for (const id of order.taskIds) assert.equal(tasksByParsedId.get(id)?.parentId, order.parentId);
  }
  return { tasks, orders: parsedOrders };
}

test("purging a parent removes its order file and promotes its surviving child to root order", () => {
  const plan = planAndroidPurgeCanonicalChanges(
    [
      currentTask("parent", null, 0),
      currentTask("child", "parent", 0),
      currentTask("sibling", null, 1),
    ],
    [{ id: "parent", parentId: null }],
    [{ id: "child", parentId: null }],
  );

  assert.deepEqual(plan, {
    deletedOrderParentIds: ["parent"],
    orders: [{ parentId: null, taskIds: ["child", "sibling"] }],
  });
});

test("purging nested parents deletes both child-order files and places the surviving descendant at root", () => {
  const plan = planAndroidPurgeCanonicalChanges(
    [
      currentTask("outer", null, 0),
      currentTask("inner", "outer", 0),
      currentTask("survivor", "inner", 0),
      currentTask("root-sibling", null, 1),
    ],
    [
      { id: "outer", parentId: null },
      { id: "inner", parentId: "outer" },
    ],
    [{ id: "survivor", parentId: null }],
  );

  assert.deepEqual(plan, {
    deletedOrderParentIds: ["outer", "inner"],
    orders: [{ parentId: null, taskIds: ["survivor", "root-sibling"] }],
  });
});

test("the reparsed canonical purge matches the SQLite root sibling order", () => {
  const current = [
    currentTask("a", null, 0),
    currentTask("d", null, 1),
    currentTask("e", "d", 0),
    currentTask("f", null, 2),
  ];
  const deleted = [{ id: "d", parentId: null }];
  const affected = [
    { id: "e", parentId: null },
    { id: "f", parentId: null },
  ];
  const plan = planAndroidPurgeCanonicalChanges(current, deleted, affected);
  const reparsed = reparsePurgeResult(current, deleted, affected, plan);

  assert.deepEqual(reparsed.orders.find((order) => order.parentId === null)?.taskIds, ["a", "e", "f"]);
  assert.deepEqual(reparsed.tasks.map((task) => task.id), ["a", "e", "f"]);
  assert.equal(reparsed.orders.some((order) => order.parentId === "d"), false);
});

test("purging a child updates the surviving parent order and deletes the child's order file", () => {
  const plan = planAndroidPurgeCanonicalChanges(
    [
      currentTask("parent", null, 0),
      currentTask("removed", "parent", 0),
      currentTask("sibling", "parent", 1),
      currentTask("promoted", "removed", 0),
    ],
    [{ id: "removed", parentId: "parent" }],
    [{ id: "promoted", parentId: null }],
  );

  assert.deepEqual(plan, {
    deletedOrderParentIds: ["removed"],
    orders: [
      { parentId: "parent", taskIds: ["sibling"] },
      { parentId: null, taskIds: ["parent", "promoted"] },
    ],
  });
});
