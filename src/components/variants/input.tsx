import type { ComponentProps } from "react";
import { cn } from "cn";
import { Input as StockInput } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FOCUS_RING } from "./focus";

/** Setup fields use the same keyboard focus ring as the rest of the app. */
export function Input({ className, ...props }: ComponentProps<typeof StockInput>) {
  return <StockInput className={cn(FOCUS_RING, className)} {...props} />;
}

/** Keep the native slider behavior, with the app's focus treatment instead of a browser outline. */
export function RangeInput({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  return <input type="range" className={cn("rounded-lg", FOCUS_RING, className)} {...props} />;
}

/**
 * The inline editor's fields carry no box: the text reads as the task itself, and the caret, key
 * hints and active row fill say it is being edited (`client.focus-ring`).
 */
const BARE =
  "rounded-none border-0 bg-transparent p-0 shadow-none caret-primary focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent aria-invalid:ring-0 placeholder:text-muted-foreground/70";

/** The title in the row title's type, at the row title's place. */
export function InlineTitleInput({ className, ...props }: ComponentProps<typeof StockInput>) {
  return (
    <StockInput
      className={cn(BARE, "block h-auto text-sm leading-snug font-medium md:text-sm", className)}
      {...props}
    />
  );
}

/** The description in the type Details shows it in, growing with its text until it scrolls. */
export function InlineDescription({ className, ...props }: ComponentProps<typeof Textarea>) {
  return (
    <Textarea
      className={cn(
        BARE,
        "max-h-80 min-h-0 resize-none overflow-y-auto text-xs leading-normal text-foreground/80 md:text-xs",
        className,
      )}
      {...props}
    />
  );
}
