import { useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
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
import { priorityMeta, statusGlyphColor, taskStatusMeta } from "@/components/taskFilters";
import { preventFocusSteal } from "@/navigation";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ClassificationBadge } from "@/components/variants/badge";
import {
  TaskItemDescription,
  TaskItemMetadata,
  TaskItemTitle,
  TaskItemTrailing,
} from "@/components/variants/item";
import { useFlashTooltip } from "./useFlashTooltip";

export type TaskRowVariant = "full" | "compact";

export function taskContextMessage(indented: boolean): string {
  return indented
    ? "Shown with parent, outside current results."
    : "Shown because a child matches the current filters.";
}

/** Informational status icon. Interactive toggling stays with the list. */
export function TaskStatusDisplay({
  task,
}: {
  task: Pick<TaskView, "status" | "priority">;
}): ReactElement {
  const status = taskStatusMeta[task.status];
  const Icon = status.Icon;
  return (
    <span
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full",
        statusGlyphColor(task),
      )}
      role="img"
      aria-label={`Status: ${status.label}, priority ${priorityMeta(task.priority).label}`}
    >
      <Icon className="size-5" aria-hidden="true" />
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
  const Icon = status.Icon;
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
        <Icon
          key={`${task.status}-${priority.shortLabel}`}
          className="size-5"
          aria-hidden="true"
          data-status-enter={entrance === "status" ? task.status : undefined}
          data-priority-enter={entrance === "priority" || undefined}
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

function TaskRowMetadata({
  task,
  hiddenCategorySlug,
  onSelectCategory,
}: {
  task: TaskView;
  hiddenCategorySlug?: string | null;
  onSelectCategory?: (category: ClassificationToken) => void;
}): ReactElement | null {
  const category = task.category?.slug !== hiddenCategorySlug ? (task.category ?? null) : null;
  if (!category && task.tags.length === 0) {
    if (!task.category) {
      // Hidden as a whole, so the empty line takes no gap in the row.
      return <TaskItemMetadata className="sr-only">No category or tags</TaskItemMetadata>;
    }
    return null;
  }

  return (
    <TaskItemMetadata>
      {category ? (
        onSelectCategory ? (
          // A pointer shortcut inside a list option, like the status glyph.
          // Keyboard filtering belongs to the list/toolbar, not a nested button.
          <span
            role="img"
            tabIndex={-1}
            data-task-category={category.slug}
            aria-label={`Category ${category.label}. Click to filter; press @ to choose a category.`}
            title={`Filter by ${category.label}`}
            onMouseDown={preventFocusSteal}
            onClick={(event) => {
              event.stopPropagation();
              onSelectCategory(category);
            }}
            className="flex cursor-pointer rounded-full"
          >
            <ClassificationBadge kind="category">
              <Folder data-icon="inline-start" aria-hidden="true" />
              {category.label}
            </ClassificationBadge>
          </span>
        ) : (
          <ClassificationBadge kind="category">
            <Folder data-icon="inline-start" aria-hidden="true" />
            {category.label}
          </ClassificationBadge>
        )
      ) : null}
      {task.tags.map((tag) => (
        <ClassificationBadge key={tag.slug} kind="tag">
          {tag.label}
        </ClassificationBadge>
      ))}
    </TaskItemMetadata>
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
      <span
        data-task-due
        title={`Due ${formatDueDate(task.due, today)}`}
        className={cn(
          "inline-flex items-center gap-1 text-xs",
          dueNow(task, today) ? "text-warning" : "text-muted-foreground",
        )}
      >
        <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="sr-only">Due </span>
        {dueLabel}
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
        aria-label={`${imageText}. Click to copy the newest; press Ctrl/⌘+Shift+C.`}
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
 * status slot plus title, with optional details and metadata only in full mode.
 * The disclosure sits just before the trailing date, so dates keep the row's end
 * and an undated parent's chevron takes it instead.
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
  onCopyImage?: (task: TaskView) => void;
}): ReactElement {
  const blocker = variant === "full" ? taskBlocker(task, blockedByLabels) : null;
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
        <TaskItemTitle className="wrap-anywhere w-full">{task.title}</TaskItemTitle>
        {variant === "full" ? (
          <TaskRowMetadata
            task={task}
            hiddenCategorySlug={hiddenCategorySlug}
            onSelectCategory={onSelectCategory}
          />
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
        {variant === "full" && showDetails && task.description ? (
          <TaskItemDescription data-task-description>{task.description}</TaskItemDescription>
        ) : null}
      </div>
      {variant === "full" && disclosureSlot ? (
        <div className="flex h-[1.375em] shrink-0 items-center self-start">{disclosureSlot}</div>
      ) : null}
      {variant === "full" ? (
        <TaskRowTrailing task={task} showCompletedAt={showCompletedAt} />
      ) : null}
    </div>
  );
}
