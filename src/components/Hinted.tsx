import type { ReactElement, ReactNode } from "react";
import { Tooltip } from "@/components/variants/tooltip";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** A short hint on hover, shown at once like every tooltip here; never a native title, which lags. */
export function Hinted({
  hint,
  render,
  children,
}: {
  hint: ReactNode;
  /** The element that shows the hint, without children: they go in `children`. */
  render: ReactElement;
  children: ReactNode;
}): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger render={render}>{children}</TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}
