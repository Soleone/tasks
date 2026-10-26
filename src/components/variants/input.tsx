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

/** No border at rest so the text reads as the task itself; focus retains a faint fill. */
const QUIET =
  "border-transparent bg-transparent focus-visible:border-transparent focus-visible:bg-input/30 dark:bg-transparent dark:focus-visible:bg-input/30";

export function QuietInput({ className, ...props }: ComponentProps<typeof Input>) {
  return <Input className={cn(QUIET, className)} {...props} />;
}

/** Grows with its text, so the resize grip goes too. */
export function QuietTextarea({ className, ...props }: ComponentProps<typeof Textarea>) {
  return <Textarea className={cn(QUIET, FOCUS_RING, "resize-none", className)} {...props} />;
}
