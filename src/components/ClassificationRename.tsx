import { useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import type { ClassificationOption } from "./taskView";
import { KeyHintButton } from "@/components/variants/button";
import { modKey } from "@/platform/runtime";
import { renameClassification, type RenameResult } from "@/platform/backendClient";
import { useLoadOnOpen } from "./useLoadOnOpen";

const SLUG = /^[a-z](?:[a-z0-9_-]*[a-z0-9_])?$/;

export type Renamed = { from: string; to: string } & RenameResult;

type Draft = {
  from: string;
  to: string;
  refused: boolean;
  saving: boolean;
  failure: string | null;
};

function isRenameKey(event: KeyboardEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "r"
  );
}

/** The cmdk value of a picker row, so the highlight can be found and set. */
export function itemValue(option: { slug: string; label: string }): string {
  return `${option.label} ${option.slug}`;
}

/**
 * Rename mode for the category and tag pickers: Ctrl/⌘+R or the footer turns the highlighted row
 * into a field, the footer explains what Enter will do, and a saved rename reloads the options
 * with the new name highlighted.
 */
export function useClassificationRename({
  open,
  kind,
  load,
  searchInput,
  onRenamed,
}: {
  open: boolean;
  kind: "category" | "tag";
  /** Must be stable, as for useLoadOnOpen. */
  load: () => Promise<ClassificationOption[]>;
  searchInput: RefObject<HTMLInputElement | null>;
  onRenamed: (renamed: Renamed) => void;
}) {
  // A new function reloads the options (see useLoadOnOpen).
  const [reload, setReload] = useState(() => load);
  const { value, loading, error } = useLoadOnOpen(open, reload);
  const options = value ?? [];
  const [highlight, setHighlight] = useState("");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  // The new name to highlight once the reloaded options hold it.
  const [follow, setFollow] = useState<string | null>(null);
  if (follow !== null && !loading && options.some((option) => itemValue(option) === follow)) {
    setHighlight(follow);
    setFollow(null);
  }
  const marker = kind === "tag" ? "#" : "@";
  const highlighted = options.find((option) => itemValue(option) === highlight);
  const update = (patch: Partial<Draft>) =>
    setDraft((previous) => previous && { ...previous, ...patch });

  function start(): void {
    if (highlighted && !draft)
      setDraft({
        from: highlighted.slug,
        to: highlighted.slug,
        refused: false,
        saving: false,
        failure: null,
      });
  }

  function leave(): void {
    setDraft(null);
    requestAnimationFrame(() => searchInput.current?.focus());
  }

  async function save(): Promise<void> {
    if (!draft || draft.saving || draft.to === draft.from || !SLUG.test(draft.to)) return;
    const { from, to } = draft;
    update({ saving: true, failure: null });
    try {
      const result = await renameClassification(kind, from, to);
      // Clear the search so the new name shows, highlighted.
      setSearch("");
      setFollow(itemValue({ slug: to, label: to }));
      setReload(() => () => load());
      leave();
      onRenamed({ from, to, ...result });
    } catch (caught) {
      update({ saving: false, failure: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  function handleFieldKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    // The field owns every key: no list navigation, selection or dialog Escape.
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;
    if (isRenameKey(event) || event.key === "Enter" || event.key === "Escape")
      event.preventDefault();
    if (event.key === "Enter") void save();
    if (event.key === "Escape" && !draft?.saving) leave();
  }

  return {
    options,
    loading,
    error,
    /** Selecting is off while a row is being renamed. */
    renaming: draft !== null,
    commandProps: {
      value: highlight,
      onValueChange: setHighlight,
      onKeyDown: (event: KeyboardEvent) => {
        if (!isRenameKey(event)) return;
        // Keep the browser from reloading the page, whatever the picker shows.
        event.preventDefault();
        start();
      },
    },
    searchProps: { value: search, onValueChange: setSearch, readOnly: draft !== null },
    /** The renaming row's field, or null for a row shown as usual. */
    field: (option: ClassificationOption): ReactNode =>
      draft?.from === option.slug ? (
        <input
          ref={(input) => {
            if (!input || input === document.activeElement) return;
            input.focus();
            input.select();
          }}
          aria-label={`Rename ${marker}${draft.from}`}
          aria-describedby="classification-rename-hint"
          className="-my-0.5 -ml-1.5 h-6 w-full min-w-0 flex-1 rounded-sm bg-background px-1.5 font-medium outline-1 outline-ring"
          value={draft.to}
          readOnly={draft.saving}
          spellCheck={false}
          autoComplete="off"
          onKeyDown={handleFieldKeyDown}
          // A click in the field must not select the row underneath.
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            const next = event.target.value.toLowerCase().replaceAll(" ", "-");
            const allowed = /^[a-z0-9_-]*$/.test(next);
            update({ refused: !allowed, failure: null, ...(allowed ? { to: next } : {}) });
          }}
        />
      ) : null,
    footer: draft ? (
      <div
        id="classification-rename-hint"
        role={draft.failure ? "alert" : undefined}
        className="flex min-h-9 items-center gap-2 border-t px-3.5 py-1.5 text-xs text-muted-foreground"
      >
        {hint(draft, marker, options)}
        {draft.failure ? (
          <KeyHintButton onClick={() => void save()} className="ml-auto">
            Retry
          </KeyHintButton>
        ) : null}
      </div>
    ) : highlighted ? (
      <div className="flex min-h-9 items-center border-t px-1.5">
        <KeyHintButton keys={`${modKey}+R`} onClick={start}>
          Rename {marker}
          {highlighted.slug}
        </KeyHintButton>
      </div>
    ) : null,
  };
}

function hint(draft: Draft, marker: string, options: ClassificationOption[]): string {
  const { from, to } = draft;
  const target = options.find((option) => option.slug === to);
  if (draft.failure) return draft.failure;
  if (draft.refused) return "Use letters, digits, - and _.";
  if (!to || to === from) return `Type a new name for ${marker}${from}.`;
  if (!SLUG.test(to)) return "Start with a letter, and end with a letter, digit or _.";
  if (target)
    return `Merges ${marker}${from} into ${marker}${to} (${target.taskCount} ${target.taskCount === 1 ? "task" : "tasks"}).`;
  return `Rename ${marker}${from} to ${marker}${to}. Done and canceled tasks change too.`;
}
