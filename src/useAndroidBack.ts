import { useEffect } from "react";

declare global {
  interface Window {
    /** Called by the Android shell on the system's back gesture or button. False lets back leave the app. */
    tasksBack?: () => boolean;
  }
}

let wentBack = true;

/** The list says Escape had nothing left to close, clear or reset. */
export function escapeFoundNothing(): void {
  wentBack = false;
}

/** Android's back presses Escape for whatever has focus, and leaves the app only from the plain list. */
export function useAndroidBack(): void {
  useEffect(() => {
    window.tasksBack = () => {
      wentBack = true;
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
      return wentBack;
    };
    return () => {
      delete window.tasksBack;
    };
  }, []);
}
