import { Fragment, useEffect, useMemo, useState, type FormEvent, type ReactElement } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ActivityRecord, TaskRecord } from "@/backend/protocol";
import { backendKind } from "@/platform/backendTransport";
import {
  closeBackendSession,
  createTask,
  listActivity,
  listTasks,
  transitionTask,
  updateTask,
  type BackendCommandError,
  type TaskMutationResult,
} from "@/platform/backendClient";

type StatusFilter = "all" | "open" | "in_progress" | "done" | "canceled";
type TransitionCommand = "task.start" | "task.complete" | "task.reopen" | "task.cancel";

const inBrowserPreview = backendKind() === "browser";

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    const commandError = error as BackendCommandError;
    return `${commandError.code}: ${commandError.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function taskStatusLabel(status: TaskRecord["status"]): string {
  return status === "in_progress" ? "In progress" : status[0].toUpperCase() + status.slice(1);
}

function statusVariant(status: TaskRecord["status"]): "default" | "secondary" | "outline" | "destructive" {
  if (status === "canceled") return "destructive";
  if (status === "done") return "outline";
  return status === "in_progress" ? "secondary" : "default";
}

function mutationOptions(dryRun: boolean, readOnly: boolean): {
  idempotencyKey: string;
  dryRun?: boolean;
  readOnly?: boolean;
} {
  return {
    idempotencyKey: crypto.randomUUID(),
    ...(dryRun ? { dryRun: true } : {}),
    ...(readOnly ? { readOnly: true } : {}),
  };
}

function ClassificationFooter({ task }: { task: TaskRecord }): ReactElement | null {
  const tokens = [
    task.category ? `@${task.category.label}` : null,
    ...task.tags.map((tag) => `#${tag.label}`),
  ].filter(Boolean);

  if (tokens.length === 0) return null;
  return <span className="flex flex-wrap gap-1.5">{tokens.map((token) => <Badge key={token} variant="outline">{token}</Badge>)}</span>;
}

function ActivityList({ activity }: { activity: ActivityRecord[] }): ReactElement {
  if (activity.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  }

  return (
    <ItemGroup className="gap-1">
      {activity.map((entry) => (
        <Item key={entry.seq} size="sm">
          <ItemContent>
            <ItemTitle>{entry.action}</ItemTitle>
            <ItemDescription>
              {entry.actor.label} · {new Date(entry.createdAt).toLocaleString()}
            </ItemDescription>
          </ItemContent>
        </Item>
      ))}
    </ItemGroup>
  );
}

export default function App(): ReactElement {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [captureTitle, setCaptureTitle] = useState("");
  const [captureDescription, setCaptureDescription] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [dryRun, setDryRun] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedTask = tasks.find((task) => task.id === selectedId) ?? null;
  const visibleTasks = useMemo(
    () => (statusFilter === "all" ? tasks : tasks.filter((task) => task.status === statusFilter)),
    [statusFilter, tasks],
  );

  async function refreshTasks(nextSelectedId = selectedId): Promise<void> {
    const result = await listTasks();
    setTasks(result.tasks);
    const nextTask = nextSelectedId
      ? result.tasks.find((task) => task.id === nextSelectedId)
      : result.tasks[0];

    if (!nextTask) {
      setSelectedId(null);
      setActivity([]);
      return;
    }

    setSelectedId(nextTask.id);
    setDraftTitle(nextTask.title);
    setDraftDescription(nextTask.descriptionMarkdown);
    const activityResult = await listActivity(nextTask.id);
    setActivity(activityResult.activity);
  }

  useEffect(() => {
    let mounted = true;
    void refreshTasks().catch((caughtError: unknown) => {
      if (mounted) setError(errorMessage(caughtError));
    });
    return () => {
      mounted = false;
      void closeBackendSession();
    };
  }, []);

  function clearFeedback(): void {
    setMessage(null);
    setError(null);
  }

  function selectTask(task: TaskRecord): void {
    clearFeedback();
    setSelectedId(task.id);
    setDraftTitle(task.title);
    setDraftDescription(task.descriptionMarkdown);
    void listActivity(task.id)
      .then((result) => setActivity(result.activity))
      .catch((caughtError: unknown) => setError(errorMessage(caughtError)));
  }

  async function applyMutation(result: TaskMutationResult, successMessage: string, taskId = result.task.id): Promise<void> {
    if (result.dryRun) {
      setMessage(`Preview only. ${successMessage}`);
      return;
    }
    await refreshTasks(taskId);
    setMessage(successMessage);
  }

  async function handleCapture(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    clearFeedback();
    if (captureTitle.trim() === "") {
      setError("A task title is required.");
      return;
    }

    setRunning(true);
    try {
      const result = await createTask(captureTitle, captureDescription, mutationOptions(dryRun, readOnly));
      await applyMutation(result, dryRun || readOnly ? "Task was not saved." : "Task captured.");
      if (!result.dryRun) {
        setCaptureTitle("");
        setCaptureDescription("");
      }
    } catch (caughtError) {
      setError(errorMessage(caughtError));
    } finally {
      setRunning(false);
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    clearFeedback();
    if (!selectedTask) return;

    setRunning(true);
    try {
      const result = await updateTask(
        selectedTask.id,
        draftTitle,
        draftDescription,
        selectedTask.version,
        mutationOptions(dryRun, readOnly),
      );
      await applyMutation(result, dryRun || readOnly ? "Changes were not saved." : "Task updated.", selectedTask.id);
    } catch (caughtError) {
      setError(errorMessage(caughtError));
      await refreshTasks(selectedTask.id).catch(() => undefined);
    } finally {
      setRunning(false);
    }
  }

  async function handleTransition(command: TransitionCommand): Promise<void> {
    clearFeedback();
    if (!selectedTask) return;

    setRunning(true);
    try {
      const result = await transitionTask(
        command,
        selectedTask.id,
        selectedTask.version,
        mutationOptions(dryRun, readOnly),
      );
      const label = command.slice("task.".length).replace("_", " ");
      await applyMutation(result, dryRun || readOnly ? "Transition was not saved." : `Task ${label}.`, selectedTask.id);
    } catch (caughtError) {
      setError(errorMessage(caughtError));
      await refreshTasks(selectedTask.id).catch(() => undefined);
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="min-h-svh bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-8">
        <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">M1 / Local workspace{inBrowserPreview ? " · Browser preview" : null}</p>
            <h1 className="text-3xl font-semibold tracking-tight">Tasks</h1>
            <p className="max-w-xl text-sm text-muted-foreground">
              Capture clearly, keep the history, and let people and agents use the same path.
            </p>
          </div>
          <FieldSet className="w-auto gap-2">
            <FieldLegend variant="label">Mutation safety</FieldLegend>
            <FieldGroup className="gap-2">
              <Field orientation="horizontal">
                <Checkbox id="dry-run" checked={dryRun} onCheckedChange={(checked) => setDryRun(checked === true)} />
                <FieldLabel htmlFor="dry-run">Dry run</FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <Checkbox id="read-only" checked={readOnly} onCheckedChange={(checked) => setReadOnly(checked === true)} />
                <FieldLabel htmlFor="read-only">Read only</FieldLabel>
              </Field>
            </FieldGroup>
          </FieldSet>
        </header>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Action failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {message ? (
          <Alert>
            <AlertTitle>Workspace updated</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Capture the next clear action</CardTitle>
            <CardDescription>Use one optional @category and any number of #tags in the task text.</CardDescription>
            <CardAction><Badge variant="secondary">{tasks.length} tasks</Badge></CardAction>
          </CardHeader>
          <form onSubmit={handleCapture}>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="capture-title">Task title</FieldLabel>
                  <Input
                    id="capture-title"
                    value={captureTitle}
                    onChange={(event) => setCaptureTitle(event.target.value)}
                    placeholder="What needs doing?"
                    disabled={running}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="capture-notes">Notes</FieldLabel>
                  <Textarea
                    id="capture-notes"
                    value={captureDescription}
                    onChange={(event) => setCaptureDescription(event.target.value)}
                    placeholder="Optional Markdown notes"
                    rows={3}
                    disabled={running}
                  />
                </Field>
              </FieldGroup>
            </CardContent>
            <CardFooter className="justify-end">
              <Button type="submit" disabled={running}>{dryRun || readOnly ? "Preview capture" : "Capture task"}</Button>
            </CardFooter>
          </form>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(22rem,0.9fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Tasks</CardTitle>
              <CardDescription>{visibleTasks.length} shown</CardDescription>
              <CardAction>
                <Select value={statusFilter} onValueChange={(value) => setStatusFilter((value ?? "all") as StatusFilter)}>
                  <SelectTrigger size="sm" aria-label="Filter tasks"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in_progress">In progress</SelectItem>
                      <SelectItem value="done">Done</SelectItem>
                      <SelectItem value="canceled">Canceled</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </CardAction>
            </CardHeader>
            <CardContent>
              {visibleTasks.length === 0 ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>{tasks.length === 0 ? "Nothing captured yet." : "No tasks in this view."}</EmptyTitle>
                    <EmptyDescription>{tasks.length === 0 ? "Start with one small, concrete action above." : "Try another status filter."}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ItemGroup className="gap-1">
                  {visibleTasks.map((task, index) => (
                    <Fragment key={task.id}>
                      <Item
                        render={<button type="button" />}
                        variant={task.id === selectedId ? "muted" : "outline"}
                        size="sm"
                        onClick={() => selectTask(task)}
                      >
                        <ItemContent>
                          <ItemTitle className="line-clamp-none">{task.title}</ItemTitle>
                          <ItemDescription className="flex flex-wrap items-center gap-2">
                            <Badge variant={statusVariant(task.status)}>{taskStatusLabel(task.status)}</Badge>
                            <ClassificationFooter task={task} />
                          </ItemDescription>
                        </ItemContent>
                      </Item>
                      {index < visibleTasks.length - 1 ? <ItemSeparator /> : null}
                    </Fragment>
                  ))}
                </ItemGroup>
              )}
            </CardContent>
          </Card>

          <Card>
            {selectedTask ? (
              <>
                <CardHeader>
                  <CardTitle>Edit task</CardTitle>
                  <CardDescription>Version {selectedTask.version}</CardDescription>
                  <CardAction><Badge variant={statusVariant(selectedTask.status)}>{taskStatusLabel(selectedTask.status)}</Badge></CardAction>
                </CardHeader>
                <form onSubmit={handleSave}>
                  <CardContent>
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="detail-title">Title</FieldLabel>
                        <Input id="detail-title" value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} disabled={running} />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="detail-notes">Notes</FieldLabel>
                        <Textarea id="detail-notes" value={draftDescription} onChange={(event) => setDraftDescription(event.target.value)} rows={6} disabled={running} />
                      </Field>
                    </FieldGroup>
                  </CardContent>
                  <CardFooter className="flex-wrap justify-between gap-2">
                    <Button type="submit" disabled={running}>{dryRun || readOnly ? "Preview changes" : "Save changes"}</Button>
                    <div className="flex flex-wrap gap-2">
                      {selectedTask.status === "open" ? <Button type="button" variant="outline" size="sm" onClick={() => void handleTransition("task.start")} disabled={running}>Start</Button> : null}
                      {selectedTask.status === "open" || selectedTask.status === "in_progress" ? <Button type="button" size="sm" onClick={() => void handleTransition("task.complete")} disabled={running}>Complete</Button> : null}
                      {selectedTask.status === "open" || selectedTask.status === "in_progress" ? <Button type="button" variant="destructive" size="sm" onClick={() => void handleTransition("task.cancel")} disabled={running}>Cancel</Button> : null}
                      {selectedTask.status === "done" || selectedTask.status === "canceled" ? <Button type="button" variant="outline" size="sm" onClick={() => void handleTransition("task.reopen")} disabled={running}>Reopen</Button> : null}
                    </div>
                  </CardFooter>
                </form>
                <Separator />
                <CardContent className="pt-6">
                  <h3 className="mb-3 text-sm font-medium">Activity</h3>
                  <ActivityList activity={activity} />
                </CardContent>
              </>
            ) : (
              <CardContent className="pt-6">
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>Select a task</EmptyTitle>
                    <EmptyDescription>Choose a task to edit it and see its activity.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </CardContent>
            )}
          </Card>
        </div>

        <Separator />
        <footer className="text-sm text-muted-foreground">Local-first. Structured for humans and agents. Your data stays in the workspace.</footer>
      </div>
    </main>
  );
}
