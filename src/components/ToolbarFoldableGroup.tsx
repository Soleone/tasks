import type { ComponentProps, ReactElement, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import type { Tooltip } from "@/components/variants/tooltip";
import { ToolbarGlyph, ToolbarTooltip } from "@/components/variants/toolbar";

export const TOOLBAR_FOLD_GROUPS = ["filter", "actions"] as const;
export type ToolbarFoldGroup = (typeof TOOLBAR_FOLD_GROUPS)[number];

// A group is its glyph plus its buttons; folded, only the glyph remains. The panel stays
// mounted so the F mode can focus a folded group's toolbar.
export function FoldableGroup({
  group,
  icon,
  label,
  open,
  active,
  onFoldChange,
  tooltip,
  children,
}: {
  group: ToolbarFoldGroup;
  icon: LucideIcon;
  label: string;
  open: boolean;
  active: boolean;
  onFoldChange: (group: ToolbarFoldGroup, folded: boolean) => void;
  tooltip: ComponentProps<typeof Tooltip>;
  children: ReactNode;
}): ReactElement {
  return (
    <Collapsible
      className="flex"
      open={open}
      onOpenChange={(nextOpen) => onFoldChange(group, !nextOpen)}
    >
      <ToolbarTooltip
        tooltip={tooltip}
        hint={`${open ? "Hide" : "Show"} ${label.toLowerCase()}`}
        render={
          <CollapsibleTrigger
            render={
              <ToolbarGlyph
                icon={icon}
                open={open}
                active={!open && active}
                aria-label={label}
                data-toolbar-glyph={group}
              />
            }
          />
        }
      />
      <CollapsibleContent keepMounted className="flex">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
