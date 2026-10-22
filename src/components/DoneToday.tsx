import { useRef, useState, type CSSProperties, type ReactElement } from "react";
import { CircleCheck } from "lucide-react";
import { formatRecentTime, formatTaskDateTime } from "@/backend/taskDates";
import { preventFocusSteal } from "@/navigation";
import type { TaskView } from "./taskView";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ListPopoverContent } from "@/components/variants/popover";

/**
 * The header's quiet tally of tasks done in the last 24 hours. Hidden at zero,
 * so a fresh morning shows no empty score. It opens the list of what was done.
 */
export function DoneToday({
  tasks,
  total,
  open,
  onOpenChange,
  finalFocus,
}: {
  tasks: readonly TaskView[];
  total: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus: () => HTMLElement | undefined;
}): ReactElement | null {
  const list = useRef<HTMLUListElement>(null);
  // Only a rising count pops; undo takes it back quietly.
  const [shownTotal, setShownTotal] = useState(total);
  const [rose, setRose] = useState(false);
  if (shownTotal !== total) {
    setShownTotal(total);
    setRose(total > shownTotal);
  }
  // An open list stays until closed, so an undo to zero never drops focus with it.
  if (total === 0 && !open) return null;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  tabIndex={-1}
                  aria-label={`${total} done today`}
                  aria-keyshortcuts="D"
                  data-done-today
                  onMouseDown={preventFocusSteal}
                />
              }
            />
          }
        >
          <CircleCheck data-icon="inline-start" aria-hidden="true" className="text-success" />
          {/* Keyed so a new count remounts and plays its entrance once. */}
          <span key={total} className="inline-block" data-count-enter={rose || undefined}>
            {total}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          Done in the last 24 hours <Kbd>D</Kbd>
        </TooltipContent>
      </Tooltip>
      <ListPopoverContent
        data-done-today-list
        side="bottom"
        align="end"
        initialFocus={list}
        finalFocus={finalFocus}
        onKeyDown={(event) => {
          // The key that opened the list closes it (home.same-key-closes).
          const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
          if (plain && !event.repeat && event.key.toLowerCase() === "d") {
            event.preventDefault();
            onOpenChange(false);
          }
        }}
      >
        <PopoverHeader>
          <PopoverTitle>Done today</PopoverTitle>
          <PopoverDescription>
            {total === 1 ? "1 task" : `${total} tasks`} in the last 24 hours
          </PopoverDescription>
        </PopoverHeader>
        {/* Focused on open, so arrows, Page Up/Down and Home/End scroll a long list natively. */}
        <ul
          ref={list}
          tabIndex={-1}
          aria-label="Tasks done today"
          className="flex max-h-80 flex-col gap-1.5 overflow-y-auto outline-none"
        >
          {tasks.map((task, index) => (
            <li
              key={task.id}
              className="flex min-w-0 items-start gap-2"
              style={{ "--done-row": index } as CSSProperties}
            >
              <CircleCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-success" />
              {/* Two lines before it cuts off; the full title shows on hover. */}
              <span className="line-clamp-2 min-w-0 flex-1" title={task.title}>
                {task.title}
              </span>
              {task.closedAt ? (
                <time
                  dateTime={task.closedAt}
                  title={formatTaskDateTime(task.closedAt)}
                  className="shrink-0 text-xs text-muted-foreground"
                >
                  {formatRecentTime(task.closedAt)}
                </time>
              ) : null}
            </li>
          ))}
        </ul>
        {total > tasks.length ? (
          <p className="text-xs text-muted-foreground">and {total - tasks.length} more</p>
        ) : null}
      </ListPopoverContent>
    </Popover>
  );
}
