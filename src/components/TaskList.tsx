import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import {
  Circle,
  CircleCheck,
  CirclePause,
  Folder,
  CirclePlay,
  CircleX,
  ListFilter,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import type { TaskRecord, TaskStatus } from "@/backend/protocol";
import { stripClassificationTokens } from "@/backend/taskText";
import { TaskDeleteDialog } from "@/components/TaskDeleteDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { FocusStack, Navigator } from "@/navigation";
import { BackendCommandError, transitionTask } from "@/platform/backendClient";

type StatusCommand = "task.start" | "task.pause" | "task.complete" | "task.reopen";
type StatusMeta = {
  label: string;
  Icon: LucideIcon;
  color: string;
  next: TaskStatus;
  command: StatusCommand;
};

const taskStatusMeta: Record<TaskStatus, StatusMeta> = {
  open: { label: "Open", Icon: Circle, color: "text-muted-foreground", next: "in_progress", command: "task.start" },
  in_progress: { label: "In progress", Icon: CirclePlay, color: "text-primary", next: "paused", command: "task.pause" },
  paused: { label: "Paused", Icon: CirclePause, color: "text-warning", next: "done", command: "task.complete" },
  done: { label: "Done", Icon: CircleCheck, color: "text-success", next: "open", command: "task.reopen" },
  canceled: { label: "Cancelled", Icon: CircleX, color: "text-destructive", next: "open", command: "task.reopen" },
};

type TaskListProps = {
  tasks: TaskRecord[];
  total: number;
  showInactive: boolean;
  onShowInactiveChange: (show: boolean) => void;
  activeTaskIndex: number;
  loading: boolean;
  error: string | null;
  nav: Navigator;
  focusStack: FocusStack;
  onRefresh: (offset?: number) => Promise<void>;
  onActiveTaskIndexChange: (index: number) => void;
  onAnnounce: (message: string) => void;
  onEdit: (task: TaskRecord) => void;
  onTaskUpdated: (task: TaskRecord) => void;
  onCanceled: (task: TaskRecord) => void;
};

type StatusReceipt = {
  version: number;
  target: TaskStatus;
  key: string;
};

function taskMetadata(task: TaskRecord): ReactElement | null {
  const hasClassification = Boolean(task.category) || task.tags.length > 0;
  if (!hasClassification) return null;

  return (
    <ItemDescription className="flex flex-wrap items-center gap-1.5">
      {task.category ? (
        <Badge variant="outline" className="h-5 border-classification-category bg-classification-category px-1.5 text-xs font-normal text-classification-foreground">
          <Folder data-icon="inline-start" aria-hidden="true" />
          {task.category.label}
        </Badge>
      ) : null}
      {task.tags.map((tag) => (
        <Badge key={tag.slug} variant="outline" className="h-5 border-classification-tag bg-classification-tag px-1.5 text-xs font-normal text-classification-foreground">{tag.label}</Badge>
      ))}
    </ItemDescription>
  );
}

const TOGGLE_FEEDBACK_DURATION_MS = 900;

function StatusIndicator({ task, pending, feedbackVersion, onToggle }: {
  task: TaskRecord;
  pending: boolean;
  feedbackVersion?: number;
  onToggle: (task: TaskRecord) => void;
}): ReactElement {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const status = taskStatusMeta[task.status];
  const nextStatus = taskStatusMeta[status.next].label;
  const Icon = status.Icon;
  const statusLabel = `Status: ${status.label}`;

  useEffect(() => {
    if (feedbackVersion === undefined) return;
    setFeedbackOpen(true);
    const timeout = window.setTimeout(() => setFeedbackOpen(false), TOGGLE_FEEDBACK_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [feedbackVersion]);

  return (
    <Tooltip open={feedbackOpen} onOpenChange={setFeedbackOpen}>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={`${statusLabel}. Click or press Space to change it to ${nextStatus}.`}
            tabIndex={-1}
            data-status={task.status}
            data-status-pending={pending || undefined}
            className={cn(
              "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-muted",
              status.color,
              pending && "animate-pulse opacity-60",
            )}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(task);
            }}
          />
        }
      >
        <Icon aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>{status.label}</TooltipContent>
    </Tooltip>
  );
}

export function TaskList({
  tasks,
  total,
  showInactive,
  onShowInactiveChange,
  activeTaskIndex,
  loading,
  error,
  nav,
  focusStack,
  onRefresh,
  onActiveTaskIndexChange,
  onAnnounce,
  onEdit,
  onTaskUpdated,
  onCanceled,
}: TaskListProps): ReactElement {
  const section = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const loadMore = useRef<HTMLButtonElement>(null);
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

  const hasMore = tasks.length < total;
  const activeTask = listFocused && tasks.length ? tasks[Math.min(activeTaskIndex, tasks.length - 1)] : undefined;

  // The list owns its internal tail (load-more, retry); the navigator only
  // enters the destination from either end.
  useEffect(() => nav.register("list", {
    focusFirst: () => (list.current ?? retry.current ?? section.current)?.focus(),
    focusLast: () => (loadMore.current ?? list.current ?? retry.current ?? section.current)?.focus(),
  }), [nav]);

  useEffect(() => {
    const nextIndex = Math.min(activeTaskIndex, Math.max(tasks.length - 1, 0));
    if (nextIndex !== activeTaskIndex) onActiveTaskIndexChange(nextIndex);
  }, [activeTaskIndex, onActiveTaskIndexChange, tasks.length]);

  useEffect(() => {
    if (tasks.length > 0 && document.activeElement === section.current) {
      list.current?.focus();
      return;
    }
    if (tasks.length === 0 && listFocused) {
      setListFocused(false);
      section.current?.focus();
    }
  }, [listFocused, tasks.length]);

  useEffect(() => {
    if (filterFeedbackVersion === 0) return;
    setFilterFeedbackOpen(true);
    const timeout = window.setTimeout(() => setFilterFeedbackOpen(false), TOGGLE_FEEDBACK_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [filterFeedbackVersion]);

  function toggleTaskFilter(): void {
    const next = !showInactive;
    onShowInactiveChange(next);
    setFilterFeedbackVersion((previous) => previous + 1);
    onAnnounce(next ? "Showing inactive tasks" : "Showing active tasks");
  }

  function moveActive(next: number): void {
    if (tasks.length === 0) return;
    const wrapped = (next + tasks.length) % tasks.length;
    onActiveTaskIndexChange(wrapped);
    onAnnounce(`${wrapped + 1} of ${tasks.length}: ${tasks[wrapped].title}`);
    requestAnimationFrame(() => {
      document.getElementById(`task-option-${tasks[wrapped].id}`)?.scrollIntoView({ block: "nearest" });
    });
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
    const status = taskStatusMeta[task.status];
    const previousReceipt = statusReceipts.current.get(task.id);
    const receipt = previousReceipt?.version === task.version && previousReceipt.target === status.next
      ? previousReceipt
      : { version: task.version, target: status.next, key: crypto.randomUUID() };
    statusReceipts.current.set(task.id, receipt);
    setStatusPending(task.id, true);
    try {
      const result = await transitionTask(status.command, task.id, task.version, { idempotencyKey: receipt.key });
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
    if (event.key.toLowerCase() === "a") {
      if (event.repeat || event.shiftKey) return;
      event.preventDefault();
      toggleTaskFilter();
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
    } else if (event.key === "Home") {
      event.preventDefault();
      moveActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveActive(tasks.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeTask) onEdit(activeTask);
    } else if (event.key === "Escape") {
      event.preventDefault();
      nav.go("create");
    } else if (event.key === "Tab") {
      event.preventDefault();
      if (event.shiftKey) nav.prev("list");
      else if (hasMore) loadMore.current?.focus();
      else nav.next("list");
    }
  }

  function handleBoundaryTab(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    if (event.shiftKey) list.current?.focus();
    else nav.next("list");
  }

  return (
    <section
      ref={section}
      tabIndex={-1}
      aria-label="Saved tasks"
      aria-keyshortcuts="A Space Delete"
      className="flex flex-col gap-4"
      onKeyDown={handleListKeyDown}
    >
      <ButtonGroup aria-label="Task list filters and sorting" className="self-end">
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
          <TooltipContent side="top" sideOffset={8}>{showInactive ? "Inactive tasks" : "Active tasks"}</TooltipContent>
        </Tooltip>
      </ButtonGroup>
      {error ? <Alert variant="destructive">
        <AlertTitle>Could not load tasks</AlertTitle>
        <AlertDescription>
          <p>{error}</p>
          <Button
            ref={retry}
            variant="outline"
            size="sm"
            onClick={() => void onRefresh()}
            onKeyDown={handleBoundaryTab}
          >Retry</Button>
        </AlertDescription>
      </Alert> : null}
      {tasks.length ? (
        <div
          ref={list}
          role="listbox"
          aria-label={`Tasks, ${tasks.length} of ${total}`}
          aria-orientation="vertical"
          aria-keyshortcuts="A Space Delete"
          aria-activedescendant={activeTask ? `task-option-${activeTask.id}` : undefined}
          tabIndex={0}
          className="flex w-full flex-col gap-2 outline-none"
          onFocus={() => setListFocused(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setListFocused(false);
          }}
        >
          {tasks.map((task, index) => {
            const displayTitle = stripClassificationTokens(task.title) || task.title;
            const active = listFocused && index === activeTaskIndex;
            return (
              <Item
                key={task.id}
                id={`task-option-${task.id}`}
                role="option"
                aria-selected={active}
                tabIndex={-1}
                data-active={active || undefined}
                size="sm"
                variant={active ? "outline" : "default"}
                className={active ? "border-ring bg-muted" : undefined}
                onClick={() => onEdit(task)}
                onMouseEnter={() => onActiveTaskIndexChange(index)}
              >
                <ItemMedia variant="icon">
                  <StatusIndicator
                    task={task}
                    pending={statusPendingIds.has(task.id)}
                    feedbackVersion={statusFeedback?.taskId === task.id ? statusFeedback.version : undefined}
                    onToggle={(nextTask) => void toggleStatus(nextTask)}
                  />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="line-clamp-none wrap-anywhere">{displayTitle}</ItemTitle>
                  {task.descriptionMarkdown ? <ItemDescription className="wrap-anywhere">{task.descriptionMarkdown}</ItemDescription> : null}
                  {taskMetadata(task)}
                </ItemContent>
              </Item>
            );
          })}
        </div>
      ) : !loading && !error ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No tasks yet</EmptyTitle>
            <EmptyDescription>Write a title above and press Enter.</EmptyDescription>
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
          onKeyDown={handleBoundaryTab}
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
