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
  if ([...selectedIds].some((id) => !selected.some((candidate) => candidate.task.id === id)))
    return null;
  return selected;
}

export function placementForMove(
  direction: TaskMoveDirection,
  row: VisibleTaskRow,
  selected: readonly VisibleTaskRow[],
  rows: readonly VisibleTaskRow[],
): TaskMovePlacement | null {
  const scope = selectableSiblingRows(row, rows);
  const selectedIds = new Set(selected.map((candidate) => candidate.task.id));
  const firstSelected = scope.findIndex((candidate) => selectedIds.has(candidate.task.id));
  const lastSelected =
    scope.length -
    1 -
    [...scope].reverse().findIndex((candidate) => selectedIds.has(candidate.task.id));
  if (firstSelected < 0 || lastSelected < 0) return null;
  if (direction === "start") {
    return firstSelected === 0 ? null : { beforeId: scope[0].task.id };
  }
  if (direction === "end") {
    return lastSelected === scope.length - 1 ? null : { afterId: scope[scope.length - 1].task.id };
  }
  if (direction === "up") {
    if (firstSelected === 0) return null;
    const previous = scope
      .slice(0, firstSelected)
      .reverse()
      .find((candidate) => !selectedIds.has(candidate.task.id));
    return previous ? { beforeId: previous.task.id } : null;
  }
  if (lastSelected === scope.length - 1) return null;
  const next = scope
    .slice(lastSelected + 1)
    .find((candidate) => !selectedIds.has(candidate.task.id));
  return next ? { afterId: next.task.id } : null;
}

export function selectionMembershipMatches(
  rows: readonly VisibleTaskRow[],
  ids: readonly string[],
): boolean {
  if (rows.length !== ids.length) return false;
  const rowIds = new Set(rows.map((row) => row.task.id));
  return rowIds.size === ids.length && ids.every((id) => rowIds.has(id));
}

export function placementTargetId(placement: TaskMovePlacement): string {
  return "beforeId" in placement ? placement.beforeId : placement.afterId;
}
