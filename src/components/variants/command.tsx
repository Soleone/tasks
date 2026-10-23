import type { ComponentProps, ReactNode } from "react";
import { cn } from "cn";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CommandShortcut } from "@/components/ui/command";
import { AnchoredDialogContent } from "./dialog";

type ContentProps = ComponentProps<typeof AnchoredDialogContent>;

/** A command palette on the shared dialog anchor, with explicit focus on open and on close. */
export function PaletteDialog({
  title,
  description,
  className,
  wide = false,
  initialFocus,
  finalFocus,
  children,
  ...props
}: Omit<ComponentProps<typeof Dialog>, "children"> & {
  title: string;
  description: string;
  className?: string;
  /** For palettes whose rows carry a hint and keycaps, so each stays on one line. */
  wide?: boolean;
  initialFocus?: ContentProps["initialFocus"];
  finalFocus?: ContentProps["finalFocus"];
  children: ReactNode;
}) {
  return (
    <Dialog {...props}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <AnchoredDialogContent
        className={cn("overflow-hidden p-0", wide && "sm:max-w-3xl", className)}
        showCloseButton={false}
        initialFocus={initialFocus}
        finalFocus={finalFocus}
      >
        {children}
      </AnchoredDialogContent>
    </Dialog>
  );
}

/** Keycap groups keep normal letter spacing next to Kbd chips. */
export function KeysShortcut({ className, ...props }: ComponentProps<typeof CommandShortcut>) {
  return (
    <CommandShortcut
      className={cn("flex shrink-0 items-center tracking-normal", className)}
      {...props}
    />
  );
}
