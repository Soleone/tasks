import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
} from "react";
import { ChevronDown, ChevronRight, Folder, ListFilter, Plus, TriangleAlert } from "lucide-react";
import type { ProjectRecord, TaskRecord, TaskStatus } from "@/backend/protocol";
import { TaskDeleteDialog } from "@/components/TaskDeleteDialog";
import { TaskRow, TaskStatusToggle, taskStatusMeta, taskTitleDisplay } from "@/components/TaskRow";
import { projectVisibleTaskRows, type VisibleTaskRow } from "@/components/taskTree";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Item } from "@/components/ui/item";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { FocusStack, Navigator } from "@/navigation";
import { BackendCommandError, transitionTask } from "@/platform/backendClient";

type StatusCommand = "task.start" | "task.pause" | "task.complete" | "task.reopen";

const taskStatusTransition: Record<TaskStatus, { next: TaskStatus; command: StatusCommand }> = {
  open: { next: "in_progress", command: "task.start" },
  in_progress: { next: "paused", command: "task.pause" },
  paused: { next: "done", command: "task.complete" },
  done: { next: "open", command: "task.reopen" },
  canceled: { next: "open", command: "task.reopen" },
};

type TaskListProps = {
  tasks: TaskRecord[];
  total: number;
  showInactive: boolean;
  onShowInactiveChange: (show: boolean) => void;
  showUnblocked: boolean;
  onShowUnblockedChange: (show: boolean) => void;
  projectFilter: ProjectRecord | null;
  onProjectFilterChange: (project: ProjectRecord | null) => void;
  onOpenProjectPicker: () => void;
  activeTaskIndex: number;
  loading: boolean;
  error: string | null;
  nav: Navigator;
  focusStack: FocusStack;
  newTaskButtonRef: RefObject<HTMLButtonElement | null>;
  onCreate: () => void;
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

const TOGGLE_FEEDBACK_DURATION_MS = 900;

export function TaskList({
  tasks,
  total,
  showInactive,
  onShowInactiveChange,
  showUnblocked,
  onShowUnblockedChange,
  projectFilter,
  onProjectFilterChange,
  onOpenProjectPicker,
  activeTaskIndex,
  loading,
  error,
  nav,
  focusStack,
  newTaskButtonRef,
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

  const visibleRows = useMemo(() => projectVisibleTaskRows(tasks, expandedIds), [tasks, expandedIds]);
  const hasMore = tasks.length < total;
  const activeRow = listFocused && visibleRows.length ? visibleRows[Math.min(activeTaskIndex, visibleRows.length - 1)] : undefined;
  const activeTask = activeRow?.task;

  // The list owns its internal tail (load-more, retry); the navigator only
  // enters the destination from either end.
  useEffect(() => nav.register("list", {
    focusFirst: () => (list.current ?? retry.current ?? section.current)?.focus(),
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
      return;
    }
    if (visibleRows.length === 0 && listFocused) {
      setListFocused(false);
      section.current?.focus();
    }
  }, [listFocused, visibleRows.length]);

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

  function toggleTaskFilter(): void {
    const next = !showInactive;
    onShowInactiveChange(next);
    setFilterFeedbackVersion((previous) => previous + 1);
    onAnnounce(next ? "Showing inactive tasks" : "Showing active tasks");
  }

  function toggleUnblockedFilter(): void {
    const next = !showUnblocked;
    onShowUnblockedChange(next);
    setUnblockedFeedbackVersion((previous) => previous + 1);
    onAnnounce(next ? "Showing unblocked tasks" : "Showing all tasks");
  }

  function clearProjectFilter(): void {
    if (!projectFilter) return;
    onProjectFilterChange(null);
    onAnnounce("Showing tasks from all projects");
  }

  function toggleProjectFilter(): void {
    if (projectFilter) {
      clearProjectFilter();
      return;
    }
    onOpenProjectPicker();
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

  function handleListKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.target !== list.current && event.target !== section.current) return;
    if (event.key === "Delete") {
      if (event.repeat || event.nativeEvent.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      event.preventDefault();
      openDeleteDialog();
      return;
    }
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.toLowerCase() === "c") {
      if (event.repeat || event.shiftKey) return;
      event.preventDefault();
      onCreate();
    } else if (event.key.toLowerCase() === "a") {
      if (event.repeat || event.shiftKey) return;
      event.preventDefault();
      toggleTaskFilter();
    } else if (event.key.toLowerCase() === "u") {
      if (event.repeat || event.shiftKey) return;
      event.preventDefault();
      toggleUnblockedFilter();
    } else if (event.key.toLowerCase() === "p") {
      if (event.repeat) return;
      event.preventDefault();
      if (event.shiftKey) clearProjectFilter();
      else onOpenProjectPicker();
    } else if (event.key.toLowerCase() === "b") {
      if (event.repeat || event.shiftKey) return;
      event.preventDefault();
      if (activeTask) onAddBlocker(activeTask);
    } else if (event.key.toLowerCase() === "m") {
      if (event.repeat || event.shiftKey) return;
      event.preventDefault();
      if (activeTask) onMoveUnder(activeTask);
    } else if (event.key === " ") {
      if (event.repeat || event.target !== list.current || event.shiftKey) return;
      event.preventDefault();
      if (activeTask) void toggleStatus(activeTask);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(activeTaskIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(activeTaskIndex - 1);
    } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      handleHorizontalNavigation(event.key);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveActive(visibleRows.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeTask) onEdit(activeTask);
    } else if (event.key === "Escape") {
      event.preventDefault();
      nav.go("create");
    } else if (event.key === "Tab") event.preventDefault();
  }

  return (
    <section
      ref={section}
      tabIndex={-1}
      aria-label="Saved tasks"
      aria-keyshortcuts="C A U P B M Space Delete ArrowLeft ArrowRight"
      onFocus={(event) => {
        if (event.target === event.currentTarget && visibleRows.length > 0) list.current?.focus();
      }}
      className="flex flex-col gap-4"
      onKeyDown={handleListKeyDown}
    >
      <div className="flex items-center justify-between gap-2">
        <Button
          ref={newTaskButtonRef}
          size="sm"
          tabIndex={-1}
          aria-keyshortcuts="C"
          onClick={onCreate}
        >
          <Plus aria-hidden="true" />
          New task
        </Button>
      <ButtonGroup aria-label="Task list filters and sorting">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={projectFilter ? "secondary" : "ghost"}
                size="icon-sm"
                tabIndex={-1}
                aria-label={projectFilter ? `Clear project filter: ${projectFilter.label}` : "Filter by project"}
                aria-pressed={projectFilter !== null}
                aria-keyshortcuts="P"
                data-filter="task-project"
                onClick={toggleProjectFilter}
              />
            }
          >
            <Folder aria-hidden="true" />
            <span className="sr-only">{projectFilter ? `Clear project filter: ${projectFilter.label}` : "Filter by project"}</span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>{projectFilter ? projectFilter.label : "Project"}</TooltipContent>
        </Tooltip>
        <Tooltip open={filterFeedbackOpen} onOpenChange={setFilterFeedbackOpen}>
          <TooltipTrigger
            render={
              <Button
                variant={showInactive ? "secondary" : "ghost"}
                size="icon-sm"
                tabIndex={-1}
                aria-label={showInactive ? "Show active tasks" : "Show inactive tasks"}
                aria-pressed={showInactive}
                aria-keyshortcuts="A"
                data-filter="task-activity"
                onClick={toggleTaskFilter}
              />
            }
          >
            <ListFilter aria-hidden="true" />
            <span className="sr-only">{showInactive ? "Show active tasks" : "Show inactive tasks"}</span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>{showInactive ? "Inactive" : "Active"}</TooltipContent>
        </Tooltip>
        <Tooltip open={unblockedFeedbackOpen} onOpenChange={setUnblockedFeedbackOpen}>
          <TooltipTrigger
            render={
              <Button
                variant={showUnblocked ? "secondary" : "ghost"}
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
            <TriangleAlert aria-hidden="true" />
            <span className="sr-only">{showUnblocked ? "Show all tasks" : "Show unblocked tasks"}</span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>{showUnblocked ? "Unblocked" : "All tasks"}</TooltipContent>
        </Tooltip>
      </ButtonGroup>
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
      {visibleRows.length ? (
        <div
          ref={list}
          role="listbox"
          aria-label={`Tasks, ${visibleRows.length} visible of ${total}`}
          aria-orientation="vertical"
          aria-keyshortcuts="C A U P B M Space Delete ArrowLeft ArrowRight"
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
            const active = listFocused && index === activeTaskIndex;
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
        </div>
      ) : !loading && !error ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No tasks yet</EmptyTitle>
            <EmptyDescription>Press C or choose New task to capture.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      {loading ? <p role="status" className="text-sm text-muted-foreground">Loading tasks…</p> : null}
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
