import type { ReactElement, ReactNode } from "react";
import { Clock3, Folder, RotateCcwClock, ShieldBan } from "lucide-react";
import { cn } from "cn";
import type { ClassificationToken } from "@/backend/taskText";
import type { TaskView } from "./taskView";
import { formatTaskDate, formatTaskDateTime, sameTaskDay } from "@/backend/taskDates";
import { priorityMeta, taskStatusMeta } from "@/components/taskFilters";
import { preventFocusSteal } from "@/navigation";
import { ItemDescription } from "@/components/ui/item";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ClassificationBadge } from "@/components/variants/badge";
import { TaskItemMetadata, TaskItemTitle } from "@/components/variants/item";
import { useFlashTooltip } from "./useFlashTooltip";

export type TaskRowVariant = "full" | "compact";

export function taskContextMessage(task: TaskView): string {
  const status = taskStatusMeta[task.status].label.toLowerCase();
  return `Still visible because children aren't ${status} yet.`;
}

/** Informational status icon. Interactive toggling stays with the list. */
export function TaskStatusDisplay({ task }: { task: Pick<TaskView, "status"> }): ReactElement {
  const status = taskStatusMeta[task.status];
  const Icon = status.Icon;
  return (
    <span
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full",
        status.color,
      )}
      role="img"
      aria-label={`Status: ${status.label}`}
    >
      <Icon aria-hidden="true" />
    </span>
  );
}

function TaskPriorityDisplay({ task }: { task: TaskView }): ReactElement {
  const meta = priorityMeta(task.priority ?? 2);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={`inline-block size-2 shrink-0 rounded-full ${meta.dot}`}
            role="img"
            aria-label={`Priority ${meta.label}`}
            data-priority={meta.shortLabel}
            tabIndex={-1}
          />
        }
      />
      <TooltipContent side="top" sideOffset={8}>
        Priority {meta.label}
      </TooltipContent>
    </Tooltip>
  );
}

const STATUS_FEEDBACK_DURATION_MS = 900;

export function TaskStatusToggle({
  task,
  pending,
  feedbackVersion,
  nextLabel,
  previousLabel,
  onToggle,
}: {
  task: TaskView;
  pending: boolean;
  feedbackVersion?: number;
  nextLabel: string;
  previousLabel: string;
  onToggle: (task: TaskView) => void;
}): ReactElement {
  const feedback = useFlashTooltip(feedbackVersion, STATUS_FEEDBACK_DURATION_MS);
  const status = taskStatusMeta[task.status];
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
            aria-label={`Status: ${status.label}. Click or press Space to change it to ${nextLabel}; press Shift+Space to change it to ${previousLabel}.${pauseHint}`}
            tabIndex={-1}
            data-status={task.status}
            data-status-pending={pending || undefined}
            className={cn(
              "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-muted",
              status.color,
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
        <Icon aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {status.label}
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
      return (
        <TaskItemMetadata>
          <span className="sr-only">No category or tags</span>
        </TaskItemMetadata>
      );
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

/** Quiet relationship context for the full row. Never color-only. */
function TaskRowRelationships({
  task,
  blockedByLabels,
}: {
  task: TaskView;
  blockedByLabels?: string[];
}): ReactElement | null {
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
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
      <span className="inline-flex min-w-0 items-center gap-1">
        <ShieldBan className="size-3.5 shrink-0 text-warning" aria-hidden="true" />
        <span className="sr-only">Blocked by </span>
        <span>{blockerText}</span>
      </span>
    </p>
  );
}

/** Quiet created/updated line for the time footer. Updated leads when it differs. */
function TaskRowTimestamps({ task }: { task: TaskView }): ReactElement {
  const showUpdated = !sameTaskDay(task.createdAt, task.updatedAt);
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
      {showUpdated ? (
        <span
          className="inline-flex min-w-0 items-center gap-1"
          title={`Updated ${formatTaskDateTime(task.updatedAt)}`}
        >
          <RotateCcwClock className="size-3.5 shrink-0" aria-hidden="true" />
          <span>Updated {formatTaskDate(task.updatedAt)}</span>
        </span>
      ) : null}
      <span
        className="inline-flex min-w-0 items-center gap-1"
        title={`Created ${formatTaskDateTime(task.createdAt)}`}
      >
        <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
        <span>Created {formatTaskDate(task.createdAt)}</span>
      </span>
    </p>
  );
}

/**
 * Shared task presentation. The parent owns the outer wrapper (list option
 * or picker result), selection styling, and activation; this renders the
 * status slot plus title, with optional details and metadata only in full mode.
 */
export function TaskRow({
  task,
  variant,
  statusSlot,
  blockedByLabels,
  indented = false,
  showDetails = false,
  contextOnly = false,
  hiddenCategorySlug,
  onSelectCategory,
}: {
  task: TaskView;
  variant: TaskRowVariant;
  statusSlot: ReactNode;
  blockedByLabels?: string[];
  indented?: boolean;
  showDetails?: boolean;
  contextOnly?: boolean;
  hiddenCategorySlug?: string | null;
  onSelectCategory?: (category: ClassificationToken) => void;
}): ReactElement {
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
          "flex shrink-0 items-center justify-center gap-1.5",
          variant === "full" && "h-[1.375em]",
        )}
      >
        {statusSlot}
        {variant === "full" ? <TaskPriorityDisplay task={task} /> : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <TaskItemTitle className="wrap-anywhere w-full">{task.title}</TaskItemTitle>
        {variant === "full" && showDetails && task.description ? (
          <ItemDescription data-task-description className="wrap-anywhere">
            {task.description}
          </ItemDescription>
        ) : null}
        {variant === "full" ? (
          <TaskRowMetadata
            task={task}
            hiddenCategorySlug={hiddenCategorySlug}
            onSelectCategory={onSelectCategory}
          />
        ) : null}
        {variant === "full" ? (
          <TaskRowRelationships task={task} blockedByLabels={blockedByLabels} />
        ) : null}
        {variant === "full" && contextOnly ? (
          <p data-parent-context className="text-xs text-muted-foreground">
            {taskContextMessage(task)}
          </p>
        ) : null}
        {variant === "full" && showDetails ? <TaskRowTimestamps task={task} /> : null}
      </div>
    </div>
  );
}
