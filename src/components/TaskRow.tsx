import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import {
  Circle,
  CircleCheck,
  CirclePause,
  CirclePlay,
  CircleX,
  Folder,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import type { TaskRecord, TaskStatus } from "@/backend/protocol";
import { stripClassificationTokens } from "@/backend/taskText";
import { Badge } from "@/components/ui/badge";
import { ItemDescription, ItemTitle } from "@/components/ui/item";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type TaskRowVariant = "full" | "compact";

type StatusMeta = {
  label: string;
  Icon: LucideIcon;
  color: string;
};

export const taskStatusMeta: Record<TaskStatus, StatusMeta> = {
  open: { label: "Open", Icon: Circle, color: "text-muted-foreground" },
  in_progress: { label: "In progress", Icon: CirclePlay, color: "text-primary" },
  paused: { label: "Paused", Icon: CirclePause, color: "text-warning" },
  done: { label: "Done", Icon: CircleCheck, color: "text-success" },
  canceled: { label: "Cancelled", Icon: CircleX, color: "text-destructive" },
};

/** Visible title without the @category/#tag tokens the backend parses. */
export function taskTitleDisplay(title: string): string {
  return stripClassificationTokens(title) || title;
}

export function taskRowDisplayTitle(task: TaskRecord): string {
  return taskTitleDisplay(task.title);
}

/** Informational status icon. Interactive toggling stays with the list. */
export function TaskStatusDisplay({ task }: { task: TaskRecord }): ReactElement {
  const status = taskStatusMeta[task.status];
  const Icon = status.Icon;
  return (
    <span
      className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-full", status.color)}
      role="img"
      aria-label={`Status: ${status.label}`}
    >
      <Icon aria-hidden="true" />
    </span>
  );
}

const STATUS_FEEDBACK_DURATION_MS = 900;

export function TaskStatusToggle({ task, pending, feedbackVersion, nextLabel, onToggle }: {
  task: TaskRecord;
  pending: boolean;
  feedbackVersion?: number;
  nextLabel: string;
  onToggle: (task: TaskRecord) => void;
}): ReactElement {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const status = taskStatusMeta[task.status];
  const Icon = status.Icon;

  useEffect(() => {
    if (feedbackVersion === undefined) return;
    setFeedbackOpen(true);
    const timeout = window.setTimeout(() => setFeedbackOpen(false), STATUS_FEEDBACK_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [feedbackVersion]);

  return (
    <Tooltip open={feedbackOpen} onOpenChange={setFeedbackOpen}>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={`Status: ${status.label}. Click or press Space to change it to ${nextLabel}.`}
            tabIndex={-1}
            data-status={task.status}
            data-status-pending={pending || undefined}
            className={cn(
              "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-muted",
              status.color,
              pending && "animate-pulse opacity-60",
            )}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(task);
            }}
          />
        }
      >
        <Icon aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>{status.label}</TooltipContent>
    </Tooltip>
  );
}

export function TaskRowMetadata({ task }: { task: TaskRecord }): ReactElement | null {
  const hasClassification = Boolean(task.category) || task.tags.length > 0;
  if (!hasClassification) return null;

  return (
    <ItemDescription className="flex flex-wrap items-center gap-1.5">
      {task.category ? (
        <Badge variant="outline" className="h-5 border-classification-category bg-classification-category px-1.5 text-xs font-normal text-classification-foreground">
          <Folder data-icon="inline-start" aria-hidden="true" />
          {task.category.label}
        </Badge>
      ) : null}
      {task.tags.map((tag) => (
        <Badge key={tag.slug} variant="outline" className="h-5 border-classification-tag bg-classification-tag px-1.5 text-xs font-normal text-classification-foreground">{tag.label}</Badge>
      ))}
    </ItemDescription>
  );
}

/** Quiet relationship context for the full row. Never color-only. */
export function TaskRowRelationships({ task, blockedByLabels }: {
  task: TaskRecord;
  blockedByLabels?: string[];
}): ReactElement | null {
  const blockerCount = task.blockedByIds.length;
  if (blockerCount === 0) return null;

  const resolved = blockedByLabels ?? [];
  const unresolvedCount = Math.max(blockerCount - resolved.length, 0);
  const blockerText = resolved.length > 0
    ? unresolvedCount > 0
      ? `${resolved.join(", ")} +${unresolvedCount} more`
      : resolved.join(", ")
    : blockerCount === 1
      ? "1 blocker"
      : `${blockerCount} blockers`;

  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
      <span className="inline-flex min-w-0 items-center gap-1">
        <TriangleAlert className="size-3.5 shrink-0 text-warning" aria-hidden="true" />
        <span className="sr-only">Blocked by </span>
        <span>{blockerText}</span>
      </span>
    </p>
  );
}

/**
 * Shared task presentation. The parent owns the outer wrapper (list option
 * or picker result), selection styling, and activation; this renders the
 * status slot plus title, with description and metadata only in full mode.
 */
export function TaskRow({ task, variant, statusSlot, blockedByLabels, indented = false }: {
  task: TaskRecord;
  variant: TaskRowVariant;
  statusSlot: ReactNode;
  blockedByLabels?: string[];
  indented?: boolean;
}): ReactElement {
  return (
    <div className={cn("flex min-w-0 flex-1 gap-2.5", variant === "compact" ? "items-center" : "items-start", indented && "pl-6")}>
      <div className={cn("flex shrink-0 items-center justify-center", variant === "full" && "h-[1.375em]")}>{statusSlot}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <ItemTitle className="line-clamp-none wrap-anywhere w-full">
          {taskRowDisplayTitle(task)}
        </ItemTitle>
        {variant === "full" && task.descriptionMarkdown ? (
          <ItemDescription className="wrap-anywhere">{task.descriptionMarkdown}</ItemDescription>
        ) : null}
        {variant === "full" ? <TaskRowMetadata task={task} /> : null}
        {variant === "full" ? <TaskRowRelationships task={task} blockedByLabels={blockedByLabels} /> : null}
      </div>
    </div>
  );
}
