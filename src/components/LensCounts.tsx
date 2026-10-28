import { useState, type ReactElement, type ReactNode } from "react";
import { CalendarDays, CircleCheck } from "lucide-react";
import { preventFocusSteal } from "@/navigation";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleButton } from "@/components/variants/button";
import type { ListLens } from "./listLens";

type LensCountProps = { total: number; lensOn: boolean; onToggleLens: () => void };

/** A quiet header count that turns its lens on and off. Hidden at zero, except while its lens is on. */
function LensCount({
  kind,
  total,
  lensOn,
  onToggleLens,
  label,
  shortcut,
  showLabel,
  children,
}: LensCountProps & {
  kind: ListLens["kind"];
  label: string;
  shortcut: string;
  showLabel: string;
  children: ReactNode;
}): ReactElement | null {
  // The lens keeps its way back, even after the count falls to zero.
  if (total === 0 && !lensOn) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ToggleButton
            variant="ghost"
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

/** Tasks done in the last 24 hours, so a fresh morning shows no empty score. */
export function DoneToday(props: LensCountProps): ReactElement | null {
  const { total } = props;
  // Only a rising count pops; undo takes it back quietly.
  const [shownTotal, setShownTotal] = useState(total);
  const [rose, setRose] = useState(false);
  if (shownTotal !== total) {
    setShownTotal(total);
    setRose(total > shownTotal);
  }
  return (
    <LensCount {...props} kind="done" label="done today" shortcut="D" showLabel="Show what's done">
      <CircleCheck data-icon="inline-start" aria-hidden="true" className="text-success" />
      {/* Keyed so a new count remounts and plays its entrance once. */}
      <span key={total} className="inline-block" data-count-enter={rose || undefined}>
        {total}
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
