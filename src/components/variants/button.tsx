import type { ComponentProps } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";

type ButtonProps = ComponentProps<typeof Button>;

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
