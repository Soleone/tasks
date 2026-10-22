import { useEffect, useRef, type ReactElement } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { createPortal } from "react-dom";
import type { Marker } from "./composerShorthand";
import { Button } from "@/components/ui/button";

type KeyboardBarProps = {
  disabled: boolean;
  onMarker: (marker: Marker) => void;
  onMoveCursor: (direction: -1 | 1) => void;
};

// Escape can close the editor, and this bar with it, before the finger lifts. The tap's click then
// lands on whatever is under it, such as a row's status glyph.
function swallowNextClick(): void {
  const swallow = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 600);
}

// Portaled so an animated row can't anchor the bar above the soft keyboard.
export function KeyboardBar({ disabled, onMarker, onMoveCursor }: KeyboardBarProps): ReactElement {
  const repeatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function stopRepeat(): void {
    if (repeatTimer.current !== null) clearTimeout(repeatTimer.current);
    repeatTimer.current = null;
  }
  function repeatMove(direction: -1 | 1): void {
    if (disabled) return;
    onMoveCursor(direction);
    repeatTimer.current = setTimeout(() => repeatMove(direction), 60);
  }
  useEffect(() => {
    if (disabled) stopRepeat();
    return stopRepeat;
  }, [disabled]);

  const keys = [
    {
      label: "Esc",
      name: "Escape",
      press: () =>
        document.activeElement?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        ),
      closesBar: true,
    },
    { label: "@", name: "@", press: () => onMarker("@") },
    { label: "#", name: "#", press: () => onMarker("#") },
    {
      label: <ArrowLeft aria-hidden="true" />,
      name: "Move cursor left",
      direction: -1 as const,
      press: () => onMoveCursor(-1),
    },
    {
      label: <ArrowRight aria-hidden="true" />,
      name: "Move cursor right",
      direction: 1 as const,
      press: () => onMoveCursor(1),
    },
  ];
  return createPortal(
    <div
      role="toolbar"
      aria-label="Keyboard keys"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 gap-1 border-t bg-background p-1"
    >
      {keys.map((key) => (
        <Button
          key={key.name}
          type="button"
          variant="ghost"
          tabIndex={-1}
          aria-label={key.name}
          disabled={disabled}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            // Touch focus changes happen before click. Run while the field still owns focus,
            // and prevent the bar from taking focus or dismissing the soft keyboard.
            event.preventDefault();
            stopRepeat();
            if (key.closesBar) swallowNextClick();
            key.press();
            const direction = key.direction;
            if (direction !== undefined) {
              event.currentTarget.setPointerCapture(event.pointerId);
              repeatTimer.current = setTimeout(() => repeatMove(direction), 400);
            }
          }}
          onPointerUp={stopRepeat}
          onPointerCancel={stopRepeat}
          onLostPointerCapture={stopRepeat}
          onPointerLeave={stopRepeat}
          onContextMenu={(event) => event.preventDefault()}
          onClick={(event) => {
            // Assistive technology can activate without a pointer event.
            if (event.detail === 0) key.press();
          }}
        >
          {key.label}
        </Button>
      ))}
    </div>,
    document.body,
  );
}
