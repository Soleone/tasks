/** "native" is the Tauri app, on desktop and phones alike. */
export type RuntimeKind = "native" | "browser";

export function runtimeKind(): RuntimeKind {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window ? "native" : "browser";
}

export function isAndroid(): boolean {
  return typeof navigator !== "undefined" && /\bAndroid\b/.test(navigator.userAgent);
}

/** Known from the build: an iPad's WebView can call itself a Mac. */
export function isIos(): boolean {
  return import.meta.env.TAURI_ENV_PLATFORM === "ios";
}

/** The Tauri app on a phone or tablet, used by touch. */
export function isMobileApp(): boolean {
  return isAndroid() || isIos();
}

/** The Tauri app on Windows, macOS or Linux. */
export function isDesktopApp(): boolean {
  return runtimeKind() === "native" && !isMobileApp();
}

type Platform = "macos" | "windows" | "linux";

const USER_AGENTS: [Platform, RegExp][] = [
  ["macos", /\b(Macintosh|iPhone|iPad)\b/],
  ["windows", /\bWindows\b/],
];
const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
const platform = USER_AGENTS.find(([, pattern]) => pattern.test(userAgent))?.[0] ?? "linux";

/** Keys that hints name differently per platform. `Mod` is the app's main shortcut modifier. */
const KEY_NAMES: Record<Platform, Partial<Record<string, string>>> = {
  macos: { Mod: "⌘", Alt: "⌥", Super: "⌘" },
  windows: { Mod: "Ctrl", Super: "Win" },
  linux: { Mod: "Ctrl", Super: "Super" },
};

/** A key as this platform's hints name it. */
export function keyName(key: string): string {
  return KEY_NAMES[platform][key] ?? key;
}

/** The modifier key that shortcut hints name: ⌘ on macOS, Ctrl elsewhere. */
export const modKey = keyName("Mod");

const PLATFORM_NAMES: Record<Platform, string> = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
};

/** Where this copy of Tasks runs, as a person names it: "Windows", "Android" or "the web". */
export function platformName(): string {
  if (isAndroid()) return "Android";
  if (isIos()) return "iOS";
  return runtimeKind() === "native" ? PLATFORM_NAMES[platform] : "the web";
}
