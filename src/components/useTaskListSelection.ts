import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TaskOptionClick } from "./TaskListRows";
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
  composerOpen: boolean;
  onAnnounce: (message: string) => void;
  onEdit: (task: TaskView) => void;
};

export function useTaskListSelection({
  tasks,
  visibleRows,
  filterIdentity,
  newTaskId,
  activeTaskRequest,
  composerOpen,
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const visibleRowsRef = useRef<VisibleTaskRow[]>([]);
  const selectedIdsRef = useRef<Set<string>>(new Set());
  const previousFilterIdentityRef = useRef<string | null>(null);
  const selectionClearedRef = useRef(false);
  const selectionAnchorRef = useRef<string | null>(null);
  const restoreActiveIdRef = useRef<string | null>(null);
  const restoreSelectionIdsRef = useRef<Set<string> | null>(null);
  const identityRefreshPendingRef = useRef(false);
  const activeTaskIndexRef = useRef(0);
  const activeTaskIdRef = useRef<string | null>(null);
  const activeTaskRef = useRef<TaskView | undefined>(undefined);
  const lastSelectedNewTaskIdRef = useRef<string | null>(null);
  const activeScrollFrameRef = useRef<number | null>(null);
  const activeScrollTargetRef = useRef<string | null>(null);

  function setActiveTaskIndex(nextIndex: number): void {
    activeTaskIdRef.current = visibleRowsRef.current[nextIndex]?.task.id ?? null;
    activeTaskIndexRef.current = nextIndex;
    setActive({ index: nextIndex, id: activeTaskIdRef.current });
  }

  function clearActiveTaskSelection(): void {
    restoreActiveIdRef.current = null;
    restoreSelectionIdsRef.current = null;
    setActiveTaskIndex(-1);
    setSelection([], null);
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

  // Event handlers read these between renders.
  useLayoutEffect(() => {
    visibleRowsRef.current = visibleRows;
    selectedIdsRef.current = selectedIds;
    activeTaskIndexRef.current = activeIndex;
    activeTaskIdRef.current = activeTaskId;
    activeTaskRef.current = activeTask;
  });

  useEffect(() => {
    if (activeIndex !== activeTaskIndex || activeTaskId !== active.id)
      setActiveTaskIndex(activeIndex);

    const selectableIds = new Set(
      visibleRows.filter((row) => !row.contextOnly).map((row) => row.task.id),
    );
    const restoredActiveId = restoreActiveIdRef.current;
    if (restoredActiveId !== null) {
      const restoredIndex = visibleRows.findIndex((row) => row.task.id === restoredActiveId);
      if (restoredIndex >= 0) {
        setActiveTaskIndex(restoredIndex);
      } else if (visibleRows.length > 0) {
        setActiveTaskIndex(Math.min(activeTaskIndex, visibleRows.length - 1));
        onAnnounce("The moved task is outside the loaded page.");
      }
      if (!identityRefreshPendingRef.current) restoreActiveIdRef.current = null;
    }

    const filterChanged =
      previousFilterIdentityRef.current !== null &&
      previousFilterIdentityRef.current !== filterIdentity;
    previousFilterIdentityRef.current = filterIdentity;
    const requestedSelection = filterChanged
      ? new Set<string>()
      : (restoreSelectionIdsRef.current ?? selectedIdsRef.current);
    // Apply the new-task selection once. The highlight id remains set briefly,
    // but it must not restore the selection after the user starts another create.
    if (newTaskId == null) lastSelectedNewTaskIdRef.current = null;
    const createdTaskId =
      newTaskId != null &&
      newTaskId !== lastSelectedNewTaskIdRef.current &&
      selectableIds.has(newTaskId)
        ? newTaskId
        : null;
    if (createdTaskId !== null) lastSelectedNewTaskIdRef.current = createdTaskId;
    const nextSelection =
      createdTaskId !== null
        ? new Set<string>([createdTaskId])
        : new Set([...requestedSelection].filter((id) => selectableIds.has(id)));
    if (createdTaskId !== null) {
      const createdTaskIndex = visibleRows.findIndex((row) => row.task.id === createdTaskId);
      if (createdTaskIndex >= 0 && createdTaskIndex !== activeTaskIndex)
        setActiveTaskIndex(createdTaskIndex);
    }
    const visibleActive = visibleRows[activeIndex];
    if (
      nextSelection.size === 0 &&
      visibleActive &&
      !visibleActive.contextOnly &&
      !selectionClearedRef.current
    )
      nextSelection.add(visibleActive.task.id);
    const changed =
      nextSelection.size !== selectedIdsRef.current.size ||
      [...nextSelection].some((id) => !selectedIdsRef.current.has(id));
    if (changed) setSelectedIds(nextSelection);
    selectedIdsRef.current = nextSelection;
    if (createdTaskId !== null) {
      selectionClearedRef.current = false;
      selectionAnchorRef.current = createdTaskId;
    } else if (
      filterChanged ||
      selectionAnchorRef.current === null ||
      !selectableIds.has(selectionAnchorRef.current)
    ) {
      selectionAnchorRef.current = [...nextSelection][0] ?? null;
    }
    if (!identityRefreshPendingRef.current) restoreSelectionIdsRef.current = null;
  }, [
    active.id,
    activeIndex,
    activeTaskId,
    activeTaskIndex,
    filterIdentity,
    newTaskId,
    onAnnounce,
    selectedIds,
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
    setActiveTaskIndex(requestedIndex);
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

  function setSelection(ids: Iterable<string>, anchorId: string | null): void {
    const next = new Set(ids);
    selectedIdsRef.current = next;
    selectionClearedRef.current = next.size === 0;
    selectionAnchorRef.current = anchorId;
    setSelectedIds(next);
  }

  function selectOnly(row: VisibleTaskRow): void {
    if (row.contextOnly) {
      setSelection([], null);
      return;
    }
    setSelection([row.task.id], row.task.id);
  }

  function selectRangeTo(row: VisibleTaskRow): void {
    if (row.contextOnly) {
      onAnnounce("Context-only tasks cannot be selected.");
      return;
    }
    const scope = selectableSiblingRows(row, visibleRowsRef.current);
    const anchorId = selectionAnchorRef.current;
    const anchorIndex =
      anchorId === null ? -1 : scope.findIndex((candidate) => candidate.task.id === anchorId);
    const targetIndex = scope.findIndex((candidate) => candidate.task.id === row.task.id);
    if (anchorId === null || targetIndex < 0) {
      selectOnly(row);
      return;
    }
    if (anchorIndex < 0) {
      selectOnly(row);
      onAnnounce("Selection is limited to one visible sibling scope.");
      return;
    }
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    const count = end - start + 1;
    setSelection(
      scope.slice(start, end + 1).map((candidate) => candidate.task.id),
      anchorId,
    );
    onAnnounce(`${count} task${count === 1 ? "" : "s"} selected`);
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
      const firstTask = visibleRows[firstIndex];
      setActiveTaskIndex(firstIndex);
      selectOnly(firstTask);
      scheduleActiveScroll(firstTask.task.id);
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
      setActiveTaskIndex(targetIndex);
      selectRangeTo(target);
      scheduleActiveScroll(target.task.id);
      return;
    }

    const wrapped = (requestedIndex + visibleRows.length) % visibleRows.length;
    const target = visibleRows[wrapped];
    setActiveTaskIndex(wrapped);
    selectOnly(target);
    scheduleActiveScroll(target.task.id);
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
    setActiveTaskIndex(visibleRows.findIndex((candidate) => candidate.task.id === target.task.id));
    selectRangeTo(target);
    scheduleActiveScroll(target.task.id);
  }

  function clearSelection(): boolean {
    if (selectedIdsRef.current.size < 2) return false;
    setSelection([], null);
    onAnnounce("Selection cleared");
    return true;
  }

  const handleOptionClick = useStableHandler<Parameters<TaskOptionClick>>((row, index, event) => {
    if (composerOpen) return;
    const { task } = row;
    if (row.contextOnly && (event.shiftKey || event.ctrlKey || event.metaKey)) {
      onAnnounce("Context-only tasks cannot be selected.");
      return;
    }
    if (event.shiftKey) {
      setActiveTaskIndex(index);
      selectRangeTo(row);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      setActiveTaskIndex(index);
      const scope = selectableSiblingRows(row, visibleRowsRef.current);
      const sameScope =
        scope.length > 0 &&
        [...selectedIdsRef.current].every((id) =>
          scope.some((candidate) => candidate.task.id === id),
        );
      if (!sameScope) {
        selectOnly(row);
        return;
      }
      const next = new Set(selectedIdsRef.current);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      setSelection(next, task.id);
      onAnnounce(`${next.size} task${next.size === 1 ? "" : "s"} selected`);
      return;
    }
    setActiveTaskIndex(index);
    selectOnly(row);
    onEdit(task);
  });

  return {
    activeIndex,
    activeRow,
    activeTask,
    selectedIds,
    visibleRowsRef,
    selectedIdsRef,
    setActiveTaskIndex,
    setSelection,
    selectOnly,
    moveActive,
    selectBoundary,
    clearSelection,
    handleOptionClick,
    scheduleActiveScroll,
    handle: {
      startIdentityPreservingRefresh: () => {
        identityRefreshPendingRef.current = true;
        restoreActiveIdRef.current = activeTaskIdRef.current;
        restoreSelectionIdsRef.current = new Set(selectedIdsRef.current);
      },
      finishIdentityPreservingRefresh: () => {
        identityRefreshPendingRef.current = false;
        restoreActiveIdRef.current = null;
        restoreSelectionIdsRef.current = null;
      },
      clearActiveTaskSelection,
      getActiveTask: () => activeTaskRef.current,
    },
  };
}
