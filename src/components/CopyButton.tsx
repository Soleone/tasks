import { useState, type ComponentProps } from "react";
import { CopyIcon } from "lucide-react";
import { Button } from "@/components/variants/button";
import { Tooltip } from "@/components/variants/tooltip";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useFlashTooltip } from "@/components/useFlashTooltip";

export const FLASH_FEEDBACK_DURATION_MS = 1500;

/** Copies what `text` returns and confirms in a tooltip that flashes after each copy and never opens on hover (`client.feedback`). */
export function CopyButton({
  text,
  copied,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick"> & { text: () => string; copied: string }) {
  const [result, setResult] = useState<{ version: number; message: string }>();
  const feedback = useFlashTooltip(result?.version, FLASH_FEEDBACK_DURATION_MS);
  const show = (message: string) =>
    setResult((last) => ({ version: (last?.version ?? 0) + 1, message }));
  return (
    <Tooltip open={feedback.open && feedback.flashing} onOpenChange={feedback.onOpenChange}>
      <TooltipTrigger
        render={
          <Button
            variant="outline"
            {...props}
            onClick={() =>
              void Promise.resolve()
                .then(() => navigator.clipboard.writeText(text()))
                .then(
                  () => show(copied),
                  () => show("Couldn't copy; select it instead"),
                )
            }
          />
        }
      >
        <CopyIcon data-icon="inline-start" aria-hidden="true" />
        {children}
      </TooltipTrigger>
      <TooltipContent role="status">{result?.message}</TooltipContent>
    </Tooltip>
  );
}
