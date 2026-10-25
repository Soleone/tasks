import type { ReactElement } from "react";
import { CircleHelp } from "lucide-react";

/**
 * The help icon, whose circle fills in the accent color as moves are learned
 * (`learn.progress-ring`). Complete progress is the plain help icon. `celebrate` pops it while a
 * finished quest's card shows (`quest.complete`); `finale`, once every quest is complete, fills
 * the ring and bursts it before the plain icon takes over.
 */
export function LearnIcon({
  progress,
  celebrate = false,
  finale = false,
  className,
}: {
  progress: number;
  celebrate?: boolean;
  finale?: boolean;
  className?: string;
}): ReactElement {
  if (progress >= 1 && !finale)
    return (
      <CircleHelp
        aria-hidden="true"
        data-learn-celebrate={celebrate || undefined}
        className={className}
      />
    );
  return (
    <svg
      aria-hidden="true"
      data-learn-progress={progress.toFixed(2)}
      data-learn-celebrate={celebrate || undefined}
      data-learn-finale={finale || undefined}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" strokeOpacity="0.3" data-learn-track />
      {/* Starts at the top and runs clockwise; pathLength makes the dash a fraction. */}
      <circle
        cx="12"
        cy="12"
        r="10"
        data-learn-ring
        className="text-primary"
        pathLength={1}
        strokeDasharray={`${finale ? 1 : progress} 1`}
        transform="rotate(-90 12 12)"
      />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  );
}
