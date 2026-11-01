import type { ComponentProps } from "react";
import { cn } from "cn";
import { Button as StockButton } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { FOCUS_RING } from "./focus";

type ButtonProps = ComponentProps<typeof StockButton>;

/** All app buttons share the toolbar's solid keyboard focus ring. */
export function Button({ className, ...props }: ButtonProps) {
  return <StockButton className={cn(FOCUS_RING, className)} {...props} />;
}

/**
 * The selected treatment for pressed toolbar controls and checked priority radios. Semantic primary
 * tokens only, so every theme keeps accent text plus a visible surface cue.
 */
const SELECTED =
  "border-primary/50 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary aria-expanded:bg-primary/10 aria-expanded:text-primary dark:border-primary/60 dark:bg-primary/20 dark:hover:bg-primary/25";

export function ToggleButton({
  selected = false,
  className,
  ...props
}: ButtonProps & { selected?: boolean }) {
  return <Button className={cn(selected && SELECTED, className)} {...props} />;
}

/** A minor action beside a primary one, muted until hovered so it doesn't compete. */
export function QuietButton({ className, ...props }: ButtonProps) {
  return (
    <Button
      variant="ghost"
      className={cn("text-muted-foreground hover:text-foreground", className)}
      {...props}
    />
  );
}

/** A mouse fallback that teaches its shortcut: the key cap, then the action. */
export function KeyHintButton({
  keys,
  children,
  ...props
}: Omit<ButtonProps, "size"> & { keys?: string }) {
  return (
    <QuietButton size="xs" {...props}>
      {keys ? <Kbd aria-hidden="true">{keys}</Kbd> : null}
      {children}
    </QuietButton>
  );
}

/**
 * Muted text standing where a field will open, like an empty field's placeholder, at the field's
 * height so nothing moves when it opens. Its hit area reaches mostly downward, away from the
 * controls above, so a finger finds it.
 */
export function PlaceholderButton({ className, ...props }: Omit<ButtonProps, "variant" | "size">) {
  return (
    <Button
      variant="ghost"
      className={cn(
        "relative flex h-auto w-full justify-start border-0 p-0 text-xs leading-normal font-normal text-muted-foreground after:absolute after:inset-x-0 after:-top-1 after:-bottom-4 hover:bg-transparent",
        className,
      )}
      {...props}
    />
  );
}
