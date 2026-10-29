import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isEditorSaving, type TaskOptionClick } from "./TaskListRows";
import type { ComposerState } from "./TaskComposer";
import { selectableSiblingRows } from "./taskReordering";
import type { VisibleTaskRow } from "./taskTree";
import type { TaskView } from "./taskView";
import { useStableHandler } from "./useStableHandler";

export type ActiveTaskRequest = {
  key: number;
  taskId: string | null;
  preserveTaskOnRefresh: boolean;
};

type TaskListSelectionView = {
  tasks: TaskView[];
  visibleRows: VisibleTaskRow[];
  filterIdentity: string;
  newTaskId?: string | null;
  activeTaskRequest: ActiveTaskRequest;
  composerMode: ComposerState["mode"] | null;
  onAnnounce: (message: string) => void;
  onEdit: (task: TaskView) => void;
};

/** The selection when no Shift or Ctrl/⌘ gesture widened it: the active task alone. */
function activeOnly(row: VisibleTaskRow | undefined): ReadonlySet<string> {
  return new Set(row && !row.contextOnly ? [row.task.id] : []);
}

export function useTaskListSelection({
  tasks,
  visibleRows,
  filterIdentity,
  newTaskId,
  activeTaskRequest,
  composerMode,
  onAnnounce,
  onEdit,
}: TaskListSelectionView) {
  // The active row is followed by task id, so hierarchy moves and refreshes
  // that shift row positions keep the same task active.
  const [active, setActive] = useState<{ index: number; id: string | null }>({
    index: 0,
    id: null,
  });
  const activeTaskIndex = active.index;
  // Only Shift and Ctrl/⌘ gestures set a range: several siblings that always
  // include the active task. Without one, the active task is the selection, so
  // every move of the active row moves the selection with it.
  const [range, setRange] = useState<ReadonlySet<string> | null>(null);
  const rangeRef = useRef<ReadonlySet<string> | null>(null);
  const visibleRowsRef = useRef<VisibleTaskRow[]>([]);
  const selectedIdsRef = useRef<ReadonlySet<string>>(new Set());
  const previousFilterIdentityRef = useRef<string | null>(null);
  const selectionAnchorRef = useRef<string | null>(null);
  const restoreActiveIdRef = useRef<string | null>(null);
  const identityRefreshPendingRef = useRef(false);
  const activeTaskIndexRef = useRef(0);
  const activeTaskIdRef = useRef<string | null>(null);
  const activeTaskRef = useRef<TaskView | undefined>(undefined);
  const lastSelectedNewTaskIdRef = useRef<string | null>(null);
  const activeScrollFrameRef = useRef<number | null>(null);
  const activeScrollTargetRef = useRef<string | null>(null);

  /** Moves the active row and keeps the range; callers settle the range next. */
  function setActiveRow(nextIndex: number): void {
    activeTaskIdRef.current = visibleRowsRef.current[nextIndex]?.task.id ?? null;
    activeTaskIndexRef.current = nextIndex;
    setActive({ index: nextIndex, id: activeTaskIdRef.current });
  }

  /** A row chosen by a key, click or request; a pending identity-preserving refresh keeps it. */
  function chooseActiveRow(nextIndex: number): void {
    setActiveRow(nextIndex);
    if (restoreActiveIdRef.current !== null) restoreActiveIdRef.current = activeTaskIdRef.current;
  }

  function setRangeIds(ids: ReadonlySet<string> | null): void {
    const next = ids && ids.size > 1 ? ids : null;
    rangeRef.current = next;
    setRange(next);
    selectedIdsRef.current = next ?? activeOnly(visibleRowsRef.current[activeTaskIndexRef.current]);
  }

  /** Makes one row active and the only selection. */
  function activate(index: number): void {
    chooseActiveRow(index);
    setRangeIds(null);
    selectionAnchorRef.current = activeTaskIdRef.current;
  }

  function clearActiveTaskSelection(): void {
    restoreActiveIdRef.current = null;
    activate(-1);
  }

  // The active row is list state, not focus state, so it survives toolbar
  // clicks and empty-area focus loss. Focus stays a screen-reader concern.
  const clampedActiveIndex = visibleRows.length
    ? Math.min(activeTaskIndex, visibleRows.length - 1)
    : 0;
  const identityActiveIndex =
    active.id === null ? -1 : visibleRows.findIndex((row) => row.task.id === active.id);
  const activeIndex = identityActiveIndex >= 0 ? identityActiveIndex : clampedActiveIndex;
  const activeRow = visibleRows.length ? visibleRows[activeIndex] : undefined;
  const activeTask = activeRow?.task;
  const activeTaskId = activeTask?.id ?? null;
  const selectedIds = range ?? activeOnly(activeRow);

  // Event handlers read these between renders.
  useLayoutEffect(() => {
    visibleRowsRef.current = visibleRows;
    selectedIdsRef.current = selectedIds;
    activeTaskIndexRef.current = activeIndex;
    activeTaskIdRef.current = activeTaskId;
    activeTaskRef.current = activeTask;
  });

  useEffect(() => {
    if (activeIndex !== activeTaskIndex || activeTaskId !== active.id) setActiveRow(activeIndex);

    const restoredActiveId = restoreActiveIdRef.current;
    if (restoredActiveId !== null) {
      const restoredIndex = visibleRows.findIndex((row) => row.task.id === restoredActiveId);
      if (restoredIndex >= 0) {
        setActiveRow(restoredIndex);
      } else if (visibleRows.length > 0) {
        setActiveRow(Math.min(activeTaskIndex, visibleRows.length - 1));
        onAnnounce("The moved task is outside the loaded page.");
      }
      if (!identityRefreshPendingRef.current) restoreActiveIdRef.current = null;
    }

    const filterChanged =
      previousFilterIdentityRef.current !== null &&
      previousFilterIdentityRef.current !== filterIdentity;
    previousFilterIdentityRef.current = filterIdentity;
    const selectableIds = new Set(
      visibleRows.filter((row) => !row.contextOnly).map((row) => row.task.id),
    );
    // Select a new task once. The highlight id remains set briefly, but it
    // must not select the task again after the user starts another create.
    if (newTaskId == null) lastSelectedNewTaskIdRef.current = null;
    if (
      newTaskId != null &&
      newTaskId !== lastSelectedNewTaskIdRef.current &&
      selectableIds.has(newTaskId)
    ) {
      lastSelectedNewTaskIdRef.current = newTaskId;
      activate(visibleRows.findIndex((row) => row.task.id === newTaskId));
      return;
    }
    if (filterChanged) {
      activate(activeTaskIndexRef.current);
      return;
    }
    // A range keeps its tasks that are still selectable, and ends once the
    // active task leaves it. A pending refresh keeps it whole until it lands.
    const current = rangeRef.current;
    if (current !== null && !identityRefreshPendingRef.current) {
      const kept = new Set([...current].filter((id) => selectableIds.has(id)));
      if (!kept.has(activeTaskIdRef.current ?? "")) activate(activeTaskIndexRef.current);
      else if (kept.size !== current.size) setRangeIds(kept);
    }
    const anchorId = selectionAnchorRef.current;
    if (anchorId === null || !selectableIds.has(anchorId))
      selectionAnchorRef.current = activeTaskIdRef.current;
  }, [
    active.id,
    activeIndex,
    activeTaskId,
    activeTaskIndex,
    filterIdentity,
    newTaskId,
    onAnnounce,
    visibleRows,
  ]);

  // Right-arrow category filtering keeps the task id through the async list
  // refresh; other active-task requests apply once to the current rows. This
  // runs after the selection effect above, so the request wins; applying it
  // during render instead selects the wrong row after a filter change.
  const appliedRequestRef = useRef<{ key: number; tasks: TaskView[] | null }>({
    key: activeTaskRequest.key,
    tasks: null,
  });
  useEffect(() => {
    const appliedRequest = appliedRequestRef.current;
    const requestChanged = appliedRequest.key !== activeTaskRequest.key;
    const refreshApplied =
      activeTaskRequest.taskId !== null &&
      appliedRequest.tasks !== null &&
      appliedRequest.tasks !== tasks;
    if (!requestChanged && !refreshApplied) return;
    appliedRequestRef.current = {
      key: activeTaskRequest.key,
      tasks: requestChanged && activeTaskRequest.preserveTaskOnRefresh ? tasks : null,
    };
    const requestedIndex =
      activeTaskRequest.taskId === null
        ? 0
        : Math.max(
            visibleRows.findIndex((row) => row.task.id === activeTaskRequest.taskId),
            0,
          );
    activate(requestedIndex);
  }, [
    activeTaskRequest.key,
    activeTaskRequest.preserveTaskOnRefresh,
    activeTaskRequest.taskId,
    tasks,
    visibleRows,
  ]);

  useEffect(
    () => () => {
      if (activeScrollFrameRef.current !== null) cancelAnimationFrame(activeScrollFrameRef.current);
    },
    [],
  );

  /** Makes `row` active and selects the siblings from the anchor through it. */
  function extendTo(row: VisibleTaskRow, index: number): void {
    if (row.contextOnly) {
      onAnnounce("Context-only tasks cannot be selected.");
      return;
    }
    const scope = selectableSiblingRows(row, visibleRowsRef.current);
    const anchorId = selectionAnchorRef.current;
    const anchorIndex =
      anchorId === null ? -1 : scope.findIndex((candidate) => candidate.task.id === anchorId);
    const targetIndex = scope.findIndex((candidate) => candidate.task.id === row.task.id);
    if (anchorIndex < 0 || targetIndex < 0) {
      activate(index);
      if (anchorId !== null && targetIndex >= 0)
        onAnnounce("Selection is limited to one visible sibling scope.");
      return;
    }
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    const count = end - start + 1;
    chooseActiveRow(index);
    setRangeIds(new Set(scope.slice(start, end + 1).map((candidate) => candidate.task.id)));
    onAnnounce(`${count} task${count === 1 ? "" : "s"} selected`);
  }

  /** Ctrl/⌘+click: adds or removes one sibling while the active task stays selected. */
  function toggleSelected(row: VisibleTaskRow, index: number): void {
    const scope = selectableSiblingRows(row, visibleRowsRef.current);
    const sameScope =
      scope.length > 0 &&
      [...selectedIdsRef.current].every((id) =>
        scope.some((candidate) => candidate.task.id === id),
      );
    if (!sameScope) {
      activate(index);
      return;
    }
    const next = new Set(selectedIdsRef.current);
    if (!next.delete(row.task.id)) {
      next.add(row.task.id);
      chooseActiveRow(index);
      selectionAnchorRef.current = row.task.id;
    } else if (next.size === 0) {
      activate(index);
      return;
    } else if (row.task.id === activeTaskIdRef.current) {
      // Removing the active task hands the active row to the nearest selected sibling.
      const at = scope.findIndex((candidate) => candidate.task.id === row.task.id);
      const nearest = scope
        .filter((candidate) => next.has(candidate.task.id))
        .reduce((best, candidate) =>
          Math.abs(scope.indexOf(candidate) - at) < Math.abs(scope.indexOf(best) - at)
            ? candidate
            : best,
        );
      chooseActiveRow(visibleRowsRef.current.indexOf(nearest));
      selectionAnchorRef.current = nearest.task.id;
    }
    setRangeIds(next);
    onAnnounce(`${next.size} task${next.size === 1 ? "" : "s"} selected`);
  }

  function scheduleActiveScroll(taskId: string): void {
    activeScrollTargetRef.current = taskId;
    if (activeScrollFrameRef.current !== null) return;
    activeScrollFrameRef.current = requestAnimationFrame(() => {
      activeScrollFrameRef.current = null;
      const targetId = activeScrollTargetRef.current;
      if (targetId !== null)
        document.getElementById(`task-option-${targetId}`)?.scrollIntoView({ block: "nearest" });
    });
  }

  function moveActive(next: number | "next" | "previous", extend = false): void {
    if (visibleRows.length === 0) return;
    const currentIndex = activeTaskIndexRef.current;
    if (currentIndex < 0) {
      const firstIndex = visibleRows.findIndex((row) => !row.contextOnly);
      if (firstIndex < 0) return;
      activate(firstIndex);
      scheduleActiveScroll(visibleRows[firstIndex].task.id);
      return;
    }
    const requestedIndex =
      typeof next === "number" ? next : currentIndex + (next === "next" ? 1 : -1);
    if (extend) {
      const current = visibleRows[currentIndex];
      if (!current || current.contextOnly) {
        onAnnounce("Selection is limited to visible sibling tasks.");
        return;
      }
      const scope = selectableSiblingRows(current, visibleRowsRef.current);
      const currentScopeIndex = scope.findIndex(
        (candidate) => candidate.task.id === current.task.id,
      );
      const step = requestedIndex > currentIndex ? 1 : -1;
      const target = scope[currentScopeIndex + step];
      if (!target) {
        onAnnounce(
          step > 0 ? "Selection is at the last sibling." : "Selection is at the first sibling.",
        );
        return;
      }
      const targetIndex = visibleRows.findIndex(
        (candidate) => candidate.task.id === target.task.id,
      );
      if (targetIndex < 0) return;
      extendTo(target, targetIndex);
      scheduleActiveScroll(target.task.id);
      return;
    }

    const wrapped = (requestedIndex + visibleRows.length) % visibleRows.length;
    activate(wrapped);
    scheduleActiveScroll(visibleRows[wrapped].task.id);
  }

  function selectBoundary(end: "start" | "end"): void {
    const current = visibleRows[activeTaskIndexRef.current];
    if (!current || current.contextOnly) {
      onAnnounce("Selection is limited to visible sibling tasks.");
      return;
    }
    const scope = selectableSiblingRows(current, visibleRowsRef.current);
    const target = end === "start" ? scope[0] : scope[scope.length - 1];
    if (!target) return;
    extendTo(
      target,
      visibleRows.findIndex((candidate) => candidate.task.id === target.task.id),
    );
    scheduleActiveScroll(target.task.id);
  }

  /** Narrows a range to the active task. Returns false when there was no range. */
  function clearSelection(): boolean {
    if (selectedIdsRef.current.size < 2) return false;
    activate(activeTaskIndexRef.current);
    onAnnounce("Selection cleared");
    return true;
  }

  const handleOptionClick = useStableHandler<Parameters<TaskOptionClick>>((row, index, event) => {
    const modified = event.shiftKey || event.ctrlKey || event.metaKey;
    // While editing, a plain click moves the editor to this row, once any save has landed.
    if (composerMode === "create" || (composerMode === "edit" && (modified || isEditorSaving())))
      return;
    if (row.contextOnly && modified) {
      onAnnounce("Context-only tasks cannot be selected.");
      return;
    }
    if (event.shiftKey) {
      extendTo(row, index);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      toggleSelected(row, index);
      return;
    }
    activate(index);
    onEdit(row.task);
  });

  return {
    activeIndex,
    activeRow,
    activeTask,
    selectedIds,
    visibleRowsRef,
    selectedIdsRef,
    activate,
    moveActive,
    selectBoundary,
    clearSelection,
    handleOptionClick,
    scheduleActiveScroll,
    handle: {
      startIdentityPreservingRefresh: () => {
        identityRefreshPendingRef.current = true;
        restoreActiveIdRef.current = activeTaskIdRef.current;
      },
      finishIdentityPreservingRefresh: () => {
        identityRefreshPendingRef.current = false;
        restoreActiveIdRef.current = null;
      },
      clearActiveTaskSelection,
      getActiveTask: () => activeTaskRef.current,
    },
  };
}
