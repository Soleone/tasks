import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Bot, CalendarDays, CircleCheck } from "lucide-react";
import { preventFocusSteal } from "@/navigation";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip } from "@/components/variants/tooltip";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleButton } from "@/components/variants/button";
import type { ListLens } from "./listLens";
import { isMet, type GoalsToday } from "@/goals";
import { BigRing, DoneTodayTip, GoalRings } from "./GoalRings";
import { startAfterPaint } from "./startAfterPaint";
import { celebrateGoals } from "./goalCelebration";

type LensCountProps = { total: number; lensOn: boolean; onToggleLens: () => void };

/**
 * A quiet header count that turns its lens on and off. Hidden at zero, except while its lens is on
 * or a flight to it holds its place.
 */
function LensCount({
  kind,
  total,
  lensOn,
  onToggleLens,
  label,
  shortcut,
  showLabel,
  holdPlace = false,
  alwaysShown = false,
  tip,
  children,
}: LensCountProps & {
  kind: ListLens["kind"];
  label: string;
  shortcut: string;
  showLabel: string;
  holdPlace?: boolean;
  /** Shown even at zero, as the done count is while goals are set. */
  alwaysShown?: boolean;
  /** Replaces the tooltip's "show" line. */
  tip?: ReactNode;
  children: ReactNode;
}): ReactElement | null {
  // The lens keeps its way back, even after the count falls to zero.
  if (total === 0 && !lensOn && !holdPlace && !alwaysShown) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ToggleButton
            variant="ghost"
            className={total === 0 && !lensOn && !alwaysShown ? "invisible" : undefined}
            selected={lensOn}
            aria-pressed={lensOn}
            tabIndex={-1}
            aria-label={`${total} ${label}`}
            aria-keyshortcuts={shortcut}
            data-lens-count={kind}
            onMouseDown={preventFocusSteal}
            onClick={onToggleLens}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>
        {tip ?? (
          <>
            {lensOn ? "Back to your list" : showLabel} <Kbd>{shortcut}</Kbd>
          </>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

const allMet = (today: GoalsToday): boolean => isMet({ done: today.filled, target: today.target });

/**
 * Tasks done today (doneTodaySince). Each of the `landing` completions still flying here
 * (useDoneFlights) holds the count back until it arrives. With goals set, its check becomes a ring
 * for all of today's goals added up, with each goal's own ring beside it, until every goal is met.
 */
export function DoneToday({
  landing,
  goals,
  categoryFilter,
  ...props
}: LensCountProps & {
  landing: number;
  goals: GoalsToday | null;
  categoryFilter: string | null;
}): ReactElement | null {
  const { total } = props;
  const [shownTotal, setShownTotal] = useState(total);
  // Only a rising count rolls; undo takes it back quietly.
  const [rolledFrom, setRolledFrom] = useState<number | null>(null);
  // The backend may count a completion before or after its flight starts, so a held count never
  // drops below what is already shown.
  const target = landing > 0 ? Math.min(total, Math.max(total - landing, shownTotal)) : total;
  if (shownTotal !== target) {
    setShownTotal(target);
    setRolledFrom(target > shownTotal ? shownTotal : null);
  }
  // Goals hold their last numbers too, so a ring fills as the check lands on it.
  const [heldGoals, setHeldGoals] = useState(goals);
  if (landing === 0 && heldGoals !== goals) setHeldGoals(goals);
  const shownGoals = landing > 0 && heldGoals ? heldGoals : goals;
  // A completion that meets the last goal celebrates, holding the rings until it folds them away.
  const [seenGoals, setSeenGoals] = useState(shownGoals);
  const [celebrating, setCelebrating] = useState(false);
  if (seenGoals !== shownGoals) {
    setSeenGoals(shownGoals);
    if (
      seenGoals &&
      shownGoals &&
      !allMet(seenGoals) &&
      allMet(shownGoals) &&
      shownGoals.done > seenGoals.done &&
      typeof document.body.animate === "function" &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      setCelebrating(true);
  }
  useEffect(() => {
    if (!celebrating) return;
    const fold = () => flushSync(() => setCelebrating(false));
    // Whatever stops it short, the rings still fold.
    void celebrateGoals(fold).finally(fold);
  }, [celebrating]);
  const count = (
    <LensCount
      {...props}
      total={shownTotal}
      holdPlace={landing > 0}
      alwaysShown={shownGoals !== null}
      tip={shownGoals && <DoneTodayTip today={shownGoals} lensOn={props.lensOn} />}
      kind="done"
      label="done today"
      shortcut="D"
      showLabel="Show what's done"
    >
      {shownGoals ? (
        <BigRing today={shownGoals} />
      ) : (
        <CircleCheck data-icon="inline-start" aria-hidden="true" className="text-success" />
      )}
      <span className="relative inline-flex overflow-hidden" data-lens-number>
        {/* Keyed so each rise remounts both numbers and plays the roll once. A count that was
            hidden at zero only rolls its first number in. */}
        {rolledFrom !== null && rolledFrom > 0 && (
          <span
            key={`from-${shownTotal}`}
            className="absolute"
            aria-hidden="true"
            data-count-leave
            ref={startAfterPaint}
          >
            {rolledFrom}
          </span>
        )}
        <span
          key={shownTotal}
          className="inline-block"
          data-count-enter={rolledFrom !== null || undefined}
          ref={startAfterPaint}
        >
          {shownTotal}
        </span>
      </span>
    </LensCount>
  );
  if (!shownGoals) return count;
  // Hovering the count lights up the whole group as one: the ring is the goals added up.
  return (
    <span
      className="flex items-center gap-1 rounded-md transition-colors has-[[data-lens-count=done]:hover]:bg-muted"
      data-goals
    >
      {count}
      {(celebrating || !allMet(shownGoals)) && (
        <span className="contents" onClick={props.onToggleLens}>
          <GoalRings today={shownGoals} categoryFilter={categoryFilter} lensOn={props.lensOn} />
        </span>
      )}
    </span>
  );
}

/** Open tasks due today or late, in red so the count stands apart from the accent in every theme. */
export function DueNow(props: LensCountProps): ReactElement | null {
  return (
    <LensCount {...props} kind="due" label="due now" shortcut="!" showLabel="Show what's due">
      <CalendarDays data-icon="inline-start" aria-hidden="true" className="text-destructive" />
      <span className="text-destructive" data-lens-number>
        {props.total}
      </span>
    </LensCount>
  );
}

/** Tasks agents changed since you last looked. Leaving its lens clears it. */
export function AgentChanges({
  agents,
  ...props
}: LensCountProps & {
  /** Who made the changes, to name a lone agent in the tooltip. */
  agents: readonly string[];
}): ReactElement | null {
  return (
    <LensCount
      {...props}
      kind="agents"
      label="changed by agents"
      shortcut="Shift+A"
      showLabel={`Show what ${agents.length === 1 ? agents[0] : "agents"} changed`}
    >
      <Bot data-icon="inline-start" aria-hidden="true" />
      <span data-lens-number>{props.total}</span>
    </LensCount>
  );
}
