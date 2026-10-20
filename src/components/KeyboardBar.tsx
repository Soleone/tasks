import type { ReactElement } from "react";
import { createPortal } from "react-dom";
import type { Marker } from "./composerShorthand";
import { Button } from "@/components/ui/button";

type KeyboardBarProps = {
  disabled: boolean;
  onMarker: (marker: Marker) => void;
  onTab: (backward: boolean) => void;
};

// Portaled so an animated row can't anchor the bar above the soft keyboard.
export function KeyboardBar({ disabled, onMarker, onTab }: KeyboardBarProps): ReactElement {
  const keys = [
    { label: "@", name: "@", press: () => onMarker("@") },
    { label: "#", name: "#", press: () => onMarker("#") },
    { label: "⇧ Tab", name: "Shift+Tab", press: () => onTab(true) },
    { label: "Tab", name: "Tab", press: () => onTab(false) },
  ];
  return createPortal(
    <div
      role="toolbar"
      aria-label="Keyboard keys"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 gap-1 border-t bg-background p-1"
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
            key.press();
          }}
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
