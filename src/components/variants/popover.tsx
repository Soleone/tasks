import type { ComponentProps } from "react";
import { cn } from "cn";
import { PopoverContent, PopoverHeader } from "@/components/ui/popover";

type ContentProps = ComponentProps<typeof PopoverContent>;

/** The shortcut guide next to its toolbar: a 320px surface that doesn't move the list. */
export function GuidePopoverContent({ className, ...props }: ContentProps) {
  return (
    <PopoverContent
      className={cn("w-[min(20rem,calc(100vw-2rem))] gap-2 p-3", className)}
      {...props}
    />
  );
}

/** A short list of task titles: wider than the guide so long titles have room. */
export function ListPopoverContent({ className, ...props }: ContentProps) {
  return (
    <PopoverContent
      className={cn("w-[min(26rem,calc(100vw-2rem))] gap-2 p-3", className)}
      {...props}
    />
  );
}

/** One row of Move controls. Dense on purpose; never per-row controls. */
export function CompactPopoverContent({ className, ...props }: ContentProps) {
  return <PopoverContent className={cn("w-auto gap-1.5 p-2", className)} {...props} />;
}

/** A horizontal guide header with room for close hints. */
export function InlinePopoverHeader({ className, ...props }: ComponentProps<typeof PopoverHeader>) {
  return (
    <PopoverHeader
      className={cn("flex-row items-center justify-between gap-4", className)}
      {...props}
    />
  );
}
