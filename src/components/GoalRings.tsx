import type { CSSProperties, ReactElement, ReactNode } from "react";
import { Fragment } from "react";
import { cn } from "cn";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isMet, type GoalProgress, type GoalsToday } from "@/goals";
import type { GoalLens } from "./listLens";

const RADIUS = 10;
/** The arc's length in its own units, as pathLength. */
const ARC = 100;
const CHECK = "m9 12 2 2 4-4";
/** Open goals beside the count before the rest fold into "+N". */
/**
 * How many open rings the header has room for as it narrows: four, two on a phone, one on a small
 * phone, none below 360px. Each ring hides below its width; `from` hides a tail from the next step
 * up, `below` under its own.
 */
const RING_STEPS = [
  { shown: 1, below: "", from: "" },
  { shown: 2, below: "max-[389px]:hidden", from: "min-[390px]:hidden" },
  { shown: 4, below: "max-sm:hidden", from: "sm:hidden" },
];
const RING_HIDDEN = ["", "max-[389px]:hidden", "max-sm:hidden", "max-sm:hidden"];
/** Met goals shown as pips on the check before it becomes "✓N". */
const PIPS_SHOWN = 3;

/** A category goal's stroke: its color, or the theme's category green without one. */
function strokeOf(goal: GoalProgress): string {
  return goal.swatch ? "stroke-(--swatch)" : "stroke-classification-category";
}

function Ring({
  fraction,
  className,
  stroke,
  swatch,
  strokeWidth,
  check,
}: {
  fraction: number;
  className: string;
  stroke: string;
  swatch?: string | null;
  strokeWidth: number;
  /** The big ring always shows its check, quiet until the ring is full; a goal ring only once met. */
  check: "always" | "met";
}): ReactElement {
  const full = fraction >= 1;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-swatch={swatch ?? undefined}
      className={cn("shrink-0 overflow-visible", className)}
    >
      <circle
        cx="12"
        cy="12"
        r={RADIUS}
        strokeWidth={strokeWidth}
        className="stroke-muted-foreground/45"
      />
      {/* Always drawn, so a change eases into place. */}
      <circle
        cx="12"
        cy="12"
        r={RADIUS}
        pathLength={ARC}
        strokeWidth={strokeWidth}
        strokeDasharray={`${ARC * Math.min(fraction, 1)} ${ARC}`}
        transform="rotate(-90 12 12)"
        data-goal-arc
        className={cn(stroke, fraction === 0 && "opacity-0")}
      />
      {(check === "always" || full) && (
        <path d={CHECK} strokeWidth={2.4} className={full ? stroke : "stroke-muted-foreground"} />
      )}
    </svg>
  );
}

/** The done count's icon with goals on: full once every goal is met. */
export function BigRing({ today }: { today: GoalsToday }): ReactElement {
  return (
    <Ring
      fraction={today.target === 0 ? 1 : today.filled / today.target}
      className="size-4"
      stroke="stroke-success"
      strokeWidth={2}
      check="always"
    />
  );
}

/** Done, then the goal, as right-aligned columns that never move when the check appears. */
function Numbers({
  done,
  target,
  check = true,
}: {
  done: number;
  target: number;
  check?: boolean;
}) {
  const met = done >= target;
  return (
    <span
      className={cn(
        "ml-3 inline-flex whitespace-pre tabular-nums",
        met && check && "text-success-inverse",
      )}
    >
      {check && <span className="w-[2ch]">{met ? "✓" : ""}</span>}
      <span className="w-(--dw) text-right">{done}</span>
      {/* The goal recedes, so the eye lands on the number you moved. */}
      <span className="w-[calc(var(--gw)+1ch)] opacity-55">/{target}</span>
    </span>
  );
}

/**
 * Lays out its lines with done and goal columns as wide as the widest numbers among `pairs`, so a
 * two-digit count still lines up.
 */
function Columns({
  pairs,
  className,
  children,
}: {
  pairs: [number, number][];
  className?: string;
  children: ReactNode;
}): ReactElement {
  const widest = (index: 0 | 1) =>
    `${Math.max(...pairs.map((pair) => String(pair[index]).length))}ch`;
  return (
    <span className={className} style={{ "--dw": widest(0), "--gw": widest(1) } as CSSProperties}>
      {children}
    </span>
  );
}

/** A goal's color; everything else is neutral, in the tooltip's ink unless `neutral` says otherwise. */
function GoalDot({
  goal,
  neutral = "bg-background",
}: {
  goal: GoalProgress;
  neutral?: string;
}): ReactElement {
  return (
    <span
      aria-hidden="true"
      data-swatch={goal.swatch ?? undefined}
      className={cn(
        "size-2 shrink-0 rounded-full",
        goal.swatch ? "bg-(--swatch)" : goal.slug ? "bg-classification-category" : neutral,
      )}
    />
  );
}

function Line({ children }: { children: ReactNode }): ReactElement {
  return <span className="flex items-center justify-between">{children}</span>;
}

/** The done count's tooltip: today's total, then each goal's numbers. */
export function DoneTodayTip({
  today,
  lensOn,
}: {
  today: GoalsToday;
  lensOn: boolean;
}): ReactElement {
  const pairs = today.goals.map((goal): [number, number] => [goal.done, goal.target]);
  return (
    <Columns className="flex flex-col gap-1.5" pairs={pairs}>
      <Line>
        <span className="font-medium">Done today</span>
        {/* Just the count: only a goal has a target, so a goal past its target can't make the
            total look met. */}
        <span className="tabular-nums">{today.done}</span>
      </Line>
      {today.goals.map((goal) => (
        <Line key={goal.slug ?? ""}>
          <span className="flex items-center gap-1.5">
            <GoalDot goal={goal} />
            {goal.name}
          </span>
          <Numbers done={goal.done} target={goal.target} />
        </Line>
      ))}
      <span className="flex items-center justify-between gap-3 border-t border-background/20 pt-1.5">
        {lensOn ? "Back to your list" : "Show what's done"} <Kbd>D</Kbd>
      </span>
    </Columns>
  );
}

/** A goal ring's tooltip: one line for a daily goal, today and this week labeled for a weekly one. */
function GoalTip({ goal }: { goal: GoalProgress }): ReactElement {
  if (!goal.week)
    return (
      <Columns pairs={[[goal.done, goal.target]]}>
        <Line>
          {goal.name}
          <Numbers done={goal.done} target={goal.target} />
        </Line>
      </Columns>
    );
  return (
    <Columns
      className="flex flex-col gap-1"
      pairs={[
        [goal.done, goal.target],
        [goal.week.done, goal.week.count],
      ]}
    >
      <span className="font-medium">{goal.name}</span>
      <Line>
        <span className="opacity-70">Today</span>
        <Numbers done={goal.done} target={goal.target} />
      </Line>
      <Line>
        <span className="opacity-70">This week</span>
        <Numbers done={goal.week.done} target={goal.week.count} />
      </Line>
    </Columns>
  );
}

/** The met check's tooltip: which goals are met, with their numbers. */
function MetTip({ met }: { met: GoalProgress[] }): ReactElement {
  return (
    <Columns
      className="flex flex-col gap-1"
      pairs={met.map((goal): [number, number] => [goal.done, goal.target])}
    >
      <span className="font-medium">Met today</span>
      {met.map((goal) => (
        <Line key={goal.slug ?? ""}>
          <span className="flex items-center gap-1.5">
            <GoalDot goal={goal} />
            {goal.name}
          </span>
          <Numbers done={goal.done} target={goal.target} check={false} />
        </Line>
      ))}
    </Columns>
  );
}

function Tipped({
  tip,
  children,
  className,
  ...data
}: { tip: ReactNode; children: ReactElement; className?: string } & Record<
  `data-${string}`,
  string
>) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={cn("flex items-center", className)} {...data} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{tip}</TooltipContent>
    </Tooltip>
  );
}

/** Met goals folded into one check, with a pip in each one's color. */
function MetCheck({ met }: { met: GoalProgress[] }): ReactElement {
  if (met.length > PIPS_SHOWN)
    return (
      <span className="flex items-center text-xs font-medium text-success tabular-nums">
        ✓{met.length}
      </span>
    );
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 overflow-visible">
      <path
        d="M19 4 8 15l-5-5"
        fill="none"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-success"
      />
      {met.map((goal, index) => (
        <circle
          key={goal.slug ?? ""}
          cx={20.5 - index * 5.4}
          cy={19.5}
          r={4}
          strokeWidth={1.6}
          data-swatch={goal.swatch ?? undefined}
          className={cn(
            "stroke-background",
            goal.swatch ? "fill-(--swatch)" : "fill-classification-category",
          )}
        />
      ))}
    </svg>
  );
}

/**
 * The goals beside the done count: up to four open goals as small rings (two on a phone), then the
 * met ones folded into a check with colored pips. With only one goal the big ring says it all. With a category
 * filter on, only that category's goal stays.
 */
export function GoalRings({
  today,
  categoryFilter,
  lensOn,
}: {
  today: GoalsToday;
  categoryFilter: string | null;
  lensOn: boolean;
}): ReactElement | null {
  if (today.goals.length < 2) return null;
  // Everything else has no color of its own, so its ring would read as a second total; the done
  // count's ring and tooltip carry it.
  const goals = today.goals.filter(
    (goal) => goal.slug !== null && (categoryFilter === null || goal.slug === categoryFilter),
  );
  const open = goals.filter((goal) => !isMet(goal));
  const met = goals.filter(isMet);
  if (goals.length === 0) return null;
  // What follows the rings: "+N" for every goal left out, or the met check when none is.
  const tail = (shown: number, className?: string) => {
    const folded = Math.max(0, open.length - shown);
    if (folded > 0)
      return (
        <Tipped
          tip={<DoneTodayTip today={today} lensOn={lensOn} />}
          className={className}
          data-goal-more=""
        >
          <span className="text-xs text-muted-foreground tabular-nums">+{folded + met.length}</span>
        </Tipped>
      );
    return (
      met.length > 0 && (
        <Tipped tip={<MetTip met={met} />} className={className} data-goal-met="">
          <span className="ml-0.5 flex items-center">
            <MetCheck met={met} />
          </span>
        </Tipped>
      )
    );
  };
  // A step that shows no more rings than the one before needs no tail of its own.
  const steps = RING_STEPS.filter(
    (step, index) => index === 0 || open.length > RING_STEPS[index - 1].shown,
  );
  return (
    <span className="flex items-center gap-1 py-1 pr-2 max-[359px]:hidden" data-goal-rings>
      {open.slice(0, RING_HIDDEN.length).map((goal, index) => (
        <Tipped
          key={goal.slug ?? ""}
          className={RING_HIDDEN[index]}
          tip={<GoalTip goal={goal} />}
          data-goal-ring={goal.slug ?? ""}
        >
          <Ring
            fraction={goal.done / goal.target}
            className="size-3.25"
            stroke={strokeOf(goal)}
            swatch={goal.swatch}
            strokeWidth={2.8}
            check="met"
          />
        </Tipped>
      ))}
      {steps.map((step, index) => (
        <Fragment key={step.shown}>
          {tail(step.shown, cn(step.below, steps[index + 1]?.from))}
        </Fragment>
      ))}
    </span>
  );
}

/** The done lens narrowed to one goal: its category, or everything outside the goal categories. */
export function goalLens(goal: GoalProgress, today: GoalsToday): GoalLens {
  return goal.slug !== null
    ? { category: goal.slug }
    : {
        excludeCategories: today.goals.flatMap((other) =>
          other.slug === null ? [] : [other.slug],
        ),
      };
}

const sameLens = (a: GoalLens | undefined, b: GoalLens): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** The done lens's count line with goals on: each goal's numbers today, a button that narrows to it. */
export function DoneLensGoals({
  today,
  goal,
  onGoal,
}: {
  today: GoalsToday;
  goal: GoalLens | undefined;
  onGoal: (goal: GoalLens | undefined) => void;
}): ReactElement | null {
  if (today.goals.length < 2) return null;
  return (
    <span className="flex flex-wrap items-center gap-1" data-done-lens-goals>
      {today.goals.map((entry) => {
        const lens = goalLens(entry, today);
        const pressed = sameLens(goal, lens);
        const button = (
          <button
            key={entry.slug ?? ""}
            type="button"
            tabIndex={-1}
            aria-pressed={pressed}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onGoal(pressed ? undefined : lens)}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground",
              pressed && "bg-muted text-foreground",
            )}
          >
            <GoalDot goal={entry} neutral="bg-foreground" />
            {entry.name}
            <span className={cn("tabular-nums", isMet(entry) && "text-success")}>
              {isMet(entry) && "✓ "}
              {entry.done}
              <span className="opacity-55">/{entry.target}</span>
            </span>
          </button>
        );
        // The pill says its name and today's numbers; only a weekly goal has more to say.
        if (!entry.week) return button;
        return (
          <Tooltip key={entry.slug ?? ""}>
            <TooltipTrigger render={button} />
            <TooltipContent side="bottom">
              <Columns pairs={[[entry.week.done, entry.week.count]]}>
                <Line>
                  <span className="opacity-70">This week</span>
                  <Numbers done={entry.week.done} target={entry.week.count} />
                </Line>
              </Columns>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </span>
  );
}
