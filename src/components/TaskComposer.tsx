import { LoggedWhenPill, loggedAt, type LoggedWhen } from "./LoggedWhen";
import { randomUUID } from "../lib/randomUUID";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { localToday } from "@/backend/dueDate";
import type { TaskPriority } from "@/backend/taskModel";
import type { ClassificationOption, TaskView } from "./taskView";
import { shorthandText, type Marker } from "./composerShorthand";
import { createTask, updateTask, type TaskMutationResult } from "@/platform/backendClient";
import { EditorError } from "@/platform/editorClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, PlaceholderButton } from "@/components/variants/button";
import { ImagePlus } from "lucide-react";
import { cn } from "cn";
import { FieldError } from "@/components/ui/field";
import { practice } from "@/learning/progress";
import { enterEditor, leaveEditor } from "@/learning/questProgress";
import { InlineDescription } from "@/components/variants/input";
import { isMobileApp, modKey } from "@/platform/runtime";
import { KeyboardBar } from "./KeyboardBar";
import { AttachmentRow } from "./AttachmentRow";
import { useDraftImages } from "./useDraftImages";
import { ComposerKeyHints } from "./ComposerKeyHints";
import { ComposerTitleLine } from "./ComposerTitleLine";
import { focusAtEnd, keepInView } from "./fieldFocus";
import { practiceMarker, savedMarkers, useTitleShorthand } from "./useTitleShorthand";

export type ComposerState =
  | {
      mode: "create";
      parentId?: string;
      initialTitle?: string;
      /** Notes and an image shared into the app with the launch (`platform.capture`). */
      initialDescription?: string;
      initialImage?: File;
      logged?: boolean;
    }
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
  initialDescription?: string;
  initialImage?: File;
  parentId?: string;
  /** Every category in the workspace, for `@` suggestions. */
  categories: ClassificationOption[];
  /** Holds the category in the rows' column; off when the rows leave the category out. */
  categoryColumn: boolean;
  onSaved: (result: TaskMutationResult) => void;
  onCreatePending: (draft: TaskCreateDraft) => void;
  onCreateFailed: () => void;
  onCancel: () => void;
  onCopyImage: (name: string) => void;
  /** Logs the new task as already done (`L`), with a "when" pill after the title. */
  logged?: boolean;
};

type ComposerField = "title" | "when" | "description" | "images";

// Shared inline create/edit form. Fields and the priority section own direct
// keyboard navigation; action buttons remain mouse-accessible backups and are
// never Tab destinations.
export function TaskComposer({
  task,
  initialTitle = "",
  initialDescription = "",
  initialImage,
  parentId,
  categories,
  categoryColumn,
  onSaved,
  onCreatePending,
  onCreateFailed,
  onCancel,
  onCopyImage,
  logged = false,
}: TaskComposerProps): ReactElement {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const notesInput = useRef<HTMLTextAreaElement>(null);
  const imageRow = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  const receipt = useRef<{ payload: string; key: string } | null>(null);
  const focusNotesOnOpen = useRef(false);
  const whenPill = useRef<HTMLButtonElement>(null);
  const [when, setWhen] = useState<LoggedWhen>("now");
  const [loggedDay, setLoggedDay] = useState(() => localToday());
  const [description, setDescription] = useState(task?.description ?? initialDescription);
  // Priority is set on the list after saving (`priority.set`), so the editor only carries it.
  const priority: TaskPriority = task?.priority ?? 2;
  const shorthand = useTitleShorthand({ task, initialTitle, categories });
  const { titleInput, classification } = shorthand;
  const images = useDraftImages(task?.attachments ?? [], initialImage);
  const [notesOpen, setNotesOpen] = useState(Boolean(task?.description ?? initialDescription));
  // Writing in the description counts once per editor (`edit.description`).
  const described = useRef(false);
  const [pending, setPending] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeField, setActiveField] = useState<ComposerField>("title");
  // Touch cancels and saves from the keyboard bar (`platform.editor-buttons`).
  const touch = isMobileApp();
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
      focusAtEnd(titleInput.current);
      if (form.current) release = keepInView(form.current);
    });
    return () => {
      cancelAnimationFrame(frame);
      release?.();
    };
  }, [task?.id, titleInput]);

  // Focus the notes after they commit, not in the click frame.
  useEffect(() => {
    if (!notesOpen || !focusNotesOnOpen.current) return undefined;
    focusNotesOnOpen.current = false;
    const input = notesInput.current;
    focusAtEnd(input);
    return input ? keepInView(input) : undefined;
  }, [notesOpen]);

  function showNotes(): void {
    focusNotesOnOpen.current = true;
    setNotesOpen(true);
  }

  // Tab order: title, description, images. Landing on a closed description opens it.
  function focusAfter(field: ComposerField, backward: boolean): void {
    const stops: ComposerField[] = [
      "title",
      ...(logged ? (["when"] as const) : []),
      "description",
      ...(images.attachments.length > 0 ? (["images"] as const) : []),
    ];
    const next = stops[(stops.indexOf(field) + (backward ? stops.length - 1 : 1)) % stops.length];
    if (next === "title") focusAtEnd(titleInput.current);
    else if (next === "when") whenPill.current?.focus();
    else if (next === "images") imageRow.current?.focus();
    else if (notesOpen) focusAtEnd(notesInput.current);
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
    if (field === titleInput.current) shorthand.updateSuggestion(field.value, caret);
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

  function handleTitleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      if (event.key === "Enter") event.preventDefault();
      return;
    }
    if (shorthand.handleTitleKeyDown(event)) return;
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
    const lifted = shorthand.liftRemaining();
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
      const draft = {
        text,
        description,
        priority,
        attachments,
        ...(logged && !task ? { closedAt: loggedAt(when, loggedDay) } : {}),
      };
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
      <ComposerTitleLine
        shorthand={shorthand}
        pending={pending}
        invalid={titleError}
        errorId={`${id}-error`}
        categoryColumn={categoryColumn}
        onEdit={() => setTitleError(false)}
        onFocus={() => setActiveField("title")}
        onKeyDown={handleTitleKeyDown}
        onPaste={pending ? undefined : images.paste}
      />
      {/* Line 2 beside the key hints, so a description starts right under the title. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1 empty:hidden @max-md:basis-full">
        <div className="flex flex-wrap items-start gap-x-2 gap-y-1 empty:hidden">
          {logged && !task ? (
            <LoggedWhenPill
              when={when}
              day={loggedDay}
              onWhen={setWhen}
              onDay={setLoggedDay}
              pillRef={whenPill}
              onKeyDown={(event) => {
                if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey) return;
                if (event.target !== whenPill.current && !event.shiftKey) return;
                event.preventDefault();
                focusAfter("when", event.shiftKey);
              }}
            />
          ) : null}
          {/* The shorthand hint on a bare task; the mouse fallbacks sit at the end of its line. */}
          {classification.category === null &&
          classification.tags.length === 0 &&
          classification.due === null ? (
            <span className="flex min-h-5 grow items-center text-xs text-muted-foreground">
              @category #tags !date
            </span>
          ) : null}
        </div>
        {titleError ? <FieldError id={`${id}-error`}>Write a title first.</FieldError> : null}
        {notesOpen ? (
          <div className="pt-0.5 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1">
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
          <div className="pt-1">
            <PlaceholderButton type="button" tabIndex={-1} disabled={pending} onClick={showNotes}>
              Add a description…
            </PlaceholderButton>
          </div>
        ) : null}
      </div>
      {!touch ? (
        <ComposerKeyHints
          pending={pending}
          notesOpen={notesOpen}
          saveKeys={activeField === "description" ? `${modKey} ↵` : "↵"}
          saveName={task ? "Save changes" : "Add task"}
          onCancel={onCancel}
          onAddDescription={showNotes}
          onPointerSave={() => {
            saveVia.current = "pointer";
          }}
        />
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
