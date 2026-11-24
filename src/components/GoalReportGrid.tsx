import type { CSSProperties, ReactElement, ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "cn";
import { formatDueDate } from "@/backend/taskDates";
import { dayMet, dayShare, type ReportSpan } from "@/goalReport";
import { isMet, type GoalProgress, type GoalsToday } from "@/goals";
import { GoalDot } from "./GoalRings";
import { Hinted } from "./Hinted";
import { status, WeekTip } from "./GoalReportTips";

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

type Judged = ReadonlyMap<string, GoalsToday | null>;

/**
 * What a day's pips show: each daily goal it met, and each weekly goal it did something for, so a
 * weekly goal never shows as met on a day nothing went into it.
 */
export const pipsOf = (goals: GoalsToday): GoalProgress[] =>
  goals.goals.filter((goal) => (goal.week ? goal.done > 0 : isMet(goal)));

export const swatchColor = (goal: GoalProgress): string =>
  goal.swatch
    ? `var(--om-${goal.swatch})`
    : goal.slug
      ? "var(--classification-category)"
      : "var(--foreground)";
type GridProps = {
  weeks: string[][];
  judged: Judged;
  span: ReportSpan;
  day: string;
  onTip: (tip: { day: string; anchor: HTMLElement } | null) => void;
  onSelect: (day: string) => void;
  onOpen: (day: string) => void;
};

/** Pointer and focus wiring every day shares; a day after today or before the first can't be picked. */
function dayProps(
  shown: string,
  { judged, span, day, onTip, onOpen }: GridProps,
  row: number,
  col: number,
) {
  const goals = judged.get(shown) ?? null;
  const future = shown > span.today;
  return {
    type: "button" as const,
    "data-day": shown,
    "data-row": row,
    "data-col": col,
    "data-met": goals && dayMet(goals) ? "" : undefined,
    tabIndex: shown === day ? 0 : -1,
    "aria-selected": shown === day,
    "aria-disabled": goals === null || undefined,
    "aria-label": `${formatDueDate(shown, span.today)}${goals ? `, ${status(goals)}` : future ? ", still to come" : ""}`,
    onPointerEnter: (event: { currentTarget: HTMLElement }) =>
      onTip(goals ? { day: shown, anchor: event.currentTarget } : null),
    onClick: () => onOpen(shown),
  };
}

const WEEKDAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function MonthGrid(
  props: GridProps & {
    month: string;
    weekly: GoalProgress[];
    /** The standout days, each true when it's the month's best. */
    standout: ReadonlyMap<string, boolean>;
  },
): ReactElement {
  const { weeks, judged, span, day, month, weekly, standout } = props;
  const columns =
    weekly.length > 0 ? "repeat(7, minmax(0, 1fr)) 3.5rem" : "repeat(7, minmax(0, 1fr))";
  return (
    <div
      role="grid"
      aria-label="Days of the month"
      className="grid gap-1.5 [--gap:--spacing(1.5)] max-sm:gap-1 max-sm:[--gap:--spacing(1)]"
      style={{ "--columns": columns } as CSSProperties}
    >
      <div
        role="row"
        className="grid grid-cols-(--columns) gap-1.5 text-center text-2xs text-muted-foreground max-sm:gap-1"
      >
        {weeks[0].map((shown) => (
          <span key={shown} role="columnheader">
            {WEEKDAY_NAMES[new Date(`${shown}T12:00`).getDay()]}
          </span>
        ))}
        {weekly.length > 0 && (
          <Hinted
            hint={`${weekly.length === 1 ? "Weekly goal" : "Weekly goals"}, tallied week by week`}
            render={<span role="columnheader" className="flex items-center justify-center gap-1" />}
          >
            {weekly.map((goal) => (
              <GoalDot key={goal.slug ?? ""} goal={goal} neutral="bg-foreground" />
            ))}
            {weekly.length === 1 && (
              <span className="truncate max-sm:hidden">{weekly[0].name}</span>
            )}
          </Hinted>
        )}
      </div>
      {weeks.map((week, row) => {
        // A weekly goal's week so far: as of its last day, or today in this week.
        const last = week[6] > span.today ? span.today : week[6];
        const weekGoals = week[0] > span.today ? null : (judged.get(last) ?? null);
        return (
          <div
            key={week[0]}
            role="row"
            data-week
            className="relative grid grid-cols-(--columns) gap-1.5 rounded-lg max-sm:gap-1"
          >
            {week.map((shown, col) => {
              const goals = judged.get(shown) ?? null;
              const next = judged.get(week[col + 1] ?? "") ?? null;
              const linked =
                col < 6 && goals !== null && next !== null && dayMet(goals) && dayMet(next);
              return (
                <button
                  key={shown}
                  role="gridcell"
                  {...dayProps(shown, props, row, col)}
                  data-this-week={span.today >= week[0] && span.today <= week[6] ? "" : undefined}
                  className={cn(
                    "group relative h-14 rounded-lg outline-none [container-type:size] sm:h-16",
                    goals ? "cursor-pointer" : "cursor-default",
                    !shown.startsWith(month) && "opacity-35",
                  )}
                >
                  {/* The selected day's tint, square whatever the cell's shape. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute top-1/2 left-1/2 size-[min(100cqw,100cqh)] -translate-1/2 rounded-lg",
                      shown === day ? "bg-primary/16" : goals && "group-hover:bg-muted",
                    )}
                  />
                  {shown === span.today && (
                    <span className="absolute top-0.5 left-1/2 z-1 -translate-x-1/2 text-3xs font-medium text-foreground/85">
                      Today
                    </span>
                  )}
                  {linked && (
                    <span
                      aria-hidden="true"
                      data-thread={shown}
                      data-to={week[col + 1]}
                      className="pointer-events-none absolute top-[calc(50%-1px)] left-1/2 -mt-px h-0.5 w-[calc(100%+var(--gap))] origin-right rounded-full bg-success/60 max-sm:top-[calc(50%+2px)]"
                    />
                  )}
                  <DayMark date={Number(shown.slice(8))} goals={goals} best={standout.get(shown)} />
                </button>
              );
            })}
            {weekly.length > 0 && (
              <WeekCell row={row} week={week[0]} goals={weekGoals} today={span.today}>
                {weekGoals?.goals
                  .filter((goal) => goal.week)
                  .map((goal) => {
                    const met = goal.week!.done >= goal.week!.count;
                    return (
                      <span key={goal.slug ?? ""} className="flex items-center gap-1">
                        {weekly.length > 1 && <GoalDot goal={goal} neutral="bg-foreground" />}
                        {met && (
                          <Check
                            aria-hidden="true"
                            className="size-3.5 text-success"
                            strokeWidth={2.6}
                          />
                        )}
                        <span className={met ? "text-success" : "text-foreground"}>
                          {goal.week!.done}
                          <span className="text-muted-foreground">/{goal.week!.count}</span>
                        </span>
                      </span>
                    );
                  })}
              </WeekCell>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A row's weekly column, with its week's numbers on hover once the week has begun. */
function WeekCell({
  row,
  week,
  goals,
  today,
  children,
}: {
  row: number;
  week: string;
  goals: GoalsToday | null;
  today: string;
  children: ReactNode;
}): ReactElement {
  const cell = (
    <div
      data-row={row}
      data-col={7.4}
      className="flex flex-col items-center justify-center gap-0.5 border-l text-xs text-muted-foreground tabular-nums"
    />
  );
  // A week still to come has nothing in it to explain.
  if (!goals) return cell;
  return (
    <Hinted hint={<WeekTip week={week} goals={goals} today={today} />} render={cell}>
      {children}
    </Hinted>
  );
}

/**
 * A day of the month: its date in a ring of its goals, solid once met, ringed again on a standout
 * day and twice on the month's best (`goals.report-standout`), then a pip per goal it met.
 */
function DayMark({
  date,
  goals,
  best,
}: {
  date: number;
  /** Null for a day after today or before the first. */
  goals: GoalsToday | null;
  /** Set on a standout day: true on the month's best. */
  best: boolean | undefined;
}): ReactElement {
  const met = goals !== null && dayMet(goals);
  const pips = goals ? pipsOf(goals) : [];
  // One generic goal's pip would only repeat the solid ring.
  const pipped = goals !== null && (goals.goals.length > 1 || goals.goals[0]?.slug != null);
  return (
    <>
      <span className="absolute top-[calc(50%-1px)] left-1/2 z-1 grid size-7.5 -translate-1/2 place-items-center max-sm:top-[calc(50%+2px)] max-sm:size-6">
        {goals && (
          <svg
            viewBox="0 0 36 36"
            aria-hidden="true"
            className="absolute inset-0 size-full -rotate-90 overflow-visible"
          >
            <circle
              cx="18"
              cy="18"
              r="16.5"
              className={cn("fill-success transition-opacity", !met && "opacity-0")}
            />
            <circle
              cx="18"
              cy="18"
              r="15"
              fill="none"
              strokeWidth="3"
              className="stroke-muted-foreground/30"
            />
            <circle
              cx="18"
              cy="18"
              r="15"
              fill="none"
              strokeWidth="3"
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray="100"
              strokeDashoffset={100 - dayShare(goals) * 100}
              className={cn(
                "stroke-success transition-all duration-500",
                dayShare(goals) === 0 && "opacity-0",
                !met && "opacity-75",
              )}
            />
            {best !== undefined && (
              <circle
                cx="18"
                cy="18"
                r="19.5"
                fill="none"
                strokeWidth="1.5"
                className="stroke-primary"
              />
            )}
            {best && (
              <circle
                cx="18"
                cy="18"
                r="22.5"
                fill="none"
                strokeWidth="1"
                className="stroke-primary opacity-45"
              />
            )}
          </svg>
        )}
        <span
          className={cn(
            "relative text-xs tabular-nums max-sm:text-3xs",
            met
              ? "font-semibold text-background"
              : goals?.done
                ? "text-foreground"
                : "text-muted-foreground",
            goals === null && "opacity-55",
          )}
        >
          {date}
        </span>
      </span>
      {pipped && pips.length > 0 && (
        <span className="absolute inset-x-0 bottom-1.5 z-1 flex justify-center gap-0.75 max-sm:bottom-1 max-sm:gap-0.5">
          {pips.map((goal) => (
            <span
              key={goal.slug ?? ""}
              data-swatch={goal.swatch ?? undefined}
              className={cn(
                "size-1.25 rounded-full max-sm:size-1",
                goal.swatch
                  ? "bg-(--swatch)"
                  : goal.slug
                    ? "bg-classification-category"
                    : "bg-foreground",
              )}
            />
          ))}
        </span>
      )}
    </>
  );
}

export function YearGrid(props: GridProps): ReactElement {
  const { weeks, judged, span } = props;
  const year = weeks[3][0].slice(0, 4);
  return (
    <div className="grid w-max gap-1 [--cell:11px]">
      <div className="ml-7 grid h-3.5 grid-flow-col auto-cols-(--cell) gap-x-0.75 text-2xs text-muted-foreground">
        {weeks.map((week, col) => {
          const first = week.find((shown) => shown.endsWith("-01") && shown.startsWith(year));
          return first ? (
            <span
              key={week[0]}
              className="col-start-(--col) row-start-1 whitespace-nowrap"
              style={{ "--col": col + 1 } as CSSProperties}
            >
              {MONTHS[Number(first.slice(5, 7)) - 1].slice(0, 3)}
            </span>
          ) : null;
        })}
      </div>
      <div role="grid" aria-label="Days of the year" className="flex gap-1.5">
        <div
          className="grid w-5.5 grid-rows-[repeat(7,var(--cell))] gap-y-0.75 text-3xs leading-(--cell) text-muted-foreground"
          aria-hidden="true"
        >
          {weeks[0].map((shown, row) => (
            <span key={shown}>
              {row % 2 === 0 ? WEEKDAY_NAMES[new Date(`${shown}T12:00`).getDay()] : ""}
            </span>
          ))}
        </div>
        <div className="grid grid-flow-col grid-rows-[repeat(7,var(--cell))] auto-cols-(--cell) gap-0.75">
          {weeks.flatMap((week, col) =>
            week.map((shown, row) => {
              const goals = judged.get(shown) ?? null;
              const inYear = shown.startsWith(year);
              return (
                <button
                  key={shown}
                  role="gridcell"
                  {...dayProps(shown, props, row, col)}
                  className={cn(
                    "rounded-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    !inYear && "invisible",
                    yearShade(goals),
                    goals === null &&
                      shown <= span.today &&
                      "inset-ring inset-ring-muted-foreground/20",
                    shown === span.today && "ring-1 ring-primary",
                    goals ? "cursor-pointer" : "cursor-default",
                  )}
                  style={
                    goals
                      ? ({ "--share": `${Math.round(dayShare(goals) * 45)}%` } as CSSProperties)
                      : undefined
                  }
                />
              );
            }),
          )}
        </div>
      </div>
    </div>
  );
}

/** A year's day: solid green once met, fainter the less of its goals it got to. */
function yearShade(goals: GoalsToday | null): string | undefined {
  if (goals === null) return undefined;
  if (dayMet(goals)) return "bg-success";
  return goals.done === 0 ? "bg-muted/70" : "bg-success/(--share)";
}
