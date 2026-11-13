import type { ComponentProps } from "react";
import { cn } from "cn";
import { Input as StockInput } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownTextarea } from "@/components/soleone/markdown-textarea";
import { FOCUS_RING } from "./focus";

/** Setup fields use the same keyboard focus ring as the rest of the app. */
export function Input({ className, ...props }: ComponentProps<typeof StockInput>) {
  return <StockInput className={cn(FOCUS_RING, className)} {...props} />;
}

/** A multi-line form field with the app's keyboard focus ring. */
export function FieldTextarea({ className, ...props }: ComponentProps<typeof Textarea>) {
  return <Textarea className={cn(FOCUS_RING, className)} {...props} />;
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

/**
 * The description in the type Details shows it in, its Markdown styled as typed, growing with its
 * text until it scrolls. Like the title, it carries no box.
 */
export function InlineDescription({
  className,
  ...props
}: ComponentProps<typeof MarkdownTextarea>) {
  return (
    <MarkdownTextarea
      className={cn(
        "max-h-80 rounded-none border-0 p-0 text-xs text-foreground/80 caret-primary focus-within:ring-0 md:text-xs [&_textarea]:placeholder:text-muted-foreground/70",
        className,
      )}
      {...props}
    />
  );
}

/** A short count typed in place, its digits right-aligned and evenly wide. */
export function CountInput({ className, ...props }: ComponentProps<typeof StockInput>) {
  return (
    <StockInput
      inputMode="numeric"
      className={cn(FOCUS_RING, "h-7 w-12 text-right tabular-nums", className)}
      {...props}
    />
  );
}
