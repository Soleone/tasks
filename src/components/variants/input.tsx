import type { ComponentProps } from "react";
import { cn } from "cn";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** No border at rest so the text reads as the task itself; a faint fill marks the focused field. */
const QUIET =
  "border-transparent bg-transparent focus-visible:border-transparent focus-visible:bg-input/30 focus-visible:ring-0 dark:bg-transparent dark:focus-visible:bg-input/30";

export function QuietInput({ className, ...props }: ComponentProps<typeof Input>) {
  return <Input className={cn(QUIET, className)} {...props} />;
}

/** Grows with its text, so the resize grip goes too. */
export function QuietTextarea({ className, ...props }: ComponentProps<typeof Textarea>) {
  return <Textarea className={cn(QUIET, "resize-none", className)} {...props} />;
}
