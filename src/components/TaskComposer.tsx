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
import { addDays, localToday } from "@/backend/dueDate";
import type { TaskPriority } from "@/backend/taskModel";
import type { ClassificationOption, TaskView } from "./taskView";
import {
  dueCompletion,
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
import { CategoryColumn } from "./TaskRow";
import { DueDatePicker } from "./DueDatePicker";
import {
  createTask,
  listCategories,
  listTags,
  updateTask,
  type TaskMutationResult,
} from "@/platform/backendClient";
import { EditorError } from "@/platform/editorClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, KeyHintButton, PlaceholderButton } from "@/components/variants/button";
import { ImagePlus } from "lucide-react";
import { cn } from "cn";
import { FieldError } from "@/components/ui/field";
import { formatDueDate } from "@/backend/taskDates";
import type { MoveId } from "@/learning/moves";
import { practice } from "@/learning/progress";
import { enterEditor, leaveEditor } from "@/learning/questProgress";
import { InlineDescription, InlineTitleInput } from "@/components/variants/input";
import { isAndroid, modKey } from "@/platform/runtime";
import { KeyboardBar } from "./KeyboardBar";
import { AttachmentRow } from "./AttachmentRow";
import { useDraftImages } from "./useDraftImages";

export type ComposerState =
  | { mode: "create"; parentId?: string; initialTitle?: string }
  | { mode: "edit"; task: TaskView };

export type TaskCreateDraft = {
  title: string;
  description: string;
  priority: TaskPriority;
  attachments: string[];
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
  onCopyImage: (name: string) => void;
};

type ComposerField = "title" | "description" | "images";

const MARKER_MOVES: Record<Marker, MoveId> = {
  "@": "shorthand.category",
  "#": "shorthand.tags",
  "!": "shorthand.due",
};

// A pill's name as a quest's success line says it, like "Due tomorrow".
function practiceMarker(marker: Marker, slug: string): void {
  practice(MARKER_MOVES[marker], "keys", marker === "!" ? formatDueDate(slug, localToday()) : slug);
}

// Markers still in the title when it saves, in the order the pills show them.
function savedMarkers(before: Classification, after: Classification): [Marker, string][] {
  return [
    ...(after.category !== null && after.category !== before.category
      ? [["@", after.category] as [Marker, string]]
      : []),
    ...after.tags
      .filter((tag) => !before.tags.includes(tag))
      .map((tag): [Marker, string] => ["#", tag]),
    ...(after.due !== null && after.due !== before.due
      ? [["!", after.due] as [Marker, string]]
      : []),
  ];
}

/**
 * Scrolls `element` into view now and again once the on-screen keyboard has
 * resized the window, which happens after focus. Returns its cleanup.
 */
function keepInView(element: HTMLElement): () => void {
  const scroll = () => element.scrollIntoView({ block: "nearest" });
  scroll();
  window.addEventListener("resize", scroll);
  const timeout = window.setTimeout(() => {
    scroll();
    window.removeEventListener("resize", scroll);
  }, 400);
  return () => {
    window.clearTimeout(timeout);
    window.removeEventListener("resize", scroll);
  };
}

// Arrow keys move the highlighted due date by a day or a week.
const TITLE_PLACEHOLDER = "What needs doing?";

const dueSteps: Partial<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

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
  onCopyImage,
}: TaskComposerProps): ReactElement {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const notesInput = useRef<HTMLTextAreaElement>(null);
  const imageRow = useRef<HTMLDivElement>(null);
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
            due: task.due,
          },
        }
      : liftAll(initialTitle, { category: null, tags: [], due: null }),
  );
  const [title, setTitle] = useState(initialDraft.text);
  const [classification, setClassification] = useState<Classification>(initialDraft.classification);
  // A new task's category comes from the category filter, so its pill flies in from there.
  const [landing, setLanding] = useState<PillLanding | null>(() =>
    !task && initialDraft.classification.category !== null
      ? { marker: "@", slug: initialDraft.classification.category, from: "filter" }
      : null,
  );
  // The caret to restore after a lift rewrites the title.
  const pendingCaret = useRef<number | null>(null);
  // The latest lift, so a Backspace right after it can put the token back.
  const lastLift = useRef<Lift | null>(null);
  const [description, setDescription] = useState(task?.description ?? "");
  // Priority is set on the list after saving (`priority.set`), so the editor only carries it.
  const priority: TaskPriority = task?.priority ?? 2;
  const images = useDraftImages(task?.attachments ?? []);
  const [notesOpen, setNotesOpen] = useState(Boolean(task?.description));
  // Writing in the description counts once per editor (`edit.description`).
  const described = useRef(false);
  const [pending, setPending] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<ClassificationOption[]>([]);
  const [tags, setTags] = useState<ClassificationOption[]>([]);
  const [suggestion, setSuggestion] = useState<PartialToken | null>(null);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  // A date picked with the arrow keys, until the typed word changes.
  const [dueCursor, setDueCursor] = useState<string | null>(null);
  const [activeField, setActiveField] = useState<ComposerField>("title");
  // Touch cancels and saves from the keyboard bar (`platform.editor-buttons`).
  const touch = isAndroid();
  // Saving teaches `Enter` unless the Add task button did it.
  const saveVia = useRef<"keys" | "pointer">("keys");

  // Quest steps inside the editor wait for it to be open (`quest.reopen`).
  useEffect(() => {
    enterEditor();
    return leaveEditor;
  }, []);

  // The whole editor comes into view, not only the title, so a row at the bottom of the list
  // opens in full above a soft keyboard (`edit.inline`).
  useEffect(() => {
    let release: (() => void) | undefined;
    const frame = requestAnimationFrame(() => {
      const input = titleInput.current;
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
      if (form.current) release = keepInView(form.current);
    });
    return () => {
      cancelAnimationFrame(frame);
      release?.();
    };
  }, [task?.id]);

  // Focus the notes after they commit, not in the click frame.
  useEffect(() => {
    if (!notesOpen || !focusNotesOnOpen.current) return undefined;
    focusNotesOnOpen.current = false;
    const input = notesInput.current;
    input?.focus();
    return input ? keepInView(input) : undefined;
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

  const suggestionItems: SuggestionRow[] = !suggestion
    ? []
    : suggestion.marker === "@"
      ? suggestionRows(
          suggestion.query,
          categories,
          classification.category === null ? [] : [classification.category],
        )
      : suggestion.marker === "#"
        ? suggestionRows(suggestion.query, tags, classification.tags)
        : [];
  // A bare `!` starts on the date already set, so Enter removes it and the arrows shift it.
  const dueChoice =
    suggestion?.marker !== "!"
      ? null
      : (dueCursor ??
        (suggestion.query === "" && classification.due !== null
          ? classification.due
          : dueCompletion(suggestion.query, localToday())));

  function updateSuggestion(nextTitle: string, cursor: number): void {
    setSuggestion(tokenBeforeCaret(nextTitle, cursor));
    setSuggestionIndex(0);
    setDueCursor(null);
  }

  function commitTitle(draft: TitleDraft): void {
    setTitle(draft.text);
    setClassification(draft.classification);
    pendingCaret.current = draft.caret;
    updateSuggestion(draft.text, draft.caret);
  }

  function commitLift(lift: Lift): void {
    commitTitle(lift.draft);
    lastLift.current = lift;
    if (lift.change === "added" || lift.change === "replaced") {
      setLanding({ marker: lift.token.marker, slug: lift.token.slug, at: lift.token.start });
      practiceMarker(lift.token.marker, lift.token.slug);
    }
  }

  // The chosen name replaces the partial one, as text.
  function completeSuggestion(partial: PartialToken, slug: string): TitleDraft {
    const replacement = `${partial.marker}${slug}`;
    return {
      text: `${title.slice(0, partial.start)}${replacement}${title.slice(partial.end)}`,
      caret: partial.start + replacement.length,
      classification,
    };
  }

  function chooseSuggestion(partial: PartialToken, slug: string): void {
    const completed = completeSuggestion(partial, slug);
    const token = {
      marker: partial.marker,
      slug,
      start: partial.start,
      end: completed.caret,
    };
    commitLift(liftToken(completed, token, true));
  }

  // Backspace right after a lift: the token goes back into the title, without the space that lifted it.
  function undoLift({ before, draft, token }: Lift): void {
    practice("shorthand.unlift");
    lastLift.current = null;
    const typed = before.text.slice(token.start, token.end);
    const at = token.start;
    commitTitle({
      text: `${draft.text.slice(0, at)}${typed}${draft.text.slice(at)}`,
      caret: at + typed.length,
      classification: before.classification,
    });
  }

  function removePill(marker: Marker, slug: string): void {
    lastLift.current = null;
    setClassification((current) =>
      marker === "@"
        ? { ...current, category: null }
        : marker === "!"
          ? { ...current, due: null }
          : { ...current, tags: current.tags.filter((tag) => tag !== slug) },
    );
  }

  function handleSuggestionKeyDown(event: KeyboardEvent<HTMLInputElement>): boolean {
    if (!suggestion || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (suggestion.marker === "!") return handleDueKeyDown(event, suggestion);
    if (suggestionItems.length === 0) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveSuggestion(event.key === "ArrowDown" ? 1 : -1);
      return true;
    }
    const row = suggestionItems[suggestionIndex];
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (enterAction(row, suggestion.query) === "save") event.currentTarget.form?.requestSubmit();
      else chooseSuggestion(suggestion, row.slug);
      return true;
    }
    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      tabSuggestion(suggestion, row);
      return true;
    }
    return false;
  }

  // Enter and Tab always lift the date, so its pill shows before the task saves.
  function handleDueKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
    partial: PartialToken,
  ): boolean {
    if (event.shiftKey) return false;
    const step = dueSteps[event.key];
    if (step !== undefined) {
      event.preventDefault();
      setDueCursor(addDays(dueChoice ?? localToday(), step));
      return true;
    }
    if (dueChoice === null || (event.key !== "Enter" && event.key !== "Tab")) return false;
    event.preventDefault();
    chooseSuggestion(partial, dueChoice);
    return true;
  }

  function moveSuggestion(delta: -1 | 1): void {
    setSuggestionIndex(
      (current) => (current + delta + suggestionItems.length) % suggestionItems.length,
    );
  }

  // The first Tab completes the name as text; a second one chooses it.
  function tabSuggestion(partial: PartialToken, row: SuggestionRow): void {
    practice("shorthand.tab");
    if (row.slug === partial.query) chooseSuggestion(partial, row.slug);
    else {
      lastLift.current = null;
      commitTitle(completeSuggestion(partial, row.slug));
    }
  }

  function showNotes(): void {
    focusNotesOnOpen.current = true;
    setNotesOpen(true);
  }

  // Tab order: title, description, images. Landing on a closed description opens it.
  function focusAfter(field: ComposerField, backward: boolean): void {
    const stops: ComposerField[] =
      images.attachments.length > 0 ? ["title", "description", "images"] : ["title", "description"];
    const next = stops[(stops.indexOf(field) + (backward ? stops.length - 1 : 1)) % stops.length];
    if (next === "title") titleInput.current?.focus();
    else if (next === "images") imageRow.current?.focus();
    else if (notesOpen) notesInput.current?.focus();
    else showNotes();
  }

  function removeImage(name: string): void {
    images.remove(name);
    if (images.attachments.length === 1 && activeField === "images") titleInput.current?.focus();
  }

  function handleImageKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      focusAfter("images", event.shiftKey);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!pending) titleInput.current?.focus();
    } else if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.repeat
    ) {
      event.preventDefault();
      event.currentTarget.closest("form")?.requestSubmit();
    }
  }

  function moveCursor(direction: -1 | 1): void {
    const field = activeField === "description" ? notesInput.current : titleInput.current;
    if (!field) return;
    field.focus();
    const start = field.selectionStart ?? 0;
    const end = field.selectionEnd ?? start;
    let caret = direction === -1 ? start : end;
    if (start === end) {
      const adjacent =
        direction === -1
          ? Array.from(field.value.slice(0, caret)).at(-1)
          : Array.from(field.value.slice(caret))[0];
      caret += direction * (adjacent?.length ?? 0);
    }
    field.setSelectionRange(caret, caret);
    if (field === titleInput.current) updateSuggestion(field.value, caret);
  }

  // Types the marker at the caret as an input event, so shorthand sees it like a keypress. Only the
  // description keeps it as text; from the image row it goes to the title.
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
      lifted?.draft.text === title &&
      input.selectionStart === lifted.draft.caret &&
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
    if (saving.current || images.picking) return;
    const via = saveVia.current;
    saveVia.current = "keys";
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
    for (const [marker, slug] of savedMarkers(classification, lifted.classification))
      practiceMarker(marker, slug);
    practice("capture.save", via);
    const text = shorthandText(lifted.text, lifted.classification);

    saving.current = true;
    setPending(true);
    setError(null);
    const attachments = [...(await images.settled())];
    // A lost reply must be retried with the same receipt, not a second write.
    const payload = JSON.stringify([
      text,
      description,
      priority,
      attachments,
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
          attachments,
          ...(parentId ? { parentId } : {}),
        });
      }
      const draft = { text, description, priority, attachments };
      const result = task
        ? await updateTask(task.id, draft, task.version, options)
        : await createTask(draft, { ...options, parentId });
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

  const pillProps = {
    classification,
    landing,
    typing: suggestion,
    titleInput,
    onRemove: removePill,
  };
  return (
    <form
      ref={form}
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
      // One wrapping flow, so a narrow editor moves the key hints under everything else. On touch
      // it keeps clear of the keyboard bar when scrolled into view.
      className={cn(
        "@container flex w-full min-w-0 flex-wrap items-start gap-x-2 gap-y-1",
        touch && "scroll-mb-12",
      )}
    >
      {/* The title line mirrors the row: the field, the due date, the empty arrow slot and the
          category column. A narrow editor gives the one-line field the whole line and drops the
          rest below it, still in their columns. */}
      <div className="flex min-w-0 basis-full flex-wrap items-start gap-x-2.5 gap-y-1">
        {/* Anchors the suggestions under the field; a flex column would lift them to its top. */}
        <div className="relative min-w-0 flex-1 @max-md:basis-full">
          {/* The field is as wide as its text, so the tags follow it as they do in the row. A click on
              the rest of the line still lands in the field, at its end. */}
          <div
            className="flex min-w-0 flex-wrap items-center gap-1"
            onMouseDown={(event) => {
              const input = titleInput.current;
              if (event.target !== event.currentTarget || !input) return;
              event.preventDefault();
              input.focus();
              input.setSelectionRange(input.value.length, input.value.length);
            }}
          >
            <div className="inline-grid max-w-full grid-cols-1">
              <span
                aria-hidden="true"
                className="invisible col-start-1 row-start-1 overflow-hidden text-sm leading-snug font-medium whitespace-pre"
              >
                {title || TITLE_PLACEHOLDER}
              </span>
              <InlineTitleInput
                className="col-start-1 row-start-1"
                // A field's natural width is 20 characters; the text sizer beside it sets the width.
                size={1}
                ref={titleInput}
                aria-label="Title"
                name="title"
                autoComplete="off"
                // Without a hint, a soft keyboard offers Next when the description follows.
                enterKeyHint="go"
                placeholder={TITLE_PLACEHOLDER}
                value={title}
                readOnly={pending}
                required
                aria-invalid={titleError || undefined}
                aria-describedby={titleError ? `${id}-error` : undefined}
                aria-expanded={
                  suggestion !== null && (suggestion.marker === "!" || suggestionItems.length > 0)
                }
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
                  if (lift) commitLift(lift);
                  else {
                    setTitle(draft.text);
                    updateSuggestion(draft.text, draft.caret);
                  }
                }}
                onFocus={() => setActiveField("title")}
                onKeyDown={handleTitleKeyDown}
                onPaste={pending ? undefined : images.paste}
                onClick={(event) =>
                  updateSuggestion(
                    event.currentTarget.value,
                    event.currentTarget.selectionStart ?? event.currentTarget.value.length,
                  )
                }
              />
            </div>
            <ClassificationPills kind="tag" {...pillProps} />
          </div>
          {suggestion?.marker === "!" ? (
            <DueDatePicker
              key={dueChoice ?? "none"}
              choice={dueChoice}
              current={classification.due}
              onPick={(due) => chooseSuggestion(suggestion, due)}
            />
          ) : null}
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
                  onClick={() => chooseSuggestion(suggestion, item.slug)}
                >
                  <span>
                    {suggestion.marker}
                    {item.label}
                  </span>
                  <SuggestionNote
                    row={item}
                    action={index === suggestionIndex ? enterAction(item, suggestion.query) : null}
                  />
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="ml-auto flex gap-2.5">
          <ClassificationPills kind="due" {...pillProps} />
          <span className="w-7 shrink-0" />
          <CategoryColumn>
            <ClassificationPills kind="category" {...pillProps} />
          </CategoryColumn>
        </div>
      </div>
      {/* The shorthand hint on a bare task; the mouse fallbacks sit at the end of its line. */}
      {classification.category === null &&
      classification.tags.length === 0 &&
      classification.due === null ? (
        <span className="flex min-h-5 grow items-center text-xs text-muted-foreground">
          @category #tags !date
        </span>
      ) : null}
      {!touch ? (
        <div className="-my-0.5 ml-auto flex items-center justify-end gap-0.5 motion-safe:animate-in motion-safe:fade-in @max-md:order-last @max-md:basis-full">
          <KeyHintButton
            keys="Esc"
            disabled={pending}
            onClick={onCancel}
            tabIndex={-1}
            type="button"
          >
            Cancel
          </KeyHintButton>
          {!notesOpen ? (
            <KeyHintButton
              keys="Tab"
              aria-label="Add description"
              onClick={showNotes}
              tabIndex={-1}
              type="button"
            >
              Description
            </KeyHintButton>
          ) : null}
          <KeyHintButton
            keys={activeField === "description" ? `${modKey} ↵` : "↵"}
            aria-label={task ? "Save changes" : "Add task"}
            disabled={pending}
            onClick={() => {
              saveVia.current = "pointer";
            }}
            tabIndex={-1}
            type="submit"
          >
            {pending ? "Saving…" : "Save"}
          </KeyHintButton>
        </div>
      ) : null}
      {titleError ? (
        <div className="basis-full">
          <FieldError id={`${id}-error`}>Write a title first.</FieldError>
        </div>
      ) : null}
      {notesOpen ? (
        <div className="basis-full pt-1 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1">
          <InlineDescription
            ref={notesInput}
            className={cn(touch && "scroll-mb-12")}
            aria-label="Description"
            name="description"
            placeholder="Write in Markdown…"
            value={description}
            readOnly={pending}
            onChange={(event) => {
              if (!described.current && event.target.value.trim()) {
                described.current = true;
                practice("edit.description");
              }
              setDescription(event.target.value);
            }}
            onFocus={() => setActiveField("description")}
            onPaste={pending ? undefined : images.paste}
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
                if (!pending) onCancel();
              }
            }}
          />
        </div>
      ) : touch ? (
        <div className="basis-full pt-1">
          <PlaceholderButton type="button" tabIndex={-1} disabled={pending} onClick={showNotes}>
            Add a description…
          </PlaceholderButton>
        </div>
      ) : null}
      {touch ? (
        <div className="basis-full pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            tabIndex={-1}
            disabled={pending || images.picking}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void images.pick()}
          >
            <ImagePlus data-icon="inline-start" aria-hidden="true" />
            Add image
          </Button>
        </div>
      ) : null}
      {images.attachments.length > 0 ? (
        <div className="basis-full pt-1">
          <AttachmentRow
            ref={imageRow}
            id={id}
            names={images.attachments}
            onRemove={removeImage}
            onCopy={onCopyImage}
            onFocus={() => setActiveField("images")}
            onKeyDown={handleImageKeyDown}
          />
        </div>
      ) : null}
      <div className="flex basis-full flex-col gap-2 empty:hidden">
        {images.error ? (
          <Alert variant="destructive">
            <AlertTitle>Image not added</AlertTitle>
            <AlertDescription>{images.error}</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Could not save</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </div>
      {touch ? (
        <KeyboardBar
          disabled={pending || images.picking}
          onMarker={insertMarker}
          onMoveCursor={moveCursor}
          saveLabel="Save"
          saveName={task ? "Save changes" : "Add task"}
          onSave={() => form.current?.requestSubmit()}
        />
      ) : null}
    </form>
  );
}
