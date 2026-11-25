import type { ComponentProps, ReactElement, ReactNode } from "react";
import { ArrowDown, ArrowDownUp, ArrowUp, ChevronDown } from "lucide-react";
import type { TaskMoveDirection } from "./taskReordering";
import { Button } from "./ui/button";
import { Popover, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipContent } from "@/components/variants/tooltip";
import { TooltipTrigger } from "./ui/tooltip";
import { preventFocusSteal } from "@/navigation";
import { ToolbarCommand, ToolbarTooltip } from "@/components/variants/toolbar";
import { CompactPopoverContent } from "@/components/variants/popover";

const REORDER_ACTIONS: { direction: TaskMoveDirection; label: string; icon: ReactNode }[] = [
  { direction: "up", label: "Move up", icon: <ArrowUp aria-hidden="true" /> },
  { direction: "down", label: "Move down", icon: <ArrowDown aria-hidden="true" /> },
  {
    direction: "start",
    label: "Move to beginning",
    icon: <ChevronDown aria-hidden="true" className="rotate-180" />,
  },
  { direction: "end", label: "Move to end", icon: <ChevronDown aria-hidden="true" /> },
];

export function ReorderMenu({
  open,
  onOpenChange,
  tooltip,
  subjectLabel,
  availabilityReason,
  reorderSelection,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tooltip: ComponentProps<typeof Tooltip>;
  subjectLabel: string;
  availabilityReason: string | null;
  reorderSelection: (direction: TaskMoveDirection) => Promise<void>;
}): ReactElement {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <ToolbarTooltip
        tooltip={tooltip}
        hint={open ? "Hide reorder controls" : "Reorder"}
        render={
          <PopoverTrigger
            render={
              <ToolbarCommand
                aria-label="Reorder"
                data-move-controls-toggle
                onMouseDown={preventFocusSteal}
              />
            }
          />
        }
      >
        <ArrowDownUp aria-hidden="true" />
      </ToolbarTooltip>
      <CompactPopoverContent
        data-move-controls
        side="bottom"
        align="end"
        sideOffset={8}
        initialFocus={false}
        finalFocus={false}
      >
        <p className="sr-only">Move {subjectLabel} in manual order.</p>
        <div
          role="toolbar"
          aria-label={
            availabilityReason
              ? `Move ${subjectLabel}. ${availabilityReason}`
              : `Move ${subjectLabel}`
          }
          aria-controls="task-list"
          className="flex items-center gap-1"
        >
          {REORDER_ACTIONS.map(({ direction, label, icon }) => (
            <Tooltip key={direction}>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    tabIndex={-1}
                    aria-label={label}
                    aria-disabled={availabilityReason !== null || undefined}
                    data-reorder-action={direction}
                    onMouseDown={preventFocusSteal}
                    onClick={() => void reorderSelection(direction)}
                  />
                }
              >
                {icon}
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={8}>
                {availabilityReason ?? label}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </CompactPopoverContent>
    </Popover>
  );
}
