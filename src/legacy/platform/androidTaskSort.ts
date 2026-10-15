import type { TaskRecord } from "../backend/protocol";

export function sortAndroidTasks(tasks: TaskRecord[], sort: string, direction: string): TaskRecord[] {
  if (sort === "manual") {
    // The snapshot is ordered by sibling position. Walk each scope so children
    // follow their parent rather than interleaving with unrelated root tasks.
    const byParent = new Map<string | null, TaskRecord[]>();
    for (const task of tasks) {
      const siblings = byParent.get(task.parentId) ?? [];
      siblings.push(task);
      byParent.set(task.parentId, siblings);
    }
    const ordered: TaskRecord[] = [];
    const visit = (task: TaskRecord): void => {
      ordered.push(task);
      for (const child of byParent.get(task.id) ?? []) visit(child);
    };
    for (const root of byParent.get(null) ?? []) visit(root);
    return ordered;
  }
  const result = [...tasks];
  const multiplier = direction === "asc" ? 1 : -1;
  result.sort((left, right) => {
    if (sort === "priority") return -multiplier * (left.priority - right.priority) || left.id.localeCompare(right.id);
    const leftValue = sort === "created" ? left.createdAt : left.updatedAt;
    const rightValue = sort === "created" ? right.createdAt : right.updatedAt;
    return multiplier * leftValue.localeCompare(rightValue) || left.id.localeCompare(right.id);
  });
  return result;
}
