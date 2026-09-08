import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import type { TaskRecord } from "@/backend/protocol";
import { TaskComposer } from "@/components/TaskComposer";
import { HelpPalette } from "@/components/HelpPalette";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { closeBackendSession, listTasks } from "@/platform/backendClient";
import { backendKind } from "@/platform/backendTransport";

export default function App(): ReactElement {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [editingTask, setEditingTask] = useState<TaskRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const helpReturnFocus = useRef<HTMLElement | null>(null);
  const capture = useRef<HTMLDivElement>(null);
  const querySequence = useRef(0);

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

  function returnToCapture(): void {
    setEditingTask(null);
    requestAnimationFrame(() => capture.current?.querySelector("input")?.focus());
  }

  function taskSaved(task: TaskRecord): void {
    setTasks((previous) => [task, ...previous.filter((existing) => existing.id !== task.id)]);
    setAnnouncement(`${editingTask ? "Saved" : "Added"}: ${task.title}`);
    if (editingTask) returnToCapture();
    void refreshTasks();
  }

  return (
    <main className="min-h-svh bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 p-4 md:p-8">
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold">Tasks</h1>
          <Button variant="ghost" size="sm" aria-keyshortcuts="Control+k Meta+k" onClick={() => {
            helpReturnFocus.current = document.activeElement as HTMLElement;
            setHelpOpen(true);
          }}>Help · Ctrl/Cmd+K</Button>
        </header>

        <div ref={capture} hidden={editingTask !== null}>
          <TaskComposer onSaved={taskSaved} />
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
                <Button variant="outline" size="sm" onClick={() => void refreshTasks()}>Retry</Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {tasks.length ? (
            <ItemGroup aria-label="Tasks">
              {tasks.map((task) => {
                const metadata = [
                  task.status === "open" ? null : task.status === "in_progress" ? "In progress" : task.status === "done" ? "Done" : "Canceled",
                  task.category ? `@${task.category.label}` : null,
                  ...task.tags.map((tag) => `#${tag.label}`),
                ].filter(Boolean).join(" · ");
                return (
                  <div key={task.id} role="listitem">
                    <Item size="sm" render={<a href={`#task-${task.id}`} />} onClick={(event) => {
                      event.preventDefault();
                      setEditingTask(task);
                    }}>
                      <ItemContent className="min-w-0">
                        <ItemTitle className="line-clamp-none wrap-anywhere">{task.title}</ItemTitle>
                        {task.descriptionMarkdown ? <ItemDescription className="wrap-anywhere">{task.descriptionMarkdown}</ItemDescription> : null}
                        {metadata ? <ItemDescription className="wrap-anywhere">{metadata}</ItemDescription> : null}
                      </ItemContent>
                    </Item>
                  </div>
                );
              })}
            </ItemGroup>
          ) : !loading && !loadError ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No tasks yet</EmptyTitle>
                <EmptyDescription>Write a title above and press Enter.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}
          {loading ? <p role="status" className="text-sm text-muted-foreground">Loading tasks…</p> : null}
          {tasks.length < total ? <Button variant="ghost" disabled={loading} onClick={() => void refreshTasks(tasks.length)}>Load more tasks</Button> : null}
        </section>}
        <p role="status" className="sr-only">{announcement}</p>
        {backendKind() === "browser" ? <p className="text-sm text-muted-foreground">Browser preview</p> : null}
      </div>
      <HelpPalette open={helpOpen} onOpenChange={setHelpOpen} returnFocus={helpReturnFocus.current} />
    </main>
  );
}
