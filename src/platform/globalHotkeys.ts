import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { readPreference, writePreference } from "./preferences";
import { keyName } from "./runtime";

/** A hotkey such as `Ctrl+Alt+Space`, or null when it is off. */
export type Hotkey = string | null;
export type GlobalHotkeys = { focus: Hotkey; create: Hotkey };

const KEYS = {
  focus: "tasks.globalHotkeyFocus",
  create: "tasks.globalHotkeyCreate",
} as const;

/** Both are off until picked in Settings. */
export function readGlobalHotkeys(): GlobalHotkeys {
  return {
    focus: readPreference(KEYS.focus) || null,
    create: readPreference(KEYS.create) || null,
  };
}

export function rememberGlobalHotkeys(hotkeys: GlobalHotkeys): void {
  writePreference(KEYS.focus, hotkeys.focus ?? "");
  writePreference(KEYS.create, hotkeys.create ?? "");
}

/** The hotkey's keys as this platform names them. */
export function hotkeyKeys(hotkey: string): string[] {
  return hotkey.split("+").map(keyName);
}

export function hotkeyLabel(hotkey: string): string {
  return hotkeyKeys(hotkey).join("+");
}

/** Registers both hotkeys with the system, replacing the last ones. */
export async function registerGlobalHotkeys(hotkeys: GlobalHotkeys): Promise<void> {
  try {
    await invoke("global_hotkeys_set", { ...hotkeys });
  } catch (failed) {
    // The native side answers with the hotkey it couldn't take.
    if (failed !== hotkeys.focus && failed !== hotkeys.create) throw failed;
    throw new Error(`${hotkeyLabel(failed as string)} is taken by the system or another app.`);
  }
}

/** On Hyprland the app can't register hotkeys; its binds run this launcher instead. */
export function hyprlandLauncher(): Promise<string | null> {
  return invoke<string | null>("hyprland_launcher");
}

/** The New task hotkey, or a Hyprland bind's `--new-task` launch. */
export function onNewTaskHotkey(handler: () => void): Promise<UnlistenFn> {
  return listen("new-task", handler);
}

const MODIFIERS = [
  ["Ctrl", "ctrlKey"],
  ["Alt", "altKey"],
  ["Shift", "shiftKey"],
  ["Super", "metaKey"],
] as const;

/**
 * The hotkey a key press makes, by physical key so the keyboard layout doesn't matter: Ctrl, Alt
 * or Super plus a letter, digit, F-key or Space. Anything else is null.
 */
export function hotkeyFromKeyDown(event: KeyboardEvent): Hotkey {
  const key =
    /^Key([A-Z])$/.exec(event.code)?.[1] ??
    /^Digit(\d)$/.exec(event.code)?.[1] ??
    (/^F\d{1,2}$/.test(event.code) || event.code === "Space" ? event.code : null);
  if (!key || !(event.ctrlKey || event.altKey || event.metaKey)) return null;
  return [...MODIFIERS.filter(([, flag]) => event[flag]).map(([name]) => name), key].join("+");
}

/** A Hyprland `bind` line that presses `hotkey` to run `launcher`. */
export function hyprlandBind(hotkey: string, launcher: string, newTask: boolean): string {
  const parts = hotkey.toUpperCase().split("+");
  const key = parts.pop();
  return `bind = ${parts.join(" ")}, ${key}, exec, "${launcher}"${newTask ? " --new-task" : ""}`;
}
