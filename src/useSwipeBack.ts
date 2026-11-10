import { useEffect } from "react";

const MIN_DISTANCE = 64;
const MAX_DURATION_MS = 500;

/** Whether a sideways drag starting here already means something: moving a caret, scrolling, a control's own gesture. */
function ownsSidewaysDrag(target: EventTarget | null): boolean {
  for (let el = target instanceof Element ? target : null; el !== null; el = el.parentElement) {
    if (el.matches('input, textarea, [contenteditable="true"], [data-slot="toast"]')) return true;
    const { touchAction, overflowX } = getComputedStyle(el);
    if (touchAction === "none" || touchAction === "pan-y") return true;
    if ((overflowX === "auto" || overflowX === "scroll") && el.scrollWidth > el.clientWidth)
      return true;
  }
  return false;
}

/** A quick one-finger swipe to the left presses Escape for whatever has focus. */
export function useSwipeBack(): void {
  useEffect(() => {
    let start: { x: number; y: number; at: number } | null = null;
    const onTouchStart = (event: TouchEvent): void => {
      const touch = event.changedTouches[0];
      start =
        event.touches.length > 1 || ownsSidewaysDrag(event.target)
          ? null
          : { x: touch.clientX, y: touch.clientY, at: event.timeStamp };
    };
    const onTouchEnd = (event: TouchEvent): void => {
      if (start === null) return;
      const touch = event.changedTouches[0];
      const left = start.x - touch.clientX;
      const sideways = Math.abs(touch.clientY - start.y) * 2 <= left;
      const quick = event.timeStamp - start.at <= MAX_DURATION_MS;
      start = null;
      if (left < MIN_DISTANCE || !sideways || !quick) return;
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    };
    const forget = (): void => {
      start = null;
    };
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", onTouchEnd);
    document.addEventListener("touchcancel", forget);
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", forget);
    };
  }, []);
}
