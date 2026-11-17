import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "cn";
import { addDays } from "@/backend/dueDate";
import { formatDueDate } from "@/backend/taskDates";
import { Field, FieldLabel } from "@/components/ui/field";
import { Kbd } from "@/components/ui/kbd";
import { TooltipTrigger } from "@/components/ui/tooltip";
import { QuietButton } from "@/components/variants/button";
import { BindingKbd } from "@/components/variants/kbd";
import { InlineRadio, InlineRadioGroup } from "@/components/variants/radio-group";
import { AnchoredTooltipContent, Tooltip } from "@/components/variants/tooltip";
import {
  clampDay,
  currentStreak,
  dayMet,
  dayProgress,
  dayShare,
  judgeDays,
  monthWeeks,
  rangeStats,
  reportSpan,
  shiftDay,
  yearWeeks,
  type ReportRange,
  type ReportSpan,
} from "@/goalReport";
import { goalsOn, isMet, type DoneTask, type GoalProgress, type GoalsToday } from "@/goals";
import { boundAction } from "@/keymap";
import { practice } from "@/learning/progress";
import { preventFocusSteal } from "@/navigation";
import { readPreference, writePreference } from "@/platform/preferences";
import type { SharedSettings } from "@/platform/sharedSettings";
import { Columns, GoalDot, Line, Numbers } from "./GoalRings";
import { Hinted } from "./Hinted";
import {
  flyDayToLens,
  flyWeekHome,
  playDayClosed,
  playOpening,
  playSlide,
  type ReportTakeOff,
} from "./goalReportMotion";
import { isDialogOpen } from "./useTaskListKeyboard";

const MONTHS = [
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
const RANGES = [
  ["month", "Month"],
  ["year", "Year"],
] as const;
/** The day the closing-the-day motion last played, so each day closes once (`goals.report-motion`). */
const CLOSED_DAY_KEY = "tasks.goal-report.closed-day";

type Judged = ReadonlyMap<string, GoalsToday | null>;

/**
 * What a day's pips show: each daily goal it met, and each weekly goal it did something for, so a
 * weekly goal never shows as met on a day nothing went into it.
 */
const pipsOf = (goals: GoalsToday): GoalProgress[] =>
  goals.goals.filter((goal) => (goal.week ? goal.done > 0 : isMet(goal)));

const swatchColor = (goal: GoalProgress): string =>
  goal.swatch
    ? `var(--om-${goal.swatch})`
    : goal.slug
      ? "var(--classification-category)"
      : "var(--foreground)";

export type GoalReportProps = {
  settings: SharedSettings;
  /** Every task done, the tally's too; null while it loads. */
  done: readonly DoneTask[] | null;
  range: ReportRange;
  /** The selected day, `YYYY-MM-DD`. */
  day: string;
  takeOff: ReportTakeOff;
  onMove: (day: string) => void;
  onRange: (range: ReportRange) => void;
  /** Shows the day in the done lens (`goals.report-day`). */
  onOpenDay: (day: string) => void;
  onClose: () => void;
};

/** The goal report, in place of the list: every day of a month or a year against today's goals. */
export function GoalReport({ done, ...props }: GoalReportProps): ReactElement {
  if (done === null)
    return <section aria-label="Goal report" aria-busy="true" className="min-h-0 flex-1" />;
  return <Report done={done} {...props} />;
}

function Report({
  settings,
  done,
  range,
  day,
  takeOff,
  onMove,
  onRange,
  onOpenDay,
  onClose,
}: GoalReportProps & { done: readonly DoneTask[] }): ReactElement {
  const root = useRef<HTMLElement>(null);
  const span = useMemo(() => reportSpan(settings, done), [settings, done]);
  const period = range === "month" ? day.slice(0, 7) : day.slice(0, 4);
  const first = range === "month" ? `${period}-01` : `${period}-01-01`;
  // A new grid only when the month or year changes, not with every day selected in it.
  const weeks = useMemo(
    () => (range === "month" ? monthWeeks(settings, first) : yearWeeks(settings, first)),
    [settings, range, first],
  );
  const judged = useMemo(
    () => judgeDays(settings, done, weeks.flat(), span),
    [settings, done, weeks, span],
  );
  const stats = useMemo(
    () => rangeStats(new Map([...judged].filter(([shown]) => shown.startsWith(period)))),
    [judged, period],
  );
  const streak = useMemo(() => currentStreak(settings, done, span), [settings, done, span]);
  const today = useMemo(() => goalsOn(settings, done, span.today), [settings, done, span.today]);
  const weekly = today.goals.filter((goal) => goal.week);
  const [tip, setTip] = useState<{ day: string; anchor: HTMLElement } | null>(null);

  const cell = (shown: string) =>
    root.current?.querySelector<HTMLElement>(`[data-day="${shown}"]`) ?? null;

  // The selected day holds the keyboard; moving it moves focus, and the tooltip follows.
  const moved = useRef(false);
  useLayoutEffect(() => {
    const selected = cell(day);
    selected?.focus({ preventScroll: range === "month" });
    if (moved.current && selected) setTip({ day, anchor: selected });
  }, [day, range]);

  // Once, as the report opens; a later range or day settles in on its own.
  const playOpen = useEffectEvent(() => {
    if (root.current) playOpening(root.current, takeOff, span.today, range === "year");
  });
  useLayoutEffect(() => playOpen(), []);

  const shownPeriod = useRef(period);
  useLayoutEffect(() => {
    if (shownPeriod.current === period) return;
    const direction = period > shownPeriod.current ? 1 : -1;
    shownPeriod.current = period;
    if (root.current) playSlide(root.current, direction);
  }, [period]);

  // Closing onto the done lens sends this week's days back into its dots, measured while they
  // still stand here.
  useLayoutEffect(
    () => () => {
      const home = new Map<string, { box: DOMRect; met: boolean }>();
      for (const dot of document.querySelectorAll<HTMLElement>("[data-day][data-this-week]"))
        home.set(dot.dataset.day!, {
          box: dot.getBoundingClientRect(),
          met: dot.dataset.met !== undefined,
        });
      flyWeekHome(home);
    },
    [],
  );

  // Today closes once: as it happens with the report open, or on the first look after.
  const todayMet = dayMet(today);
  const wasMet = useRef<boolean | null>(null);
  useEffect(() => {
    const before = wasMet.current;
    wasMet.current = todayMet;
    if (!todayMet || !root.current || readPreference(CLOSED_DAY_KEY) === span.today) return;
    if (before === true) return;
    writePreference(CLOSED_DAY_KEY, span.today);
    const colors = pipsOf(today).map(swatchColor);
    const play = () => root.current && playDayClosed(root.current, span.today, colors);
    // On opening, after the days have settled.
    const timer = window.setTimeout(play, before === null ? 1300 : 0);
    return () => window.clearTimeout(timer);
  }, [todayMet, today, span.today]);

  function select(next: string): void {
    moved.current = true;
    onMove(clampDay(next, span));
  }

  function open(shown: string): void {
    const goals = judged.get(shown);
    const target = cell(shown);
    if (!goals || !target) return;
    flyDayToLens(target.getBoundingClientRect(), dayMet(goals));
    onOpenDay(shown);
  }

  const onKeyDown = useEffectEvent((event: KeyboardEvent): void => {
    if (isDialogOpen()) return;
    const id = boundAction(event);
    if (id === "goals.report") {
      event.preventDefault();
      practice("goals.report");
      onClose();
      return;
    }
    if (id === "goals.report-range") {
      event.preventDefault();
      practice("goals.report-range");
      onRange(range === "month" ? "year" : "month");
      return;
    }
    if (event.altKey || event.shiftKey) return;
    if (event.ctrlKey || event.metaKey) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      select(shiftDay(day, range, event.key === "ArrowLeft" ? -1 : 1));
      return;
    }
    const across = range === "month" ? 1 : 7;
    const down = range === "month" ? 7 : 1;
    const step = new Map([
      ["ArrowLeft", -across],
      ["ArrowRight", across],
      ["ArrowUp", -down],
      ["ArrowDown", down],
    ]).get(event.key);
    if (event.key === "Tab") event.preventDefault();
    else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Enter") {
      event.preventDefault();
      open(day);
    } else if (event.key === "Home") {
      event.preventDefault();
      select(span.today);
    } else if (step !== undefined) {
      event.preventDefault();
      select(addDays(day, step));
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => onKeyDown(event);
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, []);

  const canGoBack = first > span.first;
  const canGoOn = shiftDay(first, range, 1) <= span.today;

  return (
    <section
      ref={root}
      aria-label="Goal report"
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
      onPointerLeave={() => setTip(null)}
    >
      <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-1">
          <QuietButton
            size="icon-sm"
            tabIndex={-1}
            aria-label={`Previous ${range}`}
            disabled={!canGoBack}
            onMouseDown={preventFocusSteal}
            onClick={() => select(shiftDay(day, range, -1))}
          >
            <ChevronLeft aria-hidden="true" />
          </QuietButton>
          <h2 className="min-w-[9.5em] text-center text-lg font-semibold whitespace-nowrap max-sm:min-w-0">
            {range === "month"
              ? `${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`
              : period}
          </h2>
          <QuietButton
            size="icon-sm"
            tabIndex={-1}
            aria-label={`Next ${range}`}
            disabled={!canGoOn}
            onMouseDown={preventFocusSteal}
            onClick={() => select(shiftDay(day, range, 1))}
          >
            <ChevronRight aria-hidden="true" />
          </QuietButton>
        </div>
        <div className="flex items-center gap-4 max-sm:contents">
          <div className="max-sm:col-span-2 max-sm:row-start-2">
            <InlineRadioGroup
              aria-label="Show a"
              value={range}
              onValueChange={(value) => onRange(value as ReportRange)}
            >
              {RANGES.map(([value, label]) => (
                <Field key={value} orientation="horizontal" className="w-auto">
                  <InlineRadio
                    value={value}
                    id={`goal-report-${value}`}
                    tabIndex={-1}
                    onMouseDown={preventFocusSteal}
                  />
                  <FieldLabel htmlFor={`goal-report-${value}`} onMouseDown={preventFocusSteal}>
                    {label}
                  </FieldLabel>
                </Field>
              ))}
            </InlineRadioGroup>
          </div>
          <Hinted
            hint={
              <>
                Close the report <BindingKbd id="goals.report" />
              </>
            }
            render={
              <QuietButton
                size="icon-sm"
                tabIndex={-1}
                aria-label="Close the report"
                className="max-sm:col-start-2 max-sm:row-start-1"
                onMouseDown={preventFocusSteal}
                onClick={onClose}
              />
            }
          >
            <X aria-hidden="true" />
          </Hinted>
        </div>
        <Stats stats={stats} streak={streak} />
      </div>
      <div className="overflow-x-auto pb-1" data-report-grid>
        {range === "month" ? (
          <MonthGrid
            weeks={weeks}
            judged={judged}
            month={period}
            span={span}
            day={day}
            weekly={weekly}
            onTip={setTip}
            onSelect={select}
            onOpen={open}
          />
        ) : (
          <YearGrid
            weeks={weeks}
            judged={judged}
            span={span}
            day={day}
            onTip={setTip}
            onSelect={select}
            onOpen={open}
          />
        )}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
          {today.goals.map((goal) => (
            <span key={goal.slug ?? ""} className="flex items-center gap-1.5">
              <GoalDot goal={goal} neutral="bg-foreground" />
              {goal.name}
              {goal.week ? " a week" : ""}
            </span>
          ))}
        </span>
        <span className="flex items-center gap-1.5 max-sm:hidden">
          <Kbd>Enter</Kbd> what got done
          <span className="ml-2">
            <BindingKbd id="goals.report-range" />
          </span>
          {range === "month" ? "year" : "month"}
          <BindingKbd id="goals.report" /> closes
        </span>
      </footer>
      <Tooltip open={tip !== null} onOpenChange={(next) => !next && setTip(null)}>
        <TooltipTrigger render={<span className="sr-only">Day details</span>} />
        {tip && judged.get(tip.day) ? (
          <AnchoredTooltipContent anchor={tip.anchor} side="bottom" sideOffset={6}>
            <DayTip day={tip.day} goals={judged.get(tip.day)!} today={span.today} />
          </AnchoredTooltipContent>
        ) : null}
      </Tooltip>
    </section>
  );
}

function Stats({ stats, streak }: { stats: ReturnType<typeof rangeStats>; streak: number }) {
  const stat = (value: number, label: string, className?: string, streakStat = false) => (
    <span className="flex items-baseline gap-1.5 text-sm text-muted-foreground">
      <b
        key={value}
        data-stat={value}
        data-streak={streakStat || undefined}
        className={cn("inline-block text-xl font-semibold text-foreground tabular-nums", className)}
      >
        {value}
      </b>
      {label}
    </span>
  );
  return (
    <div className="col-span-2 flex flex-wrap gap-x-6 gap-y-1">
      {stat(stats.met, `of ${stats.days} ${stats.days === 1 ? "day" : "days"} met`)}
      {stat(streak, "day streak", "text-success", true)}
      {stat(stats.best, "best streak")}
      {stat(stats.done, "done")}
    </div>
  );
}

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

function status(goals: GoalsToday): string {
  if (dayMet(goals)) return "met";
  if (goals.done === 0) return "nothing done";
  const { filled, target } = dayProgress(goals);
  return `${filled} of ${target}`;
}

const WEEKDAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function MonthGrid(props: GridProps & { month: string; weekly: GoalProgress[] }): ReactElement {
  const { weeks, judged, span, month, weekly } = props;
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
                    "relative h-14 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-16",
                    goals ? "cursor-pointer hover:bg-muted" : "cursor-default",
                    !shown.startsWith(month) && "opacity-35",
                    shown === span.today && "inset-ring inset-ring-primary/70",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-1 left-2 z-1 text-2xs tabular-nums max-sm:left-1.5",
                      shown === span.today ? "text-primary" : "text-muted-foreground",
                      goals === null && shown > span.today && "opacity-55",
                    )}
                  >
                    {Number(shown.slice(8))}
                  </span>
                  {linked && (
                    <span
                      aria-hidden="true"
                      data-thread={shown}
                      data-to={week[col + 1]}
                      className="pointer-events-none absolute top-[calc(50%-4px)] left-1/2 -mt-px h-0.5 w-[calc(100%+var(--gap))] origin-right rounded-full bg-success/60 max-sm:top-[calc(50%+2px)]"
                    />
                  )}
                  {goals && <DayMark goals={goals} today={shown === span.today} />}
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

/** A week's weekly goals: what got done toward each, and that they never hold a day back. */
function WeekTip({
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
        <span className={cn("ml-3", left === 0 ? "text-success-inverse" : "opacity-70")}>
          {left === 0 ? "Met" : `${left} to go`}
        </span>
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
      <span className="max-w-56 border-t border-background/20 pt-1.5 opacity-80">
        Counts the whole week and never holds a day back
      </span>
    </Columns>
  );
}

/** A day of the month: what got done in a ring of its goals, solid once met, then a pip per goal it met. */
function DayMark({ goals, today }: { goals: GoalsToday; today: boolean }): ReactElement {
  const met = dayMet(goals);
  const pips = pipsOf(goals);
  return (
    <>
      <span className="absolute top-[calc(50%-4px)] left-1/2 z-1 grid size-7.5 -translate-1/2 place-items-center max-sm:top-[calc(50%+2px)] max-sm:size-6">
        <svg
          viewBox="0 0 36 36"
          aria-hidden="true"
          className="absolute inset-0 size-full -rotate-90"
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
            className={today ? "stroke-primary/35" : "stroke-muted-foreground/30"}
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
        </svg>
        <span
          className={cn(
            "relative text-xs tabular-nums max-sm:text-3xs",
            met ? "font-semibold text-background" : "text-foreground",
          )}
        >
          {goals.done || ""}
        </span>
      </span>
      {pips.length > 0 && (
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

function YearGrid(props: GridProps): ReactElement {
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

/** A day's tooltip: its date and how it went, then each goal's numbers. */
function DayTip({
  day,
  goals,
  today,
}: {
  day: string;
  goals: GoalsToday;
  today: string;
}): ReactElement {
  const met = dayMet(goals);
  const pairs = goals.goals.map((goal): [number, number] =>
    goal.week ? [goal.week.done, goal.week.count] : [goal.done, goal.target],
  );
  return (
    <Columns className="flex min-w-48 flex-col gap-1" pairs={pairs}>
      <Line>
        <span className="font-medium">{day === today ? "Today" : formatDueDate(day, today)}</span>
        <span className={cn("ml-3", met ? "text-success-inverse" : "opacity-70")}>
          {met ? "Met" : goals.done === 0 ? "Nothing done" : status(goals)}
        </span>
      </Line>
      {goals.goals.map((goal) => (
        <Line key={goal.slug ?? ""}>
          <span className="flex items-center gap-1.5">
            <GoalDot goal={goal} />
            {goal.name}
            {goal.week && <span className="opacity-70">· {goal.done} that day</span>}
          </span>
          {goal.week ? (
            <Numbers done={goal.week.done} target={goal.week.count} />
          ) : (
            <Numbers done={goal.done} target={goal.target} />
          )}
        </Line>
      ))}
      <span className="flex items-center justify-between gap-3 border-t border-background/20 pt-1.5 opacity-80">
        What got done <Kbd>Enter</Kbd>
      </span>
    </Columns>
  );
}
