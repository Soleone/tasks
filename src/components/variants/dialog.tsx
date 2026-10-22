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

/** Hugs a full-size image and stays inside the window. */
export function ImagePreviewContent({ className, ...props }: ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      className={cn("w-auto max-w-[calc(100svw-2rem)] p-2 sm:max-w-[calc(100svw-2rem)]", className)}
      {...props}
    />
  );
}

/** The image in `ImagePreviewContent`: its own size, or shrunk to fit the window. */
export function PreviewImage({ className, ...props }: ComponentProps<"img">) {
  return (
    <img
      alt=""
      className={cn(
        "max-h-[calc(100svh-3rem)] max-w-[calc(100svw-3rem)] rounded-md object-contain",
        className,
      )}
      {...props}
    />
  );
}
