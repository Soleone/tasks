import type { ComponentProps, ReactElement } from "react";
import { CirclePause, Copy, CornerDownRight, Ellipsis, Link2, Undo2 } from "lucide-react";
import type { TaskView } from "./taskView";
import type { Tooltip } from "./ui/tooltip";
import { ToolbarCommand, ToolbarTooltip } from "./variants/toolbar";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { TaskActionsMenuContent } from "./variants/dropdown-menu";
import { preventFocusSteal } from "@/navigation";

type TaskActionsProps = {
  activeTask: TaskView | undefined;
  disabled: boolean;
  canUndo: boolean;
  onUndo: () => void;
  onAddBlocker: (task: TaskView) => void;
  onMoveUnder: (task: TaskView) => void;
  onCreateChild: (task: TaskView) => void;
  onCopy: (task: TaskView) => void;
  onPause: () => void;
  finalFocus: () => HTMLElement | false | null;
  tooltipFor: (key: string) => ComponentProps<typeof Tooltip>;
};

export function TaskActions({
  activeTask,
  disabled,
  canUndo,
  onUndo,
  onAddBlocker,
  onMoveUnder,
  onCreateChild,
  onCopy,
  onPause,
  finalFocus,
  tooltipFor,
}: TaskActionsProps): ReactElement {
  return (
    <>
      <ToolbarTooltip
        tooltip={tooltipFor("undo")}
        hint="Undo (Ctrl/⌘+Z)"
        render={
          <ToolbarCommand
            disabled={disabled || !canUndo}
            aria-label="Undo"
            aria-keyshortcuts="Control+z Meta+z"
            onMouseDown={preventFocusSteal}
            onClick={onUndo}
          />
        }
      >
        <Undo2 aria-hidden="true" />
      </ToolbarTooltip>
      <DropdownMenu>
        <ToolbarTooltip
          tooltip={tooltipFor("task-actions")}
          hint="Task actions"
          render={
            <DropdownMenuTrigger
              render={
                <ToolbarCommand
                  aria-label="Task actions"
                  disabled={disabled || !activeTask}
                  onMouseDown={preventFocusSteal}
                />
              }
            />
          }
        >
          <Ellipsis aria-hidden="true" />
        </ToolbarTooltip>

        <TaskActionsMenuContent align="end" finalFocus={finalFocus}>
          {activeTask ? (
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => onAddBlocker(activeTask)}>
                <Link2 aria-hidden="true" />
                Blockers…
                <DropdownMenuShortcut>B</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onMoveUnder(activeTask)}>
                <CornerDownRight aria-hidden="true" />
                Move under…
                <DropdownMenuShortcut>M</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={activeTask.status === "canceled"}
                onClick={() => onCreateChild(activeTask)}
              >
                <CornerDownRight aria-hidden="true" />
                New child
                <DropdownMenuShortcut>Shift+C</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCopy(activeTask)}>
                <Copy aria-hidden="true" />
                Copy text
                <DropdownMenuShortcut>Ctrl/⌘+C</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onPause}>
                <CirclePause aria-hidden="true" />
                Pause/resume
                <DropdownMenuShortcut>P</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          ) : null}
        </TaskActionsMenuContent>
      </DropdownMenu>
    </>
  );
}
