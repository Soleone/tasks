import type { ComponentProps } from "react";
import { cn } from "cn";
import { ButtonGroup } from "@/components/ui/button-group";

/**
 * A toolbar for the F and S focus modes. The visible ring belongs to the whole group, and every
 * button keeps its left border so toggling a control never shifts the layout.
 */
export function ToolbarGroup({
  active = false,
  className,
  ...props
}: ComponentProps<typeof ButtonGroup> & { active?: boolean }) {
  return (
    <ButtonGroup
      className={cn(
        "rounded-lg outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 [&>[data-slot]~[data-slot]]:border-l!",
        active && "ring-3 ring-ring/50",
        className,
      )}
      {...props}
    />
  );
}
