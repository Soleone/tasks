import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import {
  Circle,
  CircleCheck,
  CirclePause,
  CirclePlay,
  CircleX,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import type { TaskRecord, TaskStatus } from "@/backend/protocol";
import { stripClassificationTokens } from "@/backend/taskText";
import { TaskDeleteDialog } from "@/components/TaskDeleteDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BackendCommandError, transitionTask } from "@/platform/backendClient";

export type TaskListHandle = {
  focusList: () => void;
  focusLoadMore: () => void;
  focusRetry: () => void;
};

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
  paused: { label: "Paused", Icon: CirclePause, color: "text-amber-600 dark:text-amber-400", next: "done", command: "task.complete" },
  done: { label: "Done", Icon: CircleCheck, color: "text-emerald-600 dark:text-emerald-400", next: "open", command: "task.reopen" },
  canceled: { label: "Cancelled", Icon: CircleX, color: "text-destructive", next: "open", command: "task.reopen" },
};

type TaskListProps = {
  tasks: TaskRecord[];
  total: number;
  activeTaskIndex: number;
  loading: boolean;
  error: string | null;
  onRefresh: (offset?: number) => Promise<void>;
  onActiveTaskIndexChange: (index: number) => void;
  onAnnounce: (message: string) => void;
  onEdit: (task: TaskRecord) => void;
  onTaskUpdated: (task: TaskRecord) => void;
  onCanceled: (task: TaskRecord) => void;
  onFocusTitle: () => void;
  onFocusPreviousStop: () => void;
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
      {task.category ? <Badge variant="outline" className="h-5 px-1.5 text-xs font-normal text-muted-foreground">@{task.category.label}</Badge> : null}
      {task.category && task.tags.length ? <span aria-hidden="true">·</span> : null}
      {task.tags.map((tag) => (
        <Badge key={tag.slug} variant="outline" className="h-5 px-1.5 text-xs font-normal text-muted-foreground">#{tag.label}</Badge>
      ))}
    </ItemDescription>
  );
}

const STATUS_FEEDBACK_DURATION_MS = 1800;

function StatusIndicator({ task, pending, feedbackVersion }: {
  task: TaskRecord;
  pending: boolean;
  feedbackVersion?: number;
}): ReactElement {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const status = taskStatusMeta[task.status];
  const nextStatus = taskStatusMeta[status.next].label;
  const Icon = status.Icon;
  const statusLabel = `Status: ${status.label}`;

  useEffect(() => {
    if (feedbackVersion === undefined) return;
    setFeedbackOpen(true);
    const timeout = window.setTimeout(() => setFeedbackOpen(false), STATUS_FEEDBACK_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [feedbackVersion]);

  return (
    <Tooltip open={feedbackOpen} onOpenChange={setFeedbackOpen}>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={`${statusLabel}. Space changes it to ${nextStatus}.`}
            tabIndex={-1}
            data-status={task.status}
            data-status-pending={pending || undefined}
            className={cn(
              "inline-flex size-7 shrink-0 items-center justify-center rounded-full transition-colors",
              status.color,
              pending && "animate-pulse opacity-60",
            )}
          />
        }
      >
        <Icon aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>{statusLabel}</TooltipContent>
    </Tooltip>
  );
}

export const TaskList = forwardRef<TaskListHandle, TaskListProps>(function TaskList({
  tasks,
  total,
  activeTaskIndex,
  loading,
  error,
  onRefresh,
  onActiveTaskIndexChange,
  onAnnounce,
  onEdit,
  onTaskUpdated,
  onCanceled,
  onFocusTitle,
  onFocusPreviousStop,
}, ref): ReactElement {
  const section = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const loadMore = useRef<HTMLButtonElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const deleteReturnFocus = useRef<HTMLElement | null>(null);
  const statusReceipts = useRef(new Map<string, StatusReceipt>());
  const statusPending = useRef(new Set<string>());
  const [deletion, setDeletion] = useState<{ task: TaskRecord; key: string } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [listFocused, setListFocused] = useState(false);
  const [statusPendingIds, setStatusPendingIds] = useState<Set<string>>(() => new Set());
  const [statusFeedback, setStatusFeedback] = useState<{ taskId: string; version: number } | null>(null);

  const hasMore = tasks.length < total;
  const activeTask = listFocused && tasks.length ? tasks[Math.min(activeTaskIndex, tasks.length - 1)] : undefined;

  useImperativeHandle(ref, () => ({
    focusList: () => (list.current ?? section.current)?.focus(),
    focusLoadMore: () => loadMore.current?.focus(),
    focusRetry: () => retry.current?.focus(),
  }));

  useEffect(() => {
    const nextIndex = Math.min(activeTaskIndex, Math.max(tasks.length - 1, 0));
    if (nextIndex !== activeTaskIndex) onActiveTaskIndexChange(nextIndex);
  }, [activeTaskIndex, onActiveTaskIndexChange, tasks.length]);

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
    deleteReturnFocus.current = list.current;
    setDeletion({ task: activeTask, key: crypto.randomUUID() });
    setDeleteOpen(true);
  }

  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Delete") {
      if (event.repeat || event.nativeEvent.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      event.preventDefault();
      openDeleteDialog();
      return;
    }
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === " ") {
      if (event.repeat || event.target !== event.currentTarget || event.shiftKey) return;
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
      onFocusTitle();
    } else if (event.key === "Tab") {
      event.preventDefault();
      if (event.shiftKey) onFocusPreviousStop();
      else if (hasMore) loadMore.current?.focus();
      else onFocusTitle();
    }
  }

  function handleBoundaryTab(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    if (event.shiftKey) list.current?.focus();
    else onFocusTitle();
  }

  return (
    <section ref={section} tabIndex={-1} aria-label="Saved tasks" className="flex flex-col gap-4">
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
          aria-keyshortcuts="Space Delete"
          aria-activedescendant={activeTask ? `task-option-${activeTask.id}` : undefined}
          tabIndex={0}
          className="flex w-full flex-col gap-2.5 outline-none"
          onFocus={() => setListFocused(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setListFocused(false);
          }}
          onKeyDown={handleListKeyDown}
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
        returnFocus={() => deleteReturnFocus.current?.isConnected
          ? deleteReturnFocus.current
          : list.current?.isConnected
            ? list.current
            : section.current ?? undefined}
      /> : null}
    </section>
  );
});
