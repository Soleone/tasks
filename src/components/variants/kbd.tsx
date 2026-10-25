import type { ComponentProps } from "react";
import { cn } from "cn";
import { Kbd } from "@/components/ui/kbd";

/** A large key cap for the quest card, so the key to press reads at a glance. */
export function KeyCap({ className, ...props }: ComponentProps<typeof Kbd>) {
  return (
    <Kbd
      className={cn(
        "h-10 min-w-10 rounded-md border border-b-2 bg-background px-2.5 text-base font-semibold text-foreground shadow-xs",
        className,
      )}
      {...props}
    />
  );
}
