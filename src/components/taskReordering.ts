import type { TaskReorderPlacement } from "@/backend/protocol";
import type { VisibleTaskRow } from "@/components/taskTree";

export type TaskMoveDirection = "up" | "down" | "start" | "end";
export type TaskMovePlacement = Extract<
  TaskReorderPlacement,
  { beforeId: string } | { afterId: string }
>;

export function selectableSiblingRows(
  row: VisibleTaskRow,
  rows: readonly VisibleTaskRow[],
): VisibleTaskRow[] {
  return rows.filter(
    (candidate) => !candidate.contextOnly && candidate.task.parentId === row.task.parentId,
  );
}

export function selectedRowsForReorder(
  row: VisibleTaskRow,
  rows: readonly VisibleTaskRow[],
  selectedIds: ReadonlySet<string>,
): VisibleTaskRow[] | null {
  if (row.contextOnly) return null;
  const scope = selectableSiblingRows(row, rows);
  const selected = scope.filter((candidate) => selectedIds.has(candidate.task.id));
  if (selected.length === 0) return selectedIds.size === 0 ? [row] : null;
  return selected.length === selectedIds.size ? selected : null;
}

export function placementForMove(
  direction: TaskMoveDirection,
  row: VisibleTaskRow,
  selected: readonly VisibleTaskRow[],
  rows: readonly VisibleTaskRow[],
): TaskMovePlacement | null {
  const scope = selectableSiblingRows(row, rows);
  const selectedIds = new Set(selected.map((candidate) => candidate.task.id));
  const isSelected = (candidate: VisibleTaskRow) => selectedIds.has(candidate.task.id);
  const firstSelected = scope.findIndex(isSelected);
  if (firstSelected < 0) return null;
  const lastSelected = scope.length - 1 - [...scope].reverse().findIndex(isSelected);
  if (direction === "start") {
    return firstSelected === 0 ? null : { beforeId: scope[0].task.id };
  }
  if (direction === "end") {
    return lastSelected === scope.length - 1 ? null : { afterId: scope[scope.length - 1].task.id };
  }
  if (direction === "up") {
    const previous = scope
      .slice(0, firstSelected)
      .reverse()
      .find((candidate) => !isSelected(candidate));
    return previous ? { beforeId: previous.task.id } : null;
  }
  const next = scope.slice(lastSelected + 1).find((candidate) => !isSelected(candidate));
  return next ? { afterId: next.task.id } : null;
}

/** Keep roots and their visible descendants together while a move is being saved. */
export function orderedTaskRows(
  rows: readonly VisibleTaskRow[],
  order: ReadonlyMap<string, number>,
): VisibleTaskRow[] {
  const groups: VisibleTaskRow[][] = [];
  for (const row of rows) {
    if (row.depth === 0 || groups.length === 0) groups.push([row]);
    else groups[groups.length - 1].push(row);
  }
  const rank = (row: VisibleTaskRow) => order.get(row.task.id) ?? Number.MAX_SAFE_INTEGER;
  groups.sort((left, right) => rank(left[0]) - rank(right[0]));
  return groups.flatMap(([root, ...children]) => [
    root,
    ...children.sort((left, right) => rank(left) - rank(right)),
  ]);
}

export function movedTaskRows(
  rows: readonly VisibleTaskRow[],
  selected: readonly VisibleTaskRow[],
  placement: TaskMovePlacement,
): VisibleTaskRow[] {
  const ids = new Set(selected.map((row) => row.task.id));
  const moving: VisibleTaskRow[] = [];
  const remaining: VisibleTaskRow[] = [];
  let movingRoot = false;
  for (const row of rows) {
    if (row.depth === 0) movingRoot = ids.has(row.task.id);
    (movingRoot || ids.has(row.task.id) ? moving : remaining).push(row);
  }
  const targetId = "beforeId" in placement ? placement.beforeId : placement.afterId;
  let index = remaining.findIndex((row) => row.task.id === targetId);
  if ("afterId" in placement) {
    const targetDepth = remaining[index].depth;
    index++;
    if (targetDepth === 0) while (index < remaining.length && remaining[index].depth > 0) index++;
  }
  return [...remaining.slice(0, index), ...moving, ...remaining.slice(index)];
}

export function selectionMembershipMatches(
  rows: readonly VisibleTaskRow[],
  ids: readonly string[],
): boolean {
  if (rows.length !== ids.length) return false;
  const rowIds = new Set(rows.map((row) => row.task.id));
  return rowIds.size === ids.length && ids.every((id) => rowIds.has(id));
}
