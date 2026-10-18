import type { ComponentProps } from "react";
import { DropdownMenuContent } from "@/components/ui/dropdown-menu";

// Task action labels and their shortcut hints need more room than the trigger.
export function TaskActionsMenuContent(props: ComponentProps<typeof DropdownMenuContent>) {
  return <DropdownMenuContent {...props} className="w-64" />;
}
