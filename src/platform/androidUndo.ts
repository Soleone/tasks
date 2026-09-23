import type { TaskRecord } from "../backend/protocol";

export type SavedOrder = { parentId: string | null; taskIds: string[] };
export type SavedOperation = {
  id: string;
  kind: "mutation" | "reorder" | "create";
  before: TaskRecord[];
  after: TaskRecord[];
  beforeOrders: SavedOrder[];
  afterOrders: SavedOrder[];
};

export class AndroidUndoError extends Error {
  readonly code: "OPERATION_UNAVAILABLE" | "OPERATION_CONFLICT";

  constructor(code: AndroidUndoError["code"], message: string) {
    super(message);
    this.name = "AndroidUndoError";
    this.code = code;
  }
}

export function planAndroidUndo(
  stored: SavedOperation | null,
  operationId: string,
  tasks: TaskRecord[],
  now: string,
): Array<{ live: TaskRecord; restored: TaskRecord }> {
  if (!stored || stored.id !== operationId || !Array.isArray(stored.before) || !Array.isArray(stored.after)
      || !Array.isArray(stored.beforeOrders) || !Array.isArray(stored.afterOrders)
      || stored.before.length !== stored.after.length || stored.before.length === 0) {
    throw new AndroidUndoError("OPERATION_UNAVAILABLE", `operation ${operationId} is no longer undoable`);
  }
  const comparable = (task: TaskRecord): string => JSON.stringify({
    title: task.title, descriptionMarkdown: task.descriptionMarkdown, status: task.status,
    priority: task.priority, parentId: task.parentId, dependencyIds: task.dependencyIds,
    updatedAt: task.updatedAt, completedAt: task.completedAt, canceledAt: task.canceledAt,
  });
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const plans = stored.before.map((before, index) => {
    const expected = stored.after[index];
    const live = byId.get(before.id);
    if (!live || live.id !== expected?.id || live.version !== expected.version || comparable(live) !== comparable(expected)) {
      throw new AndroidUndoError("OPERATION_CONFLICT", `task ${before.id} changed since operation ${operationId}`);
    }
    const blockedByIds = before.dependencyIds.filter((id) => byId.get(id)?.status !== "canceled");
    const restored = {
      ...before, blockedByIds, version: live.version + 1,
      updatedAt: stored.kind === "reorder" ? live.updatedAt : now,
    };
    return { live, restored };
  });
  for (const order of stored.afterOrders) {
    const ids = tasks.filter((task) => task.parentId === order.parentId).map((task) => task.id);
    if (ids.length !== order.taskIds.length || ids.some((id, index) => id !== order.taskIds[index])) {
      throw new AndroidUndoError("OPERATION_CONFLICT", "sibling order changed since this operation");
    }
  }
  return plans;
}
