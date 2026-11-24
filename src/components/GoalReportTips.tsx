import type { ReactElement } from "react";
import { Check } from "lucide-react";
import { addDays } from "@/backend/dueDate";
import { formatDueDate } from "@/backend/taskDates";
import { Kbd } from "@/components/ui/kbd";
import { dayMet, dayProgress, type ReportRange } from "@/goalReport";
import type { GoalsToday } from "@/goals";
import { Columns, GoalDot, Line, Numbers } from "./GoalRings";

export function status(goals: GoalsToday): string {
  if (dayMet(goals)) return "met";
  if (goals.done === 0) return "nothing done";
  const { filled, target } = dayProgress(goals);
  return `${filled} of ${target}`;
}

/** A week's weekly goals: what got done toward each, and that they never hold a day back. */
export function WeekTip({
  week,
  goals,
  today,
}: {
  week: string;
  goals: GoalsToday;
  today: string;
}): ReactElement {
  const weekly = goals.goals.filter((goal) => goal.week);
  const left = weekly.reduce(
    (sum, goal) => sum + Math.max(0, goal.week!.count - goal.week!.done),
    0,
  );
  return (
    <Columns
      className="flex min-w-48 flex-col gap-1"
      pairs={weekly.map((goal) => [goal.week!.done, goal.week!.count])}
    >
      <Line>
        <span className="font-medium">
          {addDays(week, 6) >= today ? "This week" : `Week of ${formatDueDate(week, today)}`}
        </span>
        {left === 0 ? <Met /> : <span className="ml-3 opacity-60">{left} to go</span>}
      </Line>
      {weekly.map((goal) => (
        <Line key={goal.slug ?? ""}>
          <span className="flex items-center gap-1.5">
            <GoalDot goal={goal} />
            {goal.name}
          </span>
          <Numbers done={goal.week!.done} target={goal.week!.count} />
        </Line>
      ))}
      <span className="max-w-56 border-t border-current/15 pt-1.5 opacity-60">
        Counts the whole week and never holds a day back
      </span>
    </Columns>
  );
}

/** A met day or week in a tooltip, in the success green with a check. */
function Met(): ReactElement {
  return (
    <span className="ml-3 inline-flex items-center gap-1 font-medium text-success-inverse dark:text-success">
      <Check className="size-3" strokeWidth={3} />
      Met
    </span>
  );
}

/** A day's tooltip: its date and how it went, each goal's numbers, then how it compares to a usual day. */
export function DayTip({
  day,
  goals,
  today,
  usual,
  best,
  range,
}: {
  day: string;
  goals: GoalsToday;
  today: string;
  usual: number;
  /** Set on a standout day: true on the best of the month or year shown. */
  best: boolean | undefined;
  range: ReportRange;
}): ReactElement {
  const met = dayMet(goals);
  const pairs = goals.goals.map((goal): [number, number] =>
    goal.week ? [goal.week.done, goal.week.count] : [goal.done, goal.target],
  );
  return (
    <Columns className="flex min-w-48 flex-col gap-1" pairs={pairs}>
      <Line>
        <span className="font-medium">
          {day === today ? "Today" : formatDueDate(day, today)}
          <span className="font-normal opacity-60"> · {goals.done} done</span>
        </span>
        {met ? (
          <Met />
        ) : (
          <span className="ml-3 opacity-60">
            {goals.done === 0 ? "Nothing done" : status(goals)}
          </span>
        )}
      </Line>
      {goals.goals.map((goal) => (
        <Line key={goal.slug ?? ""}>
          <span className="flex items-center gap-1.5">
            <GoalDot goal={goal} />
            {goal.name}
            {goal.week && <span className="opacity-60">· {goal.done} that day</span>}
          </span>
          {goal.week ? (
            <Numbers done={goal.week.done} target={goal.week.count} />
          ) : (
            <Numbers done={goal.done} target={goal.target} />
          )}
        </Line>
      ))}
      {best !== undefined && (
        <Line>
          <span>
            {usual > 0 ? `${(goals.done / usual).toFixed(1)}× your usual day` : "A standout day"}
          </span>
          {best && <span className="ml-3 font-medium dark:text-primary">Best this {range}</span>}
        </Line>
      )}
      <span className="flex items-center justify-between gap-3 border-t border-current/15 pt-1.5">
        <span className="opacity-60">What got done</span> <Kbd>Enter</Kbd>
      </span>
    </Columns>
  );
}
