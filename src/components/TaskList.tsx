import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import type { TaskRecord } from "@/backend/protocol";
import { TaskDeleteDialog } from "@/components/TaskDeleteDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";

export type TaskListHandle = {
  focusList: () => void;
  focusLoadMore: () => void;
  focusRetry: () => void;
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
  onDeleted: (task: TaskRecord) => void;
  onFocusTitle: () => void;
  onFocusPreviousStop: () => void;
};

function taskMetadata(task: TaskRecord): string {
  const statusLabels = { open: "", in_progress: "In progress", done: "Done", canceled: "Canceled" };
  return [
    statusLabels[task.status],
    task.category ? `@${task.category.label}` : null,
    ...task.tags.map((tag) => `#${tag.label}`),
  ].filter(Boolean).join(" · ");
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
  onDeleted,
  onFocusTitle,
  onFocusPreviousStop,
}, ref): ReactElement {
  const section = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const loadMore = useRef<HTMLButtonElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const deleteReturnFocus = useRef<HTMLElement | null>(null);
  const [deletion, setDeletion] = useState<{ task: TaskRecord; key: string } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [listFocused, setListFocused] = useState(false);

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
    if (event.key === "ArrowDown") {
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
          aria-keyshortcuts="Delete"
          aria-activedescendant={activeTask ? `task-option-${activeTask.id}` : undefined}
          tabIndex={0}
          className="flex w-full flex-col gap-2.5 outline-none"
          onFocus={() => setListFocused(true)}
          onBlur={() => setListFocused(false)}
          onKeyDown={handleListKeyDown}
        >
          {tasks.map((task, index) => {
            const metadata = taskMetadata(task);
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
                <ItemContent className="min-w-0">
                  <ItemTitle className="line-clamp-none wrap-anywhere">{task.title}</ItemTitle>
                  {task.descriptionMarkdown ? <ItemDescription className="wrap-anywhere">{task.descriptionMarkdown}</ItemDescription> : null}
                  {metadata ? <ItemDescription className="wrap-anywhere">{metadata}</ItemDescription> : null}
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
        onDeleted={onDeleted}
        returnFocus={() => deleteReturnFocus.current?.isConnected
          ? deleteReturnFocus.current
          : list.current?.isConnected
            ? list.current
            : section.current ?? undefined}
      /> : null}
    </section>
  );
});
