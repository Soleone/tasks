import { useState, type ComponentProps, type ReactElement } from "react";
import { CirclePause, Copy, CornerDownRight, Ellipsis, Link2, Undo2 } from "lucide-react";
import type { TaskView } from "./taskView";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { ToggleButton } from "./variants/button";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const undoTooltip = tooltipFor("undo");
  const menuTooltip = tooltipFor("task-actions");
  return (
    <>
      <Tooltip {...undoTooltip}>
        <TooltipTrigger
          id={undoTooltip.triggerId ?? undefined}
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              tabIndex={-1}
              disabled={disabled || !canUndo}
              aria-label="Undo"
              aria-keyshortcuts="Control+z Meta+z"
              onMouseDown={preventFocusSteal}
              onClick={onUndo}
            />
          }
        >
          <Undo2 aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8}>
          Undo (Ctrl/⌘+Z)
        </TooltipContent>
      </Tooltip>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <Tooltip {...menuTooltip}>
          <TooltipTrigger
            id={menuTooltip.triggerId ?? undefined}
            render={
              <DropdownMenuTrigger
                render={
                  <ToggleButton
                    variant={menuOpen ? "outline" : "ghost"}
                    selected={menuOpen}
                    size="icon-sm"
                    tabIndex={-1}
                    aria-label="Task actions"
                    aria-pressed={menuOpen}
                    disabled={disabled || !activeTask}
                    onMouseDown={preventFocusSteal}
                  />
                }
              />
            }
          >
            <Ellipsis aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>
            Task actions
          </TooltipContent>
        </Tooltip>

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
