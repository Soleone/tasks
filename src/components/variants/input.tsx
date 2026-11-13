import type { ComponentProps } from "react";
import { cn } from "cn";
import { Input as StockInput } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DescriptionSource } from "@/components/DescriptionText";
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

const DESCRIPTION_TYPE = "col-start-1 row-start-1 text-xs leading-normal md:text-xs";

/**
 * The description in the type Details shows it in, growing with its text until it scrolls. The
 * field's own text is invisible: the same text lies over it with its Markdown styled.
 */
export function InlineDescription({
  className,
  value,
  ...props
}: ComponentProps<typeof Textarea> & { value: string }) {
  return (
    <div className="grid max-h-80 overflow-y-auto">
      <Textarea
        className={cn(
          BARE,
          DESCRIPTION_TYPE,
          "min-h-0 resize-none overflow-hidden text-transparent selection:text-transparent",
          className,
        )}
        value={value}
        {...props}
      />
      {/* Only its checklist boxes take the pointer: a press ticks or unticks one in the field's
          text, keeping focus and the caret where they were. */}
      <div
        aria-hidden
        className={cn(
          DESCRIPTION_TYPE,
          "pointer-events-none wrap-break-word whitespace-pre-wrap text-foreground/80",
        )}
        onMouseDown={(event) => {
          const box = (event.target as Element).closest<HTMLElement>("[data-box]");
          const field = event.currentTarget.parentElement?.querySelector("textarea");
          if (!box || !field || field.readOnly) return;
          event.preventDefault();
          const start = Number(box.dataset.box);
          const done = field.value.slice(start, start + 3) !== "[ ]";
          field.setRangeText(done ? "[ ]" : "[x]", start, start + 3, "preserve");
          field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
        }}
      >
        <DescriptionSource text={value} />
      </div>
    </div>
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
