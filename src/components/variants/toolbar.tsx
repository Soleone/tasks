import type { ComponentProps, ReactElement, ReactNode } from "react";
import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleButton } from "@/components/variants/button";

/**
 * Toolbar cells: one size for every toolbar control so groups wrap onto shared columns; touch
 * pointers get a larger cell. Integer-cell widths with no gaps are what keep wrapped rows aligned.
 * Cells are mouse fallbacks for shortcuts, so no trigger may turn one into a Tab stop.
 */
const CELL = "pointer-coarse:size-8";

type ButtonProps = ComponentProps<typeof Button>;

/** A control that shows a list state. The accent tint means exactly "this state is on". */
export function ToolbarToggle({
  pressed,
  className,
  ...props
}: Omit<ButtonProps, "variant" | "size"> & { pressed: boolean }) {
  return (
    <ToggleButton
      variant={pressed ? "outline" : "ghost"}
      selected={pressed}
      size="icon-sm"
      aria-pressed={pressed}
      data-toolbar-cell
      className={cn(CELL, className)}
      {...props}
      tabIndex={-1}
    />
  );
}

/** A one-press control. Menus it opens show as expanded, never as a pressed state. */
export function ToolbarCommand({
  variant = "ghost",
  className,
  ...props
}: Omit<ButtonProps, "size" | "aria-pressed">) {
  return (
    <Button
      variant={variant}
      size="icon-sm"
      data-toolbar-cell
      className={cn(CELL, className)}
      {...props}
      tabIndex={-1}
    />
  );
}

/**
 * Names a group and folds it. Open, it reads as a label: a smaller muted icon, quieter than the
 * group's buttons. Folded, a dashed outline marks it as a stub for hidden buttons rather than one
 * more button of the group beside it. Hover swaps in the fold direction, and the dot keeps a
 * pressed button inside a folded group visible.
 */
export function ToolbarGlyph({
  icon: Icon,
  open,
  active,
  className,
  ...props
}: Omit<ButtonProps, "size" | "variant" | "children"> & {
  icon: LucideIcon;
  open: boolean;
  active: boolean;
}) {
  const Fold = open ? ChevronLeft : ChevronRight;
  return (
    <ToolbarCommand
      className={cn(
        "relative text-muted-foreground aria-expanded:bg-transparent aria-expanded:text-muted-foreground hover:aria-expanded:bg-muted hover:aria-expanded:text-foreground",
        !open && "border-dashed border-border",
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" className="size-3.5 group-hover/button:hidden" />
      <Fold aria-hidden="true" className="hidden size-3.5 group-hover/button:block" />
      {active ? (
        <span
          aria-hidden="true"
          data-toolbar-glyph-active
          className="absolute top-1 right-1 size-1.5 rounded-full bg-primary"
        />
      ) : null}
    </ToolbarCommand>
  );
}

/** Every toolbar control names itself in a tooltip above the row. */
export function ToolbarTooltip({
  tooltip,
  hint,
  render,
  children,
}: {
  tooltip: ComponentProps<typeof Tooltip>;
  hint: ReactNode;
  render: ReactElement;
  children?: ReactNode;
}) {
  return (
    <Tooltip {...tooltip}>
      <TooltipTrigger id={tooltip.triggerId ?? undefined} render={render}>
        {children}
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {hint}
      </TooltipContent>
    </Tooltip>
  );
}
