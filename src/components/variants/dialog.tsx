import type { ComponentProps } from "react";
import { cn } from "cn";
import { DialogContent } from "@/components/ui/dialog";
import { NESTED_BUTTON_FOCUS } from "./focus";

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
        NESTED_BUTTON_FOCUS,
        className,
      )}
      {...props}
    />
  );
}

/**
 * Hugs a full-size image and stays inside the window. It zooms from half size, so opening reads
 * as the thumbnail growing; `!` beats the stock 95% zoom, which would otherwise win on CSS order.
 */
export function ImagePreviewContent({ className, ...props }: ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      className={cn(
        "max-h-[calc(100svh-2rem)] w-auto max-w-[calc(100svw-2rem)] overflow-y-auto p-2 data-open:zoom-in-50! data-closed:zoom-out-50! sm:max-w-[calc(100svw-2rem)]",
        NESTED_BUTTON_FOCUS,
        className,
      )}
      {...props}
    />
  );
}

/** The image in `ImagePreviewContent`: its own size, or shrunk to fit the window. */
export function PreviewImage({
  withActions = false,
  className,
  ...props
}: ComponentProps<"img"> & { withActions?: boolean }) {
  return (
    <img
      alt=""
      className={cn(
        "max-w-[calc(100svw-3rem)] rounded-md object-contain",
        withActions ? "max-h-[calc(100svh-7rem)]" : "max-h-[calc(100svh-3rem)]",
        className,
      )}
      {...props}
    />
  );
}
