import type { ComponentProps } from "react";
import { cn } from "cn";
import { TabsTrigger } from "@/components/ui/tabs";

/** Inactive tab labels at the muted text token, which keeps readable contrast in light themes too. */
export function ReadableTabsTrigger({ className, ...props }: ComponentProps<typeof TabsTrigger>) {
  return <TabsTrigger className={cn("text-muted-foreground", className)} {...props} />;
}
