import { useState, type ReactElement } from "react";
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
          <ContextMenuItem onClick={() => actions.onEdit(task)}>Edit</ContextMenuItem>
          <ContextMenuItem onClick={() => actions.onStatus(task)}>Change status</ContextMenuItem>
          <ContextMenuItem
            disabled={task.status === "done" || task.status === "canceled"}
            onClick={() => actions.onPause(task)}
          >
            {task.status === "paused" ? "Resume" : "Pause"}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => actions.onAddBlocker(task)}>Blockers…</ContextMenuItem>
          <ContextMenuItem onClick={() => actions.onMoveUnder(task)}>Move under…</ContextMenuItem>
          <ContextMenuItem
            disabled={task.status === "canceled"}
            onClick={() => actions.onCreateChild(task)}
          >
            New child
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger disabled={actions.reorderDisabledReason !== null}>
              Reorder
            </ContextMenuSubTrigger>
            <TaskContextSubContent>
              <ContextMenuGroup>
                <ContextMenuItem onClick={() => actions.onReorder("up")}>Move up</ContextMenuItem>
                <ContextMenuItem onClick={() => actions.onReorder("down")}>
                  Move down
                </ContextMenuItem>
                <ContextMenuItem onClick={() => actions.onReorder("start")}>
                  Move to beginning
                </ContextMenuItem>
                <ContextMenuItem onClick={() => actions.onReorder("end")}>
                  Move to end
                </ContextMenuItem>
              </ContextMenuGroup>
            </TaskContextSubContent>
          </ContextMenuSub>
          <ContextMenuItem onClick={() => actions.onCopy(task)}>Copy text</ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem variant="destructive" onClick={() => actions.onDelete(task)}>
            Delete
          </ContextMenuItem>
        </ContextMenuGroup>
      </TaskContextMenuContent>
    </ContextMenu>
  );
}
