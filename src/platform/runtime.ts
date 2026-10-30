/** "native" is the Tauri app, on desktop and Android alike. */
export type RuntimeKind = "native" | "browser";

export function runtimeKind(): RuntimeKind {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window ? "native" : "browser";
}

export function isAndroid(): boolean {
  return typeof navigator !== "undefined" && /\bAndroid\b/.test(navigator.userAgent);
}

/** The Tauri app on Windows, macOS or Linux. */
export function isDesktopApp(): boolean {
  return runtimeKind() === "native" && !isAndroid();
}

type Platform = "macos" | "windows" | "linux";

const USER_AGENTS: [Platform, RegExp][] = [
  ["macos", /\bMacintosh\b/],
  ["windows", /\bWindows\b/],
];
const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
const platform = USER_AGENTS.find(([, pattern]) => pattern.test(userAgent))?.[0] ?? "linux";

/** Keys that hints name differently per platform. `Mod` is the app's main shortcut modifier. */
const KEY_NAMES: Record<Platform, Partial<Record<string, string>>> = {
  macos: { Mod: "⌘", Super: "⌘" },
  windows: { Mod: "Ctrl", Super: "Win" },
  linux: { Mod: "Ctrl", Super: "Super" },
};

/** A key as this platform's hints name it. */
export function keyName(key: string): string {
  return KEY_NAMES[platform][key] ?? key;
}

/** The modifier key that shortcut hints name: ⌘ on macOS, Ctrl elsewhere. */
export const modKey = keyName("Mod");
