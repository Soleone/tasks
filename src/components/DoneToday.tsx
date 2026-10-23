import { useState, type ReactElement } from "react";
import { CircleCheck } from "lucide-react";
import { preventFocusSteal } from "@/navigation";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleButton } from "@/components/variants/button";

/**
 * The header's quiet tally of tasks done in the last 24 hours. Hidden at zero,
 * so a fresh morning shows no empty score. It turns the done lens on and off.
 */
export function DoneToday({
  total,
  lensOn,
  onToggleLens,
}: {
  total: number;
  lensOn: boolean;
  onToggleLens: () => void;
}): ReactElement | null {
  // Only a rising count pops; undo takes it back quietly.
  const [shownTotal, setShownTotal] = useState(total);
  const [rose, setRose] = useState(false);
  if (shownTotal !== total) {
    setShownTotal(total);
    setRose(total > shownTotal);
  }
  // The lens keeps its way back, even after an undo takes the count to zero.
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
            aria-label={`${total} done today`}
            aria-keyshortcuts="D"
            data-done-today
            onMouseDown={preventFocusSteal}
            onClick={onToggleLens}
          />
        }
      >
        <CircleCheck data-icon="inline-start" aria-hidden="true" className="text-success" />
        {/* Keyed so a new count remounts and plays its entrance once. */}
        <span key={total} className="inline-block" data-count-enter={rose || undefined}>
          {total}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {lensOn ? "Back to your list" : "Show what's done"} <Kbd>D</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}
