import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import type { TaskRecord } from "@/backend/protocol";
import { TaskComposer } from "@/components/TaskComposer";
import { HelpPalette } from "@/components/HelpPalette";
import { TaskList, type TaskListHandle } from "@/components/TaskList";
import { Button } from "@/components/ui/button";
import { closeBackendSession, listTasks } from "@/platform/backendClient";
import { backendKind } from "@/platform/backendTransport";

// Severe tab control: Title -> revealed Description -> Task list -> back to Title.
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
  const taskList = useRef<TaskListHandle>(null);
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

  function focusTitle(): void {
    capture.current?.querySelector<HTMLInputElement>("input[name=title]")?.focus();
  }

  function focusPreviousCaptureStop(): void {
    const notes = capture.current?.querySelector<HTMLTextAreaElement>("textarea[name=description]");
    if (notes) notes.focus();
    else focusTitle();
  }

  function focusLastStop(): void {
    if (editingTask) {
      document.querySelector<HTMLButtonElement>('form[aria-label="Edit task"] button[type=submit]')?.focus();
      return;
    }
    if (hasMore) {
      taskList.current?.focusLoadMore();
      return;
    }
    if (showList) {
      taskList.current?.focusList();
      return;
    }
    if (loadError) {
      taskList.current?.focusRetry();
      return;
    }
    capture.current?.querySelector<HTMLTextAreaElement>("textarea[name=description]")?.focus();
  }

  function tabFromDescription(): void {
    if (showList) taskList.current?.focusList();
    else if (loadError) taskList.current?.focusRetry();
    else focusTitle();
  }

  function shiftTabFromTitle(): void {
    if (hasMore) taskList.current?.focusLoadMore();
    else if (showList) taskList.current?.focusList();
    else if (loadError) taskList.current?.focusRetry();
    else focusPreviousCaptureStop();
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

        {editingTask ? null : <TaskList
          ref={taskList}
          tasks={tasks}
          total={total}
          activeTaskIndex={activeTaskIndex}
          loading={loading}
          error={loadError}
          onRefresh={refreshTasks}
          onActiveTaskIndexChange={setActiveTaskIndex}
          onAnnounce={setAnnouncement}
          onEdit={setEditingTask}
          onDeleted={(task) => {
            ++querySequence.current;
            setTasks((previous) => previous.filter((existing) => existing.id !== task.id));
            setTotal((previous) => Math.max(0, previous - 1));
            setAnnouncement(`Deleted: ${task.title}`);
          }}
          onFocusTitle={focusTitle}
          onFocusPreviousStop={focusPreviousCaptureStop}
        />}
        <p role="status" className="sr-only">{announcement}</p>
        {backendKind() === "browser" ? <p className="text-sm text-muted-foreground">Browser preview</p> : null}
      </div>
      <HelpPalette open={helpOpen} onOpenChange={setHelpOpen} returnFocus={helpReturnFocus.current} />
    </main>
  );
}
