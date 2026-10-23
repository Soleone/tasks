import type { ComponentProps } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";

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
      className={cn(
        "rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "ring-2 ring-ring",
        className,
      )}
      {...props}
    />
  );
}

/** The composer's priority radios. No ring: focus shows as the checked radio taking the accent. */
export function PriorityGroup({ className, ...props }: ComponentProps<typeof ButtonRow>) {
  return (
    <ButtonRow className={cn("group/priority rounded-lg outline-none", className)} {...props} />
  );
}

const FOCUSED_CHECKED =
  "group-focus/priority:border-primary/50 group-focus/priority:bg-primary/10 group-focus/priority:text-primary dark:group-focus/priority:border-primary/60 dark:group-focus/priority:bg-primary/20";

/** A radio inside `PriorityGroup`: checked is a muted outline until the group has focus. */
export function PriorityRadio({
  checked,
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "variant" | "role"> & { checked: boolean }) {
  return (
    <Button
      role="radio"
      aria-checked={checked}
      variant={checked ? "outline" : "ghost"}
      className={cn(checked && FOCUSED_CHECKED, className)}
      {...props}
    />
  );
}
