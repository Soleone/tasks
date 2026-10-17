/** "native" is the Tauri app, on desktop and Android alike. */
export type RuntimeKind = "native" | "browser";

export function runtimeKind(): RuntimeKind {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window ? "native" : "browser";
}

export function isAndroid(): boolean {
  return typeof navigator !== "undefined" && /\bAndroid\b/.test(navigator.userAgent);
}
