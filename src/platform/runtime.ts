export type RuntimeKind = "desktop" | "android" | "browser";

function hasTauriInternals(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function runtimeKind(): RuntimeKind {
  if (!hasTauriInternals()) return "browser";

  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return /\bandroid\b/i.test(userAgent) ? "android" : "desktop";
}

export function isDesktopTauri(): boolean {
  return runtimeKind() === "desktop";
}
