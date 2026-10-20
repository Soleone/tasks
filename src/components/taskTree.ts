import type { TaskView } from "./taskView";

export type VisibleTaskRow = {
  task: TaskView;
  depth: 0 | 1;
  hasChildren: boolean;
  contextOnly: boolean;
};

type TaskGroup = {
  root: TaskView;
  descendants: TaskView[];
  rootIndex: number;
};

function rootFor(task: TaskView, byId: Map<string, TaskView>): string {
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

export function contextTaskIds(
  tasks: readonly TaskView[],
  knownTasks: readonly TaskView[],
): Set<string> {
  const byId = new Map(knownTasks.map((task) => [task.id, task]));
  const rootIds = new Set(tasks.map((task) => rootFor(task, byId)));
  return new Set(
    knownTasks.filter((task) => rootIds.has(rootFor(task, byId))).map((task) => task.id),
  );
}

export function taskGroupOrder(tasks: TaskView[], contextTasks: TaskView[]): Map<string, number> {
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
  tasks: TaskView[],
  expandedIds: ReadonlySet<string>,
  contextTasks: TaskView[] = [],
  rootOrder: ReadonlyMap<string, number> = new Map(),
): VisibleTaskRow[] {
  const matchingIds = new Set(tasks.map((task) => task.id));
  const byId = new Map([...contextTasks, ...tasks].map((task) => [task.id, task]));
  const groups = new Map<string, TaskGroup>();

  tasks.forEach((task, index) => {
    const rootId = rootFor(task, byId);
    const root = byId.get(rootId) ?? task;
    const group = groups.get(rootId) ?? {
      root,
      descendants: [],
      rootIndex: rootOrder.get(rootId) ?? index,
    };
    if (task.id === rootId) group.root = task;
    else group.descendants.push(task);
    if (!rootOrder.has(rootId)) group.rootIndex = Math.min(group.rootIndex, index);
    groups.set(rootId, group);
  });

  for (const task of contextTasks) {
    if (matchingIds.has(task.id)) continue;
    const rootId = rootFor(task, byId);
    if (task.id !== rootId) groups.get(rootId)?.descendants.push(task);
  }

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
      return [
        rootRow,
        ...group.descendants.map((task) => ({
          task,
          depth: 1 as const,
          hasChildren: false,
          contextOnly: !matchingIds.has(task.id),
        })),
      ];
    });
}
