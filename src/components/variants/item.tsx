import type { ComponentProps } from "react";
import { cn } from "cn";
import { Item, ItemActions, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";

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
  nested = false,
  className,
  ...props
}: ComponentProps<typeof Item> & { state?: TaskItemState; nested?: boolean }) {
  // List status slots share the first toolbar cell's center; editors keep their inset.
  // Rows are tighter than the stock Item, which spaces outlined cards; states are fills.
  // A child's rail runs under its parent's status glyph, through both transparent borders.
  return (
    <Item
      className={cn(
        props.role === "option" && "border-l-0 py-1.5 pl-0",
        nested &&
          "relative before:absolute before:-top-px before:-bottom-px before:left-4 before:w-px before:bg-border",
        state && STATES[state],
        className,
      )}
      {...props}
    />
  );
}

/** A root task and its visible children touch, so the list's gap separates only families. */
export function TaskItemGroup({ className, ...props }: ComponentProps<typeof ItemGroup>) {
  return <ItemGroup className={cn("gap-0 has-data-[size=sm]:gap-0", className)} {...props} />;
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

/** Display-only facts at the row's end, level with the title's first line. */
export function TaskItemTrailing({ className, ...props }: ComponentProps<typeof ItemActions>) {
  return <ItemActions className={cn("h-[1.375em] shrink-0 self-start", className)} {...props} />;
}
