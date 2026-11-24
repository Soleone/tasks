import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "cn";
import { addDays } from "@/backend/dueDate";
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
  judgeDays,
  monthWeeks,
  rangeStats,
  reportSpan,
  shiftDay,
  standouts,
  usualDone,
  yearWeeks,
  type ReportRange,
} from "@/goalReport";
import { goalsOn, type DoneTask } from "@/goals";
import { boundAction } from "@/keymap";
import { practice } from "@/learning/progress";
import { preventFocusSteal } from "@/navigation";
import { readPreference, writePreference } from "@/platform/preferences";
import type { SharedSettings } from "@/platform/sharedSettings";
import { GoalDot } from "./GoalRings";
import { Hinted } from "./Hinted";
import { MONTHS, MonthGrid, YearGrid, pipsOf, swatchColor } from "./GoalReportGrid";
import { DayTip } from "./GoalReportTips";
import {
  flyDayToLens,
  flyWeekHome,
  playDayClosed,
  playOpening,
  playSlide,
  type ReportTakeOff,
} from "./goalReportMotion";
import { isDialogOpen } from "./useTaskListKeyboard";

const RANGES = [
  ["month", "Month"],
  ["year", "Year"],
] as const;
/** The day the closing-the-day motion last played, so each day closes once (`goals.report-motion`). */
const CLOSED_DAY_KEY = "tasks.goal-report.closed-day";

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
  const usual = useMemo(() => usualDone(settings, done, span.today), [settings, done, span.today]);
  const standout = useMemo(() => standouts(judged, usual, period), [judged, usual, period]);
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
            standout={standout}
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
            <DayTip
              day={tip.day}
              goals={judged.get(tip.day)!}
              today={span.today}
              usual={usual}
              best={standout.get(tip.day)}
              range={range}
            />
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
