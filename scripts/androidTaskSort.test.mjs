import assert from "node:assert/strict";
import { test } from "node:test";
import { sortAndroidTasks } from "../src/platform/androidTaskSort.ts";
import { classifyTaskFields } from "../src/backend/taskText.ts";

const tasks = [
  { id: "child", parentId: "root-a", priority: 0, createdAt: "2026-01-03", updatedAt: "2026-01-01" },
  { id: "root-a", parentId: null, priority: 4, createdAt: "2026-01-01", updatedAt: "2026-01-02" },
  { id: "root-b", parentId: null, priority: 2, createdAt: "2026-01-02", updatedAt: "2026-01-03" },
];

function ids(items) {
  return items.map((task) => task.id);
}

test("Android defaults to updated/newest; explicit priority sort matches desktop", () => {
  assert.deepEqual(ids(sortAndroidTasks(tasks, "updated", "desc")), ["root-b", "root-a", "child"]);
  assert.deepEqual(ids(sortAndroidTasks(tasks, "priority", "desc")), ["child", "root-b", "root-a"]);
  assert.deepEqual(ids(sortAndroidTasks(tasks, "priority", "asc")), ["root-a", "root-b", "child"]);
});

test("Android uses the desktop title/category and description/tag classification rules", () => {
  const parsed = classifyTaskFields("Plan @work #first", "Notes @personal #second");
  assert.equal(parsed.category?.slug, "work");
  assert.deepEqual(parsed.tags.map((tag) => tag.slug), ["first", "second"]);
});

test("Android manual order keeps descendants beside their parent, even when filtered", () => {
  const ordered = sortAndroidTasks(tasks, "manual", "desc");
  assert.deepEqual(ids(ordered), ["root-a", "child", "root-b"]);
  assert.deepEqual(ids(ordered.filter((task) => task.id !== "root-a")), ["child", "root-b"]);
  assert.deepEqual(ids(tasks), ["child", "root-a", "root-b"]);
});

test("Android date sort uses direction and stable id ties", () => {
  assert.deepEqual(ids(sortAndroidTasks(tasks, "created", "desc")), ["child", "root-b", "root-a"]);
  assert.deepEqual(ids(sortAndroidTasks(tasks, "updated", "asc")), ["child", "root-a", "root-b"]);
});
