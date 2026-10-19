import type { ReactElement } from "react";
import { createPortal } from "react-dom";
import type { Marker } from "./composerShorthand";
import { Button } from "@/components/ui/button";
import { preventFocusSteal } from "@/navigation";

export type Arrow = "left" | "up" | "down" | "right";

type KeyboardBarProps = {
  disabled: boolean;
  onMarker: (marker: Marker) => void;
  onTab: (backward: boolean) => void;
  onArrow: (arrow: Arrow) => void;
};

// Keys a phone keyboard hides on another page. The app pads itself above the soft keyboard, so the
// bottom of the window is the top of the keyboard. Portaled so an animated row can't anchor it.
export function KeyboardBar({
  disabled,
  onMarker,
  onTab,
  onArrow,
}: KeyboardBarProps): ReactElement {
  const keys = [
    { label: "@", name: "@", press: () => onMarker("@") },
    { label: "#", name: "#", press: () => onMarker("#") },
    { label: "⇧ Tab", name: "Shift+Tab", press: () => onTab(true) },
    { label: "Tab", name: "Tab", press: () => onTab(false) },
    { label: "←", name: "Left", press: () => onArrow("left") },
    { label: "↑", name: "Up", press: () => onArrow("up") },
    { label: "↓", name: "Down", press: () => onArrow("down") },
    { label: "→", name: "Right", press: () => onArrow("right") },
  ];
  return createPortal(
    <div
      role="toolbar"
      aria-label="Keyboard keys"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-8 gap-1 border-t bg-background p-1"
    >
      {keys.map((key) => (
        <Button
          key={key.name}
          type="button"
          variant="ghost"
          tabIndex={-1}
          aria-label={key.name}
          disabled={disabled}
          // Keeps focus, and so the soft keyboard, in the field.
          onMouseDown={preventFocusSteal}
          onClick={key.press}
        >
          {key.label}
        </Button>
      ))}
    </div>,
    document.body,
  );
}

function lineStart(text: string, at: number): number {
  return at === 0 ? 0 : text.lastIndexOf("\n", at - 1) + 1;
}

// Moves the caret like an arrow key. A selection first collapses to its edge; up and down keep the
// column across lines, without knowing about soft wraps.
export function moveCaret(
  field: HTMLInputElement | HTMLTextAreaElement,
  delta: -1 | 1,
  vertical: boolean,
): void {
  const text = field.value;
  const start = field.selectionStart ?? text.length;
  const end = field.selectionEnd ?? start;
  const caret = delta < 0 ? start : end;
  let next = caret;
  if (vertical) {
    const line = lineStart(text, caret);
    const column = caret - line;
    if (delta < 0) {
      next = line === 0 ? 0 : Math.min(lineStart(text, line - 1) + column, line - 1);
    } else {
      const lineEnd = text.indexOf("\n", caret);
      const nextEnd = lineEnd === -1 ? -1 : text.indexOf("\n", lineEnd + 1);
      next =
        lineEnd === -1
          ? text.length
          : Math.min(lineEnd + 1 + column, nextEnd === -1 ? text.length : nextEnd);
    }
  } else if (start === end) {
    next = Math.min(text.length, Math.max(0, caret + delta));
  }
  field.setSelectionRange(next, next);
}
