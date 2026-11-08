import type { CSSProperties, ReactElement, ReactNode } from "react";
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
const OPEN_SHOWN = 4;
/** Met goals shown as pips on the check before it becomes "✓N". */
const PIPS_SHOWN = 3;

/** A goal's stroke: its category's color, the theme's category green without one, neutral for everything else. */
function strokeOf(goal: GoalProgress): string {
  return goal.swatch
    ? "stroke-(--swatch)"
    : goal.slug
      ? "stroke-classification-category"
      : "stroke-foreground";
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
        className="stroke-foreground/15"
      />
      {/* Always drawn so a change eases into place: past the goal a little, then back. The gap
          is a whole turn, so overshooting a full ring still draws one. */}
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

/** The done count's icon with goals on: everything done today against all of today's targets. */
export function BigRing({ today }: { today: GoalsToday }): ReactElement {
  return (
    <Ring
      fraction={today.target === 0 ? 1 : today.done / today.target}
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
      className={cn("ml-3 inline-flex whitespace-pre tabular-nums", met && check && "text-success")}
    >
      {check && <span className="w-[2ch]">{met ? "✓" : ""}</span>}
      <span className="w-(--dw) text-right">{done}</span> of{" "}
      <span className="w-(--gw) text-right">{target}</span>
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

/** The done count's tooltip: today's total, then each goal's share when there is more than one. */
export function DoneTodayTip({
  today,
  lensOn,
}: {
  today: GoalsToday;
  lensOn: boolean;
}): ReactElement {
  const pairs: [number, number][] = [
    [today.done, today.target],
    ...today.goals.map((goal): [number, number] => [goal.done, goal.target]),
  ];
  return (
    <Columns className="flex flex-col gap-1.5" pairs={pairs}>
      <Line>
        <span className="font-medium">Done today</span>
        <Numbers done={today.done} target={today.target} />
      </Line>
      {today.goals.length > 1 &&
        today.goals.map((goal) => (
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
  ...data
}: { tip: ReactNode; children: ReactElement } & Record<`data-${string}`, string>) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="flex items-center" {...data} />}>
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
      {/* Only categories get a pip: everything else has no color to tell it apart, so the
          check alone says it, and the tooltip names it. */}
      {met
        .filter((goal) => goal.slug !== null)
        .map((goal, index) => (
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
 * The goals beside the done count: up to four open goals as small rings, then the met ones folded
 * into a check with colored pips. With only one goal the big ring says it all. With a category
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
  const goals =
    categoryFilter === null
      ? today.goals
      : today.goals.filter((goal) => goal.slug === categoryFilter);
  const open = goals.filter((goal) => !isMet(goal));
  const met = goals.filter(isMet);
  const shown = open.slice(0, OPEN_SHOWN);
  const folded = open.length - shown.length;
  if (goals.length === 0) return null;
  return (
    <span className="flex items-center gap-1 py-1 pr-2 max-sm:hidden" data-goal-rings>
      {shown.map((goal) => (
        <Tipped
          key={goal.slug ?? ""}
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
      {folded > 0 ? (
        <Tipped tip={<DoneTodayTip today={today} lensOn={lensOn} />} data-goal-more="">
          <span className="text-xs text-muted-foreground tabular-nums">+{folded + met.length}</span>
        </Tipped>
      ) : (
        met.length > 0 && (
          <Tipped tip={<MetTip met={met} />} data-goal-met="">
            <span className="ml-0.5 flex items-center">
              <MetCheck met={met} />
            </span>
          </Tipped>
        )
      )}
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
        return (
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
              {entry.done} of {entry.target}
            </span>
          </button>
        );
      })}
    </span>
  );
}
