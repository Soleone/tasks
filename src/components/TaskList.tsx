import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { ChevronDown, ChevronRight, Circle, Flag, Folder, Plus, Search, ShieldBan, Tags } from "lucide-react";
import type { CategoryRecord, TagRecord, TaskPriority, TaskRecord, TaskStatus } from "@/backend/protocol";
import { EXACT_STATUS_META, PRIORITY_META, STATUS_SEQUENCE_TIMEOUT_MS, taskStatusMeta, type StatusPreset } from "@/components/taskFilters";
import { TaskDeleteDialog } from "@/components/TaskDeleteDialog";
import { TaskRow, TaskStatusToggle, taskTitleDisplay } from "@/components/TaskRow";
import { visibleTaskRows, type VisibleTaskRow } from "@/components/taskTree";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Item } from "@/components/ui/item";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { preventFocusSteal, type FocusStack, type Navigator } from "@/navigation";
import { BackendCommandError, transitionTask } from "@/platform/backendClient";

type StatusCommand = "task.start" | "task.pause" | "task.complete" | "task.reopen";

const taskStatusTransition: Record<TaskStatus, { next: TaskStatus; command: StatusCommand }> = {
  open: { next: "in_progress", command: "task.start" },
  in_progress: { next: "paused", command: "task.pause" },
  paused: { next: "done", command: "task.complete" },
  done: { next: "open", command: "task.reopen" },
  canceled: { next: "open", command: "task.reopen" },
};

const EXACT_STATUS_BY_KEY = new Map(EXACT_STATUS_META.map((entry) => [entry.key.toLowerCase(), entry.status]));

// Home shortcuts work anywhere on the home surface, not only when the listbox
// is focused. Typing targets and open dialogs always win.
function isHomeTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('[role="dialog"], [role="menu"], [data-slot="command"]')) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
    || target.isContentEditable
    || target.getAttribute("role") === "combobox"
    || target.hasAttribute("cmdk-input");
}

// Space and Enter keep their native meaning on real buttons (Retry, Load
// more, Clear filters). Backup buttons are tabIndex -1 and mouse-only, so
// list commands win there.
function isNativeButtonAction(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('button:not([tabindex="-1"]), a[href], input, textarea, select') !== null;
}

type TaskListProps = {
  tasks: TaskRecord[];
  total: number;
  statusPreset: StatusPreset;
  exactStatus: TaskStatus | null;
  onToggleStatusPreset: () => void;
  onExactStatus: (status: TaskStatus | null) => void;
  onOpenStatusMenu: () => void;
  priorityFilter: TaskPriority | null;
  onPriorityFilter: (priority: TaskPriority | null) => void;
  onOpenPriorityMenu: () => void;
  showUnblocked: boolean;
  onShowUnblockedChange: (show: boolean) => void;
  categoryFilter: CategoryRecord | null;
  onCategoryFilterChange: (category: CategoryRecord | null) => void;
  onOpenCategoryPicker: () => void;
  tagFilter: TagRecord[];
  onTagFilterChange: (tags: TagRecord[]) => void;
  onOpenTagPicker: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onOpenSearch: () => void;
  hasActiveFilters: boolean;
  onClearAllFilters: () => void;
  activeTaskIndex: number;
  loading: boolean;
  error: string | null;
  nav: Navigator;
  focusStack: FocusStack;
  onCreate: (parentId?: string) => void;
  onRefresh: (offset?: number) => Promise<void>;
  onActiveTaskIndexChange: (index: number) => void;
  onAnnounce: (message: string) => void;
  onEdit: (task: TaskRecord) => void;
  onTaskUpdated: (task: TaskRecord) => void;
  onCanceled: (task: TaskRecord) => void;
  onAddBlocker: (task: TaskRecord) => void;
  onMoveUnder: (task: TaskRecord) => void;
};

type StatusReceipt = {
  version: number;
  target: TaskStatus;
  key: string;
};

type HomeShortcutActions = {
  hasActiveFilters: boolean;
  activeTask: TaskRecord | undefined;
  activeTaskIndex: number;
  visibleRowCount: number;
  openDeleteDialog: () => void;
  clearStatusSequence: () => void;
  clearAllFilters: () => void;
  startStatusSequence: () => void;
  applyExactStatus: (status: TaskStatus) => void;
  openSearch: () => void;
  createTask: (parentId?: string) => void;
  toggleStatusPreset: () => void;
  applyPriorityFilter: (priority: TaskPriority) => void;
  toggleUnblockedFilter: () => void;
  clearCategoryFilter: () => void;
  openCategoryPicker: () => void;
  clearTagFilter: () => void;
  openTagPicker: () => void;
  addBlocker: (task: TaskRecord) => void;
  moveUnder: (task: TaskRecord) => void;
  toggleStatus: (task: TaskRecord) => Promise<void>;
  moveActive: (next: number) => void;
  handleHorizontalNavigation: (key: "ArrowLeft" | "ArrowRight") => void;
  editTask: (task: TaskRecord) => void;
};

const TOGGLE_FEEDBACK_DURATION_MS = 900;
const ACTIVE_FILTER_CLASS = "border-primary/50 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary";

export function TaskList({
  tasks,
  total,
  statusPreset,
  exactStatus,
  onToggleStatusPreset,
  onExactStatus,
  onOpenStatusMenu,
  priorityFilter,
  onPriorityFilter,
  onOpenPriorityMenu,
  showUnblocked,
  onShowUnblockedChange,
  categoryFilter,
  onCategoryFilterChange,
  onOpenCategoryPicker,
  tagFilter,
  onTagFilterChange,
  onOpenTagPicker,
  searchQuery,
  onSearchChange,
  onOpenSearch,
  hasActiveFilters,
  onClearAllFilters,
  activeTaskIndex,
  loading,
  error,
  nav,
  focusStack,
  onCreate,
  onRefresh,
  onActiveTaskIndexChange,
  onAnnounce,
  onEdit,
  onTaskUpdated,
  onCanceled,
  onAddBlocker,
  onMoveUnder,
}: TaskListProps): ReactElement {
  const section = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const loadMore = useRef<HTMLButtonElement>(null);
  const initialHomeFocusPending = useRef(true);
  const retry = useRef<HTMLButtonElement>(null);
  const statusReceipts = useRef(new Map<string, StatusReceipt>());
  const statusPending = useRef(new Set<string>());
  const statusSequence = useRef<{ pending: boolean; timeout: number | null }>({ pending: false, timeout: null });
  const homeShortcutActions = useRef<HomeShortcutActions | null>(null);
  const [deletion, setDeletion] = useState<{ task: TaskRecord; key: string } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [listFocused, setListFocused] = useState(false);
  const [statusPendingIds, setStatusPendingIds] = useState<Set<string>>(() => new Set());
  const [statusFeedback, setStatusFeedback] = useState<{ taskId: string; version: number } | null>(null);
  const [filterFeedbackVersion, setFilterFeedbackVersion] = useState(0);
  const [filterFeedbackOpen, setFilterFeedbackOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [unblockedFeedbackVersion, setUnblockedFeedbackVersion] = useState(0);
  const [unblockedFeedbackOpen, setUnblockedFeedbackOpen] = useState(false);

  const visibleRows = useMemo(() => visibleTaskRows(tasks, expandedIds), [tasks, expandedIds]);
  const hasMore = tasks.length < total;
  // The active row is list state, not focus state, so it survives toolbar
  // clicks and empty-area focus loss. Focus stays a screen-reader concern.
  const clampedActiveIndex = visibleRows.length ? Math.min(activeTaskIndex, visibleRows.length - 1) : 0;
  const activeRow = visibleRows.length ? visibleRows[clampedActiveIndex] : undefined;
  const activeTask = activeRow?.task;

  // The list owns its internal tail (load-more, retry); the navigator only
  // enters it through explicit navigation.
  useEffect(() => nav.register("list", {
    focusLast: () => (loadMore.current ?? list.current ?? retry.current ?? section.current)?.focus(),
  }), [nav]);

  useEffect(() => {
    const nextIndex = Math.min(activeTaskIndex, Math.max(visibleRows.length - 1, 0));
    if (nextIndex !== activeTaskIndex) onActiveTaskIndexChange(nextIndex);
  }, [activeTaskIndex, onActiveTaskIndexChange, visibleRows.length]);

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

  useEffect(() => {
    if (filterFeedbackVersion === 0) return;
    setFilterFeedbackOpen(true);
    const timeout = window.setTimeout(() => setFilterFeedbackOpen(false), TOGGLE_FEEDBACK_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [filterFeedbackVersion]);

  useEffect(() => {
    if (unblockedFeedbackVersion === 0) return;
    setUnblockedFeedbackOpen(true);
    const timeout = window.setTimeout(() => setUnblockedFeedbackOpen(false), TOGGLE_FEEDBACK_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [unblockedFeedbackVersion]);

  // Reset a pending Shift+S sequence on unmount, blur, hiding, or Escape.
  // Modals steal focus from the list, so blur covers modal transitions too.
  useEffect(() => {
    const clear = (): void => {
      if (statusSequence.current.timeout !== null) window.clearTimeout(statusSequence.current.timeout);
      statusSequence.current = { pending: false, timeout: null };
    };
    const onBlur = (): void => clear();
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") clear();
    };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clear();
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  function clearStatusSequence(): void {
    if (statusSequence.current.timeout !== null) window.clearTimeout(statusSequence.current.timeout);
    statusSequence.current = { pending: false, timeout: null };
  }

  function startStatusSequence(): void {
    clearStatusSequence();
    statusSequence.current.pending = true;
    statusSequence.current.timeout = window.setTimeout(() => {
      clearStatusSequence();
      onAnnounce("Status choice timed out. Press Shift+S then O, I, D, P, or C within 2 seconds.");
    }, STATUS_SEQUENCE_TIMEOUT_MS);
    onAnnounce("Press O for Open, I for In progress, D for Done, P for Paused, or C for Canceled.");
  }

  function toggleStatusPreset(): void {
    clearStatusSequence();
    onToggleStatusPreset();
    setFilterFeedbackVersion((previous) => previous + 1);
    onAnnounce(statusPreset === "active" && exactStatus === null ? "Showing inactive tasks" : "Showing active tasks");
  }

  function applyExactStatus(status: TaskStatus): void {
    clearStatusSequence();
    onExactStatus(status);
    const label = EXACT_STATUS_META.find((entry) => entry.status === status)?.label ?? status;
    onAnnounce(`Showing ${label} tasks`);
  }

  function toggleUnblockedFilter(): void {
    const next = !showUnblocked;
    onShowUnblockedChange(next);
    setUnblockedFeedbackVersion((previous) => previous + 1);
    onAnnounce(next ? "Showing unblocked tasks" : "Showing all tasks");
  }

  function clearCategoryFilter(): void {
    if (!categoryFilter) return;
    onCategoryFilterChange(null);
    onAnnounce("Showing tasks from all categories");
  }

  function toggleCategoryFilter(): void {
    if (categoryFilter) {
      clearCategoryFilter();
      return;
    }
    onOpenCategoryPicker();
  }

  function clearTagFilter(): void {
    if (tagFilter.length === 0) return;
    onTagFilterChange([]);
    onAnnounce("Cleared tag filters");
  }

  function clearSearch(): void {
    if (searchQuery.trim() === "") return;
    onSearchChange("");
    onAnnounce("Cleared search");
  }

  function applyPriorityFilter(priority: TaskPriority): void {
    if (priorityFilter === priority) {
      onPriorityFilter(null);
      onAnnounce("Showing all priorities");
      return;
    }
    onPriorityFilter(priority);
    const label = PRIORITY_META.find((meta) => meta.value === priority)?.label ?? `P${priority}`;
    onAnnounce(`Showing ${label} tasks`);
  }

  function moveActive(next: number): void {
    if (visibleRows.length === 0) return;
    const wrapped = (next + visibleRows.length) % visibleRows.length;
    onActiveTaskIndexChange(wrapped);
    onAnnounce(`${wrapped + 1} of ${visibleRows.length}: ${visibleRows[wrapped].task.title}`);
    requestAnimationFrame(() => {
      document.getElementById(`task-option-${visibleRows[wrapped].task.id}`)?.scrollIntoView({ block: "nearest" });
    });
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
    const parentIndex = visibleRows.findIndex((candidate) => candidate.task.id === row.task.parentId);
    if (parentIndex >= 0) onActiveTaskIndexChange(parentIndex);
  }

  function handleHorizontalNavigation(key: "ArrowLeft" | "ArrowRight"): void {
    if (!activeRow) return;
    if (key === "ArrowRight") {
      if (activeRow.hasChildren && !expandedIds.has(activeRow.task.id)) {
        setExpanded(activeRow.task.id, true);
        onAnnounce(`Expanded ${activeRow.task.title}`);
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
    }
  }

  function setStatusPending(taskId: string, pending: boolean): void {
    if (pending) statusPending.current.add(taskId);
    else statusPending.current.delete(taskId);
    setStatusPendingIds((previous) => {
      const next = new Set(previous);
      if (pending) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
  }

  async function toggleStatus(task: TaskRecord): Promise<void> {
    if (statusPending.current.has(task.id)) return;
    const transition = taskStatusTransition[task.status];
    const previousReceipt = statusReceipts.current.get(task.id);
    const receipt = previousReceipt?.version === task.version && previousReceipt.target === transition.next
      ? previousReceipt
      : { version: task.version, target: transition.next, key: crypto.randomUUID() };
    statusReceipts.current.set(task.id, receipt);
    setStatusPending(task.id, true);
    try {
      const result = await transitionTask(transition.command, task.id, task.version, { idempotencyKey: receipt.key });
      statusReceipts.current.delete(task.id);
      onTaskUpdated(result.task);
      setStatusFeedback({ taskId: task.id, version: result.task.version });
      onAnnounce(`${task.title}: ${taskStatusMeta[result.task.status].label}`);
    } catch (caught) {
      onAnnounce(caught instanceof BackendCommandError && caught.code === "STALE_TASK_VERSION"
        ? `${task.title} changed elsewhere. Refresh and try again.`
        : `Could not change ${task.title}: ${caught instanceof Error ? caught.message : String(caught)}`);
    } finally {
      setStatusPending(task.id, false);
    }
  }

  function openDeleteDialog(): void {
    if (!activeTask) return;
    focusStack.push("delete", list.current);
    setDeletion({ task: activeTask, key: crypto.randomUUID() });
    setDeleteOpen(true);
  }

  homeShortcutActions.current = {
    hasActiveFilters,
    activeTask,
    activeTaskIndex,
    visibleRowCount: visibleRows.length,
    openDeleteDialog,
    clearStatusSequence,
    clearAllFilters: onClearAllFilters,
    startStatusSequence,
    applyExactStatus,
    openSearch: onOpenSearch,
    createTask: onCreate,
    toggleStatusPreset,
    applyPriorityFilter,
    toggleUnblockedFilter,
    clearCategoryFilter,
    openCategoryPicker: onOpenCategoryPicker,
    clearTagFilter,
    openTagPicker: onOpenTagPicker,
    addBlocker: onAddBlocker,
    moveUnder: onMoveUnder,
    toggleStatus,
    moveActive,
    handleHorizontalNavigation,
    editTask: onEdit,
  };

  // Keep one window listener so state changes cannot leave a gap between
  // removing an old listener and installing its replacement. The ref is
  // updated during render, so the listener always invokes current actions.
  useEffect(() => {
    function onWindowKeyDown(event: KeyboardEvent): void {
      const actions = homeShortcutActions.current;
      if (!actions) return;
      if (event.key === "Tab") {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.target === list.current || event.target === section.current) event.preventDefault();
        return;
      }
      if (document.querySelector('[role="dialog"]')) return;
      if (isHomeTypingTarget(event.target)) return;
      if (event.key === "Delete") {
        if (event.repeat || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        event.preventDefault();
        actions.openDeleteDialog();
        return;
      }
      if (event.key === "Escape") {
        // Escape resets the list: it cancels a pending Shift+S choice and
        // clears every filter. Focus stays put.
        event.preventDefault();
        const wasPending = statusSequence.current.pending;
        actions.clearStatusSequence();
        if (wasPending || actions.hasActiveFilters) actions.clearAllFilters();
        return;
      }
      if (event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey) return;
      // A pending Shift+S sequence takes precedence over single-key filters:
      // P means Paused and C means Canceled here, not category picker or create.
      if (statusSequence.current.pending) {
        if (event.repeat) return;
        const exact = EXACT_STATUS_BY_KEY.get(event.key.toLowerCase());
        if (exact) {
          event.preventDefault();
          actions.applyExactStatus(exact);
          return;
        }
        // Any other key cancels the sequence and falls through to normal handling.
        actions.clearStatusSequence();
      }
      if (event.key === "/") {
        if (event.repeat) return;
        event.preventDefault();
        actions.openSearch();
      } else if (event.key.toLowerCase() === "n") {
        if (event.repeat) return;
        event.preventDefault();
        actions.createTask(event.shiftKey ? actions.activeTask?.id : undefined);
      } else if (event.key.toLowerCase() === "s" && !event.repeat) {
        event.preventDefault();
        if (event.shiftKey) actions.startStatusSequence();
        else actions.toggleStatusPreset();
      } else if (event.key.toLowerCase() === "a") {
        if (event.repeat || event.shiftKey) return;
        event.preventDefault();
        actions.toggleStatusPreset();
      } else if (event.key >= "0" && event.key <= "4" && !event.shiftKey) {
        if (event.repeat) return;
        event.preventDefault();
        actions.applyPriorityFilter(Number(event.key) as TaskPriority);
      } else if (event.key.toLowerCase() === "u") {
        if (event.repeat || event.shiftKey) return;
        event.preventDefault();
        actions.toggleUnblockedFilter();
      } else if (event.key.toLowerCase() === "c" && !event.shiftKey) {
        if (event.repeat) return;
        event.preventDefault();
        actions.openCategoryPicker();
      } else if (event.key.toLowerCase() === "t") {
        if (event.repeat) return;
        event.preventDefault();
        if (event.shiftKey) actions.clearTagFilter();
        else actions.openTagPicker();
      } else if (event.key.toLowerCase() === "b") {
        if (event.repeat || event.shiftKey) return;
        event.preventDefault();
        if (actions.activeTask) actions.addBlocker(actions.activeTask);
      } else if (event.key.toLowerCase() === "m") {
        if (event.repeat || event.shiftKey) return;
        event.preventDefault();
        if (actions.activeTask) actions.moveUnder(actions.activeTask);
      } else if (event.key === " ") {
        if (event.repeat || event.shiftKey || isNativeButtonAction(event.target)) return;
        event.preventDefault();
        if (actions.activeTask) void actions.toggleStatus(actions.activeTask);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        actions.moveActive(actions.activeTaskIndex + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        actions.moveActive(actions.activeTaskIndex - 1);
      } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        actions.handleHorizontalNavigation(event.key);
      } else if (event.key === "Home") {
        event.preventDefault();
        actions.moveActive(0);
      } else if (event.key === "End") {
        event.preventDefault();
        actions.moveActive(actions.visibleRowCount - 1);
      } else if (event.key === "Enter") {
        if (isNativeButtonAction(event.target)) return;
        event.preventDefault();
        if (actions.activeTask) actions.editTask(actions.activeTask);
      }
    }
    window.addEventListener("keydown", onWindowKeyDown, true);
    return () => window.removeEventListener("keydown", onWindowKeyDown, true);
  }, []);

  const statusActive = exactStatus !== null || statusPreset === "inactive";
  const statusLabel = exactStatus !== null
    ? EXACT_STATUS_META.find((entry) => entry.status === exactStatus)?.label ?? exactStatus
    : statusPreset === "active" ? "Active" : "Inactive";
  const priorityLabel = priorityFilter !== null
    ? PRIORITY_META.find((meta) => meta.value === priorityFilter)?.shortLabel ?? `P${priorityFilter}`
    : "Priority";
  const tagLabel = tagFilter.length > 0 ? `${tagFilter.length} tag${tagFilter.length === 1 ? "" : "s"}` : "Tags";
  const searchActive = searchQuery.trim() !== "";
  const summaryStatus = statusLabel.toLowerCase();
  const summaryTags = tagFilter.length > 2
    ? `#${tagFilter[0].label} +${tagFilter.length - 1} tags`
    : tagFilter.length > 0 ? tagFilter.map((tag) => `#${tag.label}`).join(" ") : null;
  const summaryTaskCount = visibleRows.length;
  const filterSummary = [
    `${summaryTaskCount} ${summaryStatus} ${summaryTaskCount === 1 ? "task" : "tasks"}`,
    priorityFilter !== null ? priorityLabel : null,
    categoryFilter ? `@${categoryFilter.label}` : null,
    summaryTags,
    searchActive ? `“${searchQuery.trim()}”` : null,
    showUnblocked ? "unblocked" : null,
  ].filter((part): part is string => part !== null).join(" · ");
  const isFilteredEmpty = !loading && !error && visibleRows.length === 0 && (hasActiveFilters || total > 0);
  const showListSurface = !error && (visibleRows.length > 0 || isFilteredEmpty || listFocused || (!initialHomeFocusPending.current && loading));

  return (
    <section
      ref={section}
      tabIndex={-1}
      aria-label="Saved tasks"
      aria-keyshortcuts="Escape N Shift+N S A U C T B M Space Delete ArrowLeft ArrowRight 0 1 2 3 4 /"
      onFocus={(event) => {
        if (event.target === event.currentTarget && visibleRows.length > 0) list.current?.focus();
      }}
      className="flex flex-col gap-4"
      onMouseDown={(event) => {
        if (event.target instanceof HTMLElement && event.target.closest('[tabindex="-1"]')) preventFocusSteal(event);
      }}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Button
            size="sm"
            tabIndex={-1}
            aria-keyshortcuts="N"
            onClick={() => onCreate()}
          >
            <Plus aria-hidden="true" />
            New task
          </Button>
          <ButtonGroup aria-label="Task list filters">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={statusActive ? "outline" : "ghost"}
                className={statusActive ? ACTIVE_FILTER_CLASS : undefined}
                size="icon-sm"
                tabIndex={-1}
                aria-label={exactStatus !== null ? `Status filter: ${statusLabel}. Open status menu.` : `Status filter: ${statusLabel}. Open status menu or press S to toggle.`}
                aria-pressed={statusActive}
                aria-keyshortcuts="S"
                data-filter="task-status"
                onClick={onOpenStatusMenu}
              />
            }
          >
            <Circle aria-hidden="true" />
            <span className="sr-only">{`Status: ${statusLabel}`}</span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>{statusLabel}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={priorityFilter !== null ? "outline" : "ghost"}
                className={priorityFilter !== null ? ACTIVE_FILTER_CLASS : undefined}
                size="icon-sm"
                tabIndex={-1}
                aria-label={priorityFilter !== null ? `Priority filter: ${priorityLabel}. Open priority menu.` : "Filter by priority"}
                aria-pressed={priorityFilter !== null}
                aria-keyshortcuts="0 1 2 3 4"
                data-filter="task-priority"
                onClick={onOpenPriorityMenu}
              />
            }
          >
            <Flag aria-hidden="true" />
            <span className="sr-only">{`Priority: ${priorityLabel}`}</span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>{priorityLabel}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={categoryFilter ? "outline" : "ghost"}
                className={categoryFilter ? ACTIVE_FILTER_CLASS : undefined}
                size="icon-sm"
                tabIndex={-1}
                aria-label={categoryFilter ? `Clear category filter: ${categoryFilter.label}` : "Filter by category"}
                aria-pressed={categoryFilter !== null}
                aria-keyshortcuts="C"
                data-filter="task-category"
                onClick={toggleCategoryFilter}
              />
            }
          >
            <Folder aria-hidden="true" />
            <span className="sr-only">{categoryFilter ? `Clear category filter: ${categoryFilter.label}` : "Filter by category"}</span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>{categoryFilter ? categoryFilter.label : "Category"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={tagFilter.length > 0 ? "outline" : "ghost"}
                className={tagFilter.length > 0 ? ACTIVE_FILTER_CLASS : undefined}
                size="icon-sm"
                tabIndex={-1}
                aria-label={tagFilter.length > 0 ? `Tag filter: ${tagFilter.map((tag) => tag.label).join(", ")}. Open tag picker.` : "Filter by tags"}
                aria-pressed={tagFilter.length > 0}
                aria-keyshortcuts="T"
                data-filter="task-tags"
                onClick={onOpenTagPicker}
              />
            }
          >
            <Tags aria-hidden="true" />
            <span className="sr-only">{`Tags: ${tagLabel}`}</span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>{tagFilter.length > 0 ? tagFilter.map((tag) => tag.label).join(", ") : "Tags"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={searchActive ? "outline" : "ghost"}
                className={searchActive ? ACTIVE_FILTER_CLASS : undefined}
                size="icon-sm"
                tabIndex={-1}
                aria-label={searchActive ? `Search: ${searchQuery.trim()}. Open search or clear.` : "Search tasks"}
                aria-pressed={searchActive}
                aria-keyshortcuts="/"
                data-filter="task-search"
                onClick={onOpenSearch}
              />
            }
          >
            <Search aria-hidden="true" />
            <span className="sr-only">{searchActive ? `Search: ${searchQuery.trim()}` : "Search"}</span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>{searchActive ? searchQuery.trim() : "Search"}</TooltipContent>
        </Tooltip>
        <Tooltip open={unblockedFeedbackOpen} onOpenChange={setUnblockedFeedbackOpen}>
          <TooltipTrigger
            render={
              <Button
                variant={showUnblocked ? "outline" : "ghost"}
                className={showUnblocked ? ACTIVE_FILTER_CLASS : undefined}
                size="icon-sm"
                tabIndex={-1}
                aria-label={showUnblocked ? "Show all tasks" : "Show unblocked tasks"}
                aria-pressed={showUnblocked}
                aria-keyshortcuts="U"
                data-filter="task-unblocked"
                onClick={toggleUnblockedFilter}
              />
            }
          >
            <ShieldBan aria-hidden="true" />
            <span className="sr-only">{showUnblocked ? "Show all tasks" : "Show unblocked tasks"}</span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>{showUnblocked ? "Unblocked" : "All tasks"}</TooltipContent>
        </Tooltip>
          </ButtonGroup>
        </div>
        <p
          data-filter-summary
          aria-live="polite"
          aria-atomic="true"
          title={filterSummary}
          className="truncate text-xs leading-4 text-muted-foreground"
        >
          {filterSummary}
        </p>
      </div>
      {error ? <Alert variant="destructive">
        <AlertTitle>Could not load tasks</AlertTitle>
        <AlertDescription>
          <p>{error}</p>
          <Button
            ref={retry}
            variant="outline"
            size="sm"
            onClick={() => void onRefresh()}
          >Retry</Button>
        </AlertDescription>
      </Alert> : null}
      {showListSurface ? (
        <div
          ref={list}
          role="listbox"
          aria-label={visibleRows.length ? `Tasks, ${visibleRows.length} visible of ${total}` : "Tasks, no visible matches"}
          aria-orientation="vertical"
          aria-keyshortcuts="Escape N Shift+N S A U C T B M Space Delete ArrowLeft ArrowRight 0 1 2 3 4 /"
          aria-activedescendant={activeTask ? `task-option-${activeTask.id}` : undefined}
          tabIndex={0}
          className="flex w-full flex-col gap-2 outline-none"
          onFocus={() => setListFocused(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setListFocused(false);
          }}
        >
          {visibleRows.map((row, index) => {
            const { task } = row;
            const active = index === clampedActiveIndex;
            const blockedByLabels = task.blockedByIds.map((id) => {
              const blocker = tasks.find((candidate) => candidate.id === id);
              return blocker ? taskTitleDisplay(blocker.title) : null;
            }).filter((label): label is string => label !== null);
            const DisclosureIcon = expandedIds.has(task.id) ? ChevronDown : ChevronRight;
            return (
              <Item
                key={task.id}
                id={`task-option-${task.id}`}
                role="option"
                aria-selected={active}
                aria-expanded={row.hasChildren ? expandedIds.has(task.id) : undefined}
                tabIndex={-1}
                data-active={active || undefined}
                data-depth={row.depth}
                size="sm"
                variant={active ? "outline" : "default"}
                className={active ? "border-ring bg-muted" : undefined}
                onClick={() => onEdit(task)}
                onMouseEnter={() => onActiveTaskIndexChange(index)}
              >
                <TaskRow
                  task={task}
                  variant="full"
                  indented={row.depth === 1}
                  blockedByLabels={blockedByLabels}
                  statusSlot={
                    <TaskStatusToggle
                      task={task}
                      pending={statusPendingIds.has(task.id)}
                      feedbackVersion={statusFeedback?.taskId === task.id ? statusFeedback.version : undefined}
                      nextLabel={taskStatusMeta[taskStatusTransition[task.status].next].label}
                      onToggle={(nextTask) => void toggleStatus(nextTask)}
                    />
                  }
                />
                {row.hasChildren ? (
                  <span
                    role="img"
                    aria-label={expandedIds.has(task.id) ? "Collapse children" : "Expand children"}
                    className="inline-flex size-7 shrink-0 self-center items-center justify-center text-muted-foreground"
                    onMouseDown={preventFocusSteal}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleExpanded(row);
                    }}
                  >
                    <DisclosureIcon aria-hidden="true" className="size-4" />
                  </span>
                ) : null}
              </Item>
            );
          })}
          {isFilteredEmpty ? (
            <Item
              data-empty-state="filtered"
              size="sm"
              className="min-h-16 border-dashed border-border bg-transparent"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">No tasks match the current filters</p>
                <p className="mt-1 text-sm text-muted-foreground">Try different filters or clear them.</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                tabIndex={-1}
                onClick={() => {
                  onClearAllFilters();
                  list.current?.focus();
                }}
              >Clear filters</Button>
            </Item>
          ) : null}
        </div>
      ) : !loading && !error ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No tasks yet</EmptyTitle>
            <EmptyDescription>Press N or choose New task to capture.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      {loading ? <p role="status" className="text-sm text-muted-foreground">Loading tasks…</p> : null}
      {statusSequence.current.pending ? (
        <p role="status" className="text-xs text-muted-foreground">Status: press O, I, D, P, or C (Esc cancels).</p>
      ) : null}
      <Tooltip open={filterFeedbackOpen} onOpenChange={setFilterFeedbackOpen}>
        <TooltipTrigger render={<span className="sr-only">Status filter feedback</span>} />
        <TooltipContent side="top" sideOffset={8}>{exactStatus !== null ? (EXACT_STATUS_META.find((entry) => entry.status === exactStatus)?.label ?? exactStatus) : statusPreset === "active" ? "Active" : "Inactive"}</TooltipContent>
      </Tooltip>
      {hasMore ? (
        <Button
          ref={loadMore}
          variant="ghost"
          disabled={loading}
          onClick={() => void onRefresh(tasks.length)}
        >Load more tasks</Button>
      ) : null}
      {deletion ? <TaskDeleteDialog
        key={deletion.key}
        task={deletion.task}
        open={deleteOpen}
        onClose={() => { setDeleteOpen(false); void onRefresh(); }}
        onCanceled={onCanceled}
        returnFocus={() => focusStack.restore("delete")
          ?? (list.current?.isConnected
            ? list.current
            : section.current ?? undefined)}
      /> : null}
    </section>
  );
}
