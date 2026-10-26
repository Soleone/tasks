import type { ComponentProps } from "react";
import { cn } from "cn";
import { TabsTrigger } from "@/components/ui/tabs";

/** Readable inactive labels and the same solid focus ring as the filter toolbar. */
export function ReadableTabsTrigger({ className, ...props }: ComponentProps<typeof TabsTrigger>) {
  return (
    <TabsTrigger
      className={cn(
        "text-muted-foreground focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  );
}
