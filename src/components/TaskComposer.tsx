import { randomUUID } from "../lib/randomUUID";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from "react";
import type { CategoryRecord, TagRecord, TaskPriority, TaskRecord } from "@/legacy/backend/protocol";
import type { TaskView } from "./taskView";
import { PRIORITY_META } from "@/components/taskFilters";
import { parseShorthand } from "@/backend/updateInputs";
import { createTask, listCategories, listTags, updateTask, selectedMainWorkspace, BackendCommandError, type TaskMutationResult } from "@/platform/backendClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { X } from "lucide-react";
import type { KeyboardHelpMode } from "@/keyboardHelp";
import { preventFocusSteal } from "@/navigation";

export type ComposerState =
  | { mode: "create"; parentId?: string; initialTitle?: string }
  | { mode: "edit"; task: TaskRecord };

export type TaskCreateDraft = {
  title: string;
  descriptionMarkdown: string;
  priority: TaskPriority;
  parentId?: string;
};

type TaskComposerProps = {
  task?: TaskView;
  initialTitle?: string;
  parentId?: string;
  onSaved: (result: TaskMutationResult) => void;
  onCreatePending: (draft: TaskCreateDraft) => void;
  onCreateFailed: () => void;
  onCancel: () => void;
  helpMode: KeyboardHelpMode;
  onDisableHelp: () => void;
};

type ContextualHelpTarget = "title" | "description" | "priority";

const CONTEXTUAL_HELP: Record<ContextualHelpTarget, { heading: string; text: string }> = {
  title: {
    heading: "Title",
    text: "Type the task title. Press Tab to choose a priority, or Enter to save.",
  },
  description: {
    heading: "Description",
    text: "Add optional Markdown notes. Press Shift+Tab for priority, or Tab and Escape to return to the title.",
  },
  priority: {
    heading: "Priority",
    text: "Press 0–4 or ← → to choose a priority.",
  },
};

function ComposerHelpTooltip({ target, onDisableHelp }: { target: ContextualHelpTarget; onDisableHelp: () => void }): ReactElement {
  const help = CONTEXTUAL_HELP[target];

  return (
    <Tooltip open>
      <TooltipTrigger
        render={<span aria-hidden="true" tabIndex={-1} className="pointer-events-none absolute inset-x-0 top-6 bottom-0" />}
      />
      <TooltipContent
        data-context-help={target}
        role="status"
        aria-live="polite"
        side="left"
        align="center"
        sideOffset={8}
        className="max-w-[16rem] whitespace-normal"
      >
        <span className="flex w-full flex-col items-start text-left">
          <span className="flex w-full items-start justify-between gap-2">
            <span className="font-medium">{help.heading}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              tabIndex={-1}
              aria-label="Use basic keyboard help"
              title="Use basic keyboard help"
              onMouseDown={preventFocusSteal}
              onClick={onDisableHelp}
            >
              <X aria-hidden="true" />
            </Button>
          </span>
          <span>{help.text}</span>
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

// Shared inline create/edit form. Fields and the priority section own direct
// keyboard navigation; action buttons remain mouse-accessible backups and are
// never Tab destinations.
export function TaskComposer({ task, initialTitle = "", parentId, onSaved, onCreatePending, onCreateFailed, onCancel, helpMode, onDisableHelp }: TaskComposerProps): ReactElement {
  const id = useId();
  const titleInput = useRef<HTMLInputElement>(null);
  const notesInput = useRef<HTMLTextAreaElement>(null);
  const prioritySection = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  const receipt = useRef<{ payload: string; key: string } | null>(null);
  const focusNotesOnOpen = useRef(false);
  const [title, setTitle] = useState(task?.inputText ?? task?.title ?? initialTitle);
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
  const dirty = title !== (task?.inputText ?? task?.title ?? "")
    || description !== (task?.descriptionMarkdown ?? "")
    || priority !== (task?.priority ?? 2);
  const showContextualHelp = helpMode === "full" && !pending;
  const showPriorityHelp = helpMode === "basic" && !pending;

  useEffect(() => {
    const frame = requestAnimationFrame(() => titleInput.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [task?.id]);

  // Focus the notes after they commit, not in the click frame.
  useEffect(() => {
    if (notesOpen && focusNotesOnOpen.current) {
      focusNotesOnOpen.current = false;
      notesInput.current?.focus();
    }
  }, [notesOpen]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listCategories(), listTags()])
      .then(([categoryResult, tagResult]) => {
        if (cancelled) return;
        setCategories(categoryResult.categories);
        setTags(tagResult.tags);
      })
      .catch(() => {
        // Autocomplete is a convenience. The title remains editable if the
        // shared backend is unavailable while the editor is open.
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
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (event.shiftKey) titleInput.current?.focus();
      else if (notesOpen) notesInput.current?.focus();
      else showNotes();
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
    if (event.key === "Escape" && suggestion && suggestionItems.length > 0) {
      event.preventDefault();
      event.stopPropagation();
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
      if (event.shiftKey) {
        if (notesOpen) notesInput.current?.focus();
        else focusPrioritySection();
      } else {
        focusPrioritySection();
      }
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
      receipt.current = { payload, key: randomUUID() };
    }
    const options = { idempotencyKey: receipt.current.key };
    try {
      if (selectedMainWorkspace() && !parseShorthand(title).title) {
        setTitleError(true);
        titleInput.current?.focus();
        return;
      }
      if (!task) {
        onCreatePending({
          title: title.trim(),
          descriptionMarkdown: description,
          priority,
          ...(parentId ? { parentId } : {}),
        });
      }
      const result = task
        ? await updateTask(task.id, title, description, task.version, { ...options, priority })
        : await createTask(title, description, { ...options, parentId, priority });
      receipt.current = null;
      onSaved(result);
    } catch (caught) {
      setError(caught instanceof BackendCommandError && caught.code === "STALE_TASK_VERSION"
        ? "This task changed elsewhere. Your draft is still here. Copy any changes you want to keep, then cancel and reopen the task."
        : caught instanceof Error ? caught.message : String(caught));
      if (!task) {
        onCreateFailed();
        requestAnimationFrame(() => titleInput.current?.focus());
      }
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
      className="flex w-full min-w-0 flex-col gap-4"
    >
      <FieldGroup>
        <Field className="relative" data-invalid={titleError || undefined}>
          {showContextualHelp && helpTarget === "title" ? <ComposerHelpTooltip target="title" onDisableHelp={onDisableHelp} /> : null}
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
        <Field className="relative">
          {showContextualHelp && helpTarget === "priority" ? <ComposerHelpTooltip target="priority" onDisableHelp={onDisableHelp} /> : null}
          <FieldLabel id={`${id}-priority-label`}>Priority</FieldLabel>
          <div>
            <ButtonGroup
              ref={prioritySection}
              toolbar
              role="radiogroup"
              aria-labelledby={`${id}-priority-label`}
              aria-describedby={showContextualHelp || !showPriorityHelp ? undefined : `${id}-priority-help`}
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
          </div>
          {showPriorityHelp ? <FieldDescription id={`${id}-priority-help`}>Focus here, then press 0–4 or ← → to choose.</FieldDescription> : null}
        </Field>
        {notesOpen ? (
          <Field className="relative">
            {showContextualHelp && helpTarget === "description" ? <ComposerHelpTooltip target="description" onDisableHelp={onDisableHelp} /> : null}
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
              onBlur={(event) => {
                const nextFocus = event.relatedTarget;
                if (!description.trim() && nextFocus instanceof HTMLElement && event.currentTarget.form?.contains(nextFocus)) setNotesOpen(false);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
                  event.preventDefault();
                  if (event.shiftKey) focusPrioritySection();
                  else titleInput.current?.focus();
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
