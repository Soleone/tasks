import type { ComponentProps } from "react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { FOCUS_RING } from "./focus";

const KINDS = {
  category: "border-classification-category bg-classification-category",
  tag: "border-classification-tag bg-classification-tag",
  due: "border-info bg-info",
};

/** On touch, a removable pill reaches past its 20px so a finger can hit it. */
const TOUCH_TARGET =
  "relative pointer-coarse:after:absolute pointer-coarse:after:-inset-x-0.5 pointer-coarse:after:-inset-y-2";

/** Compact category, tag and due date badges: semantic tokens, 20px high, quiet density. */
export function ClassificationBadge({
  kind,
  touchTarget = false,
  className,
  ...props
}: Omit<ComponentProps<typeof Badge>, "variant"> & {
  kind: keyof typeof KINDS;
  touchTarget?: boolean;
}) {
  return (
    <Badge
      className={cn(
        "h-5 px-1.5 text-xs font-normal text-classification-foreground",
        FOCUS_RING,
        KINDS[kind],
        touchTarget && TOUCH_TARGET,
        className,
      )}
      {...props}
    />
  );
}
