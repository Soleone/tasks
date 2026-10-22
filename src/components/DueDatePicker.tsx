import { useState, type ReactElement } from "react";
import { localToday } from "@/backend/dueDate";
import { formatDueDate } from "@/backend/taskDates";
import { Calendar } from "@/components/ui/calendar";

function calendarDay(due: string): Date {
  const [year, month, day] = due.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * The month under the title field while a `^word` is typed, in the flow so the editor grows
 * around it instead of clipping it. It highlights the date the word points
 * at and shows what Enter does; clicking a day picks it. Focus stays in the title field.
 */
export function DueDatePicker({
  choice,
  current,
  onPick,
}: {
  choice: string | null;
  current: string | null;
  onPick: (due: string) => void;
}): ReactElement {
  const today = localToday();
  // Starts on the highlighted date's month; the parent remounts it when that date changes.
  const [month, setMonth] = useState(() => calendarDay(choice ?? today));
  return (
    <div
      role="group"
      aria-label="Due date picker"
      className="mt-1 w-fit rounded-md border bg-popover text-popover-foreground"
      onMouseDown={(event) => event.preventDefault()}
    >
      <Calendar
        mode="single"
        weekStartsOn={1}
        month={month}
        onMonthChange={setMonth}
        selected={choice === null ? undefined : calendarDay(choice)}
        onDayClick={(day) => onPick(localToday(day))}
      />
      <p className="flex items-center justify-between gap-3 border-t px-3 py-1.5 text-xs">
        {choice === null ? (
          <span className="text-muted-foreground">No date matches</span>
        ) : (
          <>
            <span>{formatDueDate(choice, today)}</span>
            {choice === current ? (
              <span className="text-destructive">↵ remove</span>
            ) : (
              <span className="text-muted-foreground">↵ select</span>
            )}
          </>
        )}
      </p>
    </div>
  );
}
