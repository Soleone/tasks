import type { ComponentProps } from "react";
import { ContextMenuContent, ContextMenuSubContent } from "@/components/ui/context-menu";

// Task titles stay bounded, and touch actions need larger targets than desktop menu rows.
const taskMenuClasses =
  "w-64 [&_[data-slot=context-menu-label]]:truncate pointer-coarse:[&_[role=menuitem]]:min-h-11 pointer-coarse:[&_[role=menuitemradio]]:min-h-11";

export function TaskContextMenuContent(props: ComponentProps<typeof ContextMenuContent>) {
  return <ContextMenuContent {...props} className={taskMenuClasses} />;
}

export function TaskContextSubContent(props: ComponentProps<typeof ContextMenuSubContent>) {
  return <ContextMenuSubContent {...props} className={taskMenuClasses} />;
}
