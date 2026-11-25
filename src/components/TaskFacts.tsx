import type { ReactElement, ReactNode } from "react";
import { CalendarDays, Folder } from "lucide-react";
import { cn } from "cn";
import type { ClassificationToken } from "@/backend/taskText";
import { preventFocusSteal } from "@/navigation";
import { useSharedSettings } from "@/platform/sharedSettings";
import { Hinted } from "./Hinted";
import { flyCategoryToFilter } from "./categoryFlight";

/**
 * The category column: one width down the list, so the due dates and chevrons before it line up.
 * The list measures its widest category into `--category-column-width`; long names still truncate.
 * The editor's column can grow past it for a category that is new.
 */
export function CategoryColumn({
  grow = false,
  children,
}: {
  grow?: boolean;
  children?: ReactNode;
}): ReactElement {
  return (
    <div
      className={cn(
        "flex h-[1.375em] shrink-0 items-center max-w-20 sm:max-w-28",
        grow
          ? "min-w-[min(var(--category-column-width),5rem)] sm:min-w-[min(var(--category-column-width),7rem)]"
          : "w-(--category-column-width)",
      )}
    >
      {children}
    </div>
  );
}

// Letters matching what is typed after `@` or `#`: finishing that name would remove the pill.
const TYPED = "bg-transparent text-warning";

/**
 * A category as quiet text at the row's end, cut short when it outgrows the column. Its folder
 * takes the category's color from Settings › Categories.
 */
export function CategoryFact({
  label,
  typed = 0,
  children,
}: {
  label: string;
  /** How many leading letters match a name being typed in the editor. */
  typed?: number;
  children?: ReactNode;
}): ReactElement {
  const swatch = useSharedSettings().colors[label];
  return (
    <span
      data-category={label}
      className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground group-hover/fact:text-foreground"
    >
      <Folder
        className={cn(
          "size-3.5 shrink-0",
          swatch ? "text-(--swatch)" : "text-classification-category",
        )}
        data-swatch={swatch}
        aria-hidden="true"
      />
      <span className="truncate">
        {typed > 0 && <mark className={TYPED}>{label.slice(0, typed)}</mark>}
        {label.slice(typed)}
      </span>
      {children}
    </span>
  );
}

/** A tag as quiet text after the title. */
export function TagFact({
  label,
  typed = 0,
  children,
}: {
  label: string;
  /** How many leading letters match a name being typed in the editor. */
  typed?: number;
  children?: ReactNode;
}): ReactElement {
  return (
    <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground group-hover/fact:text-foreground">
      <span>
        {typed > 0 ? (
          <mark className={TYPED}>
            <span aria-hidden="true">#</span>
            {label.slice(0, typed)}
          </mark>
        ) : (
          <span aria-hidden="true" className="text-muted-foreground/60">
            #
          </span>
        )}
        {label.slice(typed)}
      </span>
      {children}
    </span>
  );
}

/** A due date as quiet text at the row's end; today and late are red. */
export function DueFact({
  label,
  now,
  children,
}: {
  label: string;
  now: boolean;
  children?: ReactNode;
}): ReactElement {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs whitespace-nowrap",
        now ? "text-destructive" : "text-muted-foreground",
      )}
    >
      <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
      {label}
      {children}
    </span>
  );
}

export function TaskRowCategory({
  category,
  onSelectCategory,
}: {
  category: ClassificationToken | null;
  onSelectCategory?: (category: ClassificationToken) => void;
}): ReactElement {
  if (!category) {
    return (
      <CategoryColumn>
        <span className="sr-only">No category</span>
      </CategoryColumn>
    );
  }
  if (!onSelectCategory) {
    return (
      <CategoryColumn>
        <CategoryFact label={category.label} />
      </CategoryColumn>
    );
  }
  return (
    <CategoryColumn>
      {/* A pointer shortcut inside a list option, like the status glyph.
          Keyboard filtering belongs to the list/toolbar, not a nested button. */}
      <Hinted
        hint={`Filter by ${category.label}`}
        render={
          <span
            role="img"
            tabIndex={-1}
            data-task-category={category.slug}
            aria-label={`Category ${category.label}. Click to filter; press @ to choose a category.`}
            onMouseDown={preventFocusSteal}
            onClick={(event) => {
              event.stopPropagation();
              flyCategoryToFilter(event.currentTarget);
              onSelectCategory(category);
            }}
            className="group/fact flex min-w-0 cursor-pointer"
          />
        }
      >
        <CategoryFact label={category.label} />
      </Hinted>
    </CategoryColumn>
  );
}

export function TaskRowTag({
  tag,
  onSelectTag,
}: {
  tag: ClassificationToken;
  onSelectTag?: (tag: ClassificationToken) => void;
}): ReactElement {
  if (!onSelectTag) {
    return (
      <span data-task-tag>
        <TagFact label={tag.label} />
      </span>
    );
  }
  return (
    // A pointer shortcut inside a list option, like the category.
    <Hinted
      hint={`Filter by #${tag.label}`}
      render={
        <span
          role="img"
          tabIndex={-1}
          data-task-tag={tag.slug}
          aria-label={`Tag ${tag.label}. Click to filter; press # to choose tags.`}
          onMouseDown={preventFocusSteal}
          onClick={(event) => {
            event.stopPropagation();
            onSelectTag(tag);
          }}
          className="group/fact cursor-pointer"
        />
      }
    >
      <TagFact label={tag.label} />
    </Hinted>
  );
}
