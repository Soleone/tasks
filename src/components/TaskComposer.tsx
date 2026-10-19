import { randomUUID } from "../lib/randomUUID";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import type { TaskPriority } from "@/backend/taskModel";
import type { ClassificationOption, TaskView } from "./taskView";
import { PRIORITY_META } from "@/components/taskFilters";
import {
  enterAction,
  liftAll,
  liftFinished,
  liftToken,
  shorthandText,
  shorthandTitle,
  suggestionRows,
  tokenBeforeCaret,
  type Classification,
  type Lift,
  type Marker,
  type PartialToken,
  type SuggestionRow,
  type TitleDraft,
} from "./composerShorthand";
import { ClassificationPills, type PillLanding } from "./ClassificationPills";
import {
  createTask,
  listCategories,
  listTags,
  updateTask,
  type TaskMutationResult,
} from "@/platform/backendClient";
import { EditorError } from "@/platform/editorClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { X } from "lucide-react";
import type { KeyboardHelpMode } from "@/keyboardHelp";
import { preventFocusSteal } from "@/navigation";
import { PriorityGroup, PriorityRadio } from "@/components/variants/button-group";
import { QuietInput, QuietTextarea } from "@/components/variants/input";
import { isAndroid } from "@/platform/runtime";
import { KeyboardBar, moveCaret, type Arrow } from "./KeyboardBar";

export type ComposerState =
  | { mode: "create"; parentId?: string; initialTitle?: string }
  | { mode: "edit"; task: TaskView };

export type TaskCreateDraft = {
  title: string;
  description: string;
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

type ComposerField = "title" | "description" | "priority";

const CONTEXTUAL_HELP: Record<ComposerField, { heading: string; text: string }> = {
  title: {
    heading: "Title",
    text: "Type the task title; @category and #tags become pills. Tab completes a suggestion or moves to priority, and Enter saves.",
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

function ComposerHelpTooltip({
  target,
  onDisableHelp,
}: {
  target: ComposerField;
  onDisableHelp: () => void;
}): ReactElement {
  const help = CONTEXTUAL_HELP[target];

  return (
    <Tooltip open>
      <TooltipTrigger
        render={
          <span
            aria-hidden="true"
            tabIndex={-1}
            className="pointer-events-none absolute inset-x-0 top-6 bottom-0"
          />
        }
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

// The highlighted row says what Enter does ("save task", so it reads as more than the name); the
// others only mark a new name or a pill to remove.
function SuggestionNote({
  row,
  action,
}: {
  row: SuggestionRow;
  action: "select" | "save" | "remove" | null;
}): ReactElement | null {
  if (action)
    return (
      <span
        className={
          action === "remove" ? "text-xs text-destructive" : "text-xs text-muted-foreground"
        }
      >
        ↵ {action === "save" ? "save task" : action}
      </span>
    );
  if (row.kind === "remove") return <span className="text-xs text-destructive">remove</span>;
  if (row.kind === "new") return <span className="text-xs text-muted-foreground">new</span>;
  return null;
}

// Shared inline create/edit form. Fields and the priority section own direct
// keyboard navigation; action buttons remain mouse-accessible backups and are
// never Tab destinations.
export function TaskComposer({
  task,
  initialTitle = "",
  parentId,
  onSaved,
  onCreatePending,
  onCreateFailed,
  onCancel,
  helpMode,
  onDisableHelp,
}: TaskComposerProps): ReactElement {
  const id = useId();
  const titleInput = useRef<HTMLInputElement>(null);
  const notesInput = useRef<HTMLTextAreaElement>(null);
  const prioritySection = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  const receipt = useRef<{ payload: string; key: string } | null>(null);
  const focusNotesOnOpen = useRef(false);
  const [initialDraft] = useState(() =>
    task
      ? {
          // The trailing space lets a marker follow straight away.
          text: `${shorthandTitle(task.title)} `,
          classification: {
            category: task.category?.slug ?? null,
            tags: task.tags.map((tag) => tag.slug),
          },
        }
      : liftAll(initialTitle, { category: null, tags: [] }),
  );
  const [title, setTitle] = useState(initialDraft.text);
  const [classification, setClassification] = useState<Classification>(initialDraft.classification);
  const [landing, setLanding] = useState<PillLanding | null>(null);
  // The caret to restore after a lift rewrites the title.
  const pendingCaret = useRef<number | null>(null);
  // The latest lift, so a Backspace right after it can put the token back.
  const lastLift = useRef<{ before: TitleDraft; lift: Lift } | null>(null);
  const [description, setDescription] = useState(task?.description ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 2);
  const [notesOpen, setNotesOpen] = useState(Boolean(task?.description));
  const [pending, setPending] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<ClassificationOption[]>([]);
  const [tags, setTags] = useState<ClassificationOption[]>([]);
  const [suggestion, setSuggestion] = useState<PartialToken | null>(null);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [activeField, setActiveField] = useState<ComposerField>("title");
  const showContextualHelp = helpMode === "full" && !pending;
  const showPriorityHelp = helpMode === "basic" && !pending;

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const input = titleInput.current;
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    });
    return () => cancelAnimationFrame(frame);
  }, [task?.id]);

  // Focus the notes after they commit, not in the click frame.
  useEffect(() => {
    if (notesOpen && focusNotesOnOpen.current) {
      focusNotesOnOpen.current = false;
      notesInput.current?.focus();
    }
  }, [notesOpen]);

  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    titleInput.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [title]);

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

  const suggestionItems: SuggestionRow[] = suggestion
    ? suggestion.marker === "@"
      ? suggestionRows(
          suggestion.query,
          categories,
          classification.category === null ? [] : [classification.category],
        )
      : suggestionRows(suggestion.query, tags, classification.tags)
    : [];

  function updateSuggestion(nextTitle: string, cursor: number): void {
    setSuggestion(tokenBeforeCaret(nextTitle, cursor));
    setSuggestionIndex(0);
  }

  function commitTitle(draft: TitleDraft): void {
    setTitle(draft.text);
    setClassification(draft.classification);
    pendingCaret.current = draft.caret;
    updateSuggestion(draft.text, draft.caret);
  }

  function commitLift(before: TitleDraft, lift: Lift): void {
    commitTitle(lift.draft);
    lastLift.current = { before, lift };
    if (lift.change === "added" || lift.change === "replaced")
      setLanding({ marker: lift.token.marker, slug: lift.token.slug, at: lift.token.start });
  }

  // The row's name replaces the partial one, as text.
  function completeSuggestion(partial: PartialToken, row: SuggestionRow): TitleDraft {
    const replacement = `${partial.marker}${row.slug}`;
    return {
      text: `${title.slice(0, partial.start)}${replacement}${title.slice(partial.end)}`,
      caret: partial.start + replacement.length,
      classification,
    };
  }

  function chooseSuggestion(partial: PartialToken, row: SuggestionRow): void {
    const completed = completeSuggestion(partial, row);
    const token = {
      marker: partial.marker,
      slug: row.slug,
      start: partial.start,
      end: completed.caret,
    };
    commitLift(completed, liftToken(completed, token, true));
  }

  // Backspace right after a lift: the token goes back into the title, without the space that lifted it.
  function undoLift({ before, lift }: { before: TitleDraft; lift: Lift }): void {
    lastLift.current = null;
    const typed = before.text.slice(lift.token.start, lift.token.end);
    const at = lift.token.start;
    commitTitle({
      text: `${lift.draft.text.slice(0, at)}${typed}${lift.draft.text.slice(at)}`,
      caret: at + typed.length,
      classification: before.classification,
    });
  }

  function removePill(marker: Marker, slug: string): void {
    lastLift.current = null;
    setClassification((current) =>
      marker === "@"
        ? { ...current, category: null }
        : { ...current, tags: current.tags.filter((tag) => tag !== slug) },
    );
  }

  function handleSuggestionKeyDown(event: KeyboardEvent<HTMLInputElement>): boolean {
    if (!suggestion || suggestionItems.length === 0) return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveSuggestion(event.key === "ArrowDown" ? 1 : -1);
      return true;
    }
    const row = suggestionItems[suggestionIndex];
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (enterAction(row, suggestion.query) === "save") event.currentTarget.form?.requestSubmit();
      else chooseSuggestion(suggestion, row);
      return true;
    }
    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      tabSuggestion(suggestion, row);
      return true;
    }
    return false;
  }

  function moveSuggestion(delta: -1 | 1): void {
    setSuggestionIndex(
      (current) => (current + delta + suggestionItems.length) % suggestionItems.length,
    );
  }

  // The first Tab completes the name as text; a second one chooses it.
  function tabSuggestion(partial: PartialToken, row: SuggestionRow): void {
    if (row.slug === partial.query) chooseSuggestion(partial, row);
    else {
      lastLift.current = null;
      commitTitle(completeSuggestion(partial, row));
    }
  }

  function showNotes(): void {
    focusNotesOnOpen.current = true;
    setNotesOpen(true);
  }

  function focusPrioritySection(): void {
    prioritySection.current?.focus();
  }

  function stepPriority(delta: -1 | 1): void {
    setPriority((current) => Math.min(4, Math.max(0, current + delta)) as TaskPriority);
  }

  // Tab order: title, priority, description. Tab from priority opens a closed description.
  function focusAfter(field: ComposerField, backward: boolean): void {
    if (field === "title") {
      if (backward && notesOpen) notesInput.current?.focus();
      else focusPrioritySection();
    } else if (field === "priority") {
      if (backward) titleInput.current?.focus();
      else if (notesOpen) notesInput.current?.focus();
      else showNotes();
    } else if (backward) focusPrioritySection();
    else titleInput.current?.focus();
  }

  // The keyboard bar's Tab: the same as the key in the field that has focus.
  function pressTab(backward: boolean): void {
    const row = suggestionItems[suggestionIndex];
    if (activeField === "title" && !backward && suggestion && row) tabSuggestion(suggestion, row);
    else focusAfter(activeField, backward);
  }

  // The keyboard bar's arrows: the same as the keys in the field that has focus.
  function pressArrow(arrow: Arrow): void {
    const delta = arrow === "up" || arrow === "left" ? -1 : 1;
    const vertical = arrow === "up" || arrow === "down";
    if (activeField === "priority") {
      if (!vertical) stepPriority(delta);
    } else if (activeField === "title" && vertical) {
      if (suggestion && suggestionItems.length > 0) moveSuggestion(delta);
    } else {
      const field = activeField === "title" ? titleInput.current : notesInput.current;
      if (field) moveCaret(field, delta, vertical);
    }
  }

  // Types the marker at the caret as an input event, so shorthand sees it like a keypress. Only the
  // description keeps it as text; from priority it goes to the title.
  function insertMarker(marker: Marker): void {
    const field = activeField === "description" ? notesInput.current : titleInput.current;
    if (!field) return;
    field.focus();
    const end = field.selectionEnd ?? field.value.length;
    field.setRangeText(marker, field.selectionStart ?? end, end, "end");
    field.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText", data: marker }),
    );
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
      focusAfter("priority", event.shiftKey);
      return;
    }
    if (
      event.key === "Enter" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      if (event.repeat) return;
      event.preventDefault();
      event.currentTarget.closest("form")?.requestSubmit();
      return;
    }
    if (
      (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      event.preventDefault();
      stepPriority(event.key === "ArrowLeft" ? -1 : 1);
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
    const input = event.currentTarget;
    const lifted = lastLift.current;
    if (
      event.key === "Backspace" &&
      lifted?.lift.draft.text === title &&
      input.selectionStart === lifted.lift.draft.caret &&
      input.selectionEnd === input.selectionStart
    ) {
      event.preventDefault();
      undoLift(lifted);
      return;
    }
    if (event.key === "Escape" && suggestion) {
      event.preventDefault();
      event.stopPropagation();
      lastLift.current = null;
      commitTitle({
        text: `${title.slice(0, suggestion.start)}${title.slice(suggestion.end)}`,
        caret: suggestion.start,
        classification,
      });
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
      focusAfter("title", event.shiftKey);
      return;
    }
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving.current) return;
    // A marker still in the title counts on save, but never removes a pill.
    const lifted = liftAll(title, classification);
    setTitle(lifted.text);
    setClassification(lifted.classification);
    setSuggestion(null);
    if (!lifted.text.trim()) {
      setTitleError(true);
      titleInput.current?.focus();
      return;
    }
    const text = shorthandText(lifted.text, lifted.classification);

    saving.current = true;
    setPending(true);
    setError(null);
    // A lost reply must be retried with the same receipt, not a second write.
    const payload = JSON.stringify([
      text,
      description,
      priority,
      task?.id ?? "new",
      parentId ?? null,
    ]);
    if (receipt.current?.payload !== payload) {
      receipt.current = { payload, key: randomUUID() };
    }
    const options = { idempotencyKey: receipt.current.key };
    try {
      if (!task) {
        onCreatePending({
          title: text,
          description,
          priority,
          ...(parentId ? { parentId } : {}),
        });
      }
      const result = task
        ? await updateTask(task.id, text, description, task.version, { ...options, priority })
        : await createTask(text, description, { ...options, parentId, priority });
      receipt.current = null;
      onSaved(result);
    } catch (caught) {
      setError(
        caught instanceof EditorError && caught.code === "STALE_TASK_VERSION"
          ? "This task changed elsewhere. Your draft is still here. Copy any changes you want to keep, then cancel and reopen the task."
          : caught instanceof Error
            ? caught.message
            : String(caught),
      );
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
          {showContextualHelp && activeField === "title" ? (
            <ComposerHelpTooltip target="title" onDisableHelp={onDisableHelp} />
          ) : null}
          <FieldLabel htmlFor={`${id}-title`}>Title</FieldLabel>
          {/* Anchors the suggestions under the field; a flex column would lift them to its top. */}
          <div className="relative">
            <QuietInput
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
                setTitleError(false);
                lastLift.current = null;
                const draft = {
                  text: event.target.value,
                  caret: event.target.selectionStart ?? event.target.value.length,
                  classification,
                };
                // Pasted text adds what it names; only typing a pill again takes it off.
                const toggle = (event.nativeEvent as InputEvent).inputType !== "insertFromPaste";
                const lift = liftFinished(draft, toggle);
                if (lift) commitLift(draft, lift);
                else {
                  setTitle(draft.text);
                  updateSuggestion(draft.text, draft.caret);
                }
              }}
              onFocus={() => setActiveField("title")}
              onKeyDown={handleTitleKeyDown}
              onClick={(event) =>
                updateSuggestion(
                  event.currentTarget.value,
                  event.currentTarget.selectionStart ?? event.currentTarget.value.length,
                )
              }
            />
            {suggestion && suggestionItems.length > 0 ? (
              <div
                role="listbox"
                aria-label={`${suggestion.marker === "@" ? "Categories" : "Tags"} autocomplete`}
                className="absolute top-full z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
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
                    onClick={() => chooseSuggestion(suggestion, item)}
                  >
                    <span>
                      {suggestion.marker}
                      {item.label}
                    </span>
                    <SuggestionNote
                      row={item}
                      action={
                        index === suggestionIndex ? enterAction(item, suggestion.query) : null
                      }
                    />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <ClassificationPills
            classification={classification}
            landing={landing}
            titleInput={titleInput}
            onRemove={removePill}
          />
          {titleError ? <FieldError id={`${id}-error`}>Write a title first.</FieldError> : null}
        </Field>
        <Field className="relative">
          {showContextualHelp && activeField === "priority" ? (
            <ComposerHelpTooltip target="priority" onDisableHelp={onDisableHelp} />
          ) : null}
          <FieldLabel id={`${id}-priority-label`}>Priority</FieldLabel>
          <div>
            <PriorityGroup
              ref={prioritySection}
              role="radiogroup"
              aria-labelledby={`${id}-priority-label`}
              aria-describedby={
                showContextualHelp || !showPriorityHelp ? undefined : `${id}-priority-help`
              }
              aria-activedescendant={`${id}-priority-${priority}`}
              aria-keyshortcuts="0 1 2 3 4 ArrowLeft ArrowRight"
              aria-disabled={pending || undefined}
              tabIndex={0}
              data-priority-section
              onFocus={() => setActiveField("priority")}
              onKeyDown={handlePriorityKeyDown}
            >
              {PRIORITY_META.map((meta) => {
                const selected = priority === meta.value;
                return (
                  <PriorityRadio
                    key={meta.value}
                    id={`${id}-priority-${meta.value}`}
                    type="button"
                    checked={selected}
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
                    <span
                      aria-hidden="true"
                      className={`inline-block size-2 rounded-full ${meta.dot}`}
                    />
                    {meta.shortLabel}
                  </PriorityRadio>
                );
              })}
            </PriorityGroup>
          </div>
          {showPriorityHelp ? (
            <FieldDescription id={`${id}-priority-help`}>
              Focus here, then press 0–4 or ← → to choose.
            </FieldDescription>
          ) : null}
        </Field>
        {notesOpen ? (
          <Field className="relative">
            {showContextualHelp && activeField === "description" ? (
              <ComposerHelpTooltip target="description" onDisableHelp={onDisableHelp} />
            ) : null}
            <FieldLabel htmlFor={`${id}-description`}>Description</FieldLabel>
            <QuietTextarea
              ref={notesInput}
              id={`${id}-description`}
              name="description"
              placeholder="Write in Markdown…"
              rows={4}
              value={description}
              readOnly={pending}
              onChange={(event) => setDescription(event.target.value)}
              onFocus={() => setActiveField("description")}
              onBlur={(event) => {
                const nextFocus = event.relatedTarget;
                if (
                  !description.trim() &&
                  nextFocus instanceof HTMLElement &&
                  event.currentTarget.form?.contains(nextFocus)
                )
                  setNotesOpen(false);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
                  event.preventDefault();
                  focusAfter("description", event.shiftKey);
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
          <Button
            type="button"
            variant="ghost"
            size="sm"
            tabIndex={-1}
            disabled={pending}
            onClick={onCancel}
          >
            Cancel
          </Button>
          {!notesOpen ? (
            <Button type="button" variant="ghost" size="sm" tabIndex={-1} onClick={showNotes}>
              Add description
            </Button>
          ) : null}
        </div>
        <Button type="submit" size="sm" tabIndex={-1} disabled={pending}>
          {pending ? "Saving…" : task ? "Save changes" : "Add task"}
        </Button>
      </div>
      {isAndroid() ? (
        <KeyboardBar
          disabled={pending}
          onMarker={insertMarker}
          onTab={pressTab}
          onArrow={pressArrow}
        />
      ) : null}
    </form>
  );
}
