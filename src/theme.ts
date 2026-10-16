import type { ThemeMode, ThemeRecord } from "@/backend/themePalette";

/**
 * Applies a theme by writing its palette into the slots `src/styles.css`
 * declares. Only these slots become custom properties, so a value in a theme
 * file that belongs to another app (a Hyprland gradient, a terminal color)
 * cannot reach the stylesheet.
 */
const PALETTE_SLOTS: readonly string[] = [
  "accent",
  "on_accent",
  "on_red",
  "background",
  "dark_background",
  "darker_background",
  "lighter_background",
  "selection",
  "muted",
  "foreground",
  "dark_foreground",
  "light_foreground",
  "bright_foreground",
  "muted_foreground",
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "magenta",
  "brown",
];

const STORAGE_KEY = "tasks.theme";
const systemAppearance = window.matchMedia("(prefers-color-scheme: dark)");
let stopFollowingSystem: (() => void) | undefined;

function slotProperty(slot: string): string {
  return `--om-${slot.replaceAll("_", "-")}`;
}

function resolvedMode(mode: ThemeMode): "dark" | "light" {
  if (mode !== "system") return mode;
  return systemAppearance.matches ? "dark" : "light";
}

function paint(theme: ThemeRecord): void {
  const root = document.documentElement;
  for (const slot of PALETTE_SLOTS) {
    const value = theme.palette[slot];
    if (value === undefined) root.style.removeProperty(slotProperty(slot));
    else root.style.setProperty(slotProperty(slot), value);
  }
  root.classList.toggle("dark", resolvedMode(theme.mode) === "dark");
  // Keep the declared theme-color honest: it is the canvas the regions sit on.
  const canvas = getComputedStyle(root).getPropertyValue("--background").trim();
  if (canvas !== "") {
    document
      .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute("content", canvas);
  }
}

export function applyTheme(theme: ThemeRecord): void {
  stopFollowingSystem?.();
  stopFollowingSystem = undefined;
  paint(theme);
  if (theme.mode === "system") {
    const follow = (): void => paint(theme);
    systemAppearance.addEventListener("change", follow);
    stopFollowingSystem = () => systemAppearance.removeEventListener("change", follow);
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
  } catch {
    // Without storage the next launch simply waits for the workspace theme.
  }
}

/** Re-applies the last theme before the first paint so a launch does not flash the neutral ramp. */
export function applyStoredTheme(): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    const theme = JSON.parse(stored) as ThemeRecord;
    if (
      typeof theme?.name === "string" &&
      typeof theme.mode === "string" &&
      typeof theme.palette === "object" &&
      theme.palette !== null
    ) {
      applyTheme(theme);
    }
  } catch {
    // A stale cache is replaced by the workspace selection once the backend answers.
  }
}
