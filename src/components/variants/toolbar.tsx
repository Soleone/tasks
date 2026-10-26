import type { ComponentProps, ReactElement, ReactNode } from "react";
import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "./button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleButton } from "@/components/variants/button";

/**
 * Toolbar cells: one size for every toolbar control so groups wrap onto shared columns.
 * Integer-cell widths with no gaps are what keep wrapped rows aligned.
 * Cells are mouse fallbacks for shortcuts, so no trigger may turn one into a Tab stop.
 */
const CELL = "size-8";

type ButtonProps = ComponentProps<typeof Button>;

/**
 * A control that shows a list state. The accent tint means exactly "this state is on". The dot
 * marks that part of the list deviates from it, so a pressed or unpressed look is not the whole story.
 */
export function ToolbarToggle({
  pressed,
  mixed = false,
  className,
  children,
  ...props
}: Omit<ButtonProps, "variant" | "size"> & { pressed: boolean; mixed?: boolean }) {
  return (
    <ToggleButton
      variant={pressed ? "outline" : "ghost"}
      selected={pressed}
      size="icon-sm"
      aria-pressed={pressed}
      data-toolbar-cell
      className={cn("relative", CELL, className)}
      {...props}
      tabIndex={-1}
    >
      {children}
      {mixed ? (
        <span
          aria-hidden="true"
          data-toolbar-toggle-mixed
          className="absolute top-1 right-1 size-1.5 rounded-full bg-primary"
        />
      ) : null}
    </ToggleButton>
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
 * A menu trigger that shows a list state. It takes the accent tint while that state is off its
 * default, like a pressed toggle, but as a menu it reports expanded, never pressed.
 */
export function ToolbarStateTrigger({
  selected,
  className,
  ...props
}: Omit<ButtonProps, "variant" | "size" | "aria-pressed"> & { selected: boolean }) {
  return (
    <ToggleButton
      variant={selected ? "outline" : "ghost"}
      selected={selected}
      size="icon-sm"
      data-toolbar-cell
      data-toolbar-state-selected={selected || undefined}
      className={cn(CELL, className)}
      {...props}
      tabIndex={-1}
    />
  );
}

/**
 * Names a group and folds it. Open, it reads as a label: a muted icon, quieter than the group's
 * buttons, underlined by a mark as wide as the icon so the group's start is findable without
 * spending a cell. The icon keeps the buttons' size so spacing stays even across the row. Folded,
 * a dashed outline replaces the mark and reads as a stub for hidden buttons rather than one more
 * button of the group beside it. The outline sits inside the transparent border, where filled
 * buttons paint, so a stub is as big as its neighbors and keeps the same gap to them. Hover swaps
 * in the fold direction, and the dot keeps a pressed button inside a folded group visible.
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
        !open && "outline outline-dashed outline-border -outline-offset-2",
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" className="group-hover/button:hidden" />
      <Fold aria-hidden="true" className="hidden group-hover/button:block" />
      {open ? (
        <span
          aria-hidden="true"
          data-toolbar-glyph-mark
          className="absolute inset-x-0 bottom-0.25 mx-auto h-0.5 w-4 rounded-full bg-muted-foreground/60"
        />
      ) : null}
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
