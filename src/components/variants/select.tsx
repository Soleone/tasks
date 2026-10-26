import type { ComponentProps } from "react";
import { cn } from "cn";
import { SelectTrigger as StockSelectTrigger } from "@/components/ui/select";
import { FOCUS_RING } from "./focus";

/** Selects keep their stock menu behavior and share the app's focus ring. */
export function SelectTrigger({ className, ...props }: ComponentProps<typeof StockSelectTrigger>) {
  return <StockSelectTrigger className={cn(FOCUS_RING, className)} {...props} />;
}
