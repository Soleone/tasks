import { CommandError } from "./errors.js";
import { validateGraph } from "./taskModel.js";
import type { CanonicalTask } from "./taskModel.js";

export type PurgeReference = { taskId: string; targetId: string; field: "parentId" | "dependencyIds" };
export class PurgeReferencedError extends CommandError {
  readonly details: { references: PurgeReference[] };
  constructor(references: PurgeReference[]) {
    super("PURGE_REFERENCED", "surviving task references prevent the complete canceled-task purge");
    this.details = { references };
  }
}

export function planPurge(tasks: readonly CanonicalTask[]): string[] {
  validateGraph(tasks);
  const purgedIds = tasks.filter(task => task.status === "canceled").map(task => task.id).sort();
  const removed = new Set(purgedIds);
  const references: PurgeReference[] = [];
  for (const task of [...tasks].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)) {
    if (removed.has(task.id)) continue;
    if (task.parentId !== null && removed.has(task.parentId)) references.push({ taskId: task.id, targetId: task.parentId, field: "parentId" });
    for (const id of task.dependencyIds) if (removed.has(id)) references.push({ taskId: task.id, targetId: id, field: "dependencyIds" });
  }
  if (references.length) throw new PurgeReferencedError(references);
  return purgedIds;
}
