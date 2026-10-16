import type { ComponentProps } from "react";
import { cn } from "cn";
import { Alert, AlertAction, AlertTitle } from "@/components/ui/alert";

/**
 * A confirmation before replacing data: destructive emphasis with readable body copy, and actions
 * stacked below full-width text instead of reserving the corner action gutter.
 */
export function ConfirmationAlert({ className, ...props }: ComponentProps<typeof Alert>) {
  return (
    <Alert
      className={cn("border-destructive/50 has-data-[slot=alert-action]:pr-2.5", className)}
      {...props}
    />
  );
}

export function ConfirmationAlertTitle({ className, ...props }: ComponentProps<typeof AlertTitle>) {
  return <AlertTitle className={cn("text-destructive", className)} {...props} />;
}

export function ConfirmationAlertActions({
  className,
  ...props
}: ComponentProps<typeof AlertAction>) {
  return (
    <AlertAction
      className={cn("static flex flex-wrap justify-end gap-2 pt-2", className)}
      {...props}
    />
  );
}
