import type { ComponentProps } from "react";
import { cn } from "cn";
import { Item, ItemDescription, ItemTitle } from "@/components/ui/item";

/** Task row states. Active wins over selected; callers keep that precedence when choosing. */
const STATES = {
  active: "border-transparent bg-primary/10",
  selected: "border-transparent bg-primary/5",
  context: "bg-muted/50 text-muted-foreground",
  empty: "min-h-16 border-dashed border-border bg-transparent",
};

export type TaskItemState = keyof typeof STATES;

export function TaskItem({
  state,
  className,
  ...props
}: ComponentProps<typeof Item> & { state?: TaskItemState }) {
  // List status slots share the first toolbar cell's center; editors keep their inset.
  return (
    <Item
      className={cn(
        props.role === "option" && "border-l-0 pl-0",
        state && STATES[state],
        className,
      )}
      {...props}
    />
  );
}

/** Task titles stay complete at narrow widths. */
export function TaskItemTitle({ className, ...props }: ComponentProps<typeof ItemTitle>) {
  return <ItemTitle className={cn("line-clamp-none", className)} {...props} />;
}

/** The quiet classification row for category and tag badges. */
export function TaskItemMetadata({ className, ...props }: ComponentProps<typeof ItemDescription>) {
  return (
    <ItemDescription className={cn("flex flex-wrap items-center gap-1.5", className)} {...props} />
  );
}
