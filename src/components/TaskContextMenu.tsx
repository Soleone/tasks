import { useState, type ReactElement } from "react";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  ChevronDown,
  ChevronsUp,
  ChevronUp,
  Circle,
  CircleX,
  Copy,
  CornerDownRight,
  Flag,
  Link2,
  ListChevronsUpDown,
  Pencil,
} from "lucide-react";
import { cn } from "cn";
import type { TaskEffort, TaskPriority, TaskStatus } from "@/backend/taskModel";
import type { TaskView } from "./taskView";
import {
  EFFORT_ICONS,
  EFFORTS_LARGEST_FIRST,
  EXACT_STATUS_META,
  PRIORITY_META,
  effortTitle,
  taskStatusMeta,
} from "./taskFilters";
import { SETTABLE_STATUSES, statusSettable, type SettableStatus } from "./taskStatusCycle";
import { StatusGlyph } from "./TaskRow";
import type { TaskMoveDirection } from "./taskReordering";
import {
  ContextMenu,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
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
  onSetStatus: (task: TaskView, status: SettableStatus) => void;
  onAddBlocker: (task: TaskView) => void;
  onMoveUnder: (task: TaskView) => void;
  onCreateChild: (task: TaskView) => void;
  detailsShown: boolean;
  onToggleDetails: (task: TaskView) => void;
  onCopy: (task: TaskView) => void;
  onPriority: (task: TaskView, priority: TaskPriority) => void;
  onEffort: (task: TaskView, effort: TaskEffort) => void;
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
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Circle aria-hidden="true" />
              Status
            </ContextMenuSubTrigger>
            <TaskContextSubContent>
              <ContextMenuRadioGroup
                value={task.status}
                onValueChange={(status: SettableStatus) => actions.onSetStatus(task, status)}
              >
                {SETTABLE_STATUSES.map((status) => {
                  const { Icon, color } = taskStatusMeta[status];
                  return (
                    <ContextMenuRadioItem
                      key={status}
                      value={status}
                      disabled={!statusSettable(task.status, status)}
                      closeOnClick
                    >
                      <Icon aria-hidden="true" className={color} />
                      {statusLabel(status)}
                    </ContextMenuRadioItem>
                  );
                })}
              </ContextMenuRadioGroup>
            </TaskContextSubContent>
          </ContextMenuSub>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Flag aria-hidden="true" />
              Priority
            </ContextMenuSubTrigger>
            <TaskContextSubContent>
              <ContextMenuRadioGroup
                value={task.priority}
                onValueChange={(priority: TaskPriority) => actions.onPriority(task, priority)}
              >
                {PRIORITY_META.map((meta) => (
                  <ContextMenuRadioItem key={meta.value} value={meta.value} closeOnClick>
                    <span aria-hidden="true" className={meta.glyph}>
                      <StatusGlyph task={{ status: "open", priority: meta.value }} />
                    </span>
                    <span className={cn("font-medium", meta.title)}>{meta.shortLabel}</span>{" "}
                    <span className="text-muted-foreground">{meta.label}</span>
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </TaskContextSubContent>
          </ContextMenuSub>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <ChevronsUp aria-hidden="true" />
              Effort
            </ContextMenuSubTrigger>
            <TaskContextSubContent>
              <ContextMenuRadioGroup
                value={task.effort}
                onValueChange={(effort: TaskEffort) => actions.onEffort(task, effort)}
              >
                {EFFORTS_LARGEST_FIRST.map((effort) => {
                  const Icon = EFFORT_ICONS[effort];
                  return (
                    <ContextMenuRadioItem key={effort} value={effort} closeOnClick>
                      <Icon aria-hidden="true" />
                      {effortTitle(effort)}
                    </ContextMenuRadioItem>
                  );
                })}
              </ContextMenuRadioGroup>
            </TaskContextSubContent>
          </ContextMenuSub>
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
          <ContextMenuItem onClick={() => actions.onToggleDetails(task)}>
            <ListChevronsUpDown aria-hidden="true" />
            {actions.detailsShown ? "Hide details" : "Show details"}
          </ContextMenuItem>
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

function statusLabel(status: TaskStatus): string {
  return EXACT_STATUS_META.find((entry) => entry.status === status)?.label ?? status;
}
