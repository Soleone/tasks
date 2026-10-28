import { createContext, useContext, useSyncExternalStore, type ReactElement } from "react";
import type { WeekProps } from "react-day-picker";
import { localToday } from "@/backend/dueDate";
import { formatDueDate } from "@/backend/taskDates";
import { Calendar } from "@/components/variants/calendar";

// Below this height, as on a phone with the keyboard up, the month shrinks to one week.
const SHORT_WINDOW = "(max-height: 600px)";

function subscribeShortWindow(onChange: () => void): () => void {
  const query = matchMedia(SHORT_WINDOW);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function isShortWindow(): boolean {
  return matchMedia(SHORT_WINDOW).matches;
}

function calendarDay(due: string): Date {
  const [year, month, day] = due.split("-").map(Number);
  return new Date(year, month - 1, day);
}

const StripDay = createContext("");

// Renders only the week row that holds the highlighted date.
function StripWeek({ week, ...props }: WeekProps): ReactElement {
  const focus = useContext(StripDay);
  return week.days.some((day) => localToday(day.date) === focus) ? <tr {...props} /> : <></>;
}

/**
 * The month under the title field while a `!word` is typed, in the flow so the editor grows
 * around it instead of clipping it. It highlights the date the word points
 * at and shows what Enter does; clicking a day picks it. Focus stays in the title field.
 * In a short window it shows only the highlighted week.
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
  const focus = choice ?? today;
  const strip = useSyncExternalStore(subscribeShortWindow, isShortWindow);
  return (
    <div
      role="group"
      aria-label="Due date picker"
      className="mt-1 w-fit rounded-md border bg-popover text-popover-foreground"
      onMouseDown={(event) => event.preventDefault()}
    >
      <StripDay value={focus}>
        <Calendar
          mode="single"
          weekStartsOn={1}
          // The parent remounts the picker when the highlighted date changes.
          defaultMonth={calendarDay(focus)}
          hideNavigation={strip}
          components={strip ? { Week: StripWeek } : undefined}
          selected={choice === null ? undefined : calendarDay(choice)}
          onDayClick={(day) => onPick(localToday(day))}
        />
      </StripDay>
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
