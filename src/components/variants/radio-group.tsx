import type { ComponentProps } from "react";
import { cn } from "cn";
import { FieldLabel } from "@/components/ui/field";
import { RadioGroupItem } from "@/components/ui/radio-group";

/** A radio choice drawn as a card. Focus shows once, as the app's solid ring around the card. */
export function ChoiceCard({ className, ...props }: ComponentProps<typeof FieldLabel>) {
  return (
    <FieldLabel
      className={cn(
        "has-[>[data-slot=field]]:has-[:focus-visible]:ring-2 has-[>[data-slot=field]]:has-[:focus-visible]:ring-ring",
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
