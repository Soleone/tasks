import { useState, type ReactElement } from "react";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Circle,
  CirclePause,
  CirclePlay,
  CircleX,
  Copy,
  CornerDownRight,
  Link2,
  Pencil,
} from "lucide-react";
import type { TaskView } from "./taskView";
import type { TaskMoveDirection } from "./taskReordering";
import {
  ContextMenu,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { TaskContextMenuContent, TaskContextSubContent } from "./variants/context-menu";

export type TaskContextActions = {
  disabled: boolean;
  onTarget: () => void;
  onEdit: (task: TaskView) => void;
  onStatus: (task: TaskView) => void;
  onPause: (task: TaskView) => void;
  onAddBlocker: (task: TaskView) => void;
  onMoveUnder: (task: TaskView) => void;
  onCreateChild: (task: TaskView) => void;
  onCopy: (task: TaskView) => void;
  onDelete: (task: TaskView) => void;
  onReorder: (direction: TaskMoveDirection) => void;
  reorderDisabledReason: string | null;
  finalFocus: () => HTMLElement | false | null;
};

export function TaskContextMenu({
  task,
  actions,
  children,
}: {
  task: TaskView;
  actions: TaskContextActions;
  children: ReactElement;
}): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <ContextMenu
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (nextOpen && actions.disabled) {
          details.cancel();
          return;
        }
        if (nextOpen) actions.onTarget();
        setOpen(nextOpen);
      }}
    >
      <ContextMenuTrigger
        render={children}
        onClickCapture={(event) => {
          // Releasing a long press must not also open the inline editor.
          if (open) event.stopPropagation();
        }}
      />
      <TaskContextMenuContent
        aria-label={`Actions for ${task.title}`}
        finalFocus={actions.finalFocus}
      >
        <ContextMenuGroup>
          <ContextMenuLabel>{task.title}</ContextMenuLabel>
          <ContextMenuItem onClick={() => actions.onEdit(task)}>
            <Pencil aria-hidden="true" />
            Edit
          </ContextMenuItem>
          <ContextMenuItem onClick={() => actions.onStatus(task)}>
            <Circle aria-hidden="true" />
            Change status
          </ContextMenuItem>
          <ContextMenuItem
            disabled={task.status === "done" || task.status === "canceled"}
            onClick={() => actions.onPause(task)}
          >
            {task.status === "paused" ? (
              <CirclePlay aria-hidden="true" />
            ) : (
              <CirclePause aria-hidden="true" />
            )}
            {task.status === "paused" ? "Resume" : "Pause"}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => actions.onAddBlocker(task)}>
            <Link2 aria-hidden="true" />
            Blockers…
          </ContextMenuItem>
          <ContextMenuItem onClick={() => actions.onMoveUnder(task)}>
            <CornerDownRight aria-hidden="true" />
            Move under…
          </ContextMenuItem>
          <ContextMenuItem
            disabled={task.status === "canceled"}
            onClick={() => actions.onCreateChild(task)}
          >
            <CornerDownRight aria-hidden="true" />
            New child
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger disabled={actions.reorderDisabledReason !== null}>
              <ArrowDownUp aria-hidden="true" />
              Reorder
            </ContextMenuSubTrigger>
            <TaskContextSubContent>
              <ContextMenuGroup>
                <ContextMenuItem onClick={() => actions.onReorder("up")}>
                  <ArrowUp aria-hidden="true" />
                  Move up
                </ContextMenuItem>
                <ContextMenuItem onClick={() => actions.onReorder("down")}>
                  <ArrowDown aria-hidden="true" />
                  Move down
                </ContextMenuItem>
                <ContextMenuItem onClick={() => actions.onReorder("start")}>
                  <ChevronUp aria-hidden="true" />
                  Move to beginning
                </ContextMenuItem>
                <ContextMenuItem onClick={() => actions.onReorder("end")}>
                  <ChevronDown aria-hidden="true" />
                  Move to end
                </ContextMenuItem>
              </ContextMenuGroup>
            </TaskContextSubContent>
          </ContextMenuSub>
          <ContextMenuItem onClick={() => actions.onCopy(task)}>
            <Copy aria-hidden="true" />
            Copy text
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem variant="destructive" onClick={() => actions.onDelete(task)}>
            <CircleX aria-hidden="true" />
            Cancel task
          </ContextMenuItem>
        </ContextMenuGroup>
      </TaskContextMenuContent>
    </ContextMenu>
  );
}
