import { randomUUID } from "../lib/randomUUID";
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type Ref,
} from "react";
import type { ClassificationToken } from "@/backend/taskText";
import type { TaskPriority, TaskStatus } from "@/backend/taskModel";
import type { TaskTransitionCommand } from "@/backend/protocol";
import type { ClassificationOption, TaskView } from "./taskView";
import { stripClassificationTokens } from "@/backend/taskText";
import {
  EXACT_STATUS_META,
  PRIORITY_META,
  taskStatusMeta,
  type SortDirection,
  type SortField,
  type StatusPreset,
} from "@/components/taskFilters";
import { InlineTaskComposer, OptimisticTaskOption, TaskOption } from "./TaskListRows";
import { isDialogOpen, useTaskListKeyboard } from "./useTaskListKeyboard";
import { useTaskListSelection, type ActiveTaskRequest } from "./useTaskListSelection";
import {
  forwardStatusTransition,
  reverseStatusTransition,
  type StatusCommand,
  type StatusTransition,
} from "./taskStatusCycle";
import { TaskListToolbar } from "./TaskListToolbar";
import type { TaskListMode as ToolbarMode } from "./TaskListModeHelp";
import type { ComposerState, TaskCreateDraft } from "@/components/TaskComposer";
import { visibleTaskRows, type VisibleTaskRow } from "@/components/taskTree";
import {
  placementForMove,
  placementTargetId,
  selectedRowsForReorder,
  selectionMembershipMatches,
  type TaskMoveDirection,
  type TaskMovePlacement,
} from "@/components/taskReordering";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip";
import { preventFocusSteal, type Navigator } from "@/navigation";
import {
  deleteTask,
  reorderTasks,
  transitionTask,
  transitionTasks,
  updateTaskPriority,
  selectedMainWorkspace,
  type TaskMutationResult,
} from "@/platform/backendClient";
import { EditorError } from "@/platform/editorClient";
import { APP_NAME } from "@/backend/branding";
import type { KeyboardHelpMode } from "@/keyboardHelp";
import { TaskItem } from "@/components/variants/item";
import { AnchoredTooltipContent } from "@/components/variants/tooltip";
import { useFlashTooltip } from "./useFlashTooltip";
import { useStableHandler } from "./useStableHandler";

export async function copyTaskText(task: TaskView): Promise<void> {
  const text = [selectedMainWorkspace() ? task.title : (task.text ?? task.title), task.description]
    .map((value) => (selectedMainWorkspace() ? value : stripClassificationTokens(value)))
    .filter(Boolean)
    .join(" ");
  await navigator.clipboard.writeText(text);
}

export type TaskListHandle = {
  startIdentityPreservingRefresh: () => void;
  finishIdentityPreservingRefresh: () => void;
  clearActiveTaskSelection: () => void;
  getActiveTask: () => TaskView | undefined;
};

type TaskListProps = {
  tasks: TaskView[];
  newTaskId?: string | null;
  exitingTaskIds: ReadonlySet<string>;
  contextTasks: TaskView[];
  contextOrder: ReadonlyMap<string, number>;
  total: number;
  statusPreset: StatusPreset;
  exactStatus: TaskStatus | null;
  onToggleStatusPreset: () => void;
  onResetStatusFilter: () => void;
  onExactStatus: (status: TaskStatus | null) => void;
  onOpenStatusMenu: () => void;
  priorityFilter: TaskPriority | null;
  onPriorityFilter: (priority: TaskPriority | null) => void;
  onOpenPriorityMenu: () => void;
  showUnblocked: boolean;
  onShowUnblockedChange: (show: boolean) => void;
  sortField: SortField;
  sortDirection: SortDirection;
  onSortFieldChange: (field: SortField) => void;
  onReverseSort: () => void;
  showDetails: boolean;
  helpMode: KeyboardHelpMode;
  onDisableHelp: () => void;
  onDisableComposerHelp: () => void;
  onToggleDetails: () => void;
  categoryFilter: ClassificationToken | null;
  onCategoryFilterChange: (category: ClassificationToken | null, activeTaskId?: string) => void;
  onSelectCategory: (category: ClassificationToken, activeTaskId?: string) => void;
  onOpenCategoryPicker: () => void;
  tagFilter: ClassificationOption[];
  onTagFilterChange: (tags: ClassificationOption[]) => void;
  onOpenTagPicker: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onOpenSearch: () => void;
  hasActiveFilters: boolean;
  onClearAllFilters: () => void;
  activeTaskRequest: ActiveTaskRequest;
  loading: boolean;
  error: string | null;
  nav: Navigator;
  onCreate: (parentId?: string) => void;
  composer: ComposerState | null;
  optimisticTask: TaskView | null;
  onCloseComposer: () => void;
  onComposerSaved: (result: TaskMutationResult) => void;
  onCreatePending: (draft: TaskCreateDraft) => void;
  onCreateFailed: () => void;
  onRefresh: (offset?: number) => Promise<boolean>;
  onAnnounce: (message: string) => void;
  onToast: (message: string) => void;
  onEdit: (task: TaskView) => void;
  onTaskUpdated: (task: TaskView) => void;
  onTasksUpdated: (tasks: TaskView[]) => void;
  onOperation?: (operationId: string, previous: TaskView[], current: TaskView[]) => void;
  onStatusChanged?: (previous: TaskView, current: TaskView, wasActive: boolean) => void;
  onStatusBatchChanged?: (
    previous: TaskView[],
    current: TaskView[],
    wasActiveTaskId: string | null,
  ) => void;
  canUndoStatus?: boolean;
  onUndoStatus?: () => void;
  onCanceled: (task: TaskView) => void;
  onCanceledMany?: (previous: TaskView[], current: TaskView[]) => void;
  onAddBlocker: (task: TaskView) => void;
  onMoveUnder: (task: TaskView) => void;
};

type StatusReceipt = {
  version: number;
  target: TaskStatus;
  key: string;
};

type DeleteReceipt = {
  version: number;
  key: string;
};

const TOGGLE_FEEDBACK_DURATION_MS = 900;

export function TaskList({
  ref,
  tasks,
  newTaskId,
  exitingTaskIds,
  contextTasks,
  contextOrder,
  total,
  statusPreset,
  exactStatus,
  onToggleStatusPreset,
  onResetStatusFilter,
  onExactStatus,
  onOpenStatusMenu,
  priorityFilter,
  onPriorityFilter,
  onOpenPriorityMenu,
  showUnblocked,
  onShowUnblockedChange,
  sortField,
  sortDirection,
  onSortFieldChange,
  onReverseSort,
  showDetails,
  helpMode,
  onDisableHelp,
  onDisableComposerHelp,
  onToggleDetails,
  categoryFilter,
  onCategoryFilterChange,
  onSelectCategory,
  onOpenCategoryPicker,
  tagFilter,
  onTagFilterChange,
  onOpenTagPicker,
  searchQuery,
  onSearchChange,
  onOpenSearch,
  hasActiveFilters,
  onClearAllFilters,
  activeTaskRequest,
  loading,
  error,
  nav,
  onCreate,
  composer,
  optimisticTask,
  onCloseComposer,
  onComposerSaved,
  onCreatePending,
  onCreateFailed,
  onRefresh,
  onAnnounce,
  onToast,
  onEdit,
  onTaskUpdated,
  onTasksUpdated,
  onOperation,
  onStatusChanged,
  onStatusBatchChanged,
  canUndoStatus,
  onUndoStatus,
  onCanceled,
  onCanceledMany,
  onAddBlocker,
  onMoveUnder,
}: TaskListProps & { ref?: Ref<TaskListHandle> }): ReactElement {
  const section = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const filterToolbar = useRef<HTMLDivElement>(null);
  const sortToolbar = useRef<HTMLDivElement>(null);
  const statusFilterButton = useRef<HTMLButtonElement>(null);
  const loadMore = useRef<HTMLButtonElement>(null);
  const initialHomeFocusPending = useRef(true);
  // Once the first query has succeeded, reloads keep the list on screen.
  const [firstLoadDone, setFirstLoadDone] = useState(false);
  if (!firstLoadDone && !loading && !error) setFirstLoadDone(true);
  const retry = useRef<HTMLButtonElement>(null);
  const statusReceipts = useRef(new Map<string, StatusReceipt>());
  const batchTransitionReceiptRef = useRef<{ signature: string; key: string } | null>(null);
  const deleteReceipts = useRef(new Map<string, DeleteReceipt>());
  const deletePending = useRef(new Set<string>());
  const priorityReceipts = useRef(new Map<string, { version: number; key: string }>());
  const mutationPending = useRef(new Set<string>());
  const toolbarModeRef = useRef<ToolbarMode | null>(null);
  const [listFocused, setListFocused] = useState(false);
  const composerOpenRef = useRef(composer !== null);
  const previousComposerOpenRef = useRef(composer !== null);
  useLayoutEffect(() => {
    composerOpenRef.current = composer !== null;
  });
  const [mutationPendingIds, setMutationPendingIds] = useState<Set<string>>(() => new Set());
  const [toolbarMode, setToolbarMode] = useState<ToolbarMode | null>(null);
  const [statusFeedback, setStatusFeedback] = useState<{ taskId: string; version: number } | null>(
    null,
  );
  const [filterFeedbackVersion, setFilterFeedbackVersion] = useState(0);
  const filterFeedback = useFlashTooltip(filterFeedbackVersion, TOGGLE_FEEDBACK_DURATION_MS);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [unblockedFeedbackVersion, setUnblockedFeedbackVersion] = useState(0);
  const unblockedFeedback = useFlashTooltip(unblockedFeedbackVersion, TOGGLE_FEEDBACK_DURATION_MS);
  const [moveControlsOpen, setMoveControlsOpen] = useState(false);
  const reorderPending = useRef(false);
  const reorderReceipt = useRef<{ signature: string; key: string } | null>(null);

  const visibleRows = useMemo(
    () => visibleTaskRows(tasks, expandedIds, contextTasks, contextOrder),
    [tasks, expandedIds, contextTasks, contextOrder],
  );
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  // A filter change resets the selection.
  const filterIdentity = [
    statusPreset,
    exactStatus ?? "",
    priorityFilter ?? "",
    tagFilter.map((tag) => tag.slug).join(","),
    searchQuery,
    showUnblocked ? "1" : "0",
    categoryFilter?.slug ?? "",
  ].join("|");
  const hasMore = tasks.length < total;
  const {
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
    handle: selectionHandle,
  } = useTaskListSelection({
    tasks,
    visibleRows,
    filterIdentity,
    newTaskId,
    activeTaskRequest,
    composerOpen: composer !== null,
    onAnnounce,
    onEdit,
  });

  useImperativeHandle(ref, () => selectionHandle, [selectionHandle]);

  // The list owns its internal tail (load-more, retry); the navigator only
  // enters it through explicit navigation.
  useEffect(
    () =>
      nav.register("list", {
        focusLast: () =>
          (loadMore.current ?? list.current ?? retry.current ?? section.current)?.focus(),
      }),
    [nav],
  );

  useEffect(() => {
    const wasOpen = previousComposerOpenRef.current;
    previousComposerOpenRef.current = composer !== null;
    if (!wasOpen || composer !== null) return;
    const frame = requestAnimationFrame(() => {
      if (!composerOpenRef.current)
        (list.current ?? (error ? retry.current : section.current))?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [composer, error]);

  // The task list is the home surface. Wait for the first query so focus
  // lands on the list, or its empty/error state, instead of the capture action.
  useEffect(() => {
    if (!initialHomeFocusPending.current || loading) return;
    const home = list.current ?? (error ? retry.current : section.current);
    if (!home) return;
    home.focus();
    if (!error) initialHomeFocusPending.current = false;
  }, [error, loading, visibleRows.length]);

  useEffect(() => {
    if (visibleRows.length > 0 && document.activeElement === section.current) {
      list.current?.focus();
    }
  }, [visibleRows.length]);

  function clearToolbarMode(): void {
    toolbarModeRef.current = null;
    setToolbarMode(null);
  }

  function returnToList(): void {
    clearToolbarMode();
    (list.current ?? (error ? retry.current : section.current))?.focus();
  }

  // Toolbar modes are explicit focus states. They are cleared when focus leaves
  // the app or the page is hidden; choosing an option, the mode key, or Escape
  // returns to the task list directly.
  useEffect(() => {
    const clear = (): void => clearToolbarMode();
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") clear();
    };
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clear();
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  function activateToolbarMode(mode: ToolbarMode): void {
    toolbarModeRef.current = mode;
    setToolbarMode(mode);
  }

  function startToolbarMode(mode: ToolbarMode): void {
    clearToolbarMode();
    activateToolbarMode(mode);
    (mode === "filter" ? filterToolbar.current : sortToolbar.current)?.focus();
    onAnnounce(
      mode === "filter"
        ? "Filter toolbar focused. Choose a filter, press F again, or press Escape to return to the task list."
        : "Sort toolbar focused. Choose a sort, press S again, or press Escape to return to the task list.",
    );
  }

  function startFilterMode(): void {
    startToolbarMode("filter");
  }

  function startSortMode(): void {
    startToolbarMode("sort");
  }

  function focusListBeforeToolbarDialog(): void {
    if (!isDialogOpen() && !composerOpenRef.current) returnToList();
  }

  function openStatusMenu(): void {
    focusListBeforeToolbarDialog();
    onOpenStatusMenu();
  }

  function openPriorityMenu(): void {
    focusListBeforeToolbarDialog();
    onOpenPriorityMenu();
  }

  function openCategoryPicker(): void {
    focusListBeforeToolbarDialog();
    onOpenCategoryPicker();
  }

  function openTagPicker(): void {
    focusListBeforeToolbarDialog();
    onOpenTagPicker();
  }

  function openSearch(): void {
    focusListBeforeToolbarDialog();
    onOpenSearch();
  }

  function toggleStatusPreset(): void {
    returnToList();
    onToggleStatusPreset();
    setFilterFeedbackVersion((previous) => previous + 1);
    onAnnounce(
      statusPreset === "active" && exactStatus === null
        ? "Showing inactive tasks"
        : "Showing active tasks",
    );
  }

  function clearStatusFilter(): void {
    if (statusPreset === "active" && exactStatus === null) return;
    returnToList();
    onResetStatusFilter();
    onAnnounce("Showing active tasks");
  }

  function applyExactStatus(status: TaskStatus): void {
    returnToList();
    onExactStatus(status);
    const label = EXACT_STATUS_META.find((entry) => entry.status === status)?.label ?? status;
    onAnnounce(`Showing ${label} tasks`);
  }

  function applySortField(field: SortField): void {
    returnToList();
    onSortFieldChange(field);
  }

  function reverseSort(): void {
    returnToList();
    onReverseSort();
  }

  function toggleUnblockedFilter(): void {
    returnToList();
    const next = !showUnblocked;
    onShowUnblockedChange(next);
    setUnblockedFeedbackVersion((previous) => previous + 1);
    onAnnounce(next ? "Showing unblocked tasks" : "Showing all tasks");
  }

  function clearCategoryFilter(activeTaskId?: string): void {
    if (activeTaskId !== undefined) {
      const row = visibleRowsRef.current.find((candidate) => candidate.task.id === activeTaskId);
      if (row && !row.contextOnly) selectOnly(row);
    }
    returnToList();
    if (!categoryFilter) return;
    onCategoryFilterChange(null, activeTaskId);
    onAnnounce("Showing tasks from all categories");
  }

  function toggleCategoryFilter(): void {
    if (categoryFilter) {
      clearCategoryFilter();
      return;
    }
    openCategoryPicker();
  }

  function selectCategory(category: ClassificationToken, activeTaskId?: string): void {
    if (activeTaskId !== undefined) {
      const row = visibleRowsRef.current.find((candidate) => candidate.task.id === activeTaskId);
      if (row && !row.contextOnly) selectOnly(row);
    }
    returnToList();
    onSelectCategory(category, activeTaskId);
  }

  function clearSearch(): void {
    returnToList();
    if (searchQuery.trim() === "") return;
    onSearchChange("");
    onAnnounce("Cleared search");
  }

  function clearTagFilter(): void {
    returnToList();
    if (tagFilter.length === 0) return;
    onTagFilterChange([]);
    onAnnounce("Cleared tag filters");
  }

  function clearPriorityFilter(): void {
    returnToList();
    if (priorityFilter === null) return;
    onPriorityFilter(null);
    onAnnounce("Showing all priorities");
  }

  function applyPriorityFilter(priority: TaskPriority): void {
    if (priorityFilter === priority) {
      clearPriorityFilter();
      return;
    }
    returnToList();
    onPriorityFilter(priority);
    const label = PRIORITY_META.find((meta) => meta.value === priority)?.label ?? `P${priority}`;
    onAnnounce(`Showing ${label} tasks`);
  }

  async function copyActiveTask(task: TaskView): Promise<void> {
    try {
      await copyTaskText(task);
      onAnnounce(`Copied ${task.title}`);
      onToast("Task details copied to clipboard");
    } catch {
      onAnnounce("Could not copy the selected task.");
    }
  }

  function reorderDisabledReason(row: VisibleTaskRow | undefined): string | null {
    const selected = selectedMainWorkspace();
    if (selected && !selected.supportsOrdering)
      return "Reordering is not yet available in this selected workspace.";
    if (!row) return "No task is selected.";
    if (row.contextOnly) return "Context-only ancestors cannot be reordered.";
    if (exactStatus !== null) return "Clear the exact-status filter before reordering.";
    if (statusPreset !== "active") return "Clear the inactive filter before reordering.";
    if (showUnblocked) return "Clear the Unblocked filter before reordering.";
    if (priorityFilter !== null) return "Clear the priority filter before reordering.";
    if (tagFilter.length > 0) return "Clear the tag filter before reordering.";
    if (searchQuery.trim() !== "") return "Clear search before reordering.";
    return null;
  }

  function waitForListRender(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  async function reorderSelection(direction: TaskMoveDirection): Promise<void> {
    if (reorderPending.current) return;
    const sourceRows = visibleRowsRef.current;
    const sourceActiveId = activeRow?.task.id;
    const sourceRow =
      sourceActiveId === undefined
        ? sourceRows[activeIndex]
        : sourceRows.find((candidate) => candidate.task.id === sourceActiveId);
    const reason = reorderDisabledReason(sourceRow);
    if (reason) {
      onAnnounce(reason);
      return;
    }
    if (!sourceRow) return;
    const sourceSelected = selectedRowsForReorder(sourceRow, sourceRows, selectedIdsRef.current);
    if (!sourceSelected) {
      setSelection([], sourceRow.contextOnly ? null : sourceRow.task.id);
      onAnnounce("Selection is limited to one visible sibling scope.");
      return;
    }
    const selectedIdSnapshot = sourceSelected.map((candidate) => candidate.task.id);
    const switchedToManual = sortField !== "manual";
    reorderPending.current = true;
    try {
      let placement: TaskMovePlacement | null = null;
      let refreshedSelectionOrder: VisibleTaskRow[] | null = null;
      if (switchedToManual) {
        onSortFieldChange("manual");
        // Let the sort-change effect start before issuing the authoritative
        // refresh used to resolve the visible manual-order target.
        await waitForListRender();
        try {
          if (!(await onRefresh(0))) {
            onAnnounce("Could not refresh tasks. No move was made.");
            return;
          }
        } catch {
          onAnnounce("Could not refresh tasks. No move was made.");
          return;
        }
        await waitForListRender();
        const refreshedRows = visibleRowsRef.current;
        const refreshedActive = refreshedRows.find(
          (candidate) => candidate.task.id === sourceRow.task.id,
        );
        if (!refreshedActive || refreshedActive.contextOnly) {
          onAnnounce("The selected task changed during refresh. No move was made.");
          return;
        }
        const refreshedSelected = selectedRowsForReorder(
          refreshedActive,
          refreshedRows,
          selectedIdsRef.current,
        );
        if (
          !refreshedSelected ||
          !selectionMembershipMatches(refreshedSelected, selectedIdSnapshot)
        ) {
          onAnnounce("The selected task changed during refresh. No move was made.");
          return;
        }
        refreshedSelectionOrder = refreshedSelected;
        placement = placementForMove(direction, refreshedActive, refreshedSelected, refreshedRows);
      } else {
        placement = placementForMove(direction, sourceRow, sourceSelected, sourceRows);
      }
      if (!placement) {
        const boundary =
          direction === "up" || direction === "start"
            ? "Already at the beginning."
            : "Already at the end.";
        onAnnounce(switchedToManual ? `Switched to manual order. ${boundary}` : boundary);
        return;
      }

      const currentRows = visibleRowsRef.current;
      const currentActive = currentRows.find(
        (candidate) => candidate.task.id === sourceRow.task.id,
      );
      if (!currentActive || currentActive.contextOnly) {
        onAnnounce("The selected task changed during refresh. No move was made.");
        return;
      }
      const currentSelected = selectedRowsForReorder(
        currentActive,
        currentRows,
        selectedIdsRef.current,
      );
      if (!currentSelected || !selectionMembershipMatches(currentSelected, selectedIdSnapshot)) {
        onAnnounce("The selected task changed during refresh. No move was made.");
        return;
      }
      const commandSelection =
        refreshedSelectionOrder === null
          ? currentSelected
          : refreshedSelectionOrder
              .map((row) => currentSelected.find((candidate) => candidate.task.id === row.task.id))
              .filter((row): row is VisibleTaskRow => row !== undefined);
      if (commandSelection.length !== currentSelected.length) {
        onAnnounce("The selected task changed during refresh. No move was made.");
        return;
      }
      const target = currentRows.find(
        (candidate) => candidate.task.id === placementTargetId(placement),
      );
      if (!target || target.contextOnly || target.task.parentId !== currentActive.task.parentId) {
        onAnnounce("The task or move target changed during refresh. No move was made.");
        return;
      }
      const commandTasks = commandSelection.map((candidate) => ({
        id: candidate.task.id,
        expectedVersion: candidate.task.version,
      }));
      const signature = JSON.stringify({ tasks: commandTasks, placement });
      const receipt =
        reorderReceipt.current?.signature === signature
          ? reorderReceipt.current
          : { signature, key: randomUUID() };
      reorderReceipt.current = receipt;
      currentSelected.forEach((candidate) => setMutationPending(candidate.task.id, true));
      try {
        const result = await reorderTasks(commandTasks, placement, { idempotencyKey: receipt.key });
        reorderReceipt.current = null;
        if (result.changed === false) {
          const boundary =
            direction === "up" || direction === "start"
              ? "Already at the beginning."
              : "Already at the end.";
          onAnnounce(switchedToManual ? `Switched to manual order. ${boundary}` : boundary);
          return;
        }
        if (result.operationId)
          onOperation?.(
            result.operationId,
            currentSelected.map((row) => row.task),
            result.tasks,
          );
        restoreSelectionAfterMove(sourceRow.task.id, selectedIdSnapshot);
        await onRefresh(0);
        await waitForListRender();
        const move = `${currentSelected.length} task${currentSelected.length === 1 ? "" : "s"} moved ${direction === "start" ? "to the beginning" : direction === "end" ? "to the end" : direction}.`;
        onAnnounce(switchedToManual ? `Switched to manual order. ${move}` : move);
        list.current?.focus();
      } catch (caught) {
        if (caught instanceof EditorError && caught.code === "STALE_TASK_VERSION") {
          reorderReceipt.current = null;
          onAnnounce("A selected task changed elsewhere. Refresh and try again.");
          void onRefresh(0);
        } else if (caught instanceof EditorError) {
          reorderReceipt.current = null;
          onAnnounce(caught.message);
        } else {
          onAnnounce(
            `Could not move the selected task${currentSelected.length === 1 ? "" : "s"}. Try again.`,
          );
        }
      } finally {
        currentSelected.forEach((candidate) => setMutationPending(candidate.task.id, false));
      }
    } finally {
      reorderPending.current = false;
    }
  }

  function setExpanded(taskId: string, expanded: boolean): void {
    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (expanded) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
  }

  function toggleExpanded(row: VisibleTaskRow): void {
    if (!row.hasChildren) return;
    setExpanded(row.task.id, !expandedIds.has(row.task.id));
  }

  function moveToParent(row: VisibleTaskRow): void {
    if (row.depth === 0 || !row.task.parentId) return;
    const parentIndex = visibleRows.findIndex(
      (candidate) => candidate.task.id === row.task.parentId,
    );
    if (parentIndex >= 0) setActiveTaskIndex(parentIndex);
  }

  function handleHorizontalNavigation(key: "ArrowLeft" | "ArrowRight"): void {
    if (!activeRow) return;
    if (key === "ArrowRight") {
      if (activeRow.hasChildren) {
        if (!expandedIds.has(activeRow.task.id)) {
          setExpanded(activeRow.task.id, true);
          onAnnounce(`Expanded ${activeRow.task.title}`);
        }
        return;
      }
      if (activeRow.task.category) {
        selectCategory(
          activeRow.task.category,
          activeRow.contextOnly ? undefined : activeRow.task.id,
        );
      } else {
        onAnnounce(`${activeRow.task.title} has no category to filter.`);
      }
      return;
    }
    if (activeRow.depth === 1) {
      moveToParent(activeRow);
      return;
    }
    if (expandedIds.has(activeRow.task.id)) {
      setExpanded(activeRow.task.id, false);
      onAnnounce(`Collapsed ${activeRow.task.title}`);
      return;
    }
    if (categoryFilter) {
      clearCategoryFilter(activeRow.contextOnly ? undefined : activeRow.task.id);
    }
  }

  function selectedTasksForAction(): TaskView[] {
    const selected = visibleRows
      .filter((row) => !row.contextOnly && selectedIdsRef.current.has(row.task.id))
      .map((row) => row.task);
    return selected.length > 0 ? selected : activeTask ? [activeTask] : [];
  }

  function setMutationPending(taskId: string, pending: boolean): void {
    if (pending) mutationPending.current.add(taskId);
    else mutationPending.current.delete(taskId);
    setMutationPendingIds((previous) => {
      const next = new Set(previous);
      if (pending) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
  }

  function setMutationPendingMany(taskIds: readonly string[], pending: boolean): void {
    for (const taskId of taskIds) {
      if (pending) mutationPending.current.add(taskId);
      else mutationPending.current.delete(taskId);
    }
    setMutationPendingIds((previous) => {
      const next = new Set(previous);
      for (const taskId of taskIds) {
        if (pending) next.add(taskId);
        else next.delete(taskId);
      }
      return next;
    });
  }

  function batchTransitionReceipt(
    items: readonly { id: string; expectedVersion: number; command: TaskTransitionCommand }[],
  ): { signature: string; key: string } {
    const signature = JSON.stringify(items);
    const existing = batchTransitionReceiptRef.current;
    if (existing?.signature === signature) return existing;
    const receipt = { signature, key: randomUUID() };
    batchTransitionReceiptRef.current = receipt;
    return receipt;
  }

  async function changeStatus(task: TaskView, transition: StatusTransition): Promise<void> {
    if (mutationPending.current.has(task.id)) return;
    const previousReceipt = statusReceipts.current.get(task.id);
    const receipt =
      previousReceipt?.version === task.version && previousReceipt.target === transition.next
        ? previousReceipt
        : { version: task.version, target: transition.next, key: randomUUID() };
    statusReceipts.current.set(task.id, receipt);
    setMutationPending(task.id, true);
    const wasActive = activeTask?.id === task.id;
    try {
      const result = await transitionTask(transition.command, task.id, task.version, {
        idempotencyKey: receipt.key,
      });
      statusReceipts.current.delete(task.id);
      onTaskUpdated(result.task);
      if (result.changed !== false) {
        if (result.operationId) onOperation?.(result.operationId, [task], [result.task]);
        onStatusChanged?.(task, result.task, wasActive);
        setStatusFeedback({ taskId: task.id, version: result.task.version });
      }
      onAnnounce(`${task.title}: ${taskStatusMeta[result.task.status].label}`);
    } catch (caught) {
      onAnnounce(
        caught instanceof EditorError && caught.code === "STALE_TASK_VERSION"
          ? `${task.title} changed elsewhere. Refresh and try again.`
          : `Could not change ${task.title}: ${caught instanceof Error ? caught.message : String(caught)}`,
      );
    } finally {
      setMutationPending(task.id, false);
    }
  }

  async function transitionSelectedTasks(
    selected: TaskView[],
    commandForTask: (task: TaskView) => TaskTransitionCommand | null,
    actionLabel: string,
  ): Promise<void> {
    const items = selected
      .map((task) => {
        const command = commandForTask(task);
        return command ? { id: task.id, expectedVersion: task.version, command } : null;
      })
      .filter(
        (item): item is { id: string; expectedVersion: number; command: TaskTransitionCommand } =>
          item !== null,
      );
    if (items.length === 0) return;
    const receipt = batchTransitionReceipt(items);
    const selectedIds = items.map((item) => item.id);
    setMutationPendingMany(selectedIds, true);
    try {
      const result = await transitionTasks(items, { idempotencyKey: receipt.key });
      batchTransitionReceiptRef.current = null;
      onTasksUpdated(result.tasks);
      if (result.changed) {
        const previous = selected.filter((task) => selectedIds.includes(task.id));
        const current = result.tasks.filter((task) => selectedIds.includes(task.id));
        if (result.operationId) onOperation?.(result.operationId, previous, current);
        onStatusBatchChanged?.(previous, current, activeTask?.id ?? null);
      }
      onAnnounce(
        `${result.tasks.length} task${result.tasks.length === 1 ? "" : "s"} ${actionLabel}`,
      );
    } catch (caught) {
      if (caught instanceof EditorError && caught.code === "STALE_TASK_VERSION") {
        batchTransitionReceiptRef.current = null;
        onAnnounce("A selected task changed elsewhere. Refresh and try again.");
        void onRefresh(0);
      } else {
        onAnnounce(
          caught instanceof Error ? caught.message : `Could not ${actionLabel} selected tasks.`,
        );
      }
    } finally {
      setMutationPendingMany(selectedIds, false);
    }
  }

  function toggleStatus(task: TaskView): Promise<void> {
    return changeStatus(task, forwardStatusTransition[task.status]);
  }

  async function toggleSelectedStatus(): Promise<void> {
    const selected = selectedTasksForAction();
    if (selected.length === 0) return;
    if (selected.length === 1) {
      await toggleStatus(selected[0]);
      return;
    }
    await transitionSelectedTasks(
      selected,
      (task) => forwardStatusTransition[task.status].command,
      "updated",
    );
  }

  function reverseStatus(task: TaskView): Promise<void> {
    return changeStatus(task, reverseStatusTransition[task.status]);
  }

  async function reverseSelectedStatus(): Promise<void> {
    const selected = selectedTasksForAction();
    if (selected.length === 0) return;
    if (selected.length === 1) {
      await reverseStatus(selected[0]);
      return;
    }
    await transitionSelectedTasks(
      selected,
      (task) => reverseStatusTransition[task.status].command,
      "updated",
    );
  }

  function pauseTask(task: TaskView): Promise<void> {
    if (task.status === "done" || task.status === "canceled") {
      onAnnounce(
        `${task.title} is ${taskStatusMeta[task.status].label.toLowerCase()}. Reopen it before pausing.`,
      );
      return Promise.resolve();
    }
    const target: TaskStatus = task.status === "paused" ? "in_progress" : "paused";
    const command: StatusCommand = task.status === "paused" ? "task.start" : "task.pause";
    return changeStatus(task, { next: target, command });
  }

  async function pauseSelectedTasks(): Promise<void> {
    const selected = selectedTasksForAction();
    if (selected.length === 0) return;
    if (selected.length === 1) {
      await pauseTask(selected[0]);
      return;
    }
    const eligible = selected.filter(
      (task) => task.status !== "done" && task.status !== "canceled",
    );
    if (eligible.length === 0) {
      onAnnounce("Done and canceled tasks cannot be paused.");
      return;
    }
    await transitionSelectedTasks(
      eligible,
      (task) => (task.status === "paused" ? "task.start" : "task.pause"),
      "updated",
    );
  }

  async function setTaskPriority(task: TaskView, priority: TaskPriority): Promise<void> {
    if (task.priority === priority || mutationPending.current.has(task.id)) return;
    const previousReceipt = priorityReceipts.current.get(task.id);
    const receipt =
      previousReceipt?.version === task.version
        ? previousReceipt
        : { version: task.version, key: randomUUID() };
    priorityReceipts.current.set(task.id, receipt);
    setMutationPending(task.id, true);
    try {
      const result = await updateTaskPriority(task, priority, { idempotencyKey: receipt.key });
      priorityReceipts.current.delete(task.id);
      onTaskUpdated(result.task);
      if (result.operationId) onOperation?.(result.operationId, [task], [result.task]);
      const label = PRIORITY_META.find((meta) => meta.value === priority)?.label ?? `P${priority}`;
      onAnnounce(`${task.title}: priority ${label}`);
    } catch (caught) {
      onAnnounce(
        caught instanceof EditorError && caught.code === "STALE_TASK_VERSION"
          ? `${task.title} changed elsewhere. Refresh and try again.`
          : `Could not change ${task.title}: ${caught instanceof Error ? caught.message : String(caught)}`,
      );
    } finally {
      setMutationPending(task.id, false);
    }
  }

  async function deleteTaskRecord(task: TaskView): Promise<void> {
    if (deletePending.current.has(task.id)) return;
    const previousReceipt = deleteReceipts.current.get(task.id);
    const receipt =
      previousReceipt?.version === task.version
        ? previousReceipt
        : { version: task.version, key: randomUUID() };
    deleteReceipts.current.set(task.id, receipt);
    deletePending.current.add(task.id);
    try {
      const result = await deleteTask(task.id, task.version, { idempotencyKey: receipt.key });
      deleteReceipts.current.delete(task.id);
      if (result.changed !== false) {
        if (result.operationId) onOperation?.(result.operationId, [task], [result.task]);
        onStatusChanged?.(task, result.task, activeTask?.id === task.id);
      }
      // Remove the selected styling before the parent starts the exit animation.
      // Otherwise the moving border makes the cancellation transition look wrong.
      setSelection([], null);
      onCanceled(result.task);
    } catch (caught) {
      if (caught instanceof EditorError && caught.code === "STALE_TASK_VERSION") {
        onAnnounce(`${task.title} changed elsewhere. Refresh and try again.`);
        void onRefresh();
      } else {
        onAnnounce(
          `Could not cancel ${task.title}: ${caught instanceof Error ? caught.message : String(caught)}`,
        );
      }
    } finally {
      deletePending.current.delete(task.id);
    }
  }

  async function deleteSelectedTasks(): Promise<void> {
    const selected = selectedTasksForAction().filter((task) => !deletePending.current.has(task.id));
    if (selected.length === 0) return;
    if (selected.length === 1) {
      await deleteTaskRecord(selected[0]);
      return;
    }
    const items = selected.map((task) => ({
      id: task.id,
      expectedVersion: task.version,
      command: "task.delete" as const,
    }));
    const receipt = batchTransitionReceipt(items);
    const selectedIds = selected.map((task) => task.id);
    selectedIds.forEach((taskId) => deletePending.current.add(taskId));
    setMutationPendingMany(selectedIds, true);
    try {
      const result = await transitionTasks(items, { idempotencyKey: receipt.key });
      batchTransitionReceiptRef.current = null;
      if (result.operationId) onOperation?.(result.operationId, selected, result.tasks);
      onStatusBatchChanged?.(selected, result.tasks, activeTask?.id ?? null);
      setSelection([], null);
      if (onCanceledMany) onCanceledMany(selected, result.tasks);
      else result.tasks.forEach((task) => onCanceled(task));
      onAnnounce(`Canceled ${result.tasks.length} tasks`);
    } catch (caught) {
      if (caught instanceof EditorError && caught.code === "STALE_TASK_VERSION") {
        batchTransitionReceiptRef.current = null;
        onAnnounce("A selected task changed elsewhere. Refresh and try again.");
        void onRefresh(0);
      } else {
        onAnnounce(
          caught instanceof Error ? caught.message : "Could not cancel the selected tasks.",
        );
      }
    } finally {
      selectedIds.forEach((taskId) => deletePending.current.delete(taskId));
      setMutationPendingMany(selectedIds, false);
    }
  }

  const handleOptionToggleStatus = useStableHandler((task: TaskView): void => {
    void toggleStatus(task);
  });
  const handleOptionToggleExpanded = useStableHandler(toggleExpanded);
  const handleOptionSelectCategory = useStableHandler(selectCategory);

  useTaskListKeyboard(
    {
      hasActiveFilters,
      activeTask,
      visibleRowCount: visibleRows.length,
      canUndoStatus: Boolean(canUndoStatus),
      undoStatus: () => onUndoStatus?.(),
      deleteSelectedTasks,
      returnToList,
      clearAllFilters: onClearAllFilters,
      startFilterMode,
      startSortMode,
      applyExactStatus,
      applySortField,
      reverseSort,
      toggleDetailsView: onToggleDetails,
      setPriority: setTaskPriority,
      openSearch,
      createTask: onCreate,
      toggleStatusPreset,
      applyPriorityFilter,
      toggleUnblockedFilter,
      openCategoryPicker,
      openTagPicker,
      addBlocker: onAddBlocker,
      moveUnder: onMoveUnder,
      toggleSelectedStatus,
      reverseSelectedStatus,
      pauseSelectedTasks,
      moveActive,
      selectBoundary,
      reorderSelection,
      clearSelection,
      handleHorizontalNavigation,
      editTask: onEdit,
      copyTask: copyActiveTask,
    },
    { toolbarModeRef, composerOpenRef, list, section },
  );

  const summaryTaskCount =
    useMemo(
      () => visibleRows.reduce((count, row) => count + (row.contextOnly ? 0 : 1), 0),
      [visibleRows],
    ) + (optimisticTask ? 1 : 0);

  const isDefaultActiveEmpty =
    !loading &&
    !error &&
    composer === null &&
    optimisticTask === null &&
    visibleRows.length === 0 &&
    !hasActiveFilters &&
    total === 0;
  const isFilteredEmpty =
    !loading &&
    !error &&
    optimisticTask === null &&
    visibleRows.length === 0 &&
    (hasActiveFilters || total > 0);
  const showListSurface =
    (!error || optimisticTask !== null) &&
    (optimisticTask !== null ||
      visibleRows.length > 0 ||
      isFilteredEmpty ||
      listFocused ||
      (firstLoadDone && loading));
  const visibleRowCount = visibleRows.length + (optimisticTask ? 1 : 0);
  const selectionCount = selectedIds.size;
  const selectionLabel = `${selectionCount} task${selectionCount === 1 ? "" : "s"} selected`;
  const moveSubjectLabel = selectionCount > 1 ? `selected tasks, ${selectionLabel}` : "active task";
  const reorderAvailabilityReason = reorderDisabledReason(activeRow);
  const editingTaskVisible =
    composer?.mode === "edit" && visibleRows.some((row) => row.task.id === composer.task.id);
  const editingActiveTask = composer?.mode === "edit" && composer.task.id === activeTask?.id;
  const listSelectionLabel =
    composer?.mode === "edit" && editingTaskVisible
      ? `editing ${composer.task.title}`
      : selectionLabel;

  const optimisticTaskId = optimisticTask?.id;
  useEffect(() => {
    if (!optimisticTaskId) return;
    list.current?.focus();
    list.current?.scrollTo({ top: 0 });
  }, [optimisticTaskId]);

  return (
    <section
      ref={section}
      tabIndex={-1}
      aria-label="Saved tasks"
      aria-keyshortcuts="Escape C Shift+C Enter S U T B M P Space Shift+Space Delete ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+Home Shift+End Control+c Meta+c Control+ArrowUp Control+ArrowDown Control+Home Control+End Meta+ArrowUp Meta+ArrowDown Meta+Home Meta+End 0 1 2 3 4 / @ # F O V Control+z Meta+z"
      onFocus={(event) => {
        if (event.target === event.currentTarget && visibleRows.length > 0) list.current?.focus();
      }}
      className="flex min-h-0 flex-1 flex-col gap-4 outline-none"
      onMouseDown={(event) => {
        if (!(event.target instanceof HTMLElement)) return;
        const mouseOnlyControl = event.target.closest('[tabindex="-1"]');
        if (mouseOnlyControl && mouseOnlyControl !== event.currentTarget) preventFocusSteal(event);
      }}
    >
      <TaskListToolbar
        toolbarMode={toolbarMode}
        helpMode={helpMode}
        onDisableHelp={onDisableHelp}
        returnToList={returnToList}
        filterToolbar={filterToolbar}
        sortToolbar={sortToolbar}
        statusFilterButton={statusFilterButton}
        activateToolbarMode={activateToolbarMode}
        clearToolbarMode={clearToolbarMode}
        composerOpen={composer !== null}
        onCreate={onCreate}
        categoryFilter={categoryFilter}
        toggleCategoryFilter={toggleCategoryFilter}
        exactStatus={exactStatus}
        statusPreset={statusPreset}
        openStatusMenu={openStatusMenu}
        priorityFilter={priorityFilter}
        openPriorityMenu={openPriorityMenu}
        tagFilter={tagFilter}
        openTagPicker={openTagPicker}
        showUnblocked={showUnblocked}
        toggleUnblockedFilter={toggleUnblockedFilter}
        unblockedFeedbackOpen={unblockedFeedback.open}
        setUnblockedFeedbackOpen={unblockedFeedback.onOpenChange}
        searchQuery={searchQuery}
        openSearch={openSearch}
        sortField={sortField}
        sortDirection={sortDirection}
        applySortField={applySortField}
        reverseSort={reverseSort}
        showDetails={showDetails}
        onToggleDetails={onToggleDetails}
        moveControlsOpen={moveControlsOpen}
        setMoveControlsOpen={setMoveControlsOpen}
        moveSubjectLabel={moveSubjectLabel}
        reorderAvailabilityReason={reorderAvailabilityReason}
        reorderSelection={reorderSelection}
        summaryTaskCount={summaryTaskCount}
        clearStatusFilter={clearStatusFilter}
        clearCategoryFilter={clearCategoryFilter}
        clearPriorityFilter={clearPriorityFilter}
        clearTagFilter={clearTagFilter}
        clearSearch={clearSearch}
      />
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load tasks</AlertTitle>
          <AlertDescription>
            <p>{error}</p>
            <Button ref={retry} variant="outline" size="sm" onClick={() => void onRefresh()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {composer && (composer.mode === "create" || !editingTaskVisible) ? (
        <div hidden={optimisticTask !== null}>
          <InlineTaskComposer
            composer={composer}
            onClose={onCloseComposer}
            onSaved={onComposerSaved}
            onCreatePending={onCreatePending}
            onCreateFailed={onCreateFailed}
            helpMode={helpMode}
            onDisableHelp={onDisableComposerHelp}
          />
        </div>
      ) : null}
      {showListSurface ? (
        <div
          ref={list}
          id="task-list"
          role="listbox"
          aria-label={
            visibleRowCount
              ? `${APP_NAME}, ${visibleRowCount} visible task rows, ${total + (optimisticTask ? 1 : 0)} matching tasks, ${listSelectionLabel}`
              : isDefaultActiveEmpty
                ? `${APP_NAME}, no active tasks`
                : `${APP_NAME}, no visible matches`
          }
          aria-orientation="vertical"
          aria-multiselectable="true"
          aria-keyshortcuts="Escape C Shift+C Enter S U T B M P Space Shift+Space Delete ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+Home Shift+End Control+c Meta+c Control+ArrowUp Control+ArrowDown Control+Home Control+End Meta+ArrowUp Meta+ArrowDown Meta+Home Meta+End 0 1 2 3 4 / @ # F O V Control+z Meta+z"
          aria-activedescendant={
            activeTask && !editingActiveTask ? `task-option-${activeTask.id}` : undefined
          }
          tabIndex={0}
          className="flex min-h-0 w-full flex-1 flex-col gap-2 overflow-x-clip overflow-y-auto overscroll-y-contain outline-none"
          onFocus={() => setListFocused(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setListFocused(false);
          }}
        >
          {optimisticTask ? (
            <OptimisticTaskOption
              task={optimisticTask}
              showDetails={showDetails}
              hiddenCategorySlug={categoryFilter?.slug ?? null}
            />
          ) : null}
          {visibleRows.map((row, index) =>
            composer?.mode === "edit" && row.task.id === composer.task.id ? (
              <InlineTaskComposer
                key={`edit-${row.task.id}`}
                composer={composer}
                onClose={onCloseComposer}
                onSaved={onComposerSaved}
                onCreatePending={onCreatePending}
                onCreateFailed={onCreateFailed}
                helpMode={helpMode}
                onDisableHelp={onDisableComposerHelp}
                inList
              />
            ) : (
              <TaskOption
                key={row.task.id}
                row={row}
                index={index}
                active={index === activeIndex}
                selected={selectedIds.has(row.task.id)}
                expanded={expandedIds.has(row.task.id)}
                pending={mutationPendingIds.has(row.task.id)}
                feedbackVersion={
                  statusFeedback?.taskId === row.task.id ? statusFeedback.version : undefined
                }
                newTaskId={newTaskId}
                exitingTaskIds={exitingTaskIds}
                showDetails={showDetails}
                hiddenCategorySlug={categoryFilter?.slug ?? null}
                taskById={taskById}
                onClick={handleOptionClick}
                onToggleStatus={handleOptionToggleStatus}
                onToggleExpanded={handleOptionToggleExpanded}
                onSelectCategory={handleOptionSelectCategory}
              />
            ),
          )}
          {isDefaultActiveEmpty ? (
            <TaskItem data-empty-state="active" size="sm" state="empty">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">No active tasks</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Press C or choose New task to capture.
                </p>
              </div>
            </TaskItem>
          ) : null}
          {isFilteredEmpty ? (
            <TaskItem data-empty-state="filtered" size="sm" state="empty">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">No tasks match the current filters</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Try different filters or clear them.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                tabIndex={-1}
                onClick={() => {
                  onClearAllFilters();
                  list.current?.focus();
                }}
              >
                Clear filters
              </Button>
            </TaskItem>
          ) : null}
        </div>
      ) : !loading && !error && composer === null ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No active tasks</EmptyTitle>
            <EmptyDescription>Press C or choose New task to capture.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      <Tooltip open={filterFeedback.open} onOpenChange={filterFeedback.onOpenChange}>
        <TooltipTrigger render={<span className="sr-only">Status filter feedback</span>} />
        <AnchoredTooltipContent anchor={statusFilterButton} side="top" sideOffset={8}>
          {exactStatus !== null
            ? (EXACT_STATUS_META.find((entry) => entry.status === exactStatus)?.label ??
              exactStatus)
            : statusPreset === "active"
              ? "Active"
              : "Inactive"}
        </AnchoredTooltipContent>
      </Tooltip>
      {hasMore ? (
        <Button
          ref={loadMore}
          variant="ghost"
          disabled={loading}
          onClick={() => void onRefresh(tasks.length)}
        >
          Load more tasks
        </Button>
      ) : null}
    </section>
  );
}
