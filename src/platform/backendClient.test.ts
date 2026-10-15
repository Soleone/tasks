import { expect, test, vi } from "vitest";
import { listTasks, undoOperation, updateTaskPriority } from "./backendClient";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/legacy/platform/backendTransport", () => ({
  getBackendTransport: () => ({ request }),
  isSelectedWorkspaceLaunch: () => false,
}));

test("legacy transport normalizes task fields without changing write or retry authority", async () => {
  const now = "2026-10-15T00:00:00.000Z";
  const legacy = {
    id: "task", title: "Call @Work #Phone", descriptionMarkdown: "Notes @literal #literal",
    status: "open", priority: 2, category: { slug: "work", label: "Work" }, tags: [{ slug: "phone", label: "Phone" }],
    parentId: "parent", dependencyIds: [], blockedByIds: [], version: 7,
    createdAt: now, updatedAt: now, completedAt: null, canceledAt: null,
  };
  request.mockResolvedValue({ ok: true, result: {
    tasks: [legacy], contextTasks: [{ ...legacy, id: "parent", parentId: null, status: "done", completedAt: now }],
    total: 1, limit: 50, offset: 0, workspaceRevision: 12,
  } });
  const page = await listTasks();
  const task = page.tasks[0];
  expect(task).toMatchObject({
    id: legacy.id, title: "Call", text: legacy.title, description: legacy.descriptionMarkdown,
    category: legacy.category, tags: legacy.tags, version: 7, closedAt: null,
  });
  for (const alias of ["descriptionMarkdown", "completedAt", "canceledAt"]) expect(task).not.toHaveProperty(alias);
  expect(page.contextTasks[0].closedAt).toBe(now);
  expect(page.workspaceRevision).toBe(12);

  request.mockResolvedValue({ ok: true, result: { task: { ...legacy, priority: 0, version: 8 }, changed: true, operationId: "priority" } });
  const changed = await updateTaskPriority(task, 0, { idempotencyKey: "same-request" });
  expect(changed.task).toMatchObject({ title: "Call", text: legacy.title, description: legacy.descriptionMarkdown, priority: 0, version: 8 });
  expect(changed.operationId).toBe("priority");
  expect(request).toHaveBeenLastCalledWith(expect.objectContaining({
    version: 1, command: "task.update", idempotencyKey: "same-request",
    args: { id: task.id, title: legacy.title, descriptionMarkdown: legacy.descriptionMarkdown, expectedVersion: 7, priority: 0 },
  }));

  request.mockResolvedValue({ ok: true, result: {
    tasks: [{ ...legacy, status: "canceled", canceledAt: now }],
    changed: true, operationId: "undo", undoneOperationId: "priority", deletedTaskIds: [],
  } });
  const undone = await undoOperation("priority", { idempotencyKey: "undo-request" });
  expect(undone.tasks[0]).toMatchObject({ title: "Call", text: legacy.title, description: legacy.descriptionMarkdown, closedAt: now });
  expect(undone.undoneOperationId).toBe("priority");
});
