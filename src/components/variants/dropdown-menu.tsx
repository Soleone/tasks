import type { ComponentProps } from "react";
import { DropdownMenuContent } from "@/components/ui/dropdown-menu";

// Toolbar menu labels and their shortcut hints need more room than the one-cell trigger.
export function ToolbarMenuContent(props: ComponentProps<typeof DropdownMenuContent>) {
  return <DropdownMenuContent {...props} className="w-64" />;
}
