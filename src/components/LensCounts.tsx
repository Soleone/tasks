import { useState, type ReactElement, type ReactNode } from "react";
import { CalendarDays, CircleCheck } from "lucide-react";
import { preventFocusSteal } from "@/navigation";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleButton } from "@/components/variants/button";
import type { ListLens } from "./listLens";
import { startAfterPaint } from "./startAfterPaint";

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
  children,
}: LensCountProps & {
  kind: ListLens["kind"];
  label: string;
  shortcut: string;
  showLabel: string;
  holdPlace?: boolean;
  children: ReactNode;
}): ReactElement | null {
  // The lens keeps its way back, even after the count falls to zero.
  if (total === 0 && !lensOn && !holdPlace) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ToggleButton
            variant="ghost"
            className={total === 0 && !lensOn ? "invisible" : undefined}
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
        {lensOn ? "Back to your list" : showLabel} <Kbd>{shortcut}</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Tasks done in the last 24 hours, so a fresh morning shows no empty score. Each of the `landing`
 * completions still flying here (useDoneFlights) holds the count back until it arrives.
 */
export function DoneToday({
  landing,
  ...props
}: LensCountProps & { landing: number }): ReactElement | null {
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
  return (
    <LensCount
      {...props}
      total={shownTotal}
      holdPlace={landing > 0}
      kind="done"
      label="done today"
      shortcut="D"
      showLabel="Show what's done"
    >
      <CircleCheck data-icon="inline-start" aria-hidden="true" className="text-success" />
      <span className="relative inline-flex overflow-hidden">
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
}

/** Open tasks due today or late, in the warning color rows use for those dates. */
export function DueNow(props: LensCountProps): ReactElement | null {
  return (
    <LensCount {...props} kind="due" label="due now" shortcut="!" showLabel="Show what's due">
      <CalendarDays data-icon="inline-start" aria-hidden="true" className="text-warning" />
      <span className="text-warning">{props.total}</span>
    </LensCount>
  );
}
