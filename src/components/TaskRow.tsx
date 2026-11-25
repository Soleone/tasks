import { Fragment, useState, type ReactElement, type ReactNode } from "react";
import { CalendarDays, ListEnd, ShieldBan } from "lucide-react";
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
import { taskTitleClass } from "@/components/taskFilters";
import { modKey } from "@/platform/runtime";
import { preventFocusSteal } from "@/navigation";
import { TaskItemDescription, TaskItemTitle, TaskItemTrailing } from "@/components/variants/item";
import { DueFact, TaskRowCategory, TaskRowTag } from "./TaskFacts";
import { Hinted } from "./Hinted";
import { MarkdownText } from "@/components/soleone/markdown-textarea";
import { canOpenLinks, openLink } from "@/platform/links";
import { showTaskToast } from "./TaskToaster";
import { startAfterPaint } from "./startAfterPaint";

export type TaskRowVariant = "full" | "compact";

export function taskContextMessage(indented: boolean): string {
  return indented
    ? "Shown with parent, outside current results."
    : "Shown because a child matches the current filters.";
}

/** How a task just came into the queue: `Q` sends it to the back, `Shift+Q` to the front. */
export type QueueArrival = "back" | "front";

/**
 * The task's place in the queue, at the row's very end. The column takes room only while the list
 * shows a queued task. Coming in, the number slides in from the right for the back of the queue or
 * drops in from above for the front; a place that changes rolls to its new number.
 */
function TaskRowQueue({
  position,
  column,
  arrival,
}: {
  position: number | undefined;
  column: boolean;
  arrival: QueueArrival | undefined;
}): ReactElement {
  const [shown, setShown] = useState(position);
  const [motion, setMotion] = useState<"arrive" | "earlier" | "later" | null>(null);
  if (shown !== position) {
    setShown(position);
    setMotion(
      position === undefined
        ? null
        : shown === undefined
          ? "arrive"
          : position < shown
            ? "earlier"
            : "later",
    );
  }
  return (
    <div
      data-task-queue
      className={cn(
        "flex h-[1.375em] shrink-0 items-center justify-end self-start overflow-hidden transition-all duration-200",
        column ? "w-7 sm:w-10" : "-ml-2.5 w-0",
      )}
    >
      {position !== undefined ? (
        <span
          // Remounts on every change, so each one plays its motion once.
          key={position}
          ref={motion ? startAfterPaint : undefined}
          data-queue-arrive={motion === "arrive" ? (arrival ?? "back") : undefined}
          data-queue-roll={motion === "arrive" ? undefined : (motion ?? undefined)}
          aria-label={position === 1 ? "Next in the queue" : `Number ${position} in the queue`}
          className={cn(
            "inline-flex items-center gap-0.5 font-mono text-xs tabular-nums",
            position === 1 ? "font-semibold text-primary" : "text-primary/70",
          )}
        >
          <ListEnd aria-hidden="true" className="size-3 max-sm:hidden" />
          {position}
        </span>
      ) : null}
    </div>
  );
}

/** The row's one short trailing fact, level with the title: when it was done, or when it's due soon. */
function TaskRowTrailing({
  task,
  showCompletedAt,
  completedClockOnly,
}: {
  task: TaskView;
  showCompletedAt: boolean;
  completedClockOnly: boolean;
}): ReactElement | null {
  if (showCompletedAt && task.closedAt) {
    return (
      <TaskItemTrailing>
        <Hinted
          hint={`Done ${formatTaskDateTime(task.closedAt)}`}
          render={
            <time
              dateTime={task.closedAt}
              data-task-completed
              className="text-xs text-muted-foreground tabular-nums"
            />
          }
        >
          <span className="sr-only">Done </span>
          {formatCompletedTime(task.closedAt, completedClockOnly)}
        </Hinted>
      </TaskItemTrailing>
    );
  }
  const today = localToday();
  const dueLabel = rowDueLabel(task, today);
  if (task.due === null || dueLabel === null) return null;
  return (
    <TaskItemTrailing>
      <Hinted
        hint={`Due ${formatDueDate(task.due, today)}`}
        render={<span data-task-due className="flex" />}
      >
        <span className="sr-only">Due </span>
        <DueFact label={dueLabel} now={daysBetween(today, task.due) <= 0} />
      </Hinted>
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
      <Hinted key="updated" hint={formatTaskDateTime(task.updatedAt)} render={<span />}>
        Updated {formatTaskDate(task.updatedAt)}
      </Hinted>,
    );
  }
  facts.push(
    <Hinted
      key="created"
      hint={formatTaskDateTime(task.createdAt)}
      render={<span data-task-created />}
    >
      Created {formatTaskDate(task.createdAt)}
    </Hinted>,
  );
  if (imageCount > 0) {
    const imageText = imageCount === 1 ? "1 image" : `${imageCount} images`;
    facts.push(
      // A pointer shortcut inside a list option, like the category badge.
      <Hinted
        key="images"
        hint={imageCount === 1 ? "Copy image" : "Copy the newest"}
        render={
          <span
            role="img"
            tabIndex={-1}
            data-task-images
            aria-label={`${imageText}. Click to copy the newest; press ${modKey}+Shift+C.`}
            onMouseDown={preventFocusSteal}
            onClick={(event) => {
              event.stopPropagation();
              onCopyImage?.(task);
            }}
            className={cn(onCopyImage && "cursor-pointer hover:text-foreground")}
          />
        }
      >
        {imageText}
      </Hinted>,
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

// Details shows links (`details.links`), except on the phone apps, which can't open them yet.
function openDescriptionLink(url: string): void {
  void openLink(url).catch((error: unknown) =>
    showTaskToast(error instanceof Error ? error.message : String(error)),
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
  note,
  showCompletedAt = false,
  completedClockOnly = false,
  contextOnly = false,
  hiddenCategorySlug,
  queuePosition,
  queueColumn = false,
  queueArrival,
  onSelectCategory,
  onSelectTag,
  onCopyImage,
  onEditDescription,
}: {
  task: TaskView;
  variant: TaskRowVariant;
  statusSlot: ReactNode;
  disclosureSlot?: ReactNode;
  blockedByLabels?: string[];
  indented?: boolean;
  showDetails?: boolean;
  /** A quiet line under the title, such as who changed the task in the agents lens. */
  note?: string;
  /** Puts the done time in the trailing column, so it costs no extra line. */
  showCompletedAt?: boolean;
  /** Shows the done time as a clock even for yesterday, when the view is already one day. */
  completedClockOnly?: boolean;
  contextOnly?: boolean;
  hiddenCategorySlug?: string | null;
  /** The task's place in the queue, 1 for the front, or undefined when it isn't queued. */
  queuePosition?: number;
  /** Whether the list shows a queued task, so every row keeps the queue column's width. */
  queueColumn?: boolean;
  queueArrival?: QueueArrival;
  onSelectCategory?: (category: ClassificationToken) => void;
  onSelectTag?: (tag: ClassificationToken) => void;
  onCopyImage?: (task: TaskView) => void;
  onEditDescription?: (task: TaskView, description: string) => void;
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
        {variant === "full" && note ? (
          <p data-task-note className="text-xs text-muted-foreground">
            {note}
          </p>
        ) : null}
        {variant === "full" && showDetails && task.description ? (
          <TaskItemDescription data-task-description>
            <MarkdownText
              text={task.description}
              onChange={onEditDescription && ((text) => onEditDescription(task, text))}
              onOpenLink={canOpenLinks() ? openDescriptionLink : undefined}
            />
          </TaskItemDescription>
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
        <TaskRowTrailing
          task={task}
          showCompletedAt={showCompletedAt}
          completedClockOnly={completedClockOnly}
        />
      ) : null}
      {variant === "full" ? (
        <div data-task-disclosure className="flex h-[1.375em] w-7 shrink-0 items-center self-start">
          {disclosureSlot}
        </div>
      ) : null}
      {variant === "full" && (category || !hiddenCategorySlug) ? (
        <TaskRowCategory category={category} onSelectCategory={onSelectCategory} />
      ) : null}
      {variant === "full" ? (
        <TaskRowQueue position={queuePosition} column={queueColumn} arrival={queueArrival} />
      ) : null}
    </div>
  );
}
