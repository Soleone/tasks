import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import type { TaskRecord } from "@/backend/protocol";
import { TaskComposer } from "@/components/TaskComposer";
import { HelpPalette } from "@/components/HelpPalette";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { closeBackendSession, listTasks } from "@/platform/backendClient";
import { backendKind } from "@/platform/backendTransport";

// Severe tab control: Title -> Description -> Task list -> back to Title.
// The list is one tab stop; arrows move between tasks, Enter opens one.
export default function App(): ReactElement {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [editingTask, setEditingTask] = useState<TaskRecord | null>(null);
  const [activeTaskIndex, setActiveTaskIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const helpReturnFocus = useRef<HTMLElement | null>(null);
  const capture = useRef<HTMLDivElement>(null);
  const taskList = useRef<HTMLDivElement>(null);
  const loadMoreButton = useRef<HTMLButtonElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const querySequence = useRef(0);

  const hasMore = tasks.length < total;
  const showList = tasks.length > 0;

  const refreshTasks = useCallback(async (offset = 0): Promise<void> => {
    const sequence = ++querySequence.current;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await listTasks(undefined, offset);
      if (sequence !== querySequence.current) return;
      setTasks((previous) => offset ? [...previous, ...result.tasks.filter((task) => !previous.some((existing) => existing.id === task.id))] : result.tasks);
      setTotal(result.total);
    } catch (caught) {
      if (sequence === querySequence.current) setLoadError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (sequence === querySequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshTasks();
    const refreshOnFocus = (): void => { void refreshTasks(); };
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      ++querySequence.current;
      window.removeEventListener("focus", refreshOnFocus);
      void closeBackendSession();
    };
  }, [refreshTasks]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing || event.repeat || event.altKey) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!helpOpen) helpReturnFocus.current = document.activeElement as HTMLElement;
        setHelpOpen(!helpOpen);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [helpOpen]);

  useEffect(() => {
    setActiveTaskIndex((previous) => {
      if (tasks.length === 0) return 0;
      return Math.min(previous, tasks.length - 1);
    });
  }, [tasks.length]);

  function focusTitle(): void {
    capture.current?.querySelector<HTMLInputElement>("input[name=title]")?.focus();
  }

  function descriptionElement(): HTMLTextAreaElement | null {
    return capture.current?.querySelector<HTMLTextAreaElement>("textarea[name=description]") ?? null;
  }

  function focusLastStop(): void {
    if (editingTask) {
      document.querySelector<HTMLButtonElement>('form[aria-label="Edit task"] button[type=submit]')?.focus();
      return;
    }
    if (hasMore) {
      loadMoreButton.current?.focus();
      return;
    }
    if (showList) {
      taskList.current?.focus();
      return;
    }
    if (loadError) {
      retryButton.current?.focus();
      return;
    }
    descriptionElement()?.focus();
  }

  function tabFromDescription(): void {
    if (showList) taskList.current?.focus();
    else if (loadError) retryButton.current?.focus();
    else focusTitle();
  }

  function shiftTabFromTitle(): void {
    if (hasMore) loadMoreButton.current?.focus();
    else if (showList) taskList.current?.focus();
    else if (loadError) retryButton.current?.focus();
    else {
      const notes = descriptionElement();
      if (notes) notes.focus();
    }
  }

  function returnToCapture(): void {
    setEditingTask(null);
    requestAnimationFrame(() => focusTitle());
  }

  function taskSaved(task: TaskRecord): void {
    setTasks((previous) => [task, ...previous.filter((existing) => existing.id !== task.id)]);
    setActiveTaskIndex(0);
    setAnnouncement(`${editingTask ? "Saved" : "Added"}: ${task.title}`);
    if (editingTask) returnToCapture();
    void refreshTasks();
  }

  function openTask(index: number): void {
    const task = tasks[index];
    if (task) setEditingTask(task);
  }

  function moveActive(next: number): void {
    if (tasks.length === 0) return;
    const wrapped = (next + tasks.length) % tasks.length;
    setActiveTaskIndex(wrapped);
    setAnnouncement(`${wrapped + 1} of ${tasks.length}: ${tasks[wrapped].title}`);
    requestAnimationFrame(() => {
      document.getElementById(`task-option-${tasks[wrapped].id}`)?.scrollIntoView({ block: "nearest" });
    });
  }

  function taskMetadata(task: TaskRecord): string {
    return [
      task.status === "open" ? null : task.status === "in_progress" ? "In progress" : task.status === "done" ? "Done" : "Canceled",
      task.category ? `@${task.category.label}` : null,
      ...task.tags.map((tag) => `#${tag.label}`),
    ].filter(Boolean).join(" · ");
  }

  const activeTask = showList ? tasks[Math.min(activeTaskIndex, tasks.length - 1)] : undefined;

  return (
    <main className="min-h-svh bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 p-4 md:p-8">
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold">Tasks</h1>
          <Button
            variant="ghost"
            size="sm"
            tabIndex={-1}
            aria-keyshortcuts="Control+k Meta+k"
            onKeyDown={(event) => {
              if (event.key === "Tab" && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
                event.preventDefault();
                focusLastStop();
              }
            }}
            onClick={() => {
              helpReturnFocus.current = document.activeElement as HTMLElement;
              setHelpOpen(true);
            }}>Help · Ctrl/Cmd+K</Button>
        </header>

        <div ref={capture} hidden={editingTask !== null}>
          <TaskComposer
            onSaved={taskSaved}
            onTabFromDescription={tabFromDescription}
            onShiftTabFromTitle={shiftTabFromTitle}
          />
        </div>
        {editingTask ? <TaskComposer key={editingTask.id} task={editingTask} onSaved={taskSaved} onCancel={() => {
          returnToCapture();
          void refreshTasks();
        }} /> : null}

        {editingTask ? null : <section aria-label="Saved tasks" className="flex flex-col gap-4">
          {loadError ? (
            <Alert variant="destructive">
              <AlertTitle>Could not load tasks</AlertTitle>
              <AlertDescription>
                <p>{loadError}</p>
                <Button
                  ref={retryButton}
                  variant="outline"
                  size="sm"
                  onClick={() => void refreshTasks()}
                  onKeyDown={(event) => {
                    if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey) return;
                    event.preventDefault();
                    if (event.shiftKey) {
                      const notes = descriptionElement();
                      if (notes) notes.focus();
                      else focusTitle();
                    } else focusTitle();
                  }}
                >Retry</Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {showList ? (
            <div
              ref={taskList}
              role="listbox"
              aria-label={`Tasks, ${tasks.length} of ${total}`}
              aria-orientation="vertical"
              aria-activedescendant={activeTask ? `task-option-${activeTask.id}` : undefined}
              tabIndex={0}
              className="flex w-full flex-col gap-2.5 outline-none"
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.ctrlKey || event.metaKey || event.altKey) return;
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
                  openTask(activeTaskIndex);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  focusTitle();
                } else if (event.key === "Tab") {
                  event.preventDefault();
                  if (event.shiftKey) {
                    const notes = descriptionElement();
                    if (notes) notes.focus();
                    else focusTitle();
                  } else if (hasMore) loadMoreButton.current?.focus();
                  else focusTitle();
                }
              }}
            >
              {tasks.map((task, index) => {
                const metadata = taskMetadata(task);
                const active = index === activeTaskIndex;
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
                    onClick={() => openTask(index)}
                    onMouseEnter={() => setActiveTaskIndex(index)}
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
          ) : !loading && !loadError ? (
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
              ref={loadMoreButton}
              variant="ghost"
              disabled={loading}
              onClick={() => void refreshTasks(tasks.length)}
              onKeyDown={(event) => {
                if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey) return;
                event.preventDefault();
                if (event.shiftKey) taskList.current?.focus();
                else focusTitle();
              }}
            >Load more tasks</Button>
          ) : null}
        </section>}
        <p role="status" className="sr-only">{announcement}</p>
        {backendKind() === "browser" ? <p className="text-sm text-muted-foreground">Browser preview</p> : null}
      </div>
      <HelpPalette open={helpOpen} onOpenChange={setHelpOpen} returnFocus={helpReturnFocus.current} />
    </main>
  );
}
