import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import type { TaskOptionClick } from "./TaskListRows";
import { selectableSiblingRows } from "./taskReordering";
import type { VisibleTaskRow } from "./taskTree";
import type { TaskView } from "./taskView";

export type ActiveTaskRequest = {
  key: number;
  taskId: string | null;
  preserveTaskOnRefresh: boolean;
};

type TaskListSelectionView = {
  tasks: TaskView[];
  visibleRows: VisibleTaskRow[];
  filterIdentity: string;
  viewIdentity: string;
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
  viewIdentity,
  newTaskId,
  activeTaskRequest,
  composerOpen,
  onAnnounce,
  onEdit,
}: TaskListSelectionView) {
  const [activeTaskIndex, setActiveTaskIndexState] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const visibleRowsRef = useRef<VisibleTaskRow[]>([]);
  const selectedIdsRef = useRef<Set<string>>(new Set());
  const previousFilterIdentityRef = useRef<string | null>(null);
  const selectionClearedRef = useRef(false);
  const selectionAnchorRef = useRef<string | null>(null);
  const pendingActiveIdRef = useRef<string | null>(null);
  const pendingActiveViewRef = useRef<string | null>(null);
  const restoreActiveIdRef = useRef<string | null>(null);
  const restoreSelectionIdsRef = useRef<Set<string> | null>(null);
  const identityRefreshPendingRef = useRef(false);
  const activeTaskIndexRef = useRef(0);
  const activeTaskRequestKeyRef = useRef(activeTaskRequest.key);
  const activeTaskRequestTasksRef = useRef<TaskView[] | null>(null);
  const preserveActiveTaskOnRefreshRef = useRef(false);
  const activeTaskIdRef = useRef<string | null>(null);
  const activeTaskRef = useRef<TaskView | undefined>(undefined);
  const lastSelectedNewTaskIdRef = useRef<string | null>(null);
  const activeScrollFrameRef = useRef<number | null>(null);
  const activeScrollTargetRef = useRef<string | null>(null);
  const optionClickRef = useRef<TaskOptionClick>(() => undefined);

  function setActiveTaskIndex(nextIndex: number): void {
    activeTaskIdRef.current = visibleRowsRef.current[nextIndex]?.task.id ?? null;
    activeTaskIndexRef.current = nextIndex;
    setActiveTaskIndexState(nextIndex);
  }

  function clearActiveTaskSelection(): void {
    pendingActiveIdRef.current = null;
    pendingActiveViewRef.current = null;
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
  const pendingActiveIndex =
    pendingActiveIdRef.current === null || pendingActiveViewRef.current !== viewIdentity
      ? -1
      : visibleRows.findIndex((row) => row.task.id === pendingActiveIdRef.current);
  // Hierarchy moves change row positions; follow the active task by identity.
  const identityActiveIndex =
    activeTaskIdRef.current === null
      ? -1
      : visibleRows.findIndex((row) => row.task.id === activeTaskIdRef.current);
  const activeIndex =
    pendingActiveIndex >= 0
      ? pendingActiveIndex
      : identityActiveIndex >= 0
        ? identityActiveIndex
        : clampedActiveIndex;
  const activeRow = visibleRows.length ? visibleRows[activeIndex] : undefined;
  const activeTask = activeRow?.task;
  visibleRowsRef.current = visibleRows;
  selectedIdsRef.current = selectedIds;
  activeTaskIndexRef.current = activeIndex;
  activeTaskIdRef.current = activeTask?.id ?? null;
  activeTaskRef.current = activeTask;

  useEffect(() => {
    const pendingActiveId = pendingActiveIdRef.current;
    if (pendingActiveId !== null && pendingActiveViewRef.current !== viewIdentity) {
      pendingActiveIdRef.current = null;
      pendingActiveViewRef.current = null;
    } else if (pendingActiveId !== null) {
      const pendingIndex = visibleRows.findIndex((row) => row.task.id === pendingActiveId);
      if (pendingIndex < 0) {
        pendingActiveIdRef.current = null;
        pendingActiveViewRef.current = null;
      } else if (activeTaskIndex !== pendingIndex) setActiveTaskIndex(pendingIndex);
      else {
        pendingActiveIdRef.current = null;
        pendingActiveViewRef.current = null;
      }
    }
    if (activeIndex !== activeTaskIndex) setActiveTaskIndex(activeIndex);

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
    activeIndex,
    activeTaskIndex,
    filterIdentity,
    newTaskId,
    onAnnounce,
    selectedIds,
    viewIdentity,
    visibleRows,
  ]);

  // Right-arrow category filtering keeps the task id through the async list
  // refresh; other active-task requests apply once to the current rows.
  useEffect(() => {
    const requestChanged = activeTaskRequestKeyRef.current !== activeTaskRequest.key;
    if (requestChanged) {
      activeTaskRequestKeyRef.current = activeTaskRequest.key;
      activeTaskRequestTasksRef.current = tasks;
      preserveActiveTaskOnRefreshRef.current = activeTaskRequest.preserveTaskOnRefresh;
      pendingActiveIdRef.current = null;
      pendingActiveViewRef.current = null;
    }

    if (activeTaskRequest.taskId !== null) {
      const taskDataChanged =
        activeTaskRequestTasksRef.current !== null && activeTaskRequestTasksRef.current !== tasks;
      const refreshApplied = preserveActiveTaskOnRefreshRef.current && taskDataChanged;
      if (requestChanged || refreshApplied) {
        const requestedIndex = visibleRows.findIndex(
          (row) => row.task.id === activeTaskRequest.taskId,
        );
        if (requestedIndex >= 0) setActiveTaskIndex(requestedIndex);
        else setActiveTaskIndex(0);
      }
      if (refreshApplied) {
        activeTaskRequestTasksRef.current = null;
        preserveActiveTaskOnRefreshRef.current = false;
      }
      return;
    }
    if (requestChanged) setActiveTaskIndex(0);
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

  useEffect(() => {
    const nextIndex = Math.min(activeTaskIndex, Math.max(visibleRows.length - 1, 0));
    if (nextIndex !== activeTaskIndex) setActiveTaskIndex(nextIndex);
  }, [activeTaskIndex, visibleRows.length]);

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
      onAnnounce("Context-only ancestors cannot be selected.");
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
      pendingActiveIdRef.current = firstTask.task.id;
      pendingActiveViewRef.current = viewIdentity;
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
      pendingActiveIdRef.current = target.task.id;
      pendingActiveViewRef.current = viewIdentity;
      setActiveTaskIndex(targetIndex);
      selectRangeTo(target);
      scheduleActiveScroll(target.task.id);
      return;
    }

    const wrapped = (requestedIndex + visibleRows.length) % visibleRows.length;
    const target = visibleRows[wrapped];
    pendingActiveIdRef.current = target.task.id;
    pendingActiveViewRef.current = viewIdentity;
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
    pendingActiveIdRef.current = target.task.id;
    pendingActiveViewRef.current = viewIdentity;
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

  optionClickRef.current = (row, index, event) => {
    if (composerOpen) return;
    const { task } = row;
    pendingActiveIdRef.current = null;
    pendingActiveViewRef.current = null;
    if (row.contextOnly && (event.shiftKey || event.ctrlKey || event.metaKey)) {
      onAnnounce("Context-only ancestors cannot be selected.");
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
  };
  const handleOptionClick = useCallback(
    (row: VisibleTaskRow, index: number, event: MouseEvent<HTMLDivElement>): void => {
      optionClickRef.current(row, index, event);
    },
    [],
  );

  function restoreSelectionAfterMove(taskId: string, taskIds: Iterable<string>): void {
    restoreActiveIdRef.current = taskId;
    restoreSelectionIdsRef.current = new Set(taskIds);
  }

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
    restoreSelectionAfterMove,
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
