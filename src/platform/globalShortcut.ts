import { isDesktopTauri } from "./runtime";

export const DEFAULT_GLOBAL_SHORTCUT = "Ctrl+Alt+Space";

export function isShortcutConfigured(value: string): boolean {
  const parts = value.split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return false;
  const key = parts.at(-1)?.toLowerCase();
  if (!key || key === "ctrl" || key === "alt" || key === "shift" || key === "meta" || key === "command") return false;
  return parts.slice(0, -1).every((part) => ["ctrl", "control", "alt", "shift", "meta", "command", "cmd", "super"].includes(part.toLowerCase()));
}

export async function setGlobalShortcut(next: string, previous: string | null): Promise<void> {
  if (!isDesktopTauri()) return;

  const [{ getCurrentWindow }, { register, unregister }] = await Promise.all([
    import("@tauri-apps/api/window"),
    import("@tauri-apps/plugin-global-shortcut"),
  ]);
  await register(next, async (event) => {
    if (event.state !== "Pressed") return;
    const window = getCurrentWindow();
    await window.unminimize();
    await window.show();
    await window.setFocus();
  });
  if (previous && previous !== next) {
    try {
      await unregister(previous);
    } catch {
      // The previous shortcut may not have been registered in this process.
    }
  }
}
