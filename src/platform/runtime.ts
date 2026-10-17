export type RuntimeKind = "desktop" | "browser";

export function runtimeKind(): RuntimeKind {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window ? "desktop" : "browser";
}
