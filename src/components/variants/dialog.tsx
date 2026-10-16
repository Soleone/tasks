import type { ComponentProps } from "react";
import { cn } from "cn";
import { DialogContent } from "@/components/ui/dialog";

/**
 * Every popup shares one anchor: its top edge sits just below the header, so the eyes stay put
 * when dialogs open and close.
 */
export function AnchoredDialogContent({
  className,
  ...props
}: ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      className={cn(
        "top-16 max-h-[calc(100svh-5rem)] translate-y-0 md:top-20 md:max-h-[calc(100svh-6rem)]",
        className,
      )}
      {...props}
    />
  );
}
