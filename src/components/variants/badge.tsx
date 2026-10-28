import type { ComponentProps } from "react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { FOCUS_RING } from "./focus";

/** Compact category badge: semantic token, 20px high, quiet density. */
export function CategoryBadge({
  className,
  ...props
}: Omit<ComponentProps<typeof Badge>, "variant">) {
  return (
    <Badge
      className={cn(
        "h-5 border-classification-category bg-classification-category px-1.5 text-xs font-normal text-classification-foreground",
        FOCUS_RING,
        className,
      )}
      {...props}
    />
  );
}
