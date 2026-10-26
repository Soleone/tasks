import type { ComponentProps } from "react";
import { cn } from "cn";
import { TabsTrigger } from "@/components/ui/tabs";
import { FOCUS_RING } from "./focus";

/** Readable inactive labels and the same solid focus ring as the filter toolbar. */
export function ReadableTabsTrigger({ className, ...props }: ComponentProps<typeof TabsTrigger>) {
  return (
    <TabsTrigger
      className={cn(
        "text-muted-foreground focus-visible:border-transparent",
        FOCUS_RING,
        className,
      )}
      {...props}
    />
  );
}
