import type { ComponentProps } from "react";
import { cn } from "cn";
import { FOCUS_RING } from "./focus";

/**
 * Buttons side by side. Unlike shadcn's ButtonGroup it leaves every button its own rounded
 * corners, because a ghost button squared at the seams looks clipped when it highlights.
 */
export function ButtonRow({ className, ...props }: ComponentProps<"div">) {
  return <div role="group" className={cn("flex w-fit", className)} {...props} />;
}

/** A toolbar for the F and S focus modes. The visible ring belongs to the whole group. */
export function ToolbarGroup({
  active = false,
  className,
  ...props
}: ComponentProps<typeof ButtonRow> & { active?: boolean }) {
  return (
    <ButtonRow
      className={cn("rounded-lg outline-none", FOCUS_RING, active && "ring-2 ring-ring", className)}
      {...props}
    />
  );
}
