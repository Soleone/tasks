import { randomUUID } from "../lib/randomUUID";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { flushSync } from "react-dom";
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
import { lensPhrase, type ListLens } from "./listLens";
import { InlineTaskComposer, OptimisticTaskOption, TaskOption } from "./TaskListRows";
import { isDialogOpen, useTaskListKeyboard } from "./useTaskListKeyboard";
import { useTaskListSelection, type ActiveTaskRequest } from "./useTaskListSelection";
import {
  forwardStatusTransition,
  reverseStatusTransition,
  type StatusCommand,
  type StatusTransition,
} from "./taskStatusCycle";
import { TaskListToolbar, type ToolbarFoldGroup } from "./TaskListToolbar";
import type { TaskListMode as ToolbarMode } from "./TaskListModeHelp";
import type { ComposerState, TaskCreateDraft } from "@/components/TaskComposer";
import {
  rootIdsAboveTasks,
  rootRowRuns,
  visibleTaskRows,
  type VisibleTaskRow,
} from "@/components/taskTree";
import {
  movedTaskRows,
  orderedTaskRows,
  placementForMove,
  selectedRowsForReorder,
  selectionMembershipMatches,
  type TaskMoveDirection,
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
import { copyImage } from "@/platform/imageClipboard";
import { APP_NAME } from "@/backend/branding";
import { practice } from "@/learning/progress";
import { isAndroid } from "@/platform/runtime";
import { TaskItem, TaskItemGroup } from "@/components/variants/item";
import { AnchoredTooltipContent } from "@/components/variants/tooltip";
import { useCompletionSheen } from "./useCompletionSheen";
import { useFlashTooltip } from "./useFlashTooltip";
import { useStableHandler } from "./useStableHandler";
import type { TaskContextActions } from "./TaskContextMenu";

export async function copyTaskText(task: TaskView): Promise<void> {
  const text = [selectedMainWorkspace() ? task.title : (task.text ?? task.title), task.description]
    .map((value) => (selectedMainWorkspace() ? value : stripClassificationTokens(value)))
    .concat(task.tags.map((tag) => `#${tag.slug}`))
    .filter(Boolean)
    .join(" ");
  await navigator.clipboard.writeText(text);
}

/** Copies one image and returns what the toast says; `name` is undefined for a task without images. */
export async function copyImageMessage(name: string | undefined): Promise<string> {
  if (name === undefined) return "This task has no images.";
  try {
    await copyImage(name);
    return "Image copied to clipboard";
  } catch (caught) {
    if (caught instanceof EditorError && caught.code === "ATTACHMENT_NOT_FOUND")
      return "This image isn't on this device. It may not have synced yet.";
    return `Couldn't copy the image. ${caught instanceof Error ? caught.message : String(caught)}`;
  }
}

/** Where the list stood, so the done lens can put it back. */
export type TaskListPlace = {
  activeTaskId: string | null;
  expandedIds: ReadonlySet<string>;
  scrollTop: number;
};

export type TaskListHandle = {
  currentPlace: () => TaskListPlace;
  /** Expands the same parents and scrolls back once the restored view has loaded. */
  restorePlace: (place: TaskListPlace) => void;
  startIdentityPreservingRefresh: () => void;
  finishIdentityPreservingRefresh: () => void;
  clearActiveTaskSelection: () => void;
  getActiveTask: () => TaskView | undefined;
  waitForWrites: () => Promise<void>;
};

type TaskListProps = {
  tasks: TaskView[];
  newTaskId?: string | null;
  exitingTaskIds: ReadonlySet<string>;
  contextTasks: TaskView[];
  contextOrder: ReadonlyMap<string, number>;
  total: number;
  /** Tasks done in the last 24 hours, for the empty Active view. */
  doneTodayCount: number;
  /** The open lens, or null outside one. */
  lens: ListLens | null;
  onToggleLens: (kind: ListLens["kind"]) => void;
  onWidenDoneLens: () => void;
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
  onToggleDetails: () => void;
  foldedToolbarGroups: readonly ToolbarFoldGroup[];
  onToolbarGroupFoldedChange: (group: ToolbarFoldGroup, folded: boolean) => void;
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
  searchInput: ReactNode;
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
  canRedo?: boolean;
  onRedo?: () => void;
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
/** Rows from the end of the loaded tasks at which the next page starts loading. */
const LOAD_AHEAD_ROWS = 20;

export function TaskList({
  ref,
  tasks: queriedTasks,
  newTaskId,
  exitingTaskIds,
  contextTasks,
  contextOrder,
  total,
  doneTodayCount,
  lens,
  onToggleLens,
  onWidenDoneLens,
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
  onToggleDetails,
  foldedToolbarGroups,
  onToolbarGroupFoldedChange,
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
  searchInput,
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
  canRedo,
  onRedo,
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
  const taskWrites = useRef(new Map<string, { confirmed: TaskView; tail: Promise<TaskView> }>());
  // Replies land after later renders; these reach the handlers of the latest one.
  const showTaskUpdate = useStableHandler(onTaskUpdated);
  const announce = useStableHandler(onAnnounce);
  const recordOperation = useStableHandler(
    (operationId: string, previous: TaskView[], current: TaskView[]) =>
      onOperation?.(operationId, previous, current),
  );
  const statusChanged = useStableHandler(
    (previous: TaskView, current: TaskView, wasActive: boolean) =>
      onStatusChanged?.(previous, current, wasActive),
  );
  const toolbarModeRef = useRef<ToolbarMode | null>(null);
  const [listFocused, setListFocused] = useState(false);
  const composerOpenRef = useRef(composer !== null);
  const previousComposerOpenRef = useRef(composer !== null);
  useLayoutEffect(() => {
    composerOpenRef.current = composer !== null;
  });
  const [mutationPendingIds, setMutationPendingIds] = useState<Set<string>>(() => new Set());
  const [toolbarMode, setToolbarMode] = useState<ToolbarMode | null>(null);
  // Flashes the status glyph's tooltip after this client changes its status or priority.
  const [glyphFeedback, setGlyphFeedback] = useState<{ taskId: string; version: number } | null>(
    null,
  );
  const { sheenSteps, playSheen } = useCompletionSheen();
  const [filterFeedbackVersion, setFilterFeedbackVersion] = useState(0);
  const filterFeedback = useFlashTooltip(filterFeedbackVersion, TOGGLE_FEEDBACK_DURATION_MS);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  // Tasks whose details differ from the global setting. Client memory only: never stored in the
  // workspace, never synced, gone on reload.
  const [flippedDetailIds, setFlippedDetailIds] = useState<ReadonlySet<string>>(() => new Set());
  const [unblockedFeedbackVersion, setUnblockedFeedbackVersion] = useState(0);
  const unblockedFeedback = useFlashTooltip(unblockedFeedbackVersion, TOGGLE_FEEDBACK_DURATION_MS);
  const [moveControlsOpen, setMoveControlsOpen] = useState(false);
  const reorderPending = useRef<Promise<void> | null>(null);
  const reorderQueue = useRef<
    { direction: TaskMoveDirection; activeId: string; selectedIds: string[]; filter: string }[]
  >([]);
  const [pendingRowOrder, setPendingRowOrder] = useState<{
    filter: string;
    ranks: ReadonlyMap<string, number>;
  } | null>(null);
  const reorderReceipt = useRef<{ signature: string; key: string } | null>(null);

  // A pending status or priority change stays on screen through list refreshes until it settles.
  const [pendingTasks, setPendingTasks] = useState<ReadonlyMap<string, TaskView>>(() => new Map());
  const tasks = useMemo(
    () =>
      pendingTasks.size === 0
        ? queriedTasks
        : queriedTasks.map((task) => pendingTasks.get(task.id) ?? task),
    [queriedTasks, pendingTasks],
  );
  const shownContextTasks = useMemo(
    () => contextTasks.map((task) => pendingTasks.get(task.id) ?? task),
    [contextTasks, pendingTasks],
  );
  // A lens opens each tree its subtasks sit in, once, so none hides behind a
  // collapsed parent. Leaving the lens restores the expansion it set aside.
  const [lensOpenedIds, setLensOpenedIds] = useState<ReadonlySet<string> | null>(null);
  if (lens === null) {
    if (lensOpenedIds !== null) setLensOpenedIds(null);
  } else if (!loading) {
    const unopened = [...rootIdsAboveTasks(tasks, [...shownContextTasks, ...tasks])].filter(
      (id) => !lensOpenedIds?.has(id),
    );
    if (unopened.length > 0) {
      setLensOpenedIds(new Set([...(lensOpenedIds ?? []), ...unopened]));
      setExpandedIds((previous) => new Set([...previous, ...unopened]));
    }
  }
  const savedRows = useMemo(
    () => visibleTaskRows(tasks, expandedIds, shownContextTasks, contextOrder),
    [tasks, expandedIds, shownContextTasks, contextOrder],
  );
  // A filter change resets the selection and hides any previous reorder preview.
  const filterIdentity = [
    statusPreset,
    exactStatus ?? "",
    priorityFilter ?? "",
    tagFilter.map((tag) => tag.slug).join(","),
    searchQuery,
    showUnblocked ? "1" : "0",
    categoryFilter?.slug ?? "",
  ].join("|");
  const visibleRows = useMemo(
    () =>
      pendingRowOrder === null ||
      pendingRowOrder.filter !== filterIdentity ||
      sortField !== "manual"
        ? savedRows
        : orderedTaskRows(savedRows, pendingRowOrder.ranks),
    [savedRows, pendingRowOrder, sortField, filterIdentity],
  );
  const savedRowsRef = useRef(savedRows);
  useLayoutEffect(() => {
    savedRowsRef.current = savedRows;
  });
  const taskById = useMemo(
    () => new Map([...shownContextTasks, ...tasks].map((task) => [task.id, task])),
    [tasks, shownContextTasks],
  );
  const reorderFilterRef = useRef(filterIdentity);
  useLayoutEffect(() => {
    reorderFilterRef.current = filterIdentity;
  });
  useEffect(
    () => () => {
      reorderQueue.current = [];
    },
    [],
  );
  const hasMore = tasks.length < total;
  const {
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
    handle: selectionHandle,
  } = useTaskListSelection({
    tasks,
    visibleRows,
    filterIdentity,
    newTaskId,
    activeTaskRequest,
    composerOpen: composer !== null,
    onAnnounce,
    onEdit: (task) => {
      practice("home.open-editor", "pointer");
      onEdit(task);
    },
  });

  // Paging is invisible: the next page loads once navigation or scrolling nears
  // the end of what is loaded.
  const loadNextPage = useCallback(() => {
    if (hasMore && !loading && !error) void onRefresh(tasks.length);
  }, [hasMore, loading, error, onRefresh, tasks.length]);
  useEffect(() => {
    if (visibleRows.length - activeIndex <= LOAD_AHEAD_ROWS) loadNextPage();
  }, [activeIndex, visibleRows.length, loadNextPage]);

  // The restored view loads after restorePlace; once that load ends, the old scroll position returns.
  const pendingScroll = useRef<{ top: number; loadStarted: boolean } | null>(null);
  const expandedIdsRef = useRef(expandedIds);
  useLayoutEffect(() => {
    expandedIdsRef.current = expandedIds;
    const pending = pendingScroll.current;
    if (!pending) return;
    if (loading) pending.loadStarted = true;
    else if (pending.loadStarted) {
      pendingScroll.current = null;
      list.current?.scrollTo({ top: pending.top });
    }
  });

  useImperativeHandle(
    ref,
    () => ({
      ...selectionHandle,
      currentPlace: () => ({
        activeTaskId: selectionHandle.getActiveTask()?.id ?? null,
        expandedIds: expandedIdsRef.current,
        scrollTop: list.current?.scrollTop ?? 0,
      }),
      restorePlace: (place) => {
        setExpandedIds(new Set(place.expandedIds));
        pendingScroll.current = { top: place.scrollTop, loadStarted: false };
      },
      waitForWrites: async () => {
        // A refused optimistic write still settles before history chooses the preceding accepted step.
        while (taskWrites.current.size > 0 || reorderPending.current) {
          await Promise.allSettled([
            ...[...taskWrites.current.values()].map((chain) => chain.tail),
            ...(reorderPending.current ? [reorderPending.current] : []),
          ]);
        }
      },
    }),
    [selectionHandle],
  );

  // Details change row heights, so keep the active task on screen.
  const shownDetailsRef = useRef({ showDetails, flippedDetailIds });
  useEffect(() => {
    const shown = shownDetailsRef.current;
    if (shown.showDetails === showDetails && shown.flippedDetailIds === flippedDetailIds) return;
    shownDetailsRef.current = { showDetails, flippedDetailIds };
    if (activeTask) scheduleActiveScroll(activeTask.id);
  }, [showDetails, flippedDetailIds, activeTask, scheduleActiveScroll]);

  // The list owns its internal tail (retry); the navigator only enters it
  // through explicit navigation.
  useEffect(
    () =>
      nav.register("list", {
        focusLast: () => (list.current ?? retry.current ?? section.current)?.focus(),
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
    // A folded group opens for its mode; it must render before it can take focus.
    flushSync(() => activateToolbarMode(mode));
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

  // The newest image is the one just pasted, which is usually the one wanted.
  function copyNewestImage(task: TaskView): void {
    void copyImageMessage(task.attachments.at(-1)).then(onToast);
  }

  function copyEditorImage(name: string): void {
    void copyImageMessage(name).then(onToast);
  }

  function reorderDisabledReason(row: VisibleTaskRow | undefined): string | null {
    const selected = selectedMainWorkspace();
    if (selected && !selected.supportsOrdering)
      return "Reordering is not yet available in this selected workspace.";
    if (!row) return "No task is selected.";
    if (row.contextOnly) return "Context-only tasks cannot be reordered.";
    if (exactStatus !== null) return "Clear the exact-status filter before reordering.";
    if (statusPreset !== "active") return "Clear the inactive filter before reordering.";
    if (showUnblocked) return "Clear the Unblocked filter before reordering.";
    if (priorityFilter !== null) return "Clear the priority filter before reordering.";
    if (tagFilter.length > 0) return "Clear the tag filter before reordering.";
    if (searchQuery.trim() !== "") return "Clear search before reordering.";
    return null;
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

  function waitForListRender(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  async function performReorder(
    direction: TaskMoveDirection,
    activeId: string,
    selection: readonly string[],
    filter: string,
  ): Promise<boolean> {
    if (filter !== reorderFilterRef.current) return false;
    const sourceRows = savedRowsRef.current;
    const sourceRow = sourceRows.find((candidate) => candidate.task.id === activeId);
    const reason = reorderDisabledReason(sourceRow);
    if (reason) {
      onAnnounce(reason);
      return false;
    }
    if (!sourceRow) return false;
    const sourceSelected = selectedRowsForReorder(sourceRow, sourceRows, new Set(selection));
    if (!sourceSelected) {
      onAnnounce("Selection is limited to one visible sibling scope.");
      return false;
    }
    const switchedToManual = sortField !== "manual";
    if (switchedToManual) {
      onSortFieldChange("manual");
      // Resolve the first move against the saved manual order, not the previous sort.
      await waitForListRender();
      if (!(await onRefresh(0))) {
        onAnnounce("Could not refresh tasks. No move was made.");
        return false;
      }
      await waitForListRender();
    }
    if (filter !== reorderFilterRef.current) return false;
    const currentRows = savedRowsRef.current;
    const currentActive = currentRows.find((row) => row.task.id === activeId);
    const currentSelected =
      currentActive && selectedRowsForReorder(currentActive, currentRows, new Set(selection));
    if (!currentSelected || !selectionMembershipMatches(currentSelected, selection)) {
      onAnnounce("The selected task changed during refresh. No move was made.");
      return false;
    }
    const placement = placementForMove(direction, currentSelected[0], currentSelected, currentRows);
    if (!placement) {
      const boundary =
        direction === "up" || direction === "start"
          ? "Already at the beginning."
          : "Already at the end.";
      onAnnounce(switchedToManual ? `Switched to manual order. ${boundary}` : boundary);
      return true;
    }
    if (switchedToManual) {
      let preview = movedTaskRows(currentRows, currentSelected, placement);
      for (const next of reorderQueue.current) {
        if (next.filter !== filter) break;
        const active = preview.find((row) => row.task.id === next.activeId);
        const selected =
          active && selectedRowsForReorder(active, preview, new Set(next.selectedIds));
        if (!selected) break;
        const target = placementForMove(next.direction, selected[0], selected, preview);
        if (target) preview = movedTaskRows(preview, selected, target);
      }
      visibleRowsRef.current = preview;
      setPendingRowOrder({
        filter,
        ranks: new Map(preview.map((row, index) => [row.task.id, index])),
      });
    }
    const commandTasks = currentSelected.map((candidate) => ({
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
        return true;
      }
      if (result.operationId)
        recordOperation(
          result.operationId,
          currentSelected.map((row) => row.task),
          result.tasks,
        );
      if (!(await onRefresh(0))) {
        onAnnounce(
          "The move was saved, but tasks could not be refreshed. Refresh before moving again.",
        );
        return false;
      }
      await waitForListRender();
      const move = `${currentSelected.length} task${currentSelected.length === 1 ? "" : "s"} moved ${direction === "start" ? "to the beginning" : direction === "end" ? "to the end" : direction}.`;
      onAnnounce(switchedToManual ? `Switched to manual order. ${move}` : move);
      return true;
    } catch (caught) {
      if (caught instanceof EditorError && caught.code === "STALE_TASK_VERSION") {
        reorderReceipt.current = null;
        onAnnounce("A selected task changed elsewhere. Refresh and try again.");
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
    return false;
  }

  const performReorderRef = useRef<typeof performReorder | null>(null);
  useLayoutEffect(() => {
    performReorderRef.current = performReorder;
  });

  async function reorderSelection(direction: TaskMoveDirection): Promise<void> {
    const rows = visibleRowsRef.current;
    const active = rows.find((row) => row.task.id === selectionHandle.getActiveTask()?.id);
    const reason = reorderDisabledReason(active);
    if (reason) {
      onAnnounce(reason);
      return;
    }
    if (!active) return;
    const selected = selectedRowsForReorder(active, rows, selectedIdsRef.current);
    if (!selected) {
      onAnnounce("Selection is limited to one visible sibling scope.");
      return;
    }
    if (sortField === "manual") {
      const placement = placementForMove(direction, active, selected, rows);
      if (!placement) {
        onAnnounce(
          direction === "up" || direction === "start"
            ? "Already at the beginning."
            : "Already at the end.",
        );
        return;
      }
      const preview = movedTaskRows(rows, selected, placement);
      // Repeated keydown events can arrive before React commits this preview.
      visibleRowsRef.current = preview;
      setPendingRowOrder({
        filter: filterIdentity,
        ranks: new Map(preview.map((row, index) => [row.task.id, index])),
      });
    }
    reorderQueue.current.push({
      direction,
      activeId: active.task.id,
      selectedIds: selected.map((row) => row.task.id),
      filter: filterIdentity,
    });
    if (reorderPending.current) return;
    reorderPending.current = drainReorderQueue();
    await reorderPending.current;
  }

  async function drainReorderQueue(): Promise<void> {
    try {
      while (reorderQueue.current.length > 0) {
        const next = reorderQueue.current.shift()!;
        if (
          !(await performReorderRef.current!(
            next.direction,
            next.activeId,
            next.selectedIds,
            next.filter,
          ))
        ) {
          reorderQueue.current = [];
          await onRefresh(0);
          break;
        }
      }
    } catch {
      reorderQueue.current = [];
      announce("Could not refresh tasks. Refresh before moving again.");
    } finally {
      reorderPending.current = null;
      setPendingRowOrder(null);
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
    if (parentIndex >= 0) activate(parentIndex);
  }

  function handleHorizontalNavigation(key: "ArrowLeft" | "ArrowRight"): void {
    if (!activeRow) return;
    if (key === "ArrowRight") {
      if (activeRow.hasChildren) {
        if (!categoryFilter && activeRow.task.category) {
          selectCategory(
            activeRow.task.category,
            activeRow.contextOnly ? undefined : activeRow.task.id,
          );
          return;
        }
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

  // Status and priority show at once and the write follows. Writes to one task chain, so each
  // sends the version its predecessor confirmed; a failure puts back the last confirmed task.
  function writeOptimistically(
    task: TaskView,
    shown: TaskView,
    send: (confirmed: TaskView) => Promise<TaskMutationResult>,
    confirm: (previous: TaskView, result: TaskMutationResult) => void,
  ): Promise<void> {
    const chain = taskWrites.current.get(task.id) ?? {
      confirmed: task,
      tail: Promise.resolve(task),
    };
    const tail = chain.tail.then(async (previous) => {
      const result = await send(previous);
      chain.confirmed = result.task;
      confirm(previous, result);
      return result.task;
    });
    chain.tail = tail;
    taskWrites.current.set(task.id, chain);
    showPending(task.id, shown);
    showTaskUpdate(shown);
    const settle = (current: TaskView) => {
      taskWrites.current.delete(task.id);
      showPending(task.id, null);
      showTaskUpdate(current);
    };
    return tail.then(
      (current) => {
        if (chain.tail === tail) settle(current);
      },
      (caught: unknown) => {
        // Writes queued behind a failed one fail with it; the last one reports.
        if (chain.tail !== tail) return;
        settle(chain.confirmed);
        announce(
          caught instanceof EditorError && caught.code === "STALE_TASK_VERSION"
            ? `${task.title} changed elsewhere. Refresh and try again.`
            : `Could not change ${task.title}: ${caught instanceof Error ? caught.message : String(caught)}`,
        );
      },
    );
  }

  function showPending(taskId: string, shown: TaskView | null): void {
    setPendingTasks((previous) => {
      const next = new Map(previous);
      if (shown) next.set(taskId, shown);
      else next.delete(taskId);
      return next;
    });
  }

  function changeStatus(task: TaskView, transition: StatusTransition): Promise<void> {
    if (mutationPending.current.has(task.id)) return Promise.resolve();
    const wasActive = activeTask?.id === task.id;
    if (transition.next === "done") playSheen([task.id]);
    return writeOptimistically(
      task,
      { ...task, status: transition.next },
      async (confirmed) => {
        const previousReceipt = statusReceipts.current.get(task.id);
        const receipt =
          previousReceipt?.version === confirmed.version &&
          previousReceipt.target === transition.next
            ? previousReceipt
            : { version: confirmed.version, target: transition.next, key: randomUUID() };
        statusReceipts.current.set(task.id, receipt);
        const result = await transitionTask(transition.command, task.id, confirmed.version, {
          idempotencyKey: receipt.key,
        });
        statusReceipts.current.delete(task.id);
        return result;
      },
      (previous, result) => {
        if (result.changed !== false) {
          if (result.operationId) recordOperation(result.operationId, [previous], [result.task]);
          statusChanged(previous, result.task, wasActive);
          setGlyphFeedback({ taskId: task.id, version: result.task.version });
        }
        announce(`${task.title}: ${taskStatusMeta[result.task.status].label}`);
      },
    );
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
        // The wave runs down the list, so it follows the visible order of the selection.
        const doneNow = new Set(
          current.filter((task) => task.status === "done").map((task) => task.id),
        );
        playSheen(
          previous
            .filter((task) => task.status !== "done" && doneNow.has(task.id))
            .map((task) => task.id),
        );
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

  function setTaskPriority(task: TaskView, priority: TaskPriority): Promise<void> {
    if (task.priority === priority || mutationPending.current.has(task.id))
      return Promise.resolve();
    return writeOptimistically(
      task,
      { ...task, priority },
      async (confirmed) => {
        const previousReceipt = priorityReceipts.current.get(task.id);
        const receipt =
          previousReceipt?.version === confirmed.version
            ? previousReceipt
            : { version: confirmed.version, key: randomUUID() };
        priorityReceipts.current.set(task.id, receipt);
        const result = await updateTaskPriority(confirmed, priority, {
          idempotencyKey: receipt.key,
        });
        priorityReceipts.current.delete(task.id);
        return result;
      },
      (previous, result) => {
        if (result.operationId) recordOperation(result.operationId, [previous], [result.task]);
        if (result.changed !== false)
          setGlyphFeedback({ taskId: task.id, version: result.task.version });
        const label =
          PRIORITY_META.find((meta) => meta.value === priority)?.label ?? `P${priority}`;
        announce(`${task.title}: priority ${label}`);
      },
    );
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

  function detailsShownFor(taskId: string): boolean {
    return showDetails !== flippedDetailIds.has(taskId);
  }

  function toggleTaskDetails(task: TaskView): void {
    const next = new Set(flippedDetailIds);
    if (!next.delete(task.id)) next.add(task.id);
    setFlippedDetailIds(next);
  }

  function toggleAllDetails(): void {
    setFlippedDetailIds(new Set());
    onToggleDetails();
  }

  function contextActions(row: VisibleTaskRow, index: number): TaskContextActions {
    return {
      disabled:
        composer !== null || mutationPendingIds.has(row.task.id) || exitingTaskIds.has(row.task.id),
      onTarget: () => {
        practice("home.task-context-menu", "pointer");
        activate(index);
      },
      onEdit: (task) => {
        practice("home.open-editor", "pointer");
        onEdit(task);
      },
      onStatus: (task) => {
        practice("status.forward", "pointer");
        void toggleStatus(task);
      },
      onPause: (task) => {
        practice("status.pause", "pointer");
        void pauseTask(task);
      },
      onAddBlocker: (task) => {
        practice("pick.blocker", "pointer");
        returnToList();
        onAddBlocker(task);
      },
      onMoveUnder: (task) => {
        practice("pick.parent", "pointer");
        returnToList();
        onMoveUnder(task);
      },
      onCreateChild: (task) => {
        practice("capture.child", "pointer");
        returnToList();
        onCreate(task.id);
      },
      detailsShown: detailsShownFor(row.task.id),
      onToggleDetails: (task) => {
        practice("details.toggle-active", "pointer");
        toggleTaskDetails(task);
      },
      onCopy: (task) => void copyActiveTask(task),
      onDelete: (task) => void deleteTaskRecord(task),
      onReorder: (direction) => {
        practice("reorder.step", "pointer");
        void reorderSelection(direction);
      },
      reorderDisabledReason: reorderDisabledReason(row),
      finalFocus: () =>
        composerOpenRef.current || isDialogOpen() ? false : (list.current ?? section.current),
    };
  }

  const handleOptionToggleStatus = useStableHandler((task: TaskView): void => {
    practice("status.forward", "pointer");
    void toggleStatus(task);
  });
  const handleOptionToggleExpanded = useStableHandler(toggleExpanded);
  const handleOptionSelectCategory = useStableHandler(selectCategory);
  const handleOptionCopyImage = useStableHandler(copyNewestImage);

  useTaskListKeyboard(
    {
      hasActiveFilters,
      activeTask,
      visibleRowCount: visibleRows.length,
      canUndoStatus: Boolean(canUndoStatus),
      undoStatus: () => onUndoStatus?.(),
      canRedo: Boolean(canRedo),
      redo: () => onRedo?.(),
      deleteSelectedTasks,
      returnToList,
      clearAllFilters: onClearAllFilters,
      startFilterMode,
      startSortMode,
      applyExactStatus,
      applySortField,
      reverseSort,
      toggleActiveDetails: toggleTaskDetails,
      toggleAllDetails,
      setPriority: setTaskPriority,
      openSearch,
      createTask: onCreate,
      toggleStatusPreset,
      applyPriorityFilter,
      toggleUnblockedFilter,
      openCategoryPicker,
      openTagPicker,
      addBlocker: onAddBlocker,
      toggleLens: onToggleLens,
      widenDoneLens: onWidenDoneLens,
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
      copyImage: copyNewestImage,
    },
    { toolbarModeRef, composerOpenRef, list, section },
  );

  // Matching tasks, including those under a collapsed row; context ancestors don't count.
  const summaryTaskCount = total + (optimisticTask ? 1 : 0);

  const touch = isAndroid();
  const captureHint = touch ? "Tap New task to capture." : "Press C or choose New task to capture.";
  // Clearing the list after real work earns a warmer word than "no tasks".
  const activeEmptyTitle = doneTodayCount > 0 ? "All clear" : "No active tasks";
  const activeEmptyHint =
    doneTodayCount > 0 ? `${doneTodayCount} done today. ${captureHint}` : captureHint;
  // An emptied due lens is the same good news as an emptied Active view.
  const filteredEmptyTitle =
    lens === null
      ? "No tasks match the current filters"
      : lens.kind === "due"
        ? "All clear"
        : `Nothing ${lensPhrase(lens)}`;
  const filteredEmptyHint =
    lens === null
      ? "Try different filters or clear them."
      : lens.kind === "due"
        ? "Nothing is due today or late."
        : touch
          ? "Tap the count to look further back."
          : "Press Shift+D or choose the count to look further back.";
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
      aria-keyshortcuts="Escape C Shift+C Enter S U T B M P Space Shift+Space Delete ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+Home Shift+End Control+c Meta+c Control+Shift+c Meta+Shift+c Control+ArrowUp Control+ArrowDown Control+Home Control+End Meta+ArrowUp Meta+ArrowDown Meta+Home Meta+End 0 1 2 3 4 / @ # F O V D Shift+D Control+z Meta+z Control+y Control+Shift+z Meta+Shift+z"
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
        returnToList={returnToList}
        filterToolbar={filterToolbar}
        sortToolbar={sortToolbar}
        statusFilterButton={statusFilterButton}
        activateToolbarMode={activateToolbarMode}
        clearToolbarMode={clearToolbarMode}
        foldedGroups={foldedToolbarGroups}
        setGroupFolded={onToolbarGroupFoldedChange}
        composerOpen={composer !== null}
        onCreate={() => {
          practice("capture.open", "pointer");
          onCreate();
        }}
        taskActions={{
          activeTask,
          disabled: composer !== null,
          canUndo: Boolean(canUndoStatus),
          onUndo: () => {
            practice("undo.latest", "pointer");
            onUndoStatus?.();
          },
          canRedo: Boolean(canRedo),
          onRedo: () => onRedo?.(),
          onAddBlocker: (task) => {
            practice("pick.blocker", "pointer");
            returnToList();
            onAddBlocker(task);
          },
          onMoveUnder: (task) => {
            practice("pick.parent", "pointer");
            returnToList();
            onMoveUnder(task);
          },
          onCreateChild: (task) => {
            practice("capture.child", "pointer");
            returnToList();
            onCreate(task.id);
          },
          onCopy: (task) => void copyActiveTask(task),
          onCopyImage: copyNewestImage,
          onPause: () => {
            practice("status.pause", "pointer");
            void pauseSelectedTasks();
          },
          finalFocus: () =>
            composerOpenRef.current || isDialogOpen() ? false : (list.current ?? section.current),
        }}
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
        searchInput={searchInput}
        openSearch={() => {
          practice("filter.search", "pointer");
          openSearch();
        }}
        sortField={sortField}
        sortDirection={sortDirection}
        applySortField={applySortField}
        reverseSort={reverseSort}
        showDetails={showDetails}
        mixedDetails={flippedDetailIds.size > 0}
        onToggleDetails={toggleAllDetails}
        moveControlsOpen={moveControlsOpen}
        setMoveControlsOpen={setMoveControlsOpen}
        moveSubjectLabel={moveSubjectLabel}
        reorderAvailabilityReason={reorderAvailabilityReason}
        reorderSelection={reorderSelection}
        summaryTaskCount={summaryTaskCount}
        lens={lens}
        widenDoneLens={() => {
          returnToList();
          onWidenDoneLens();
        }}
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
            onCopyImage={copyEditorImage}
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
          aria-keyshortcuts="Escape C Shift+C Enter S U T B M P Space Shift+Space Delete ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+Home Shift+End Control+c Meta+c Control+Shift+c Meta+Shift+c Control+ArrowUp Control+ArrowDown Control+Home Control+End Meta+ArrowUp Meta+ArrowDown Meta+Home Meta+End 0 1 2 3 4 / @ # F O V Control+z Meta+z Control+y Control+Shift+z Meta+Shift+z"
          aria-activedescendant={
            activeTask && !editingActiveTask ? `task-option-${activeTask.id}` : undefined
          }
          tabIndex={0}
          className="flex min-h-0 w-full flex-1 flex-col gap-2 overflow-x-clip overflow-y-auto overscroll-y-contain outline-none"
          onFocus={() => setListFocused(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setListFocused(false);
          }}
          onScroll={(event) => {
            const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
            if (scrollHeight - scrollTop - clientHeight < clientHeight) loadNextPage();
          }}
        >
          {optimisticTask ? (
            <OptimisticTaskOption
              task={optimisticTask}
              showDetails={showDetails}
              hiddenCategorySlug={categoryFilter?.slug ?? null}
            />
          ) : null}
          {rootRowRuns(visibleRows).map((run) => (
            // A lone root stays a plain row to assistive tech; a family is a labeled group.
            <TaskItemGroup
              key={`run-${run[0].row.task.id}`}
              role={run.length > 1 ? "group" : "none"}
              aria-label={run.length > 1 ? run[0].row.task.title : undefined}
            >
              {run.map(({ row, index }) =>
                composer?.mode === "edit" && row.task.id === composer.task.id ? (
                  <InlineTaskComposer
                    key={`edit-${row.task.id}`}
                    composer={composer}
                    onClose={onCloseComposer}
                    onSaved={onComposerSaved}
                    onCreatePending={onCreatePending}
                    onCreateFailed={onCreateFailed}
                    onCopyImage={copyEditorImage}
                    inList
                  />
                ) : (
                  <TaskOption
                    key={row.task.id}
                    row={row}
                    index={index}
                    active={index === activeIndex}
                    // A leaving row drops its selected styling before it slides out.
                    selected={selectedIds.has(row.task.id) && !exitingTaskIds.has(row.task.id)}
                    expanded={expandedIds.has(row.task.id)}
                    pending={mutationPendingIds.has(row.task.id)}
                    feedbackVersion={
                      glyphFeedback?.taskId === row.task.id ? glyphFeedback.version : undefined
                    }
                    sheenStep={sheenSteps.get(row.task.id)}
                    newTaskId={newTaskId}
                    exitingTaskIds={exitingTaskIds}
                    showDetails={detailsShownFor(row.task.id)}
                    showCompletedAt={sortField === "closed"}
                    hiddenCategorySlug={categoryFilter?.slug ?? null}
                    taskById={taskById}
                    onClick={handleOptionClick}
                    contextActions={contextActions}
                    onToggleStatus={handleOptionToggleStatus}
                    onToggleExpanded={handleOptionToggleExpanded}
                    onSelectCategory={handleOptionSelectCategory}
                    onCopyImage={handleOptionCopyImage}
                  />
                ),
              )}
            </TaskItemGroup>
          ))}
          {isDefaultActiveEmpty ? (
            <TaskItem data-empty-state="active" size="sm" state="empty">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{activeEmptyTitle}</p>
                <p className="mt-1 text-sm text-muted-foreground">{activeEmptyHint}</p>
              </div>
            </TaskItem>
          ) : null}
          {isFilteredEmpty ? (
            <TaskItem data-empty-state="filtered" size="sm" state="empty">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{filteredEmptyTitle}</p>
                <p className="mt-1 text-sm text-muted-foreground">{filteredEmptyHint}</p>
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
                {lens ? "Go back" : "Clear filters"}
              </Button>
            </TaskItem>
          ) : null}
        </div>
      ) : !loading && !error && composer === null ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{activeEmptyTitle}</EmptyTitle>
            <EmptyDescription>{activeEmptyHint}</EmptyDescription>
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
    </section>
  );
}
