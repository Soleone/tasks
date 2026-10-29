import type { ComponentProps, ReactElement } from "react";
import {
  ChevronsUp,
  CirclePause,
  Copy,
  CornerDownRight,
  Ellipsis,
  Image,
  Link2,
  Redo2,
  Undo2,
} from "lucide-react";
import type { TaskEffort } from "@/backend/taskModel";
import type { TaskView } from "./taskView";
import { EFFORT_ICONS, EFFORTS_LARGEST_FIRST, effortTitle } from "./taskFilters";
import type { Tooltip } from "./ui/tooltip";
import { ToolbarCommand, ToolbarTooltip } from "./variants/toolbar";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { ToolbarMenuContent } from "./variants/dropdown-menu";
import { modKey } from "@/platform/runtime";
import { preventFocusSteal } from "@/navigation";

type TaskActionsProps = {
  activeTask: TaskView | undefined;
  disabled: boolean;
  canUndo: boolean;
  onUndo: () => void;
  canRedo: boolean;
  onRedo: () => void;
  onAddBlocker: (task: TaskView) => void;
  onMoveUnder: (task: TaskView) => void;
  onCreateChild: (task: TaskView) => void;
  onCopy: (task: TaskView) => void;
  onCopyImage: (task: TaskView) => void;
  onPause: () => void;
  onEffort: (task: TaskView, effort: TaskEffort) => void;
  finalFocus: () => HTMLElement | false | null;
  tooltipFor: (key: string) => ComponentProps<typeof Tooltip>;
};

export function TaskActions({
  activeTask,
  disabled,
  canUndo,
  onUndo,
  canRedo,
  onRedo,
  onAddBlocker,
  onMoveUnder,
  onCreateChild,
  onCopy,
  onCopyImage,
  onPause,
  onEffort,
  finalFocus,
  tooltipFor,
}: TaskActionsProps): ReactElement {
  return (
    <>
      <ToolbarTooltip
        tooltip={tooltipFor("undo")}
        hint={`Undo (${modKey}+Z)`}
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
      <ToolbarTooltip
        tooltip={tooltipFor("redo")}
        hint={`Redo (Ctrl+Y or ${modKey}+Shift+Z)`}
        render={
          <ToolbarCommand
            disabled={disabled || !canRedo}
            aria-label="Redo"
            aria-keyshortcuts="Control+y Control+Shift+z Meta+Shift+z"
            onMouseDown={preventFocusSteal}
            onClick={onRedo}
          />
        }
      >
        <Redo2 aria-hidden="true" />
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

        <ToolbarMenuContent align="end" finalFocus={finalFocus}>
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
                <DropdownMenuShortcut>{`${modKey}+C`}</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCopyImage(activeTask)}>
                <Image aria-hidden="true" />
                Copy image
                <DropdownMenuShortcut>{`${modKey}+Shift+C`}</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onPause}>
                <CirclePause aria-hidden="true" />
                Pause/resume
                <DropdownMenuShortcut>P</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <ChevronsUp aria-hidden="true" />
                  <span className="flex-1">Effort</span>
                  <DropdownMenuShortcut>[ ]</DropdownMenuShortcut>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={activeTask.effort}
                    onValueChange={(effort: TaskEffort) => onEffort(activeTask, effort)}
                  >
                    {EFFORTS_LARGEST_FIRST.map((effort) => {
                      const Icon = EFFORT_ICONS[effort];
                      return (
                        <DropdownMenuRadioItem key={effort} value={effort} closeOnClick>
                          <Icon aria-hidden="true" />
                          {effortTitle(effort)}
                        </DropdownMenuRadioItem>
                      );
                    })}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuGroup>
          ) : null}
        </ToolbarMenuContent>
      </DropdownMenu>
    </>
  );
}
