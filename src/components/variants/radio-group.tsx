import type { ComponentProps } from "react";
import { cn } from "cn";
import { FieldLabel } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { FOCUS_RING } from "./focus";

/** A radio choice drawn as a card. Focus shows once, as the app's solid ring around the card. */
export function ChoiceCard({ className, ...props }: ComponentProps<typeof FieldLabel>) {
  return (
    <FieldLabel
      className={cn(
        "has-[>[data-slot=field]]:has-[:focus-visible]:ring-1 has-[>[data-slot=field]]:has-[:focus-visible]:ring-ring",
        className,
      )}
      {...props}
    />
  );
}

/** The radio inside `ChoiceCard`, which carries the focus ring for it. */
export function ChoiceRadio({ className, ...props }: ComponentProps<typeof RadioGroupItem>) {
  return <RadioGroupItem className={cn("focus-visible:ring-0", className)} {...props} />;
}

/** Choices on one line, for a short pick like a report's kind. */
export function InlineRadioGroup({ className, ...props }: ComponentProps<typeof RadioGroup>) {
  return <RadioGroup className={cn("flex gap-6", className)} {...props} />;
}

/**
 * A bare radio beside its label, focused with the app's solid ring on the radio itself.
 * The offset keeps the ring apart from the filled dot when the focused radio is checked.
 */
export function InlineRadio({ className, ...props }: ComponentProps<typeof RadioGroupItem>) {
  return (
    <RadioGroupItem
      className={cn(
        FOCUS_RING,
        "focus-visible:ring-offset-2 focus-visible:ring-offset-popover",
        className,
      )}
      {...props}
    />
  );
}
