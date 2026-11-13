import type { ComponentProps } from "react";
import { cn } from "cn";
import { Kbd } from "@/components/ui/kbd";
import { bindingCaps, useKeymap, type BindingId } from "@/keymap";

/** A large key cap for the quest card, so the key to press reads at a glance. */
export function KeyCap({ className, ...props }: ComponentProps<typeof Kbd>) {
  return (
    <Kbd
      className={cn(
        "h-10 min-w-10 rounded-md border border-b-2 bg-background px-2.5 text-base font-semibold text-foreground shadow-xs",
        className,
      )}
      {...props}
    />
  );
}

/** The key that does `id` now, as one cap like `Ctrl+K`, or nothing while it is off. */
export function BindingKbd({ id }: { id: BindingId }) {
  useKeymap();
  const caps = bindingCaps(id);
  return caps.length ? <Kbd>{caps.join("+")}</Kbd> : null;
}
