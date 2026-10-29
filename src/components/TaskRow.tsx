import { Fragment, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { CalendarDays, Folder, ShieldBan } from "lucide-react";
import { cn } from "cn";
import type { ClassificationToken } from "@/backend/taskText";
import type { TaskView } from "./taskView";
import { daysBetween, localToday } from "@/backend/dueDate";
import {
  dueSoonLabel,
  formatCompletedTime,
  formatDueDate,
  formatTaskDate,
  formatTaskDateTime,
  sameTaskDay,
} from "@/backend/taskDates";
import {
  isSolidGlyph,
  priorityMeta,
  statusGlyphColor,
  taskStatusMeta,
  taskTitleClass,
} from "@/components/taskFilters";
import { modKey } from "@/platform/runtime";
import { preventFocusSteal } from "@/navigation";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TaskItemDescription, TaskItemTitle, TaskItemTrailing } from "@/components/variants/item";
import { useFlashTooltip } from "./useFlashTooltip";
import { flyCategoryToFilter } from "./categoryFlight";

export type TaskRowVariant = "full" | "compact";

export function taskContextMessage(indented: boolean): string {
  return indented
    ? "Shown with parent, outside current results."
    : "Shown because a child matches the current filters.";
}

/** The status icon; a highest-priority active task gets a filled disc with the icon cut out of it. */
export function StatusGlyph({
  task,
  entrance = null,
}: {
  task: Pick<TaskView, "status" | "priority">;
  /** What changed last, so the glyph plays its entrance. */
  entrance?: "status" | "priority" | null;
}): ReactElement {
  const Icon = taskStatusMeta[task.status].Icon;
  const enter = {
    "data-status-enter": entrance === "status" ? task.status : undefined,
    "data-priority-enter": entrance === "priority" || undefined,
  };
  if (!isSolidGlyph(task)) return <Icon className="size-5" aria-hidden="true" {...enter} />;
  return (
    <span
      className="grid size-5 place-items-center rounded-full bg-current"
      aria-hidden="true"
      {...enter}
    >
      {task.status === "in_progress" ? (
        <Icon className="size-3 text-primary-foreground" strokeWidth={3.5} />
      ) : null}
    </span>
  );
}

/** Informational status icon. Interactive toggling stays with the list. */
export function TaskStatusDisplay({
  task,
}: {
  task: Pick<TaskView, "status" | "priority">;
}): ReactElement {
  const status = taskStatusMeta[task.status];
  return (
    <span
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full",
        statusGlyphColor(task),
      )}
      role="img"
      aria-label={`Status: ${status.label}, priority ${priorityMeta(task.priority).label}`}
    >
      <StatusGlyph task={task} />
    </span>
  );
}

/** Which of the glyph's two meanings changed last, so a fresh mount stays still. */
function useGlyphEntrance(task: TaskView): "status" | "priority" | null {
  const [seen, setSeen] = useState({ status: task.status, priority: task.priority });
  const [entrance, setEntrance] = useState<"status" | "priority" | null>(null);
  if (seen.status !== task.status || seen.priority !== task.priority) {
    setSeen({ status: task.status, priority: task.priority });
    setEntrance(seen.status !== task.status ? "status" : "priority");
  }
  return entrance;
}

const STATUS_FEEDBACK_DURATION_MS = 900;

export function TaskStatusToggle({
  task,
  pending,
  feedbackVersion,
  sheenStep,
  nextLabel,
  previousLabel,
  onToggle,
}: {
  task: TaskView;
  pending: boolean;
  feedbackVersion?: number;
  /** Set while this client's own completion plays its sheen; the step staggers a batch. */
  sheenStep?: number;
  nextLabel: string;
  previousLabel: string;
  onToggle: (task: TaskView) => void;
}): ReactElement {
  const feedback = useFlashTooltip(feedbackVersion, STATUS_FEEDBACK_DURATION_MS);
  const entrance = useGlyphEntrance(task);
  const status = taskStatusMeta[task.status];
  const priority = priorityMeta(task.priority);
  const pauseHint =
    task.status === "open" || task.status === "in_progress"
      ? " Press P to pause."
      : task.status === "paused"
        ? " Press P to resume."
        : "";

  return (
    <Tooltip open={feedback.open} onOpenChange={feedback.onOpenChange}>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={`Status: ${status.label}, priority ${priority.label}. Click or press Space to change it to ${nextLabel}; press Shift+Space to change it to ${previousLabel}.${pauseHint}`}
            tabIndex={-1}
            data-status={task.status}
            data-priority={priority.shortLabel}
            data-status-pending={pending || undefined}
            data-completion-sheen={sheenStep !== undefined || undefined}
            style={
              sheenStep !== undefined ? ({ "--sheen-step": sheenStep } as CSSProperties) : undefined
            }
            className={cn(
              "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-muted",
              statusGlyphColor(task),
              pending && "animate-pulse opacity-60",
            )}
            onMouseDown={preventFocusSteal}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(task);
            }}
          />
        }
      >
        {/* Keyed so each new status or priority remounts the glyph and plays its entrance once. */}
        <StatusGlyph
          key={`${task.status}-${priority.shortLabel}`}
          task={task}
          entrance={entrance}
        />
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {!feedback.flashing
          ? `${status.label}, priority ${priority.label}`
          : entrance === "priority"
            ? priority.shortLabel
            : status.label}
      </TooltipContent>
    </Tooltip>
  );
}

/** The category column: one width down the list, so the due dates and chevrons before it line up. */
export function CategoryColumn({ children }: { children?: ReactNode }): ReactElement {
  return <div className="flex h-[1.375em] w-20 shrink-0 items-center sm:w-28">{children}</div>;
}

// Letters matching what is typed after `@` or `#`: finishing that name would remove the pill.
const TYPED = "bg-transparent text-warning";

/** A category as quiet text at the row's end, cut short when it outgrows the column. */
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
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground group-hover/fact:text-foreground">
      <Folder className="size-3.5 shrink-0 text-classification-category" aria-hidden="true" />
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

/** A due date as quiet text at the row's end; today and late use the warning color. */
export function DueFact({
  label,
  now,
  title,
  children,
}: {
  label: string;
  now: boolean;
  title?: string;
  children?: ReactNode;
}): ReactElement {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 text-xs whitespace-nowrap",
        now ? "text-warning" : "text-muted-foreground",
      )}
    >
      <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
      {label}
      {children}
    </span>
  );
}

function TaskRowCategory({
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
      <span
        role="img"
        tabIndex={-1}
        data-task-category={category.slug}
        aria-label={`Category ${category.label}. Click to filter; press @ to choose a category.`}
        title={`Filter by ${category.label}`}
        onMouseDown={preventFocusSteal}
        onClick={(event) => {
          event.stopPropagation();
          flyCategoryToFilter(event.currentTarget);
          onSelectCategory(category);
        }}
        className="group/fact flex min-w-0 cursor-pointer"
      >
        <CategoryFact label={category.label} />
      </span>
    </CategoryColumn>
  );
}

function TaskRowTag({
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
    <span
      role="img"
      tabIndex={-1}
      data-task-tag={tag.slug}
      aria-label={`Tag ${tag.label}. Click to filter; press # to choose tags.`}
      title={`Filter by #${tag.label}`}
      onMouseDown={preventFocusSteal}
      onClick={(event) => {
        event.stopPropagation();
        onSelectTag(tag);
      }}
      className="group/fact cursor-pointer"
    >
      <TagFact label={tag.label} />
    </span>
  );
}

/** The row's one short trailing fact, level with the title: when it was done, or when it's due soon. */
function TaskRowTrailing({
  task,
  showCompletedAt,
}: {
  task: TaskView;
  showCompletedAt: boolean;
}): ReactElement | null {
  if (showCompletedAt && task.closedAt) {
    return (
      <TaskItemTrailing>
        <time
          dateTime={task.closedAt}
          title={`Done ${formatTaskDateTime(task.closedAt)}`}
          data-task-completed
          className="text-xs text-muted-foreground tabular-nums"
        >
          <span className="sr-only">Done </span>
          {formatCompletedTime(task.closedAt)}
        </time>
      </TaskItemTrailing>
    );
  }
  const today = localToday();
  const dueLabel = rowDueLabel(task, today);
  if (task.due === null || dueLabel === null) return null;
  return (
    <TaskItemTrailing>
      <span data-task-due title={`Due ${formatDueDate(task.due, today)}`} className="flex">
        <span className="sr-only">Due </span>
        <DueFact label={dueLabel} now={dueNow(task, today)} />
      </span>
    </TaskItemTrailing>
  );
}

/** Who blocks the task, for the full row, or null when nothing does. Never color-only. */
function taskBlocker(task: TaskView, blockedByLabels?: string[]): ReactElement | null {
  const blockerCount = task.blockedByIds.length;
  if (blockerCount === 0) return null;

  const resolved = blockedByLabels ?? [];
  const unresolvedCount = Math.max(blockerCount - resolved.length, 0);
  const blockerText =
    resolved.length > 0
      ? unresolvedCount > 0
        ? `${resolved.join(", ")} +${unresolvedCount} more`
        : resolved.join(", ")
      : blockerCount === 1
        ? "1 blocker"
        : `${blockerCount} blockers`;

  return (
    <span data-task-blocker className="inline-flex min-w-0 items-center gap-1">
      <ShieldBan className="size-3.5 shrink-0 text-warning" aria-hidden="true" />
      <span className="sr-only">Blocked by </span>
      <span>{blockerText}</span>
    </span>
  );
}

/** The row's due marker text for an open task due within the week or late; null otherwise. */
function rowDueLabel(task: TaskView, today: string): string | null {
  const closed = task.status === "done" || task.status === "canceled";
  return task.due === null || closed ? null : dueSoonLabel(task.due, today);
}

/** Whether an open task is due today or already late. */
function dueNow(task: TaskView, today: string): boolean {
  const closed = task.status === "done" || task.status === "canceled";
  return task.due !== null && !closed && daysBetween(today, task.due) <= 0;
}

/**
 * Quiet facts between dots, where the blocker line sits: the blocker, then a
 * due date the row doesn't mark, updated (when it differs), created and the image count.
 */
function TaskRowFooter({
  task,
  blocker,
  onCopyImage,
}: {
  task: TaskView;
  blocker: ReactElement | null;
  onCopyImage?: (task: TaskView) => void;
}): ReactElement {
  const imageCount = task.attachments.length;
  const today = localToday();
  const facts: ReactElement[] = blocker ? [blocker] : [];
  if (task.due !== null && rowDueLabel(task, today) === null) {
    facts.push(
      <span key="due" data-task-due className="inline-flex min-w-0 items-center gap-1">
        <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
        <span>Due {formatDueDate(task.due, today)}</span>
      </span>,
    );
  }
  if (!sameTaskDay(task.createdAt, task.updatedAt)) {
    facts.push(
      <span key="updated" title={`Updated ${formatTaskDateTime(task.updatedAt)}`}>
        Updated {formatTaskDate(task.updatedAt)}
      </span>,
    );
  }
  facts.push(
    <span key="created" title={`Created ${formatTaskDateTime(task.createdAt)}`}>
      Created {formatTaskDate(task.createdAt)}
    </span>,
  );
  if (imageCount > 0) {
    const imageText = imageCount === 1 ? "1 image" : `${imageCount} images`;
    facts.push(
      // A pointer shortcut inside a list option, like the category badge.
      <span
        key="images"
        role="img"
        tabIndex={-1}
        data-task-images
        aria-label={`${imageText}. Click to copy the newest; press ${modKey}+Shift+C.`}
        title="Copy the newest image"
        onMouseDown={preventFocusSteal}
        onClick={(event) => {
          event.stopPropagation();
          onCopyImage?.(task);
        }}
        className={cn(onCopyImage && "cursor-pointer hover:text-foreground")}
      >
        {imageText}
      </span>,
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
      {facts.flatMap((fact, index) =>
        index === 0
          ? [fact]
          : [
              <span key={`dot-${fact.key}`} aria-hidden="true">
                ·
              </span>,
              fact,
            ],
      )}
    </p>
  );
}

/**
 * Shared task presentation. The parent owns the outer wrapper (list option
 * or picker result), selection styling, and activation; this renders the
 * status slot plus title, with tags, details and the row's end only in full mode.
 * The end reads date, chevron, category; the chevron slot and the category column keep
 * their width without content, so the dates line up. Filtering by a category drops the column.
 */
export function TaskRow({
  task,
  variant,
  statusSlot,
  disclosureSlot,
  blockedByLabels,
  indented = false,
  showDetails = false,
  showCompletedAt = false,
  contextOnly = false,
  hiddenCategorySlug,
  onSelectCategory,
  onSelectTag,
  onCopyImage,
}: {
  task: TaskView;
  variant: TaskRowVariant;
  statusSlot: ReactNode;
  disclosureSlot?: ReactNode;
  blockedByLabels?: string[];
  indented?: boolean;
  showDetails?: boolean;
  /** Puts the done time in the trailing column, so it costs no extra line. */
  showCompletedAt?: boolean;
  contextOnly?: boolean;
  hiddenCategorySlug?: string | null;
  onSelectCategory?: (category: ClassificationToken) => void;
  onSelectTag?: (tag: ClassificationToken) => void;
  onCopyImage?: (task: TaskView) => void;
}): ReactElement {
  const blocker = variant === "full" ? taskBlocker(task, blockedByLabels) : null;
  const category = task.category?.slug !== hiddenCategorySlug ? (task.category ?? null) : null;
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 gap-2.5",
        variant === "compact" ? "items-center" : "items-start",
        indented && "pl-6",
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center justify-center",
          variant === "full" && "h-[1.375em] w-8",
        )}
      >
        {statusSlot}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* The title's own line box, so tags flow after its last word. The spaces between them,
            unlike margins, drop where a line breaks. */}
        <div className="text-sm leading-snug wrap-anywhere">
          <TaskItemTitle className={taskTitleClass(task)}>{task.title}</TaskItemTitle>
          {variant === "full"
            ? task.tags.map((tag) => (
                <Fragment key={tag.slug}>
                  {" "}
                  <TaskRowTag tag={tag} onSelectTag={onSelectTag} />
                </Fragment>
              ))
            : null}
        </div>
        {variant === "full" && showDetails && task.description ? (
          <TaskItemDescription data-task-description>{task.description}</TaskItemDescription>
        ) : null}
        {variant === "full" && showDetails ? (
          <TaskRowFooter task={task} blocker={blocker} onCopyImage={onCopyImage} />
        ) : variant === "full" && blocker ? (
          <p className="flex text-xs text-muted-foreground">{blocker}</p>
        ) : null}
        {variant === "full" && contextOnly ? (
          <p
            data-parent-context={!indented || undefined}
            data-child-context={indented || undefined}
            className="text-xs text-muted-foreground"
          >
            {taskContextMessage(indented)}
          </p>
        ) : null}
      </div>
      {variant === "full" ? (
        <TaskRowTrailing task={task} showCompletedAt={showCompletedAt} />
      ) : null}
      {variant === "full" ? (
        <div data-task-disclosure className="flex h-[1.375em] w-7 shrink-0 items-center self-start">
          {disclosureSlot}
        </div>
      ) : null}
      {variant === "full" && (category || !hiddenCategorySlug) ? (
        <TaskRowCategory category={category} onSelectCategory={onSelectCategory} />
      ) : null}
    </div>
  );
}
