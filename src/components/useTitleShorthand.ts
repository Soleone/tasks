import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { addDays, localToday } from "@/backend/dueDate";
import { formatDueDate } from "@/backend/taskDates";
import type { MoveId } from "@/learning/moves";
import { practice } from "@/learning/progress";
import { listTags } from "@/platform/backendClient";
import type { PillLanding } from "./ClassificationPills";
import {
  dueCompletion,
  enterAction,
  liftAll,
  liftFinished,
  liftToken,
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
import type { ClassificationOption, TaskView } from "./taskView";

const MARKER_MOVES: Record<Marker, MoveId> = {
  "@": "shorthand.category",
  "#": "shorthand.tags",
  "!": "shorthand.due",
};

// A pill's name as a quest's success line says it, like "Due tomorrow".
export function practiceMarker(marker: Marker, slug: string): void {
  practice(MARKER_MOVES[marker], "keys", marker === "!" ? formatDueDate(slug, localToday()) : slug);
}

// Markers still in the title when it saves, in the order the pills show them.
export function savedMarkers(before: Classification, after: Classification): [Marker, string][] {
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

// Arrow keys move the highlighted due date by a day or a week.
const dueSteps: Partial<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

/**
 * The title's `@category #tags !date` shorthand: the text, the pills lifted out of it and the
 * suggestions for the marker being typed.
 */
export function useTitleShorthand({
  task,
  initialTitle,
  categories,
}: {
  task?: TaskView;
  initialTitle: string;
  categories: ClassificationOption[];
}) {
  const titleInput = useRef<HTMLInputElement>(null);
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
  const [tags, setTags] = useState<ClassificationOption[]>([]);
  const [suggestion, setSuggestion] = useState<PartialToken | null>(null);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  // A date picked with the arrow keys, until the typed word changes.
  const [dueCursor, setDueCursor] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    titleInput.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [title]);

  useEffect(() => {
    let cancelled = false;
    listTags()
      .then((tagResult) => {
        if (!cancelled) setTags(tagResult.tags);
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

  function changeTitle(event: ChangeEvent<HTMLInputElement>): void {
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
  }

  // A marker still in the title counts on save, but never removes a pill.
  function liftRemaining() {
    const lifted = liftAll(title, classification);
    setTitle(lifted.text);
    setClassification(lifted.classification);
    setSuggestion(null);
    return lifted;
  }

  function handleSuggestionKeyDown(event: KeyboardEvent<HTMLInputElement>): boolean {
    if (!suggestion || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (suggestion.marker === "!") return handleDueKeyDown(event, suggestion);
    if (suggestionItems.length === 0) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setSuggestionIndex(
        (current) => (current + step + suggestionItems.length) % suggestionItems.length,
      );
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
      practice("shorthand.tab");
      // The first Tab completes the name as text; a second one chooses it.
      if (row.slug === suggestion.query) chooseSuggestion(suggestion, row.slug);
      else {
        lastLift.current = null;
        commitTitle(completeSuggestion(suggestion, row.slug));
      }
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

  // The title keys shorthand owns: the suggestions, undoing a lift and dropping a partial marker.
  function handleTitleKeyDown(event: KeyboardEvent<HTMLInputElement>): boolean {
    if (handleSuggestionKeyDown(event)) return true;
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
      return true;
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
      return true;
    }
    return false;
  }

  return {
    titleInput,
    title,
    classification,
    landing,
    suggestion,
    suggestionItems,
    suggestionIndex,
    dueChoice,
    updateSuggestion,
    chooseSuggestion,
    removePill,
    changeTitle,
    liftRemaining,
    handleTitleKeyDown,
  };
}
