import type { ComponentProps } from "react";
import { cn } from "cn";
import { InputGroup as StockInputGroup } from "@/components/ui/input-group";

/** Search has one solid ring around the whole field, not its embedded controls. */
export function InputGroup({ className, ...props }: ComponentProps<typeof StockInputGroup>) {
  return (
    <StockInputGroup
      className={cn(
        "has-[[data-slot=input-group-control]:focus-visible]:ring-2 has-[[data-slot=input-group-control]:focus-visible]:ring-ring",
        className,
      )}
      {...props}
    />
  );
}
