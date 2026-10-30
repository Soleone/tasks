import { useEffect, useEffectEvent } from "react";
import { toast } from "@/components/ui/toast";
import {
  hyprlandLauncher,
  onNewTaskHotkey,
  readGlobalHotkeys,
  registerGlobalHotkeys,
} from "@/platform/globalHotkeys";
import { isDesktopApp } from "@/platform/runtime";

/** Registers the saved global hotkeys on the desktop; the New task one calls `onNewTask`. */
export function useGlobalHotkeys(onNewTask: () => void): void {
  const newTask = useEffectEvent(onNewTask);
  useEffect(() => {
    if (!isDesktopApp()) return;
    void hyprlandLauncher()
      .then((launcher) => (launcher === null ? registerGlobalHotkeys(readGlobalHotkeys()) : null))
      .catch((error: unknown) =>
        toast.add({
          title: `${error instanceof Error ? error.message : String(error)} Pick another global hotkey in Settings.`,
          timeout: 0,
        }),
      );
    const listening = onNewTaskHotkey(() => newTask());
    return () => void listening.then((stop) => stop());
  }, []);
}
