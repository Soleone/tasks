import type { ComponentProps } from "react";
import { cn } from "cn";
import { Toast as StockToast } from "@/components/ui/toast";
import { FOCUS_RING, NESTED_BUTTON_FOCUS } from "./focus";

/** Toasts and their stock Close button use the app's solid focus ring. */
export function Toast({ className, ...props }: ComponentProps<typeof StockToast>) {
  return <StockToast className={cn(FOCUS_RING, NESTED_BUTTON_FOCUS, className)} {...props} />;
}
