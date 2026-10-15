import { CommandError } from "./errors.js";
import { validateV2Graph } from "./taskModel.js";
import type { V2CanonicalTask } from "./taskModel.js";

export type V2PurgeReference = { taskId: string; targetId: string; field: "parentId" | "dependencyIds" };
export class V2PurgeReferencedError extends CommandError {
  readonly details: { references: V2PurgeReference[] };
  constructor(references: V2PurgeReference[]) {
    super("PURGE_REFERENCED", "surviving task references prevent the complete canceled-task purge");
    this.details = { references };
  }
}

export function planV2Purge(tasks: readonly V2CanonicalTask[]): string[] {
  validateV2Graph(tasks);
  const purgedIds = tasks.filter(task => task.status === "canceled").map(task => task.id).sort();
  const removed = new Set(purgedIds);
  const references: V2PurgeReference[] = [];
  for (const task of [...tasks].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)) {
    if (removed.has(task.id)) continue;
    if (task.parentId !== null && removed.has(task.parentId)) references.push({ taskId: task.id, targetId: task.parentId, field: "parentId" });
    for (const id of task.dependencyIds) if (removed.has(id)) references.push({ taskId: task.id, targetId: id, field: "dependencyIds" });
  }
  if (references.length) throw new V2PurgeReferencedError(references);
  return purgedIds;
}
