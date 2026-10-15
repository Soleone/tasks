import type { AndroidImportedTask } from "./androidStorage";

type ParentId = string | null;
type CurrentTask = Pick<AndroidImportedTask, "id" | "parentId" | "position">;
type ChangedTask = Pick<AndroidImportedTask, "id" | "parentId">;

export type AndroidPurgeOrder = { parentId: ParentId; taskIds: string[] };

export type AndroidPurgePlan = {
  deletedOrderParentIds: string[];
  orders: AndroidPurgeOrder[];
};

export function planAndroidPurgeCanonicalChanges(
  currentTasks: CurrentTask[],
  deletedTasks: Array<Pick<CurrentTask, "id" | "parentId">>,
  affectedTasks: ChangedTask[],
): AndroidPurgePlan {
  const deletedIds = new Set(deletedTasks.map((task) => task.id));
  const currentById = new Map(currentTasks.map((task) => [task.id, task]));
  const affectedById = new Map(affectedTasks.map((task) => [task.id, task]));
  const orderParentIds = new Set<ParentId>();

  for (const task of deletedTasks) {
    if (task.parentId === null || !deletedIds.has(task.parentId)) orderParentIds.add(task.parentId);
  }

  for (const task of affectedTasks) {
    const previous = currentById.get(task.id);
    if (!previous) throw new Error(`affected Android task ${task.id} is missing from the current workspace`);
    if (previous.parentId === task.parentId) continue;
    if (previous.parentId === null || !deletedIds.has(previous.parentId)) orderParentIds.add(previous.parentId);
    if (task.parentId === null || !deletedIds.has(task.parentId)) orderParentIds.add(task.parentId);
  }

  const orders = [...orderParentIds].map((parentId) => {
    const siblings = currentTasks
      .filter((task) => !deletedIds.has(task.id))
      .map((task) => {
        const affected = affectedById.get(task.id);
        return { id: task.id, parentId: affected ? affected.parentId : task.parentId, position: task.position };
      })
      .filter((task) => task.parentId === parentId)
      .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
      .map((task) => task.id);
    return { parentId, taskIds: siblings };
  });

  return { deletedOrderParentIds: [...deletedIds], orders };
}
