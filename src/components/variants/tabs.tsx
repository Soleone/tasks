import type { ComponentProps } from "react";
import { cn } from "cn";
import { TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { FOCUS_RING } from "./focus";

/**
 * Panels share one grid cell, so the tallest one sets the height and switching tabs never resizes.
 * Inactive panels stay laid out but invisible; Base UI already makes them inert.
 * Controls with `transition-all` would animate the inherited visibility and linger after the switch.
 */
export function StackedTabsContent({ className, ...props }: ComponentProps<typeof TabsContent>) {
  return (
    <TabsContent
      keepMounted
      hidden={false}
      className={cn(
        "col-start-1 row-start-1 data-hidden:invisible data-hidden:**:transition-none",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Readable inactive labels and the same focus as the filter toolbar: solid border plus ring.
 * The dark variant beats the active tab's dark border; full height keeps the 1px lines off a half pixel.
 */
export function ReadableTabsTrigger({ className, ...props }: ComponentProps<typeof TabsTrigger>) {
  return (
    <TabsTrigger
      className={cn(
        "h-full text-muted-foreground dark:focus-visible:border-ring",
        FOCUS_RING,
        className,
      )}
      {...props}
    />
  );
}
