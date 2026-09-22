import assert from "node:assert/strict";
import test from "node:test";
import { portableTaskExport } from "./taskExport.js";
import type { TaskRecord } from "./protocol.js";

const task: TaskRecord = {
  id: "first",
  title: "Write @work #today",
  descriptionMarkdown: "Notes",
  status: "open",
  priority: 2,
  category: { slug: "work", label: "work" },
  tags: [{ slug: "today", label: "today" }],
  parentId: null,
  dependencyIds: ["second"],
  blockedByIds: [],
  version: 4,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  completedAt: null,
  canceledAt: null,
};

test("desktop and Android portable exports share the same task contract", () => {
  const file = portableTaskExport([task], new Map([[task.id, 3]]), "2026-01-03T00:00:00Z");
  assert.equal(file.format, "tasks.tasks-export");
  assert.equal(file.formatVersion, 2);
  assert.equal(file.taskCount, 1);
  assert.deepEqual(file.tasks[0], {
    id: "first", siblingOrder: 3, title: task.title, status: "open", priority: 2,
    category: "work", tags: ["today"], parentId: null, blockedByIds: ["second"],
    notesMarkdown: "Notes", createdAt: task.createdAt, updatedAt: task.updatedAt,
    completedAt: null, canceledAt: null,
  });
  assert.equal("version" in file.tasks[0], false);
});
