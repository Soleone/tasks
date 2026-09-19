export type KeyboardHelpMode = "full" | "basic" | "none";

const KEYBOARD_HELP_MODES: readonly KeyboardHelpMode[] = ["full", "basic", "none"];

export function isKeyboardHelpMode(value: string | null): value is KeyboardHelpMode {
  return value !== null && KEYBOARD_HELP_MODES.includes(value as KeyboardHelpMode);
}
