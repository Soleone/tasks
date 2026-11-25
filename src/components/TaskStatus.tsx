import { useState, type CSSProperties, type ReactElement } from "react";
import { Check } from "lucide-react";
import { DEFAULT_EFFORT, type TaskEffort } from "@/backend/taskModel";
import { cn } from "cn";
import type { TaskView } from "./taskView";
import {
  EFFORT_ICONS,
  EFFORT_LABELS,
  effortTitle,
  isSolidGlyph,
  priorityMeta,
  statusGlyphColor,
  taskStatusMeta,
} from "@/components/taskFilters";
import { preventFocusSteal } from "@/navigation";
import { Tooltip, TooltipContent } from "@/components/variants/tooltip";
import { TooltipTrigger } from "@/components/ui/tooltip";
import { useFlashTooltip } from "./useFlashTooltip";
import { startAfterPaint } from "./startAfterPaint";

type GlyphEntrance = "status" | "priority" | "effort";

/** The glyph's label: status and priority, and effort when it isn't normal. */
function glyphLabel(task: Pick<TaskView, "status" | "priority" | "effort">): string {
  const effort = task.effort === DEFAULT_EFFORT ? "" : `, effort ${EFFORT_LABELS[task.effort]}`;
  return `${taskStatusMeta[task.status].label}, priority ${priorityMeta(task.priority).label}${effort}`;
}

/**
 * The status icon; a highest-priority task gets a filled disc with the icon cut out of it. Effort
 * other than normal adds chevrons at the top right, in a notch cut from the icon so they read on
 * any row fill. The parent positions them.
 */
export function StatusGlyph({
  task,
  entrance = null,
  effortFrom = DEFAULT_EFFORT,
}: {
  task: Pick<TaskView, "status" | "priority"> & { effort?: TaskEffort };
  /** What changed last, so the glyph plays its entrance. */
  entrance?: GlyphEntrance | null;
  /** The effort before an effort change: going back to normal folds its chevrons away. */
  effortFrom?: TaskEffort;
}): ReactElement {
  const Icon = taskStatusMeta[task.status].Icon;
  const effort = task.effort ?? DEFAULT_EFFORT;
  const effortChanged = entrance === "effort";
  const leaving = effortChanged && effort === DEFAULT_EFFORT;
  const glyphData = {
    "data-status-enter": entrance === "status" ? task.status : undefined,
    "data-priority-enter": entrance === "priority" || undefined,
    "data-effort-notch":
      effort === DEFAULT_EFFORT
        ? undefined
        : effortChanged && effortFrom === DEFAULT_EFFORT
          ? "opening"
          : true,
    "data-effort-notch-closing": leaving || undefined,
    ref: entrance ? startAfterPaint : undefined,
  };
  const glyph = !isSolidGlyph(task) ? (
    <Icon className="size-5" aria-hidden="true" {...glyphData} />
  ) : (
    <span
      className="grid size-5 place-items-center rounded-full bg-current"
      aria-hidden="true"
      {...glyphData}
    >
      {task.status === "in_progress" ? (
        <Icon className="size-3 text-primary-foreground" strokeWidth={3.5} />
      ) : task.status === "done" ? (
        <Check className="size-3 text-background" strokeWidth={3.5} />
      ) : null}
    </span>
  );
  const shown = leaving ? effortFrom : effort;
  if (shown === DEFAULT_EFFORT) return glyph;
  const EffortIcon = EFFORT_ICONS[shown];
  return (
    <>
      {glyph}
      {/* Bigger work in the title's color, smaller work in the muted one. A change nudges the
       * chevrons the way their level points; leaving or reaching normal folds them flat. */}
      <EffortIcon
        className={cn(
          "absolute top-[-2px] left-[17px] size-[13px]",
          shown > DEFAULT_EFFORT ? "text-foreground" : "text-muted-foreground",
        )}
        strokeWidth={3}
        aria-hidden="true"
        data-effort={leaving ? undefined : EFFORT_LABELS[shown]}
        data-effort-leave={leaving || undefined}
        data-effort-enter={
          !effortChanged || leaving ? undefined : effort > DEFAULT_EFFORT ? "up" : "down"
        }
        ref={entrance ? startAfterPaint : undefined}
      />
    </>
  );
}

/** Informational status icon. Interactive toggling stays with the list. */
export function TaskStatusDisplay({
  task,
}: {
  task: Pick<TaskView, "status" | "priority" | "effort">;
}): ReactElement {
  return (
    <span
      className={cn(
        "relative inline-flex size-7 shrink-0 items-center justify-center rounded-full",
        statusGlyphColor(task),
      )}
      role="img"
      aria-label={`Status: ${glyphLabel(task)}`}
    >
      <StatusGlyph task={task} />
    </span>
  );
}

/**
 * Which of the glyph's meanings changed last, so a fresh mount stays still, and the effort it
 * changed from.
 */
function useGlyphEntrance(task: TaskView): {
  entrance: GlyphEntrance | null;
  effortFrom: TaskEffort;
} {
  const [seen, setSeen] = useState({
    status: task.status,
    priority: task.priority,
    effort: task.effort,
  });
  const [entrance, setEntrance] = useState<GlyphEntrance | null>(null);
  const [effortFrom, setEffortFrom] = useState(task.effort);
  if (
    seen.status !== task.status ||
    seen.priority !== task.priority ||
    seen.effort !== task.effort
  ) {
    setSeen({
      status: task.status,
      priority: task.priority,
      effort: task.effort,
    });
    setEffortFrom(seen.effort);
    setEntrance(
      seen.status !== task.status
        ? "status"
        : seen.priority !== task.priority
          ? "priority"
          : "effort",
    );
  }
  return { entrance, effortFrom };
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
  const { entrance, effortFrom } = useGlyphEntrance(task);
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
            aria-label={`Status: ${glyphLabel(task)}. Click or press Space to change it to ${nextLabel}; press Shift+Space to change it to ${previousLabel}.${pauseHint}`}
            tabIndex={-1}
            data-status={task.status}
            data-priority={priority.shortLabel}
            data-effort={task.effort}
            data-status-pending={pending || undefined}
            data-completion-sheen={sheenStep !== undefined || undefined}
            ref={sheenStep !== undefined ? startAfterPaint : undefined}
            style={
              sheenStep !== undefined ? ({ "--sheen-step": sheenStep } as CSSProperties) : undefined
            }
            className={cn(
              "relative inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-muted",
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
        {/* Keyed so each new status, priority or effort remounts the glyph and plays its entrance once. */}
        <StatusGlyph
          key={`${task.status}-${priority.shortLabel}-${task.effort}`}
          task={task}
          entrance={entrance}
          effortFrom={effortFrom}
        />
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {!feedback.flashing
          ? glyphLabel(task)
          : entrance === "priority"
            ? priority.shortLabel
            : entrance === "effort"
              ? `${effortTitle(task.effort)} effort`
              : status.label}
      </TooltipContent>
    </Tooltip>
  );
}
