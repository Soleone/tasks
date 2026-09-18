import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactElement, type RefObject } from "react";
import type { CategoryRecord, TagRecord, TaskPriority, TaskRecord } from "@/backend/protocol";
import { PRIORITY_META } from "@/components/taskFilters";
import { createTask, listCategories, listTags, updateTask, BackendCommandError } from "@/platform/backendClient";
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
  helpMode: boolean;
};

// Shared create/edit form. Fields and the priority section own direct
// keyboard navigation; action buttons remain mouse-accessible backups and are
// never Tab destinations.
export function TaskComposer({ task, initialTitle = "", parentId, titleInputRef, onSaved, onCancel, helpMode }: TaskComposerProps): ReactElement {
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
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [tags, setTags] = useState<TagRecord[]>([]);
  const [suggestion, setSuggestion] = useState<{ marker: "@" | "#"; start: number; end: number; query: string } | null>(null);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [helpTarget, setHelpTarget] = useState<"title" | "description" | "priority">("title");
  const [helpTop, setHelpTop] = useState<number | null>(null);
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

  useLayoutEffect(() => {
    if (!helpMode) {
      setHelpTop(null);
      return;
    }
    const anchor = helpTarget === "title"
      ? titleInput.current
      : helpTarget === "description"
        ? notesInput.current
        : prioritySection.current;
    const popup = anchor?.closest<HTMLElement>("[data-slot=dialog-content]");
    if (!anchor || !popup) {
      setHelpTop(null);
      return;
    }
    const updateHelpPosition = (): void => {
      const anchorRect = anchor.getBoundingClientRect();
      const popupRect = popup.getBoundingClientRect();
      setHelpTop(anchorRect.top - popupRect.top + anchorRect.height / 2);
    };
    updateHelpPosition();
    const settleTimer = window.setTimeout(updateHelpPosition, 150);
    window.addEventListener("resize", updateHelpPosition);
    popup.addEventListener("scroll", updateHelpPosition, { passive: true });
    popup.addEventListener("animationend", updateHelpPosition);
    return () => {
      window.clearTimeout(settleTimer);
      window.removeEventListener("resize", updateHelpPosition);
      popup.removeEventListener("scroll", updateHelpPosition);
      popup.removeEventListener("animationend", updateHelpPosition);
    };
  }, [helpMode, helpTarget, notesOpen]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listCategories(), listTags()])
      .then(([categoryResult, tagResult]) => {
        if (cancelled) return;
        setCategories(categoryResult.categories);
        setTags(tagResult.tags);
      })
      .catch(() => {
        // Autocomplete is a convenience. The title remains fully editable if
        // the shared backend is unavailable while the dialog is open.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const suggestionItems = suggestion?.marker === "@"
    ? categories.filter((category) => category.label.toLowerCase().startsWith(suggestion.query.toLowerCase()))
    : suggestion
      ? tags.filter((tag) => tag.label.toLowerCase().startsWith(suggestion.query.toLowerCase()))
      : [];

  function updateSuggestion(nextTitle: string, cursor: number): void {
    const beforeCursor = nextTitle.slice(0, cursor);
    const match = beforeCursor.match(/(^|[^A-Za-z0-9_/@])([@#])([A-Za-z][A-Za-z0-9_-]*)?$/);
    if (!match) {
      setSuggestion(null);
      return;
    }
    const marker = match[2] as "@" | "#";
    const query = match[3] ?? "";
    const start = cursor - query.length - 1;
    setSuggestion({ marker, start, end: cursor, query });
    setSuggestionIndex(0);
  }

  function chooseSuggestion(item: CategoryRecord | TagRecord): void {
    if (!suggestion) return;
    const replacement = `${suggestion.marker}${item.label} `;
    const nextTitle = `${title.slice(0, suggestion.start)}${replacement}${title.slice(suggestion.end)}`;
    const cursor = suggestion.start + replacement.length;
    setTitle(nextTitle);
    setSuggestion(null);
    requestAnimationFrame(() => {
      titleInput.current?.focus();
      titleInput.current?.setSelectionRange(cursor, cursor);
    });
  }

  function handleSuggestionKeyDown(event: KeyboardEvent<HTMLInputElement>): boolean {
    if (!suggestion || suggestionItems.length === 0) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setSuggestionIndex((current) => (current + delta + suggestionItems.length) % suggestionItems.length);
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      chooseSuggestion(suggestionItems[suggestionIndex]);
      return true;
    }
    return false;
  }

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
    if (handleSuggestionKeyDown(event)) return;
    if (event.key === "Escape" && suggestion) {
      event.preventDefault();
      setSuggestion(null);
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

  const contextualHelp = {
    title: {
      heading: "Title",
      text: "Type the task title. Press Tab to open the description, or Enter to save.",
    },
    description: {
      heading: "Description",
      text: "Add optional Markdown notes. Press Tab twice to move to priority, or Escape to return to the title.",
    },
    priority: {
      heading: "Priority",
      text: "Press 0–4 or ← → to choose a priority.",
    },
  }[helpTarget];

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
      {helpMode ? (
        <aside
          aria-label="Keyboard help"
          data-context-help={helpTarget}
          style={helpTop === null ? undefined : { "--context-help-top": `${helpTop}px` } as CSSProperties}
          className="pointer-events-none w-full rounded-md border bg-card p-3 text-card-foreground shadow-md lg:absolute lg:right-full lg:top-(--context-help-top) lg:mr-3 lg:w-52 lg:-translate-y-1/2"
        >
          <span className="absolute -right-2 top-4 size-3 rotate-45 border-r border-t bg-card" aria-hidden="true" />
          <p className="text-xs font-medium">{contextualHelp.heading}</p>
          <p className="mt-1 text-xs text-muted-foreground">{contextualHelp.text}</p>
        </aside>
      ) : null}
      <FieldGroup>
        <Field className="relative" data-invalid={titleError || undefined}>
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
            aria-expanded={suggestion !== null && suggestionItems.length > 0}
            aria-autocomplete="list"
            onChange={(event) => {
              setTitle(event.target.value);
              setTitleError(false);
              updateSuggestion(event.target.value, event.target.selectionStart ?? event.target.value.length);
            }}
            onFocus={() => setHelpTarget("title")}
            onKeyDown={handleTitleKeyDown}
            onClick={(event) => updateSuggestion(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
          />
          {suggestion && suggestionItems.length > 0 ? (
            <div
              role="listbox"
              aria-label={`${suggestion.marker === "@" ? "Categories" : "Tags"} autocomplete`}
              className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            >
              {suggestionItems.map((item, index) => (
                <button
                  key={item.slug}
                  type="button"
                  role="option"
                  aria-selected={index === suggestionIndex}
                  tabIndex={-1}
                  className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted aria-selected:bg-muted"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseSuggestion(item)}
                >
                  <span>{suggestion.marker}{item.label}</span>
                  <span className="text-xs text-muted-foreground">{item.taskCount} {item.taskCount === 1 ? "task" : "tasks"}</span>
                </button>
              ))}
            </div>
          ) : null}
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
              onFocus={() => setHelpTarget("description")}
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
            aria-describedby={helpMode ? undefined : `${id}-priority-help`}
            aria-activedescendant={`${id}-priority-${priority}`}
            aria-keyshortcuts="0 1 2 3 4 ArrowLeft ArrowRight"
            aria-disabled={pending || undefined}
            tabIndex={0}
            data-priority-section
            onFocus={() => setHelpTarget("priority")}
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
          {!helpMode ? <FieldDescription id={`${id}-priority-help`}>Focus here, then press 0–4 or ← → to choose.</FieldDescription> : null}
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
