import type { ComponentProps } from "react";
import { cn } from "cn";
import { SelectTrigger as StockSelectTrigger } from "@/components/ui/select";
import { FOCUS_RING } from "./focus";

/** Selects keep their stock menu behavior and share the app's focus ring. */
export function SelectTrigger({ className, ...props }: ComponentProps<typeof StockSelectTrigger>) {
  return <StockSelectTrigger className={cn(FOCUS_RING, className)} {...props} />;
}

/** A select that reads as a quiet action in a list, like "Add a goal": no box until hovered. */
export function QuietSelectTrigger({ className, ...props }: ComponentProps<typeof SelectTrigger>) {
  return (
    <SelectTrigger
      className={cn(
        "border-transparent bg-transparent text-muted-foreground shadow-none hover:bg-muted/50 dark:bg-transparent dark:hover:bg-muted/50",
        className,
      )}
      {...props}
    />
  );
}
