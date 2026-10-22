import type { ComponentProps } from "react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";

const KINDS = {
  category: "border-classification-category bg-classification-category",
  tag: "border-classification-tag bg-classification-tag",
  due: "border-info bg-info",
};

/** Compact category, tag and due date badges: semantic tokens, 20px high, quiet density. */
export function ClassificationBadge({
  kind,
  className,
  ...props
}: Omit<ComponentProps<typeof Badge>, "variant"> & { kind: keyof typeof KINDS }) {
  return (
    <Badge
      className={cn(
        "h-5 px-1.5 text-xs font-normal text-classification-foreground",
        KINDS[kind],
        className,
      )}
      {...props}
    />
  );
}
