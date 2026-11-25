import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type MouseEvent,
} from "react";
import type { Tooltip } from "@/components/variants/tooltip";

/**
 * Toolbar tooltips that open on hover, and briefly after a touch tap on a button marked
 * `data-toolbar-feedback`. Attach `onClickCapture` to the toolbar's root.
 */
export function useToolbarFeedback(
  unblockedFeedbackOpen: boolean,
  setUnblockedFeedbackOpen: (open: boolean) => void,
): {
  feedbackTooltip: (key: string) => ComponentProps<typeof Tooltip>;
  onClickCapture: (event: MouseEvent) => void;
} {
  const tooltipId = useId();
  const touchTarget = useRef<HTMLButtonElement | null>(null);
  const [touchFeedback, setTouchFeedback] = useState<{ key: string } | null>(null);
  const [hoveredTooltip, setHoveredTooltip] = useState<string | null>(null);
  const dismissFeedback = useEffectEvent((event: PointerEvent | KeyboardEvent) => {
    touchTarget.current =
      "pointerType" in event && event.pointerType === "touch" && event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>("button[data-toolbar-feedback]")
        : null;
    setTouchFeedback(null);
    setHoveredTooltip(null);
    setUnblockedFeedbackOpen(false);
  });
  useEffect(() => {
    document.addEventListener("pointerdown", dismissFeedback, true);
    document.addEventListener("keydown", dismissFeedback, true);
    return () => {
      document.removeEventListener("pointerdown", dismissFeedback, true);
      document.removeEventListener("keydown", dismissFeedback, true);
    };
  }, []);
  useEffect(() => {
    if (!touchFeedback) return;
    const timeout = window.setTimeout(() => setTouchFeedback(null), 1500);
    return () => window.clearTimeout(timeout);
  }, [touchFeedback]);

  function feedbackTooltip(key: string): ComponentProps<typeof Tooltip> {
    return {
      triggerId: `${tooltipId}-${key}`,
      open: touchFeedback
        ? touchFeedback.key === key
        : hoveredTooltip !== null
          ? hoveredTooltip === key
          : key === "unblocked" && unblockedFeedbackOpen,
      onOpenChange: (open, details) => {
        // Touch generates press and hover-end events after the click. Neither should
        // dismiss the feedback that click just opened.
        if (
          touchFeedback?.key === key &&
          (details.reason === "trigger-press" || details.reason === "trigger-hover")
        ) {
          details.cancel();
          return;
        }
        setHoveredTooltip((previous) => (open ? key : previous === key ? null : previous));
        if (open || key === "unblocked") setUnblockedFeedbackOpen(false);
        if (open || touchFeedback?.key === key) setTouchFeedback(null);
      },
    };
  }

  function onClickCapture(event: MouseEvent): void {
    const button = touchTarget.current;
    touchTarget.current = null;
    if (!button || button.disabled || !button.contains(event.target as Node)) return;
    setHoveredTooltip(null);
    setTouchFeedback({ key: button.dataset.toolbarFeedback! });
  }

  return { feedbackTooltip, onClickCapture };
}
