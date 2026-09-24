import type { TaskRecord } from "@/backend/protocol";

export type VisibleTaskRow = {
  task: TaskRecord;
  depth: 0 | 1;
  hasChildren: boolean;
  contextOnly: boolean;
};

type TaskGroup = {
  root: TaskRecord;
  descendants: TaskRecord[];
  rootIndex: number;
};

function rootFor(task: TaskRecord, byId: Map<string, TaskRecord>): string {
  let current = task;
  const seen = new Set<string>();
  while (current.parentId) {
    if (seen.has(current.id)) return task.id;
    seen.add(current.id);
    const parent = byId.get(current.parentId);
    if (!parent) return current.id;
    current = parent;
  }
  return current.id;
}

export function contextAncestorIds(tasks: readonly TaskRecord[], knownTasks: readonly TaskRecord[]): Set<string> {
  const byId = new Map(knownTasks.map((task) => [task.id, task]));
  const contextIds = new Set<string>();
  for (const task of tasks) {
    const seen = new Set<string>([task.id]);
    let parentId = task.parentId;
    while (parentId !== null && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      contextIds.add(parent.id);
      parentId = parent.parentId;
    }
  }
  return contextIds;
}

export function taskGroupOrder(tasks: TaskRecord[], contextTasks: TaskRecord[]): Map<string, number> {
  const byId = new Map([...contextTasks, ...tasks].map((entry) => [entry.id, entry]));
  const order = new Map<string, number>();
  for (const task of tasks) {
    const rootId = rootFor(task, byId);
    if (!order.has(rootId)) order.set(rootId, order.size);
  }
  return order;
}

/**
 * Flattens the loaded task set into a shallow outline. Deeper relationships
 * stay visible as one-level descendants instead of creating an unbounded UI.
 */
export function visibleTaskRows(
  tasks: TaskRecord[],
  expandedIds: ReadonlySet<string>,
  contextTasks: TaskRecord[] = [],
  rootOrder: ReadonlyMap<string, number> = new Map(),
): VisibleTaskRow[] {
  const matchingIds = new Set(tasks.map((task) => task.id));
  const byId = new Map([...contextTasks, ...tasks].map((task) => [task.id, task]));
  const groups = new Map<string, TaskGroup>();

  tasks.forEach((task, index) => {
    const rootId = rootFor(task, byId);
    const root = byId.get(rootId) ?? task;
    const group = groups.get(rootId) ?? { root, descendants: [], rootIndex: rootOrder.get(rootId) ?? index };
    if (task.id === rootId) group.root = task;
    else group.descendants.push(task);
    if (!rootOrder.has(rootId)) group.rootIndex = Math.min(group.rootIndex, index);
    groups.set(rootId, group);
  });

  return [...groups.values()]
    .sort((left, right) => left.rootIndex - right.rootIndex)
    .flatMap((group) => {
      const rootRow: VisibleTaskRow = {
        task: group.root,
        depth: 0,
        hasChildren: group.descendants.length > 0,
        contextOnly: !matchingIds.has(group.root.id),
      };
      if (!expandedIds.has(group.root.id)) return [rootRow];
      return [rootRow, ...group.descendants.map((task) => ({
        task,
        depth: 1 as const,
        hasChildren: false,
        contextOnly: false,
      }))];
    });
}
