import type { ComponentProps } from "react";
import { cn } from "cn";
import { BreadcrumbList } from "@/components/ui/breadcrumb";

/** A single-line status trail: quiet type, tight spacing, truncation. */
export function CompactBreadcrumbList({
  className,
  ...props
}: ComponentProps<typeof BreadcrumbList>) {
  return (
    <BreadcrumbList
      className={cn(
        "flex-nowrap gap-x-1.5 overflow-hidden text-xs break-normal whitespace-nowrap",
        className,
      )}
      {...props}
    />
  );
}
