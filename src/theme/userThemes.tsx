import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import { themeOptions } from "virtual:theme-options";
import { ThemeProvider, type ThemeOption } from "@/components/soleone/theme";
import { createThemeHead } from "@/components/soleone/theme/head";
import { parseThemeFile } from "@/components/soleone/theme/palette";
import { readPreference } from "@/platform/preferences";
import { THEME_STORAGE_KEY } from "./config";
import { priorityStyle } from "./priorityColors";

/**
 * Themes the owner dropped into the Tasks home's `themes/` folder. Built-in themes are inlined at
 * build time; these arrive with the home, so they are parsed here and join the picker after the
 * built-ins.
 */
let userThemes: ThemeOption[] = [];
let problems: string[] = [];
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

type ThemeFile = { name: string; text: string };

function isThemeFile(value: unknown): value is ThemeFile {
  const file = value as ThemeFile;
  return typeof file?.name === "string" && typeof file.text === "string";
}

// `rose-pine` becomes `user-rose-pine` labeled "Rose Pine", so it never takes a built-in's name.
function themeName(file: string): string {
  return `user-${file.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function themeLabel(file: string): string {
  return file
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function styleSheet(): HTMLStyleElement {
  const existing = document.getElementById("user-themes");
  if (existing instanceof HTMLStyleElement) return existing;
  const style = document.createElement("style");
  style.id = "user-themes";
  document.head.append(style);
  return style;
}

/** Does for a saved user theme what the head script does for a built-in one before paint. */
function restoreSavedTheme(): void {
  const saved = userThemes.find((theme) => theme.name === readPreference(THEME_STORAGE_KEY));
  if (!saved) return;
  const root = document.documentElement;
  root.dataset.theme = saved.name;
  root.classList.toggle(
    "dark",
    saved.mode === "dark" ||
      (saved.mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches),
  );
}

/** Lists, parses and styles the home's themes, then restores a saved one. Bad files are skipped and reported. */
export async function loadUserThemes(list: () => Promise<Record<string, unknown>>): Promise<void> {
  let files: unknown;
  try {
    files = (await list()).themes;
  } catch (reason) {
    files = [];
    problems.push(
      `Couldn't read the themes folder: ${reason instanceof Error ? reason.message : String(reason)}`,
    );
  }
  if (!Array.isArray(files) || !files.every(isThemeFile))
    throw new Error("The backend returned an invalid theme list.");

  const options: ThemeOption[] = [];
  const styles: string[] = [];
  for (const file of files) {
    const name = themeName(file.name);
    try {
      const head = createThemeHead({
        themes: [{ name, label: themeLabel(file.name), toml: file.text }],
        defaultTheme: name,
        storageKey: THEME_STORAGE_KEY,
      });
      options.push(...head.themeOptions);
      styles.push(head.themeStyles, priorityStyle(name, parseThemeFile(file.text).palette));
    } catch (reason) {
      problems.push(
        `The theme "${file.name}" can't be used: ${reason instanceof Error ? reason.message : String(reason)}`,
      );
    }
  }

  userThemes = options.sort((a, b) => a.label.localeCompare(b.label));
  styleSheet().textContent = styles.join("\n");
  restoreSavedTheme();
  listeners.forEach((listener) => listener());
}

/** What went wrong loading the home's themes, handed out once so it is reported once. */
export function takeUserThemeProblems(): string[] {
  const taken = problems;
  problems = [];
  return taken;
}

/** The theme provider with the built-in themes and, once a home has loaded, its own. */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  const loaded = useSyncExternalStore(subscribe, () => userThemes);
  const themes = useMemo(() => [...themeOptions, ...loaded], [loaded]);
  return (
    <ThemeProvider themes={themes} storageKey={THEME_STORAGE_KEY}>
      {children}
    </ThemeProvider>
  );
}
