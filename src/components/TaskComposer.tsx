import { useEffect, useId, useRef, useState, type FormEvent, type ReactElement, type RefObject } from "react";
import type { TaskRecord } from "@/backend/protocol";
import { createTask, updateTask, BackendCommandError } from "@/platform/backendClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type TaskComposerProps = {
  task?: TaskRecord;
  titleInputRef?: RefObject<HTMLInputElement | null>;
  onSaved: (task: TaskRecord) => void;
  onCancel: () => void;
};

// Shared create/edit form. Always rendered inside TaskComposerDialog, so Tab
// stays native for the dialog focus trap and Escape closes through onCancel.
export function TaskComposer({ task, titleInputRef, onSaved, onCancel }: TaskComposerProps): ReactElement {
  const id = useId();
  const fallbackTitleInput = useRef<HTMLInputElement>(null);
  const notesInput = useRef<HTMLTextAreaElement>(null);
  const titleInput = titleInputRef ?? fallbackTitleInput;
  const saving = useRef(false);
  const receipt = useRef<{ payload: string; key: string } | null>(null);
  const focusNotesOnOpen = useRef(false);
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.descriptionMarkdown ?? "");
  const [notesOpen, setNotesOpen] = useState(Boolean(task?.descriptionMarkdown));
  const [pending, setPending] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const payload = JSON.stringify([title, description]);
    if (receipt.current?.payload !== payload) {
      receipt.current = { payload, key: crypto.randomUUID() };
    }
    const options = { idempotencyKey: receipt.current.key };
    try {
      const result = task
        ? await updateTask(task.id, title, description, task.version, options)
        : await createTask(title, description, options);
      receipt.current = null;
      if (!task) {
        setTitle("");
        setDescription("");
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
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
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
      </FieldGroup>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {!notesOpen ? <Button type="button" variant="ghost" size="sm" onClick={showNotes}>Add description</Button> : null}
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onCancel}>
            {task ? "Discard changes" : "Close"}
          </Button>
        </div>
        <Button
          type="submit"
          size="sm"
          disabled={pending}
        >{pending ? "Saving…" : task ? "Save changes" : "Add task"}</Button>
      </div>
    </form>
  );
}
