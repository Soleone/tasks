import type { ComponentProps } from "react";
import { cn } from "cn";
import { Checkbox as StockCheckbox } from "@/components/ui/checkbox";
import { FOCUS_RING } from "./focus";

/** Match settings checkboxes to the app's solid keyboard focus ring. */
export function Checkbox({ className, ...props }: ComponentProps<typeof StockCheckbox>) {
  return <StockCheckbox className={cn(FOCUS_RING, className)} {...props} />;
}
