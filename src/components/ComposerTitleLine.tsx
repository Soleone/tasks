import type { ClipboardEvent, KeyboardEvent, ReactElement } from "react";
import { InlineTitleInput } from "@/components/variants/input";
import { ClassificationPills } from "./ClassificationPills";
import { enterAction, type PartialToken, type SuggestionRow } from "./composerShorthand";
import { DueDatePicker } from "./DueDatePicker";
import { focusAtEnd } from "./fieldFocus";
import { CategoryColumn } from "./TaskRow";
import type { useTitleShorthand } from "./useTitleShorthand";

const TITLE_PLACEHOLDER = "What needs doing?";

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

// The `@` and `#` autocomplete under the title.
function ShorthandSuggestions({
  suggestion,
  items,
  index: suggestionIndex,
  onChoose,
}: {
  suggestion: PartialToken;
  items: SuggestionRow[];
  index: number;
  onChoose: (slug: string) => void;
}): ReactElement {
  return (
    <div
      role="listbox"
      aria-label={`${suggestion.marker === "@" ? "Categories" : "Tags"} autocomplete`}
      className="absolute top-full z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {items.map((item, index) => (
        <button
          key={item.slug}
          type="button"
          role="option"
          aria-selected={index === suggestionIndex}
          tabIndex={-1}
          className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted aria-selected:bg-muted"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChoose(item.slug)}
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
  );
}

// The title line mirrors the row: the field, the due date, the empty arrow slot and the category
// column.
export function ComposerTitleLine({
  shorthand,
  pending,
  invalid,
  errorId,
  categoryColumn,
  onEdit,
  onFocus,
  onKeyDown,
  onPaste,
}: {
  shorthand: ReturnType<typeof useTitleShorthand>;
  pending: boolean;
  invalid: boolean;
  errorId: string;
  categoryColumn: boolean;
  onEdit: () => void;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onPaste: ((event: ClipboardEvent<HTMLElement>) => void) | undefined;
}): ReactElement {
  const { titleInput, title, classification, suggestion, suggestionItems, dueChoice } = shorthand;
  const pillProps = {
    classification,
    landing: shorthand.landing,
    typing: suggestion,
    titleInput,
    onRemove: shorthand.removePill,
  };
  return (
    <div className="flex min-w-0 basis-full items-start gap-2.5">
      {/* Anchors the suggestions under the field; a flex column would lift them to its top. */}
      <div className="relative min-w-0 flex-1">
        {/* The field is as wide as its text, so the tags follow it as they do in the row. A click on
          the rest of the line still lands in the field, at its end. */}
        <div
          className="flex min-w-0 flex-wrap items-center gap-1"
          onMouseDown={(event) => {
            if (event.target !== event.currentTarget) return;
            event.preventDefault();
            focusAtEnd(titleInput.current);
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
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? errorId : undefined}
              aria-expanded={
                suggestion !== null && (suggestion.marker === "!" || suggestionItems.length > 0)
              }
              aria-autocomplete="list"
              onChange={(event) => {
                onEdit();
                shorthand.changeTitle(event);
              }}
              onFocus={onFocus}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onClick={(event) =>
                shorthand.updateSuggestion(
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
            onPick={(due) => shorthand.chooseSuggestion(suggestion, due)}
          />
        ) : null}
        {suggestion && suggestionItems.length > 0 ? (
          <ShorthandSuggestions
            suggestion={suggestion}
            items={suggestionItems}
            index={shorthand.suggestionIndex}
            onChoose={(slug) => shorthand.chooseSuggestion(suggestion, slug)}
          />
        ) : null}
      </div>
      <div className="ml-auto flex gap-2.5">
        <ClassificationPills kind="due" {...pillProps} />
        <span className="w-7 shrink-0" />
        {categoryColumn ? (
          <CategoryColumn grow>
            <ClassificationPills kind="category" {...pillProps} />
          </CategoryColumn>
        ) : (
          <div className="flex h-[1.375em] items-center">
            <ClassificationPills kind="category" {...pillProps} />
          </div>
        )}
      </div>
    </div>
  );
}
