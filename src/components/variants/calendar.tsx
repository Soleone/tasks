import type { ComponentProps } from "react";
import { cn } from "cn";
import { Calendar as StockCalendar } from "@/components/ui/calendar";
import { NESTED_BUTTON_FOCUS } from "./focus";

/** DayPicker also marks its focused day on the parent cell; both paths use the same solid ring. */
export function Calendar({ className, ...props }: ComponentProps<typeof StockCalendar>) {
  return (
    <StockCalendar
      className={cn(
        NESTED_BUTTON_FOCUS,
        "[&_[data-focused=true]_button]:ring-2 [&_[data-focused=true]_button]:ring-ring",
        className,
      )}
      {...props}
    />
  );
}
