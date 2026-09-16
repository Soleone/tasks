import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement, type RefObject } from "react";
import type { TaskPriority, TaskRecord } from "@/backend/protocol";
import { PRIORITY_META } from "@/components/taskFilters";
import { createTask, updateTask, BackendCommandError } from "@/platform/backendClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type TaskComposerProps = {
  task?: TaskRecord;
  initialTitle?: string;
  parentId?: string;
  titleInputRef?: RefObject<HTMLInputElement | null>;
  onSaved: (task: TaskRecord) => void;
  onCancel: () => void;
};

// Shared create/edit form. Fields and the priority section own direct
// keyboard navigation; action buttons remain mouse-accessible backups and are
// never Tab destinations.
export function TaskComposer({ task, initialTitle = "", parentId, titleInputRef, onSaved, onCancel }: TaskComposerProps): ReactElement {
  const id = useId();
  const fallbackTitleInput = useRef<HTMLInputElement>(null);
  const notesInput = useRef<HTMLTextAreaElement>(null);
  const titleInput = titleInputRef ?? fallbackTitleInput;
  const prioritySection = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  const receipt = useRef<{ payload: string; key: string } | null>(null);
  const focusNotesOnOpen = useRef(false);
  const [title, setTitle] = useState(task?.title ?? initialTitle);
  const [description, setDescription] = useState(task?.descriptionMarkdown ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 2);
  const [notesOpen, setNotesOpen] = useState(Boolean(task?.descriptionMarkdown));
  const [pending, setPending] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = title !== (task?.title ?? "")
    || description !== (task?.descriptionMarkdown ?? "")
    || priority !== (task?.priority ?? 2);

  useEffect(() => {
    requestAnimationFrame(() => titleInput.current?.focus());
  }, [titleInput, task?.id]);

  // Focus the notes after they commit, not in the click frame: the dialog
  // trap owns focus during entry, so a same-frame focus can be yanked and
  // immediately blurred again.
  useEffect(() => {
    if (notesOpen && focusNotesOnOpen.current) {
      focusNotesOnOpen.current = false;
      notesInput.current?.focus();
    }
  }, [notesOpen]);

  function showNotes(): void {
    focusNotesOnOpen.current = true;
    setNotesOpen(true);
  }

  function focusPrioritySection(): void {
    prioritySection.current?.focus();
  }

  function handlePriorityKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || pending) return;
    if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (event.shiftKey && notesOpen) notesInput.current?.focus();
      else titleInput.current?.focus();
      return;
    }
    if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      if (event.repeat) return;
      event.preventDefault();
      event.currentTarget.closest("form")?.requestSubmit();
      return;
    }
    if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      const delta = event.key === "ArrowLeft" ? -1 : 1;
      setPriority((current) => Math.min(4, Math.max(0, current + delta)) as TaskPriority);
      return;
    }
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const value = Number(event.key);
    if (!Number.isInteger(value) || value < 0 || value > 4) return;
    event.preventDefault();
    setPriority(value as TaskPriority);
  }

  function handleTitleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      if (event.key === "Enter") event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      if (pending) return;
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (event.shiftKey) focusPrioritySection();
      else if (notesOpen) notesInput.current?.focus();
      else if (!task && !title.trim()) return;
      else showNotes();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving.current) return;
    if (!title.trim()) {
      setTitleError(true);
      titleInput.current?.focus();
      return;
    }

    saving.current = true;
    setPending(true);
    setError(null);
    // A lost reply must be retried with the same receipt, not a second write.
    const payload = JSON.stringify([title, description, priority, task?.id ?? "new", parentId ?? null]);
    if (receipt.current?.payload !== payload) {
      receipt.current = { payload, key: crypto.randomUUID() };
    }
    const options = { idempotencyKey: receipt.current.key };
    try {
      const result = task
        ? await updateTask(task.id, title, description, task.version, { ...options, priority })
        : await createTask(title, description, { ...options, parentId, priority });
      receipt.current = null;
      if (!task) {
        setTitle("");
        setDescription("");
        setPriority(2);
        setNotesOpen(false);
      }
      onSaved(result.task);
      requestAnimationFrame(() => titleInput.current?.focus());
    } catch (caught) {
      setError(caught instanceof BackendCommandError && caught.code === "STALE_TASK_VERSION"
        ? "This task changed elsewhere. Your draft is still here. Copy any changes you want to keep, then close and reopen the task."
        : caught instanceof Error ? caught.message : String(caught));
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  return (
    <form
      aria-label={task ? "Edit task" : "New task"}
      aria-busy={pending}
      noValidate
      onSubmit={(event) => void save(event)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          event.currentTarget.requestSubmit();
        }
      }}
      className="flex flex-col gap-4"
    >
      <FieldGroup>
        <Field data-invalid={titleError || undefined}>
          <FieldLabel htmlFor={`${id}-title`}>{task ? "Edit title" : "Title"}</FieldLabel>
          <Input
            ref={titleInput}
            id={`${id}-title`}
            name="title"
            autoComplete="off"
            placeholder="What needs doing?"
            value={title}
            readOnly={pending}
            required
            aria-invalid={titleError || undefined}
            aria-describedby={titleError ? `${id}-error` : undefined}
            onChange={(event) => { setTitle(event.target.value); setTitleError(false); }}
            onKeyDown={handleTitleKeyDown}
          />
          {titleError ? <FieldError id={`${id}-error`}>Write a title first.</FieldError> : null}
        </Field>
        {notesOpen ? (
          <Field>
            <FieldLabel htmlFor={`${id}-description`}>Description</FieldLabel>
            <Textarea
              ref={notesInput}
              id={`${id}-description`}
              name="description"
              placeholder="Write in Markdown…"
              rows={4}
              value={description}
              readOnly={pending}
              onChange={(event) => setDescription(event.target.value)}
              onBlur={() => {
                if (!description.trim()) setNotesOpen(false);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
                  event.preventDefault();
                  if (event.shiftKey) titleInput.current?.focus();
                  else focusPrioritySection();
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  if (pending) return;
                  if (!description.trim()) setNotesOpen(false);
                  titleInput.current?.focus();
                }
              }}
            />
          </Field>
        ) : null}
        <Field>
          <FieldLabel id={`${id}-priority-label`}>Priority</FieldLabel>
          <ButtonGroup
            ref={prioritySection}
            role="radiogroup"
            aria-labelledby={`${id}-priority-label`}
            aria-describedby={`${id}-priority-help`}
            aria-activedescendant={`${id}-priority-${priority}`}
            aria-keyshortcuts="0 1 2 3 4 ArrowLeft ArrowRight"
            aria-disabled={pending || undefined}
            tabIndex={0}
            data-priority-section
            onKeyDown={handlePriorityKeyDown}
          >
            {PRIORITY_META.map((meta) => {
              const selected = priority === meta.value;
              return (
                <Button
                  key={meta.value}
                  id={`${id}-priority-${meta.value}`}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  variant={selected ? "outline" : "ghost"}
                  selected={selected}
                  size="sm"
                  tabIndex={-1}
                  aria-label={`${meta.shortLabel}: ${meta.label}`}
                  data-priority={meta.shortLabel}
                  disabled={pending}
                  onClick={() => {
                    setPriority(meta.value);
                    prioritySection.current?.focus();
                  }}
                >
                  <span aria-hidden="true" className={`inline-block size-2 rounded-full ${meta.dot}`} />
                  {meta.shortLabel}
                </Button>
              );
            })}
          </ButtonGroup>
          <FieldDescription id={`${id}-priority-help`}>Focus here, then press 0–4 or ← → to choose.</FieldDescription>
        </Field>
      </FieldGroup>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {!notesOpen ? <Button type="button" variant="ghost" size="sm" tabIndex={-1} onClick={showNotes}>Add description</Button> : null}
          <Button type="button" variant="ghost" size="sm" tabIndex={-1} disabled={pending} onClick={onCancel}>
            {task ? (dirty ? "Discard changes" : "Back to tasks") : "Close"}
          </Button>
        </div>
        <Button
          type="submit"
          size="sm"
          tabIndex={-1}
          disabled={pending}
        >{pending ? "Saving…" : task ? "Save changes" : "Add task"}</Button>
      </div>
    </form>
  );
}
