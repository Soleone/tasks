import {
  Fragment,
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { ArrowDown, ArrowDownUp, ArrowUp, ChevronDown, ChevronRight, Circle, Clock3, Flag, Folder, ListChevronsUpDown, ListOrdered, Plus, RotateCcwClock, Search, ShieldCheck, Tags } from "lucide-react";
import type { ClassificationToken, TagRecord, TaskPriority, TaskRecord, TaskStatus, TaskTransitionCommand } from "@/backend/protocol";
import { stripClassificationTokens } from "@/backend/taskText";
import { EXACT_STATUS_META, PRIORITY_META, taskStatusMeta, type SortDirection, type SortField, type StatusPreset } from "@/components/taskFilters";
import { TaskRow, TaskStatusDisplay, TaskStatusToggle, taskContextMessage, taskTitleDisplay } from "@/components/TaskRow";
import { TaskListModeHelp } from "@/components/TaskListModeHelp";
import { TaskComposer, type ComposerState, type TaskCreateDraft } from "@/components/TaskComposer";
import { visibleTaskRows, type VisibleTaskRow } from "@/components/taskTree";
import { placementForMove, placementTargetId, selectableSiblingRows, selectedRowsForReorder, selectionMembershipMatches, type TaskMoveDirection, type TaskMovePlacement } from "@/components/taskReordering";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Item } from "@/components/ui/item";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { preventFocusSteal, type Navigator } from "@/navigation";
import { BackendCommandError, deleteTask, reorderTasks, transitionTask, transitionTasks, updateTask, type TaskMutationResult } from "@/platform/backendClient";
import { APP_NAME } from "@/backend/branding";
import type { KeyboardHelpMode } from "@/keyboardHelp";

type StatusCommand = "task.start" | "task.pause" | "task.complete" | "task.reopen";
type StatusTransition = { next: TaskStatus; command: StatusCommand };
type ToolbarMode = "filter" | "sort";
type FilterSummaryFilter = "status" | "category" | "priority" | "tags" | "search" | "unblocked";
type FilterSummaryPart = {
  filter: Exclude<FilterSummaryFilter, "status" | "category">;
  value: string;
  label: string;
  onClear: () => void;
};

function FilterSummaryAction({ filter, label, onClear, className, children }: {
  filter: FilterSummaryFilter;
  label: string;
  onClear: () => void;
  className?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      tabIndex={-1}
      data-filter-remove={filter}
      aria-label={label}
      title={label}
      onMouseDown={preventFocusSteal}
      onClick={onClear}
      className={`cursor-pointer rounded-sm focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:focus-ring ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

export async function copyTaskText(task: TaskRecord): Promise<void> {
  const text = [task.title, task.descriptionMarkdown]
    .map(stripClassificationTokens)
    .filter(Boolean)
    .join(" ");
  await navigator.clipboard.writeText(text);
}


// Paused is a separate pause/resume state, but both Space directions keep it
// reachable: forward completes it, while reverse returns it to in progress.
const forwardStatusTransition: Record<TaskStatus, StatusTransition> = {
  open: { next: "in_progress", command: "task.start" },
  in_progress: { next: "done", command: "task.complete" },
  paused: { next: "done", command: "task.complete" },
  done: { next: "open", command: "task.reopen" },
  canceled: { next: "open", command: "task.reopen" },
};

const reverseStatusTransition: Record<TaskStatus, StatusTransition> = {
  open: { next: "done", command: "task.complete" },
  in_progress: { next: "open", command: "task.reopen" },
  paused: { next: "in_progress", command: "task.start" },
  done: { next: "in_progress", command: "task.start" },
  canceled: { next: "open", command: "task.reopen" },
};

const EXACT_STATUS_BY_KEY = new Map(EXACT_STATUS_META.map((entry) => [entry.key.toLowerCase(), entry.status]));

// Home shortcuts work anywhere on the home surface, not only when the listbox
// is focused. Typing targets, the inline editor, and open dialogs always win.
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

export type TaskListHandle = {
  startIdentityPreservingRefresh: () => void;
  finishIdentityPreservingRefresh: () => void;
  clearActiveTaskSelection: () => void;
  getActiveTask: () => TaskRecord | undefined;
};

type TaskListProps = {
  tasks: TaskRecord[];
  newTaskId?: string | null;
  exitingTaskIds: ReadonlySet<string>;
  contextTasks: TaskRecord[];
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
  tagFilter: TagRecord[];
  onTagFilterChange: (tags: TagRecord[]) => void;
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
  optimisticTask: TaskRecord | null;
  onCloseComposer: () => void;
  onComposerSaved: (result: TaskMutationResult) => void;
  onCreatePending: (draft: TaskCreateDraft) => void;
  onCreateFailed: () => void;
  onRefresh: (offset?: number) => Promise<boolean>;
  onAnnounce: (message: string) => void;
  onToast: (message: string) => void;
  onEdit: (task: TaskRecord) => void;
  onTaskUpdated: (task: TaskRecord) => void;
  onTasksUpdated: (tasks: TaskRecord[]) => void;
  onOperation?: (operationId: string, previous: TaskRecord[], current: TaskRecord[]) => void;
  onStatusChanged?: (previous: TaskRecord, current: TaskRecord, wasActive: boolean) => void;
  onStatusBatchChanged?: (previous: TaskRecord[], current: TaskRecord[], wasActiveTaskId: string | null) => void;
  canUndoStatus?: boolean;
  onUndoStatus?: () => void;
  onCanceled: (task: TaskRecord) => void;
  onCanceledMany?: (previous: TaskRecord[], current: TaskRecord[]) => void;
  onAddBlocker: (task: TaskRecord) => void;
  onMoveUnder: (task: TaskRecord) => void;
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

export type ActiveTaskRequest = {
  key: number;
  taskId: string | null;
  preserveTaskOnRefresh: boolean;
};

type TaskOptionClick = (row: VisibleTaskRow, index: number, event: MouseEvent<HTMLDivElement>) => void;

type TaskOptionProps = {
  row: VisibleTaskRow;
  index: number;
  active: boolean;
  selected: boolean;
  expanded: boolean;
  pending: boolean;
  feedbackVersion?: number;
  newTaskId?: string | null;
  exitingTaskIds: ReadonlySet<string>;
  showDetails: boolean;
  hiddenCategorySlug: string | null;
  taskById: ReadonlyMap<string, TaskRecord>;
  onClick: TaskOptionClick;
  onToggleStatus: (task: TaskRecord) => void;
  onToggleExpanded: (row: VisibleTaskRow) => void;
  onSelectCategory: (category: ClassificationToken) => void;
};

const TaskOption = memo(function TaskOption({
  row,
  index,
  active,
  selected,
  expanded,
  pending,
  feedbackVersion,
  newTaskId,
  exitingTaskIds,
  showDetails,
  hiddenCategorySlug,
  taskById,
  onClick,
  onToggleStatus,
  onToggleExpanded,
  onSelectCategory,
}: TaskOptionProps): ReactElement {
  const { task } = row;
  const blockedByLabels = task.blockedByIds.map((id) => {
    const blocker = taskById.get(id);
    return blocker ? taskTitleDisplay(blocker.title) : null;
  }).filter((label): label is string => label !== null);
  const DisclosureIcon = expanded ? ChevronDown : ChevronRight;

  return (
    <Item
      id={`task-option-${task.id}`}
      role="option"
      aria-selected={selected}
      aria-expanded={row.hasChildren ? expanded : undefined}
      aria-label={row.contextOnly ? `${taskTitleDisplay(task.title)}, ${taskContextMessage(task)}` : undefined}
      tabIndex={-1}
      data-active={active || undefined}
      data-selected={selected || undefined}
      data-context-parent={row.contextOnly || undefined}
      data-depth={row.depth}
      data-new-task={task.id === newTaskId || undefined}
      data-canceled-task={exitingTaskIds.has(task.id) || undefined}
      size="sm"
      variant={active && !selected ? "outline" : "default"}
      state={selected
        ? "selected"
        : active
          ? "active"
          : row.contextOnly ? "context" : undefined}
      onClick={(event) => onClick(row, index, event)}
    >
      <TaskRow
        task={task}
        variant="full"
        indented={row.depth === 1}
        blockedByLabels={blockedByLabels}
        showDetails={showDetails}
        contextOnly={row.contextOnly}
        hiddenCategorySlug={hiddenCategorySlug}
        onSelectCategory={onSelectCategory}
        statusSlot={
          <TaskStatusToggle
            task={task}
            pending={pending}
            feedbackVersion={feedbackVersion}
            nextLabel={taskStatusMeta[forwardStatusTransition[task.status].next].label}
            previousLabel={taskStatusMeta[reverseStatusTransition[task.status].next].label}
            onToggle={onToggleStatus}
          />
        }
      />
      {row.hasChildren ? (
        <span
          role="img"
          aria-label={expanded ? "Collapse children" : "Expand children"}
          className="inline-flex size-7 shrink-0 self-center items-center justify-center text-muted-foreground"
          onMouseDown={preventFocusSteal}
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpanded(row);
          }}
        >
          <DisclosureIcon aria-hidden="true" className="size-4" />
        </span>
      ) : null}
    </Item>
  );
});

type HomeShortcutActions = {
  hasActiveFilters: boolean;
  activeTask: TaskRecord | undefined;
  visibleRowCount: number;
  canUndoStatus: boolean;
  undoStatus: () => void;
  deleteActiveTask: () => Promise<void>;
  deleteSelectedTasks: () => Promise<void>;
  returnToList: () => void;
  clearAllFilters: () => void;
  startFilterMode: () => void;
  startSortMode: () => void;
  applyExactStatus: (status: TaskStatus) => void;
  applySortField: (field: SortField) => void;
  reverseSort: () => void;
  toggleDetailsView: () => void;
  setPriority: (task: TaskRecord, priority: TaskPriority) => Promise<void>;
  announce: (message: string) => void;
  openSearch: () => void;
  createTask: (parentId?: string) => void;
  toggleStatusPreset: () => void;
  applyPriorityFilter: (priority: TaskPriority) => void;
  toggleUnblockedFilter: () => void;
  openCategoryPicker: () => void;
  openTagPicker: () => void;
  addBlocker: (task: TaskRecord) => void;
  moveUnder: (task: TaskRecord) => void;
  toggleStatus: (task: TaskRecord) => Promise<void>;
  toggleSelectedStatus: () => Promise<void>;
  reverseStatus: (task: TaskRecord) => Promise<void>;
  reverseSelectedStatus: () => Promise<void>;
  pauseTask: (task: TaskRecord) => Promise<void>;
  pauseSelectedTasks: () => Promise<void>;
  moveActive: (next: number | "next" | "previous", extend?: boolean) => void;
  selectBoundary: (end: "start" | "end") => void;
  reorderSelection: (direction: TaskMoveDirection) => Promise<void>;
  clearSelection: () => boolean;
  handleHorizontalNavigation: (key: "ArrowLeft" | "ArrowRight") => void;
  editTask: (task: TaskRecord) => void;
  copyTask: (task: TaskRecord) => Promise<void>;
};

const TOGGLE_FEEDBACK_DURATION_MS = 900;

function InlineTaskComposer({ composer, onClose, onSaved, onCreatePending, onCreateFailed, helpMode, onDisableHelp, inList = false }: {
  composer: ComposerState;
  onClose: () => void;
  onSaved: (result: TaskMutationResult) => void;
  onCreatePending: (draft: TaskCreateDraft) => void;
  onCreateFailed: () => void;
  helpMode: KeyboardHelpMode;
  onDisableHelp: () => void;
  inList?: boolean;
}): ReactElement {
  const task = composer.mode === "edit" ? composer.task : undefined;
  const parentId = composer.mode === "create" ? composer.parentId : undefined;
  const initialTitle = composer.mode === "create" ? composer.initialTitle : undefined;

  return (
    <Item
      role="group"
      aria-label={task ? `Editing ${taskTitleDisplay(task.title)}` : "New task inline"}
      data-inline-task-editor
      state="selected"
      size="sm"
      className={inList ? "w-full shrink-0" : "w-full max-h-[50vh] overflow-y-auto"}
    >
      <TaskComposer
        key={task ? task.id : `create-${parentId ?? "root"}`}
        task={task}
        parentId={parentId}
        initialTitle={initialTitle}
        onSaved={onSaved}
        onCreatePending={onCreatePending}
        onCreateFailed={onCreateFailed}
        onCancel={onClose}
        helpMode={helpMode}
        onDisableHelp={onDisableHelp}
      />
    </Item>
  );
}

export const TaskList = forwardRef<TaskListHandle, TaskListProps>(function TaskList({
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
}: TaskListProps, ref): ReactElement {
  const section = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const filterToolbar = useRef<HTMLDivElement>(null);
  const sortToolbar = useRef<HTMLDivElement>(null);
  const statusFilterButton = useRef<HTMLButtonElement>(null);
  const loadMore = useRef<HTMLButtonElement>(null);
  const initialHomeFocusPending = useRef(true);
  const retry = useRef<HTMLButtonElement>(null);
  const statusReceipts = useRef(new Map<string, StatusReceipt>());
  const batchTransitionReceiptRef = useRef<{ signature: string; key: string } | null>(null);
  const deleteReceipts = useRef(new Map<string, DeleteReceipt>());
  const deletePending = useRef(new Set<string>());
  const priorityReceipts = useRef(new Map<string, { version: number; key: string }>());
  const mutationPending = useRef(new Set<string>());
  const toolbarModeRef = useRef<ToolbarMode | null>(null);
  const homeShortcutActions = useRef<HomeShortcutActions | null>(null);
  const [listFocused, setListFocused] = useState(false);
  const [activeTaskIndex, setActiveTaskIndexState] = useState(0);
  const composerOpenRef = useRef(composer !== null);
  const previousComposerOpenRef = useRef(composer !== null);
  composerOpenRef.current = composer !== null;
  const [mutationPendingIds, setMutationPendingIds] = useState<Set<string>>(() => new Set());
  const [toolbarMode, setToolbarMode] = useState<ToolbarMode | null>(null);
  const [statusFeedback, setStatusFeedback] = useState<{ taskId: string; version: number } | null>(null);
  const [filterFeedbackVersion, setFilterFeedbackVersion] = useState(0);
  const [filterFeedbackOpen, setFilterFeedbackOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [unblockedFeedbackVersion, setUnblockedFeedbackVersion] = useState(0);
  const [unblockedFeedbackOpen, setUnblockedFeedbackOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [moveControlsOpen, setMoveControlsOpen] = useState(false);
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
  const activeTaskRequestTasksRef = useRef<TaskRecord[] | null>(null);
  const preserveActiveTaskOnRefreshRef = useRef(false);
  const activeTaskIdRef = useRef<string | null>(null);
  const activeTaskRef = useRef<TaskRecord | undefined>(undefined);
  const lastSelectedNewTaskIdRef = useRef<string | null>(null);
  const activeScrollFrameRef = useRef<number | null>(null);
  const activeScrollTargetRef = useRef<string | null>(null);
  const optionClickRef = useRef<TaskOptionClick>(() => undefined);
  const optionToggleStatusRef = useRef<(task: TaskRecord) => void>(() => undefined);
  const optionToggleExpandedRef = useRef<(row: VisibleTaskRow) => void>(() => undefined);
  const optionSelectCategoryRef = useRef<(category: ClassificationToken) => void>(() => undefined);
  const reorderPending = useRef(false);
  const reorderReceipt = useRef<{ signature: string; key: string } | null>(null);

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

  const visibleRows = useMemo(() => visibleTaskRows(tasks, expandedIds, contextTasks, contextOrder), [tasks, expandedIds, contextTasks, contextOrder]);
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  // A pending keyboard move belongs to the view it was made in. Filter and
  // sort changes must not let that stale task override the new active index.
  const filterIdentity = [
    statusPreset,
    exactStatus ?? "",
    priorityFilter ?? "",
    tagFilter.map((tag) => tag.slug).join(","),
    searchQuery,
    showUnblocked ? "1" : "0",
    categoryFilter?.slug ?? "",
  ].join("|");
  const viewIdentity = [filterIdentity, sortField, sortDirection].join("|");
  const hasMore = tasks.length < total;
  // The active row is list state, not focus state, so it survives toolbar
  // clicks and empty-area focus loss. Focus stays a screen-reader concern.
  const clampedActiveIndex = visibleRows.length ? Math.min(activeTaskIndex, visibleRows.length - 1) : 0;
  const pendingActiveIndex = pendingActiveIdRef.current === null || pendingActiveViewRef.current !== viewIdentity
    ? -1
    : visibleRows.findIndex((row) => row.task.id === pendingActiveIdRef.current);
  // Hierarchy moves change row positions; follow the active task by identity.
  const identityActiveIndex = activeTaskIdRef.current === null
    ? -1
    : visibleRows.findIndex((row) => row.task.id === activeTaskIdRef.current);
  const activeIndex = pendingActiveIndex >= 0
    ? pendingActiveIndex
    : identityActiveIndex >= 0 ? identityActiveIndex : clampedActiveIndex;
  const activeRow = visibleRows.length ? visibleRows[activeIndex] : undefined;
  const activeTask = activeRow?.task;
  visibleRowsRef.current = visibleRows;
  selectedIdsRef.current = selectedIds;
  activeTaskIndexRef.current = activeIndex;
  activeTaskIdRef.current = activeTask?.id ?? null;
  activeTaskRef.current = activeTask;

  useImperativeHandle(ref, () => ({
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
  }), []);

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

    const selectableIds = new Set(visibleRows.filter((row) => !row.contextOnly).map((row) => row.task.id));
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

    const filterChanged = previousFilterIdentityRef.current !== null
      && previousFilterIdentityRef.current !== filterIdentity;
    previousFilterIdentityRef.current = filterIdentity;
    const requestedSelection = filterChanged
      ? new Set<string>()
      : restoreSelectionIdsRef.current ?? selectedIdsRef.current;
    // Apply the new-task selection once. The highlight id remains set briefly,
    // but it must not restore the selection after the user starts another create.
    if (newTaskId == null) lastSelectedNewTaskIdRef.current = null;
    const createdTaskId = newTaskId != null
      && newTaskId !== lastSelectedNewTaskIdRef.current
      && selectableIds.has(newTaskId)
      ? newTaskId
      : null;
    if (createdTaskId !== null) lastSelectedNewTaskIdRef.current = createdTaskId;
    const nextSelection = createdTaskId !== null
      ? new Set<string>([createdTaskId])
      : new Set([...requestedSelection].filter((id) => selectableIds.has(id)));
    if (createdTaskId !== null) {
      const createdTaskIndex = visibleRows.findIndex((row) => row.task.id === createdTaskId);
      if (createdTaskIndex >= 0 && createdTaskIndex !== activeTaskIndex) setActiveTaskIndex(createdTaskIndex);
    }
    const visibleActive = visibleRows[activeIndex];
    if (nextSelection.size === 0 && visibleActive && !visibleActive.contextOnly && !selectionClearedRef.current) nextSelection.add(visibleActive.task.id);
    const changed = nextSelection.size !== selectedIdsRef.current.size
      || [...nextSelection].some((id) => !selectedIdsRef.current.has(id));
    if (changed) setSelectedIds(nextSelection);
    selectedIdsRef.current = nextSelection;
    if (createdTaskId !== null) {
      selectionClearedRef.current = false;
      selectionAnchorRef.current = createdTaskId;
    } else if (filterChanged || selectionAnchorRef.current === null || !selectableIds.has(selectionAnchorRef.current)) {
      selectionAnchorRef.current = [...nextSelection][0] ?? null;
    }
    if (!identityRefreshPendingRef.current) restoreSelectionIdsRef.current = null;
  }, [activeIndex, activeTaskIndex, filterIdentity, newTaskId, onAnnounce, selectedIds, viewIdentity, visibleRows]);

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
      const taskDataChanged = activeTaskRequestTasksRef.current !== null
        && activeTaskRequestTasksRef.current !== tasks;
      const refreshApplied = preserveActiveTaskOnRefreshRef.current && taskDataChanged;
      if (requestChanged || refreshApplied) {
        const requestedIndex = visibleRows.findIndex((row) => row.task.id === activeTaskRequest.taskId);
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
  }, [activeTaskRequest.key, activeTaskRequest.preserveTaskOnRefresh, activeTaskRequest.taskId, tasks, visibleRows]);

  useEffect(() => () => {
    if (activeScrollFrameRef.current !== null) cancelAnimationFrame(activeScrollFrameRef.current);
  }, []);

  // The list owns its internal tail (load-more, retry); the navigator only
  // enters it through explicit navigation.
  useEffect(() => nav.register("list", {
    focusLast: () => (loadMore.current ?? list.current ?? retry.current ?? section.current)?.focus(),
  }), [nav]);

  useEffect(() => {
    const nextIndex = Math.min(activeTaskIndex, Math.max(visibleRows.length - 1, 0));
    if (nextIndex !== activeTaskIndex) setActiveTaskIndex(nextIndex);
  }, [activeTaskIndex, visibleRows.length]);

  useEffect(() => {
    const wasOpen = previousComposerOpenRef.current;
    previousComposerOpenRef.current = composer !== null;
    if (!wasOpen || composer !== null) return;
    const frame = requestAnimationFrame(() => {
      if (!composerOpenRef.current) (list.current ?? (error ? retry.current : section.current))?.focus();
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
    onAnnounce(mode === "filter"
      ? "Filter toolbar focused. Choose a filter, press F again, or press Escape to return to the task list."
      : "Sort toolbar focused. Choose a sort, press S again, or press Escape to return to the task list.");
  }

  function startFilterMode(): void {
    startToolbarMode("filter");
  }

  function startSortMode(): void {
    startToolbarMode("sort");
  }

  function focusListBeforeToolbarDialog(): void {
    if (!document.querySelector('[role="dialog"]') && !composerOpenRef.current) returnToList();
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
    onAnnounce(statusPreset === "active" && exactStatus === null ? "Showing inactive tasks" : "Showing active tasks");
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
    const anchorIndex = anchorId === null ? -1 : scope.findIndex((candidate) => candidate.task.id === anchorId);
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
    setSelection(scope.slice(start, end + 1).map((candidate) => candidate.task.id), anchorId);
    onAnnounce(`${count} task${count === 1 ? "" : "s"} selected`);
  }

  function scheduleActiveScroll(taskId: string): void {
    activeScrollTargetRef.current = taskId;
    if (activeScrollFrameRef.current !== null) return;
    activeScrollFrameRef.current = requestAnimationFrame(() => {
      activeScrollFrameRef.current = null;
      const targetId = activeScrollTargetRef.current;
      if (targetId !== null) document.getElementById(`task-option-${targetId}`)?.scrollIntoView({ block: "nearest" });
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
    const requestedIndex = typeof next === "number"
      ? next
      : currentIndex + (next === "next" ? 1 : -1);
    if (extend) {
      const current = visibleRows[currentIndex];
      if (!current || current.contextOnly) {
        onAnnounce("Selection is limited to visible sibling tasks.");
        return;
      }
      const scope = selectableSiblingRows(current, visibleRowsRef.current);
      const currentScopeIndex = scope.findIndex((candidate) => candidate.task.id === current.task.id);
      const step = requestedIndex > currentIndex ? 1 : -1;
      const target = scope[currentScopeIndex + step];
      if (!target) {
        onAnnounce(step > 0 ? "Selection is at the last sibling." : "Selection is at the first sibling.");
        return;
      }
      const targetIndex = visibleRows.findIndex((candidate) => candidate.task.id === target.task.id);
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

  async function copyActiveTask(task: TaskRecord): Promise<void> {
    try {
      await copyTaskText(task);
      onAnnounce(`Copied ${task.title}`);
      onToast("Task details copied to clipboard");
    } catch {
      onAnnounce("Could not copy the selected task.");
    }
  }

  function reorderDisabledReason(row: VisibleTaskRow | undefined): string | null {
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
    const sourceRow = sourceActiveId === undefined
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
          if (!await onRefresh(0)) {
            onAnnounce("Could not refresh tasks. No move was made.");
            return;
          }
        } catch {
          onAnnounce("Could not refresh tasks. No move was made.");
          return;
        }
        await waitForListRender();
        const refreshedRows = visibleRowsRef.current;
        const refreshedActive = refreshedRows.find((candidate) => candidate.task.id === sourceRow.task.id);
        if (!refreshedActive || refreshedActive.contextOnly) {
          onAnnounce("The selected task changed during refresh. No move was made.");
          return;
        }
        const refreshedSelected = selectedRowsForReorder(refreshedActive, refreshedRows, selectedIdsRef.current);
        if (!refreshedSelected || !selectionMembershipMatches(refreshedSelected, selectedIdSnapshot)) {
          onAnnounce("The selected task changed during refresh. No move was made.");
          return;
        }
        refreshedSelectionOrder = refreshedSelected;
        placement = placementForMove(direction, refreshedActive, refreshedSelected, refreshedRows);
      } else {
        placement = placementForMove(direction, sourceRow, sourceSelected, sourceRows);
      }
      if (!placement) {
        const boundary = direction === "up" || direction === "start" ? "Already at the beginning." : "Already at the end.";
        onAnnounce(switchedToManual ? `Switched to manual order. ${boundary}` : boundary);
        return;
      }

      const currentRows = visibleRowsRef.current;
      const currentActive = currentRows.find((candidate) => candidate.task.id === sourceRow.task.id);
      if (!currentActive || currentActive.contextOnly) {
        onAnnounce("The selected task changed during refresh. No move was made.");
        return;
      }
      const currentSelected = selectedRowsForReorder(currentActive, currentRows, selectedIdsRef.current);
      if (!currentSelected || !selectionMembershipMatches(currentSelected, selectedIdSnapshot)) {
        onAnnounce("The selected task changed during refresh. No move was made.");
        return;
      }
      const commandSelection = refreshedSelectionOrder === null
        ? currentSelected
        : refreshedSelectionOrder.map((row) => currentSelected.find((candidate) => candidate.task.id === row.task.id)).filter((row): row is VisibleTaskRow => row !== undefined);
      if (commandSelection.length !== currentSelected.length) {
        onAnnounce("The selected task changed during refresh. No move was made.");
        return;
      }
      const target = currentRows.find((candidate) => candidate.task.id === placementTargetId(placement));
      if (!target || target.contextOnly || target.task.parentId !== currentActive.task.parentId) {
        onAnnounce("The task or move target changed during refresh. No move was made.");
        return;
      }
      const commandTasks = commandSelection.map((candidate) => ({ id: candidate.task.id, expectedVersion: candidate.task.version }));
      const signature = JSON.stringify({ tasks: commandTasks, placement });
      const receipt = reorderReceipt.current?.signature === signature
        ? reorderReceipt.current
        : { signature, key: crypto.randomUUID() };
      reorderReceipt.current = receipt;
      currentSelected.forEach((candidate) => setMutationPending(candidate.task.id, true));
      try {
        const result = await reorderTasks(commandTasks, placement, { idempotencyKey: receipt.key });
        reorderReceipt.current = null;
        if (result.changed === false) {
          const boundary = direction === "up" || direction === "start" ? "Already at the beginning." : "Already at the end.";
          onAnnounce(switchedToManual ? `Switched to manual order. ${boundary}` : boundary);
          return;
        }
        if (result.operationId) onOperation?.(result.operationId, currentSelected.map((row) => row.task), result.tasks);
        restoreActiveIdRef.current = sourceRow.task.id;
        restoreSelectionIdsRef.current = new Set(selectedIdSnapshot);
        await onRefresh(0);
        await waitForListRender();
        const move = `${currentSelected.length} task${currentSelected.length === 1 ? "" : "s"} moved ${direction === "start" ? "to the beginning" : direction === "end" ? "to the end" : direction}.`;
        onAnnounce(switchedToManual ? `Switched to manual order. ${move}` : move);
        list.current?.focus();
      } catch (caught) {
        if (caught instanceof BackendCommandError && caught.code === "STALE_TASK_VERSION") {
          reorderReceipt.current = null;
          onAnnounce("A selected task changed elsewhere. Refresh and try again.");
          void onRefresh(0);
        } else if (caught instanceof BackendCommandError) {
          reorderReceipt.current = null;
          onAnnounce(caught.message);
        } else {
          onAnnounce(`Could not move the selected task${currentSelected.length === 1 ? "" : "s"}. Try again.`);
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
    const parentIndex = visibleRows.findIndex((candidate) => candidate.task.id === row.task.parentId);
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
        selectCategory(activeRow.task.category, activeRow.contextOnly ? undefined : activeRow.task.id);
      } else {
        onAnnounce(`${taskTitleDisplay(activeRow.task.title)} has no category to filter.`);
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

  function selectedTasksForAction(): TaskRecord[] {
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

  function batchTransitionReceipt(items: readonly { id: string; expectedVersion: number; command: TaskTransitionCommand }[]): { signature: string; key: string } {
    const signature = JSON.stringify(items);
    const existing = batchTransitionReceiptRef.current;
    if (existing?.signature === signature) return existing;
    const receipt = { signature, key: crypto.randomUUID() };
    batchTransitionReceiptRef.current = receipt;
    return receipt;
  }

  async function changeStatus(task: TaskRecord, transition: StatusTransition): Promise<void> {
    if (mutationPending.current.has(task.id)) return;
    const previousReceipt = statusReceipts.current.get(task.id);
    const receipt = previousReceipt?.version === task.version && previousReceipt.target === transition.next
      ? previousReceipt
      : { version: task.version, target: transition.next, key: crypto.randomUUID() };
    statusReceipts.current.set(task.id, receipt);
    setMutationPending(task.id, true);
    const wasActive = activeTask?.id === task.id;
    try {
      const result = await transitionTask(transition.command, task.id, task.version, { idempotencyKey: receipt.key });
      statusReceipts.current.delete(task.id);
      onTaskUpdated(result.task);
      if (result.changed !== false) {
        if (result.operationId) onOperation?.(result.operationId, [task], [result.task]);
        onStatusChanged?.(task, result.task, wasActive);
      }
      setStatusFeedback({ taskId: task.id, version: result.task.version });
      onAnnounce(`${task.title}: ${taskStatusMeta[result.task.status].label}`);
    } catch (caught) {
      onAnnounce(caught instanceof BackendCommandError && caught.code === "STALE_TASK_VERSION"
        ? `${task.title} changed elsewhere. Refresh and try again.`
        : `Could not change ${task.title}: ${caught instanceof Error ? caught.message : String(caught)}`);
    } finally {
      setMutationPending(task.id, false);
    }
  }

  async function transitionSelectedTasks(
    selected: TaskRecord[],
    commandForTask: (task: TaskRecord) => TaskTransitionCommand | null,
    actionLabel: string,
  ): Promise<void> {
    const items = selected
      .map((task) => {
        const command = commandForTask(task);
        return command ? { id: task.id, expectedVersion: task.version, command } : null;
      })
      .filter((item): item is { id: string; expectedVersion: number; command: TaskTransitionCommand } => item !== null);
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
      onAnnounce(`${result.tasks.length} task${result.tasks.length === 1 ? "" : "s"} ${actionLabel}`);
    } catch (caught) {
      if (caught instanceof BackendCommandError && caught.code === "STALE_TASK_VERSION") {
        batchTransitionReceiptRef.current = null;
        onAnnounce("A selected task changed elsewhere. Refresh and try again.");
        void onRefresh(0);
      } else {
        onAnnounce(caught instanceof Error ? caught.message : `Could not ${actionLabel} selected tasks.`);
      }
    } finally {
      setMutationPendingMany(selectedIds, false);
    }
  }

  function toggleStatus(task: TaskRecord): Promise<void> {
    return changeStatus(task, forwardStatusTransition[task.status]);
  }

  async function toggleSelectedStatus(): Promise<void> {
    const selected = selectedTasksForAction();
    if (selected.length === 0) return;
    if (selected.length === 1) {
      await toggleStatus(selected[0]);
      return;
    }
    await transitionSelectedTasks(selected, (task) => forwardStatusTransition[task.status].command, "updated");
  }

  function reverseStatus(task: TaskRecord): Promise<void> {
    return changeStatus(task, reverseStatusTransition[task.status]);
  }

  async function reverseSelectedStatus(): Promise<void> {
    const selected = selectedTasksForAction();
    if (selected.length === 0) return;
    if (selected.length === 1) {
      await reverseStatus(selected[0]);
      return;
    }
    await transitionSelectedTasks(selected, (task) => reverseStatusTransition[task.status].command, "updated");
  }

  function pauseTask(task: TaskRecord): Promise<void> {
    if (task.status === "done" || task.status === "canceled") {
      onAnnounce(`${task.title} is ${taskStatusMeta[task.status].label.toLowerCase()}. Reopen it before pausing.`);
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
    const eligible = selected.filter((task) => task.status !== "done" && task.status !== "canceled");
    if (eligible.length === 0) {
      onAnnounce("Done and canceled tasks cannot be paused.");
      return;
    }
    await transitionSelectedTasks(
      eligible,
      (task) => task.status === "paused" ? "task.start" : "task.pause",
      "updated",
    );
  }

  async function setTaskPriority(task: TaskRecord, priority: TaskPriority): Promise<void> {
    if (task.priority === priority || mutationPending.current.has(task.id)) return;
    const previousReceipt = priorityReceipts.current.get(task.id);
    const receipt = previousReceipt?.version === task.version
      ? previousReceipt
      : { version: task.version, key: crypto.randomUUID() };
    priorityReceipts.current.set(task.id, receipt);
    setMutationPending(task.id, true);
    try {
      const result = await updateTask(task.id, task.title, task.descriptionMarkdown, task.version, { priority, idempotencyKey: receipt.key });
      priorityReceipts.current.delete(task.id);
      onTaskUpdated(result.task);
      if (result.operationId) onOperation?.(result.operationId, [task], [result.task]);
      const label = PRIORITY_META.find((meta) => meta.value === priority)?.label ?? `P${priority}`;
      onAnnounce(`${taskTitleDisplay(task.title)}: priority ${label}`);
    } catch (caught) {
      onAnnounce(caught instanceof BackendCommandError && caught.code === "STALE_TASK_VERSION"
        ? `${task.title} changed elsewhere. Refresh and try again.`
        : `Could not change ${task.title}: ${caught instanceof Error ? caught.message : String(caught)}`);
    } finally {
      setMutationPending(task.id, false);
    }
  }

  async function deleteTaskRecord(task: TaskRecord): Promise<void> {
    if (deletePending.current.has(task.id)) return;
    const previousReceipt = deleteReceipts.current.get(task.id);
    const receipt = previousReceipt?.version === task.version
      ? previousReceipt
      : { version: task.version, key: crypto.randomUUID() };
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
      if (caught instanceof BackendCommandError && caught.code === "STALE_TASK_VERSION") {
        onAnnounce(`${task.title} changed elsewhere. Refresh and try again.`);
        void onRefresh();
      } else {
        onAnnounce(`Could not cancel ${task.title}: ${caught instanceof Error ? caught.message : String(caught)}`);
      }
    } finally {
      deletePending.current.delete(task.id);
    }
  }

  async function deleteActiveTask(): Promise<void> {
    if (!activeTask) return;
    await deleteTaskRecord(activeTask);
  }

  async function deleteSelectedTasks(): Promise<void> {
    const selected = selectedTasksForAction().filter((task) => !deletePending.current.has(task.id));
    if (selected.length === 0) return;
    if (selected.length === 1) {
      await deleteTaskRecord(selected[0]);
      return;
    }
    const items = selected.map((task) => ({ id: task.id, expectedVersion: task.version, command: "task.delete" as const }));
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
      if (caught instanceof BackendCommandError && caught.code === "STALE_TASK_VERSION") {
        batchTransitionReceiptRef.current = null;
        onAnnounce("A selected task changed elsewhere. Refresh and try again.");
        void onRefresh(0);
      } else {
        onAnnounce(caught instanceof Error ? caught.message : "Could not cancel the selected tasks.");
      }
    } finally {
      selectedIds.forEach((taskId) => deletePending.current.delete(taskId));
      setMutationPendingMany(selectedIds, false);
    }
  }

  optionClickRef.current = (row, index, event) => {
    if (composerOpenRef.current) return;
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
      const sameScope = scope.length > 0 && [...selectedIdsRef.current].every((id) => scope.some((candidate) => candidate.task.id === id));
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
  optionToggleStatusRef.current = (task) => { void toggleStatus(task); };
  optionToggleExpandedRef.current = toggleExpanded;
  optionSelectCategoryRef.current = selectCategory;
  const handleOptionClick = useCallback((row: VisibleTaskRow, index: number, event: MouseEvent<HTMLDivElement>): void => {
    optionClickRef.current(row, index, event);
  }, []);
  const handleOptionToggleStatus = useCallback((task: TaskRecord): void => {
    optionToggleStatusRef.current(task);
  }, []);
  const handleOptionToggleExpanded = useCallback((row: VisibleTaskRow): void => {
    optionToggleExpandedRef.current(row);
  }, []);
  const handleOptionSelectCategory = useCallback((category: ClassificationToken): void => {
    optionSelectCategoryRef.current(category);
  }, []);

  homeShortcutActions.current = {
    hasActiveFilters,
    activeTask,
    visibleRowCount: visibleRows.length,
    canUndoStatus: Boolean(canUndoStatus),
    undoStatus: () => onUndoStatus?.(),
    deleteActiveTask,
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
    announce: onAnnounce,
    openSearch,
    createTask: onCreate,
    toggleStatusPreset,
    applyPriorityFilter,
    toggleUnblockedFilter,
    openCategoryPicker,
    openTagPicker,
    addBlocker: onAddBlocker,
    moveUnder: onMoveUnder,
    toggleStatus,
    toggleSelectedStatus,
    reverseStatus,
    reverseSelectedStatus,
    pauseTask,
    pauseSelectedTasks,
    moveActive,
    selectBoundary,
    reorderSelection,
    clearSelection,
    handleHorizontalNavigation,
    editTask: onEdit,
    copyTask: copyActiveTask,
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
        if (toolbarModeRef.current !== null || event.target === list.current || event.target === section.current) event.preventDefault();
        return;
      }
      if (document.querySelector('[role="dialog"]') || composerOpenRef.current) return;
      if (isHomeTypingTarget(event.target)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (toolbarModeRef.current !== null) {
          actions.returnToList();
          return;
        }
        if (actions.clearSelection()) return;
        if (actions.hasActiveFilters) actions.clearAllFilters();
        return;
      }
      if (toolbarModeRef.current !== null && event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "t") {
        // Let the app-level theme shortcut continue, but make its modal return
        // target the task list rather than this temporary toolbar surface.
        actions.returnToList();
        return;
      }
      if (toolbarModeRef.current !== null && (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k") {
        // The help palette is another app-level shortcut with a modal return
        // target. Clear the toolbar first for the same reason as themes.
        actions.returnToList();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "z") {
        if (toolbarModeRef.current !== null) return;
        if (event.repeat || event.isComposing || event.keyCode === 229 || event.shiftKey) return;
        if (!actions.canUndoStatus) return;
        event.preventDefault();
        actions.undoStatus();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "c") {
        if (event.repeat || event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        if (actions.activeTask) void actions.copyTask(actions.activeTask);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
        const moveDirection = event.key === "ArrowUp"
          ? "up"
          : event.key === "ArrowDown"
            ? "down"
            : event.key === "Home"
              ? "start"
              : event.key === "End"
                ? "end"
                : null;
        if (moveDirection !== null) {
          if (event.repeat || event.isComposing || event.keyCode === 229) return;
          event.preventDefault();
          void actions.reorderSelection(moveDirection);
          return;
        }
      }
      if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.key === "ArrowUp") {
          event.preventDefault();
          actions.moveActive("previous", true);
          return;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          actions.moveActive("next", true);
          return;
        }
        if (event.key === "Home") {
          event.preventDefault();
          actions.selectBoundary("start");
          return;
        }
        if (event.key === "End") {
          event.preventDefault();
          actions.selectBoundary("end");
          return;
        }
      }
      if (event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey) return;

      // A toolbar mode owns the keyboard until an option is chosen or Escape
      // returns focus to the task list. It has no timeout or fall-through to
      // unrelated home shortcuts.
      const activeToolbarMode = toolbarModeRef.current;
      if (activeToolbarMode === "filter") {
        if (event.repeat) {
          event.preventDefault();
          return;
        }
        const key = event.key.toLowerCase();
        if (key === "f" && !event.shiftKey) {
          event.preventDefault();
          actions.returnToList();
          return;
        }
        if (key === "s" && !event.shiftKey) {
          event.preventDefault();
          actions.toggleStatusPreset();
          return;
        }
        if (!event.shiftKey) {
          const exact = EXACT_STATUS_BY_KEY.get(key);
          if (exact) {
            event.preventDefault();
            actions.applyExactStatus(exact);
            return;
          }
        }
        if (key >= "0" && key <= "4" && !event.shiftKey) {
          event.preventDefault();
          actions.applyPriorityFilter(Number(key) as TaskPriority);
          return;
        }
        if (key === "c" && !event.shiftKey) {
          event.preventDefault();
          actions.openCategoryPicker();
          return;
        }
        if (key === "t" && !event.shiftKey) {
          event.preventDefault();
          actions.openTagPicker();
          return;
        }
        if (key === "u" && !event.shiftKey) {
          event.preventDefault();
          actions.toggleUnblockedFilter();
          return;
        }
        if (key === "/" && !event.shiftKey) {
          event.preventDefault();
          actions.openSearch();
          return;
        }
        event.preventDefault();
        return;
      }
      if (activeToolbarMode === "sort") {
        if (event.repeat) {
          event.preventDefault();
          return;
        }
        const key = event.key.toLowerCase();
        if (key === "s" && !event.shiftKey) {
          event.preventDefault();
          actions.returnToList();
          return;
        }
        if (key === "c" && !event.shiftKey) {
          event.preventDefault();
          actions.applySortField("created");
          return;
        }
        if (key === "u" && !event.shiftKey) {
          event.preventDefault();
          actions.applySortField("updated");
          return;
        }
        if (key === "m" && !event.shiftKey) {
          event.preventDefault();
          actions.applySortField("manual");
          return;
        }
        if (key === "p" && !event.shiftKey) {
          event.preventDefault();
          actions.applySortField("priority");
          return;
        }
        if (key === "r" && !event.shiftKey) {
          event.preventDefault();
          actions.reverseSort();
          return;
        }
        event.preventDefault();
        return;
      }
      if (event.key === "Delete") {
        if (event.repeat || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        event.preventDefault();
        void actions.deleteSelectedTasks();
        return;
      }
      if (event.key === "/") {
        if (event.repeat) return;
        event.preventDefault();
        actions.openSearch();
      } else if (event.key === "@") {
        if (event.repeat) return;
        event.preventDefault();
        actions.openCategoryPicker();
      } else if (event.key === "#") {
        if (event.repeat) return;
        event.preventDefault();
        actions.openTagPicker();
      } else if (event.key.toLowerCase() === "c") {
        if (event.repeat) return;
        event.preventDefault();
        actions.createTask(event.shiftKey ? actions.activeTask?.id : undefined);
      } else if (event.key.toLowerCase() === "f" && !event.shiftKey) {
        if (event.repeat) return;
        event.preventDefault();
        actions.startFilterMode();
      } else if (event.key.toLowerCase() === "s" && !event.shiftKey) {
        if (event.repeat) return;
        event.preventDefault();
        actions.startSortMode();
      } else if (event.key.toLowerCase() === "v" && !event.shiftKey) {
        if (event.repeat) return;
        event.preventDefault();
        actions.toggleDetailsView();
      } else if (event.key >= "0" && event.key <= "4" && !event.shiftKey) {
        if (event.repeat) return;
        event.preventDefault();
        if (actions.activeTask) void actions.setPriority(actions.activeTask, Number(event.key) as TaskPriority);
      } else if (event.key.toLowerCase() === "b") {
        if (event.repeat || event.shiftKey) return;
        event.preventDefault();
        if (actions.activeTask) actions.addBlocker(actions.activeTask);
      } else if (event.key.toLowerCase() === "m") {
        if (event.repeat || event.shiftKey) return;
        event.preventDefault();
        if (actions.activeTask) actions.moveUnder(actions.activeTask);
      } else if (event.key.toLowerCase() === "p" && !event.shiftKey) {
        if (event.repeat) return;
        event.preventDefault();
        void actions.pauseSelectedTasks();
      } else if (event.key === " ") {
        if (event.repeat || isNativeButtonAction(event.target)) return;
        event.preventDefault();
        if (actions.activeTask) {
          void (event.shiftKey
            ? actions.reverseSelectedStatus()
            : actions.toggleSelectedStatus());
        }
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        actions.moveActive("next");
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        actions.moveActive("previous");
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
  // Descending is the default direction. The toggle is highlighted only
  // after reversing that default to ascending order.
  const reverseActive = sortField !== "manual" && sortDirection === "asc";
  const summaryStatus = statusLabel.toLowerCase();
  const summaryTags = tagFilter.length > 2
    ? `#${tagFilter[0].label} +${tagFilter.length - 1} tags`
    : tagFilter.length > 0 ? tagFilter.map((tag) => `#${tag.label}`).join(" ") : null;
  const summaryTaskCount = useMemo(() => visibleRows.reduce((count, row) => count + (row.contextOnly ? 0 : 1), 0), [visibleRows]) + (optimisticTask ? 1 : 0);
  const summaryBase = `${summaryTaskCount} ${summaryStatus} ${summaryTaskCount === 1 ? "task" : "tasks"}`;
  const statusIsDefault = statusPreset === "active" && exactStatus === null;
  const summarySuffixParts: FilterSummaryPart[] = [
    priorityFilter !== null ? {
      filter: "priority",
      value: priorityLabel,
      label: `Clear priority filter: ${priorityLabel}`,
      onClear: clearPriorityFilter,
    } : null,
    summaryTags !== null ? {
      filter: "tags",
      value: summaryTags,
      label: `Clear tag filters: ${tagFilter.map((tag) => `#${tag.label}`).join(" ")}`,
      onClear: clearTagFilter,
    } : null,
    searchActive ? {
      filter: "search",
      value: `“${searchQuery.trim()}”`,
      label: `Clear search filter: ${searchQuery.trim()}`,
      onClear: clearSearch,
    } : null,
    showUnblocked ? {
      filter: "unblocked",
      value: "unblocked",
      label: "Clear unblocked filter",
      onClear: toggleUnblockedFilter,
    } : null,
  ].filter((part): part is FilterSummaryPart => part !== null);
  const filterSummary = [
    summaryBase,
    categoryFilter ? categoryFilter.label : null,
    ...summarySuffixParts.map((part) => part.value),
  ].filter((part): part is string => part !== null).join(" · ");

  const isFilteredEmpty = !loading && !error && optimisticTask === null && visibleRows.length === 0 && (hasActiveFilters || total > 0);
  const showListSurface = (!error || optimisticTask !== null) && (optimisticTask !== null || visibleRows.length > 0 || isFilteredEmpty || listFocused || (!initialHomeFocusPending.current && loading));
  const visibleRowCount = visibleRows.length + (optimisticTask ? 1 : 0);
  const selectionCount = selectedIds.size;
  const selectionLabel = `${selectionCount} task${selectionCount === 1 ? "" : "s"} selected`;
  const moveSubjectLabel = selectionCount > 1 ? `selected tasks, ${selectionLabel}` : "active task";
  const reorderAvailabilityReason = reorderDisabledReason(activeRow);
  const editingTaskVisible = composer?.mode === "edit" && visibleRows.some((row) => row.task.id === composer.task.id);
  const editingActiveTask = composer?.mode === "edit" && composer.task.id === activeTask?.id;
  const listSelectionLabel = composer?.mode === "edit" && editingTaskVisible
    ? `editing ${taskTitleDisplay(composer.task.title)}`
    : selectionLabel;

  useEffect(() => {
    if (!optimisticTask) return;
    list.current?.focus();
    list.current?.scrollTo({ top: 0 });
  }, [optimisticTask?.id]);

  return (
    <section
      ref={section}
      tabIndex={-1}
      aria-label="Saved tasks"
      aria-keyshortcuts="Escape C Shift+C Enter S U T B M P Space Shift+Space Delete ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+Home Shift+End Control+c Meta+c Control+ArrowUp Control+ArrowDown Control+Home Control+End Meta+ArrowUp Meta+ArrowDown Meta+Home Meta+End 0 1 2 3 4 / @ # F O V Control+z Meta+z"
      onFocus={(event) => {
        if (event.target === event.currentTarget && visibleRows.length > 0) list.current?.focus();
      }}
      className="flex min-h-0 flex-1 flex-col gap-4"
      onMouseDown={(event) => {
        if (!(event.target instanceof HTMLElement)) return;
        const mouseOnlyControl = event.target.closest('[tabindex="-1"]');
        if (mouseOnlyControl && mouseOnlyControl !== event.currentTarget) preventFocusSteal(event);
      }}
    >
      <div className="flex shrink-0 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            size="sm"
            tabIndex={-1}
            aria-keyshortcuts="C"
            disabled={composer !== null}
            onClick={() => onCreate()}
          >
            <Plus aria-hidden="true" />
            New task
          </Button>
          <div className="flex flex-wrap items-center justify-end gap-1">
            <div className="relative">
              {toolbarMode === "filter" && helpMode !== "none" ? <TaskListModeHelp mode="filter" onDismiss={returnToList} onDisableHelp={onDisableHelp} /> : null}
              <ButtonGroup
            ref={filterToolbar}
            aria-label="Task list filters"
            aria-keyshortcuts="F S O I D P X 0 1 2 3 4 C T U /"
            tabIndex={-1}
            data-toolbar="filters"
            data-toolbar-active={toolbarMode === "filter" || undefined}
            toolbar
            toolbarActive={toolbarMode === "filter"}
            onFocus={() => activateToolbarMode("filter")}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) clearToolbarMode();
            }}
          >
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={categoryFilter ? "outline" : "ghost"}
                selected={categoryFilter !== null}
                size="icon-sm"
                tabIndex={-1}
                aria-label={categoryFilter ? `Clear category filter: ${categoryFilter.label}` : "Filter by category. Press @ or F then C."}
                aria-pressed={categoryFilter !== null}
                aria-keyshortcuts="@ C"
                data-filter="task-category"
                onClick={toggleCategoryFilter}
              />
            }
          >
            <Folder className={categoryFilter ? "text-success" : undefined} aria-hidden="true" />
            <span className="sr-only">{categoryFilter ? `Clear category filter: ${categoryFilter.label}` : "Filter by category"}</span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>{categoryFilter ? categoryFilter.label : "Category"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                ref={statusFilterButton}
                variant={statusActive ? "outline" : "ghost"}
                selected={statusActive}
                size="icon-sm"
                tabIndex={-1}
                aria-label={exactStatus !== null ? `Status filter: ${statusLabel}. Open status menu.` : `Status filter: ${statusLabel}. Open status menu or press F then S to toggle.`}
                aria-pressed={statusActive}
                aria-keyshortcuts="S"
                data-filter="task-status"
                onClick={openStatusMenu}
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
                selected={priorityFilter !== null}
                size="icon-sm"
                tabIndex={-1}
                aria-label={priorityFilter !== null ? `Priority filter: ${priorityLabel}. Open priority menu or press F then a number.` : "Filter by priority. Press F then 0-4."}
                aria-pressed={priorityFilter !== null}
                aria-keyshortcuts="0 1 2 3 4"
                data-filter="task-priority"
                onClick={openPriorityMenu}
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
                variant={tagFilter.length > 0 ? "outline" : "ghost"}
                selected={tagFilter.length > 0}
                size="icon-sm"
                tabIndex={-1}
                aria-label={tagFilter.length > 0 ? `Tag filter: ${tagFilter.map((tag) => tag.label).join(", ")}. Open tag picker.` : "Filter by tags. Press # or F then T."}
                aria-pressed={tagFilter.length > 0}
                aria-keyshortcuts="# T"
                data-filter="task-tags"
                onClick={openTagPicker}
              />
            }
          >
            <Tags aria-hidden="true" />
            <span className="sr-only">{`Tags: ${tagLabel}`}</span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>{tagFilter.length > 0 ? tagFilter.map((tag) => tag.label).join(", ") : "Tags"}</TooltipContent>
        </Tooltip>
        <Tooltip open={unblockedFeedbackOpen} onOpenChange={setUnblockedFeedbackOpen}>
          <TooltipTrigger
            render={
              <Button
                variant={showUnblocked ? "outline" : "ghost"}
                selected={showUnblocked}
                size="icon-sm"
                tabIndex={-1}
                aria-label={showUnblocked ? "Show all tasks. Press F then U." : "Show unblocked tasks. Press F then U."}
                aria-pressed={showUnblocked}
                aria-keyshortcuts="U"
                data-filter="task-unblocked"
                onClick={toggleUnblockedFilter}
              />
            }
          >
            <ShieldCheck aria-hidden="true" />
            <span className="sr-only">{showUnblocked ? "Show all tasks" : "Show unblocked tasks"}</span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>{showUnblocked ? "Unblocked" : "All tasks"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={searchActive ? "outline" : "ghost"}
                selected={searchActive}
                size="icon-sm"
                tabIndex={-1}
                aria-label={searchActive ? `Search: ${searchQuery.trim()}. Open search or clear.` : "Search tasks"}
                aria-pressed={searchActive}
                aria-keyshortcuts="/"
                data-filter="task-search"
                onClick={openSearch}
              />
            }
          >
            <Search aria-hidden="true" />
            <span className="sr-only">{searchActive ? `Search: ${searchQuery.trim()}` : "Search"}</span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>{searchActive ? searchQuery.trim() : "Search"}</TooltipContent>
        </Tooltip>
          </ButtonGroup>
            </div>
          <Separator orientation="vertical" className="h-7" />
          <div className="relative">
            {toolbarMode === "sort" && helpMode !== "none" ? <TaskListModeHelp mode="sort" onDismiss={returnToList} onDisableHelp={onDisableHelp} /> : null}
            <ButtonGroup
            ref={sortToolbar}
            aria-label="Task list sort"
            aria-keyshortcuts="S C U M R"
            tabIndex={-1}
            data-toolbar="sort"
            data-toolbar-active={toolbarMode === "sort" || undefined}
            toolbar
            toolbarActive={toolbarMode === "sort"}
            onFocus={() => activateToolbarMode("sort")}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) clearToolbarMode();
            }}
          >
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={sortField === "created" ? "outline" : "ghost"}
                selected={sortField === "created"}
                size="icon-sm"
                tabIndex={-1}
                aria-label={`Sort by created date. Press S then C.`}
                aria-pressed={sortField === "created"}
                aria-keyshortcuts="C"
                data-sort="task-sort-created"
                onClick={() => applySortField("created")}
              />
            }
          >
            <Clock3 aria-hidden="true" />
            <span className="sr-only">Sort by created</span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>Created</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={sortField === "updated" ? "outline" : "ghost"}
                selected={sortField === "updated"}
                size="icon-sm"
                tabIndex={-1}
                aria-label={`Sort by updated date. Press S then U.`}
                aria-pressed={sortField === "updated"}
                aria-keyshortcuts="U"
                data-sort="task-sort-updated"
                onClick={() => applySortField("updated")}
              />
            }
          >
            <RotateCcwClock aria-hidden="true" />
            <span className="sr-only">Sort by updated</span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>Updated</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={sortField === "priority" ? "outline" : "ghost"}
                selected={sortField === "priority"}
                size="icon-sm"
                tabIndex={-1}
                aria-label="Sort by priority. Press S then P."
                aria-pressed={sortField === "priority"}
                aria-keyshortcuts="P"
                data-sort="task-sort-priority"
                onClick={() => applySortField("priority")}
              />
            }
          >
            <Flag aria-hidden="true" />
            <span className="sr-only">Sort by priority</span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>Priority</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={sortField === "manual" ? "outline" : "ghost"}
                selected={sortField === "manual"}
                size="icon-sm"
                tabIndex={-1}
                aria-label="Sort by manual order. Press S then M."
                aria-pressed={sortField === "manual"}
                aria-keyshortcuts="M"
                data-sort="task-sort-manual"
                onClick={() => applySortField("manual")}
              />
            }
          >
            <ListOrdered aria-hidden="true" />
            <span className="sr-only">Sort by manual order</span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>Manual order</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={reverseActive ? "outline" : "ghost"}
                selected={reverseActive}
                size="icon-sm"
                tabIndex={-1}
                disabled={sortField === "manual"}
                aria-pressed={reverseActive}
                aria-label={sortField === "manual"
                  ? "Reverse is unavailable for manual order."
                  : sortField === "priority"
                    ? sortDirection === "desc"
                      ? "Highest priority first. Activate to show lowest priority first. Press S then R."
                      : "Lowest priority first. Activate to show highest priority first. Press S then R."
                    : sortDirection === "desc"
                      ? "Newest first. Activate to show oldest first. Press S then R."
                      : "Oldest first. Activate to show newest first. Press S then R."}
                aria-keyshortcuts="R"
                data-sort="task-sort-reverse"
                onClick={reverseSort}
              />
            }
          >
            {sortDirection === "desc" ? <ArrowDown aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
            <span className="sr-only">{sortField === "priority" ? (sortDirection === "desc" ? "Highest priority first" : "Lowest priority first") : sortDirection === "desc" ? "Newest first" : "Oldest first"}</span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>{sortField === "manual" ? "Unavailable for manual order" : sortField === "priority" ? (sortDirection === "desc" ? "Highest priority first" : "Lowest priority first") : sortDirection === "desc" ? "Newest first" : "Oldest first"}</TooltipContent>
        </Tooltip>
          </ButtonGroup>
            </div>
          <Separator orientation="vertical" className="h-7" />
          <ButtonGroup aria-label="Task list view">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={showDetails ? "outline" : "ghost"}
                selected={showDetails}
                size="icon-sm"
                tabIndex={-1}
                aria-label={showDetails ? "Hide descriptions and timestamps. Press V." : "Show descriptions and timestamps. Press V."}
                aria-pressed={showDetails}
                aria-keyshortcuts="V"
                data-view="task-details"
                onClick={onToggleDetails}
              />
            }
          >
            <ListChevronsUpDown aria-hidden="true" />
            <span className="sr-only">{showDetails ? "Hide descriptions and timestamps" : "Show descriptions and timestamps"}</span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>{showDetails ? "Hide details" : "Show details"}</TooltipContent>
        </Tooltip>
        <Popover open={moveControlsOpen} onOpenChange={setMoveControlsOpen}>
          <Tooltip>
            <TooltipTrigger
              render={
                <PopoverTrigger
                  render={
                    <Button
                      variant={moveControlsOpen ? "outline" : "ghost"}
                      selected={moveControlsOpen}
                      size="icon-sm"
                      tabIndex={-1}
                      aria-label={moveControlsOpen ? "Hide move controls" : "Show move controls"}
                      aria-pressed={moveControlsOpen}
                      data-move-controls-toggle
                      onMouseDown={preventFocusSteal}
                    />
                  }
                />
              }
            >
              <ArrowDownUp aria-hidden="true" />
              <span className="sr-only">{moveControlsOpen ? "Hide move controls" : "Show move controls"}</span>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>{moveControlsOpen ? "Hide move controls" : "Show move controls"}</TooltipContent>
          </Tooltip>
          <PopoverContent
            data-move-controls
            side="bottom"
            align="end"
            sideOffset={8}
            initialFocus={false}
            finalFocus={false}
            density="compact"
          >
            <p className="sr-only">Move {moveSubjectLabel} in manual order.</p>
            <div
              role="toolbar"
              aria-label={reorderAvailabilityReason ? `Move ${moveSubjectLabel}. ${reorderAvailabilityReason}` : `Move ${moveSubjectLabel}`}
              aria-controls="task-list"
              className="flex items-center gap-1"
            >
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      tabIndex={-1}
                      aria-label="Move up"
                      aria-disabled={reorderAvailabilityReason !== null || undefined}
                      data-reorder-action="up"
                      onMouseDown={preventFocusSteal}
                      onClick={() => void reorderSelection("up")}
                    />
                  }
                ><ArrowUp aria-hidden="true" /></TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={8}>{reorderAvailabilityReason ?? "Move up"}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      tabIndex={-1}
                      aria-label="Move down"
                      aria-disabled={reorderAvailabilityReason !== null || undefined}
                      data-reorder-action="down"
                      onMouseDown={preventFocusSteal}
                      onClick={() => void reorderSelection("down")}
                    />
                  }
                ><ArrowDown aria-hidden="true" /></TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={8}>{reorderAvailabilityReason ?? "Move down"}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      tabIndex={-1}
                      aria-label="Move to beginning"
                      aria-disabled={reorderAvailabilityReason !== null || undefined}
                      data-reorder-action="start"
                      onMouseDown={preventFocusSteal}
                      onClick={() => void reorderSelection("start")}
                    />
                  }
                ><ChevronDown aria-hidden="true" className="rotate-180" /></TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={8}>{reorderAvailabilityReason ?? "Move to beginning"}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      tabIndex={-1}
                      aria-label="Move to end"
                      aria-disabled={reorderAvailabilityReason !== null || undefined}
                      data-reorder-action="end"
                      onMouseDown={preventFocusSteal}
                      onClick={() => void reorderSelection("end")}
                    />
                  }
                ><ChevronDown aria-hidden="true" /></TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={8}>{reorderAvailabilityReason ?? "Move to end"}</TooltipContent>
              </Tooltip>
            </div>
          </PopoverContent>
        </Popover>
          </ButtonGroup>
          </div>
        </div>
        <Breadcrumb
          data-filter-summary="true"
          aria-live="polite"
          aria-atomic="true"
          title={filterSummary}
          className="overflow-hidden"
        >
          <BreadcrumbList density="compact">
            <BreadcrumbItem className="shrink-0">
              {statusIsDefault ? (
                <span className="text-sm font-medium">{summaryBase}</span>
              ) : (
                <FilterSummaryAction
                  filter="status"
                  label="Reset status filter to Active"
                  onClear={clearStatusFilter}
                  className="text-sm font-medium text-foreground"
                >
                  {summaryBase}
                </FilterSummaryAction>
              )}
            </BreadcrumbItem>
            {categoryFilter ? (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem className="shrink-0">
                  <FilterSummaryAction
                    filter="category"
                    label={`Clear category filter: ${categoryFilter.label}`}
                    onClear={clearCategoryFilter}
                    className="shrink-0 rounded-full"
                  >
                    <Badge variant="category" data-filter-category="true" className="shrink-0">
                      <Folder data-icon="inline-start" aria-hidden="true" />
                      {categoryFilter.label}
                    </Badge>
                  </FilterSummaryAction>
                </BreadcrumbItem>
              </>
            ) : null}
            {summarySuffixParts.map((part) => (
              <Fragment key={part.filter}>
                <BreadcrumbSeparator />
                <BreadcrumbItem className="min-w-0">
                  <FilterSummaryAction
                    filter={part.filter}
                    label={part.label}
                    onClear={part.onClear}
                    className="min-w-0 truncate text-left text-xs text-muted-foreground hover:text-foreground"
                  >
                    {part.value}
                  </FilterSummaryAction>
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
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
          aria-label={visibleRowCount
            ? `${APP_NAME}, ${visibleRowCount} visible task rows, ${total + (optimisticTask ? 1 : 0)} matching tasks, ${listSelectionLabel}`
            : `${APP_NAME}, no visible matches`}
          aria-orientation="vertical"
          aria-multiselectable="true"
          aria-keyshortcuts="Escape C Shift+C Enter S U T B M P Space Shift+Space Delete ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+Home Shift+End Control+c Meta+c Control+ArrowUp Control+ArrowDown Control+Home Control+End Meta+ArrowUp Meta+ArrowDown Meta+Home Meta+End 0 1 2 3 4 / @ # F O V Control+z Meta+z"
          aria-activedescendant={activeTask && !editingActiveTask ? `task-option-${activeTask.id}` : undefined}
          tabIndex={0}
          className="flex min-h-0 w-full flex-1 flex-col gap-2 overflow-x-clip overflow-y-auto overscroll-y-contain outline-none"
          onFocus={() => setListFocused(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setListFocused(false);
          }}
        >
          {optimisticTask ? (
            <Item
              id={`pending-task-option-${optimisticTask.id}`}
              role="option"
              aria-selected={false}
              aria-disabled="true"
              aria-busy="true"
              tabIndex={-1}
              data-optimistic-task
              size="sm"
            >
              <TaskRow
                task={optimisticTask}
                variant="full"
                indented={optimisticTask.parentId !== null}
                showDetails={showDetails}
                hiddenCategorySlug={categoryFilter?.slug ?? null}
                statusSlot={<TaskStatusDisplay task={optimisticTask} />}
              />
            </Item>
          ) : null}
          {visibleRows.map((row, index) => composer?.mode === "edit" && row.task.id === composer.task.id ? (
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
              feedbackVersion={statusFeedback?.taskId === row.task.id ? statusFeedback.version : undefined}
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
          ))}
          {isFilteredEmpty ? (
            <Item
              data-empty-state="filtered"
              size="sm"
              state="empty"
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
      ) : !loading && !error && composer === null ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No tasks yet</EmptyTitle>
            <EmptyDescription>Press C or choose New task to capture.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      <Tooltip open={filterFeedbackOpen} onOpenChange={setFilterFeedbackOpen}>
        <TooltipTrigger render={<span className="sr-only">Status filter feedback</span>} />
        <TooltipContent anchor={statusFilterButton} side="top" sideOffset={8}>{exactStatus !== null ? (EXACT_STATUS_META.find((entry) => entry.status === exactStatus)?.label ?? exactStatus) : statusPreset === "active" ? "Active" : "Inactive"}</TooltipContent>
      </Tooltip>
      {hasMore ? (
        <Button
          ref={loadMore}
          variant="ghost"
          disabled={loading}
          onClick={() => void onRefresh(tasks.length)}
        >Load more tasks</Button>
      ) : null}
    </section>
  );
});
