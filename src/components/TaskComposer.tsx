import { useId, useRef, useState, type FormEvent, type ReactElement } from "react";
import type { TaskRecord } from "@/backend/protocol";
import { createTask, updateTask, BackendCommandError } from "@/platform/backendClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type TaskComposerProps = {
  task?: TaskRecord;
  onSaved: (task: TaskRecord) => void;
  onCancel?: () => void;
  onTabFromDescription?: () => void;
  onShiftTabFromTitle?: () => void;
};

export function TaskComposer({ task, onSaved, onCancel, onTabFromDescription, onShiftTabFromTitle }: TaskComposerProps): ReactElement {
  const id = useId();
  const titleInput = useRef<HTMLInputElement>(null);
  const notesInput = useRef<HTMLTextAreaElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const saving = useRef(false);
  const receipt = useRef<{ payload: string; key: string } | null>(null);
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.descriptionMarkdown ?? "");
  const [notesOpen, setNotesOpen] = useState(Boolean(task?.descriptionMarkdown));
  const [pending, setPending] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = title !== (task?.title ?? "") || description !== (task?.descriptionMarkdown ?? "");

  function focusFirstButton(): void {
    // DOM order is Cancel then Save; the first tabbable after the
    // description is Cancel when it exists, otherwise Save.
    if (onCancel) cancelButton.current?.focus();
    else saveButton.current?.focus();
  }

  function handleTitleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      if (event.key === "Enter") event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      // In the editor, Esc from the title goes back to the list.
      // From the description, Esc first lands on the title so notes are kept.
      if (!pending && onCancel) {
        event.preventDefault();
        onCancel();
      }
      return;
    }
    if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (event.shiftKey) {
        event.preventDefault();
        if (onShiftTabFromTitle) onShiftTabFromTitle();
        else saveButton.current?.focus();
      } else if (!notesOpen) {
        event.preventDefault();
        showNotes();
      } else {
        event.preventDefault();
        notesInput.current?.focus();
      }
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function showNotes(): void {
    setNotesOpen(true);
    requestAnimationFrame(() => notesInput.current?.focus());
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
        ? "This task changed elsewhere. Your draft is still here. Copy any changes you want to keep, then return to the list and reopen the task."
        : caught instanceof Error ? caught.message : String(caught));
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  return (
    <Card>
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
      >
        <CardContent className="flex flex-col gap-4">
          <FieldGroup>
            <Field data-invalid={titleError || undefined}>
              <FieldLabel htmlFor={`${id}-title`}>{task ? "Edit title" : "Title"}</FieldLabel>
              <Input
                ref={titleInput}
                id={`${id}-title`}
                name="title"
                autoFocus
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
                <FieldLabel htmlFor={`${id}-description`}>Description (optional)</FieldLabel>
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
                    if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
                      event.preventDefault();
                      if (event.shiftKey) titleInput.current?.focus();
                      else if (onTabFromDescription) onTabFromDescription();
                      else focusFirstButton();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      if (!description) setNotesOpen(false);
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
              {!notesOpen ? <Button type="button" variant="ghost" size="sm" tabIndex={-1} onClick={showNotes}>Add description</Button> : null}
              {onCancel ? <Button ref={cancelButton} type="button" variant="ghost" size="sm" disabled={pending} onClick={onCancel}>{dirty ? "Discard changes" : "Back to tasks"}</Button> : null}
            </div>
            <Button
              ref={saveButton}
              type="submit"
              size="sm"
              disabled={pending}
              tabIndex={task ? undefined : -1}
              onKeyDown={task ? (event) => {
                if (event.key === "Tab" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
                  event.preventDefault();
                  titleInput.current?.focus();
                }
              } : undefined}
            >{pending ? "Saving…" : task ? "Save changes" : "Add task"}</Button>
          </div>
        </CardContent>
      </form>
    </Card>
  );
}
