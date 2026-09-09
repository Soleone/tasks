import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CommandError } from "./errors.js";
import type { ProtocolRequest, ThemeRecord } from "./protocol.js";
import { DEFAULT_THEME_NAME, THEME_SETTING_KEY, parseThemeFile } from "./themePalette.js";

/**
 * Built-in palettes, each an omarchy `colors.toml` body. They are embedded so
 * the packaged sidecar needs no theme assets, and they stay copy-pasteable: the
 * same text works as a file in the workspace `themes/` folder, which the same
 * parser reads.
 */
const BUILTIN_THEME_FILES: { name: string; label: string; toml: string }[] = [
  {
    name: "tokyo-night",
    label: "Tokyo Night",
    toml: `mode = "dark"

accent = "#7aa2f7"
selection = "#292e42"
muted = "#414868"

background = "#1a1b26"
dark_background = "#13141c"
darker_background = "#0e0e14"
lighter_background = "#24283b"

foreground = "#a9b1d6"
dark_foreground = "#565f89"
light_foreground = "#b4bee6"
bright_foreground = "#c0caf5"

red = "#f7768e"
yellow = "#e0af68"
orange = "#eb927b"
green = "#9ece6a"
cyan = "#449dab"
blue = "#7aa2f7"
magenta = "#ad8ee6"
brown = "#75493d"`,
  },
  {
    name: "catppuccin",
    label: "Catppuccin Mocha",
    toml: `mode = "dark"

accent = "#89b4fa"
selection = "#45475a"
muted = "#585b70"

background = "#1e1e2e"
dark_background = "#161622"
darker_background = "#101019"
lighter_background = "#313244"

foreground = "#cdd6f4"
dark_foreground = "#6c7086"
light_foreground = "#bac2de"
bright_foreground = "#cdd6f4"

red = "#f38ba8"
yellow = "#f9e2af"
orange = "#f6b6ab"
green = "#a6e3a1"
cyan = "#94e2d5"
blue = "#89b4fa"
magenta = "#f5c2e7"
brown = "#7b5b55"`,
  },
  {
    name: "gruvbox",
    label: "Gruvbox",
    toml: `mode = "dark"

accent = "#7daea3"
selection = "#504945"
muted = "#665c54"

background = "#282828"
dark_background = "#1e1e1e"
darker_background = "#161616"
lighter_background = "#3c3836"

foreground = "#d4be98"
dark_foreground = "#7c6f64"
light_foreground = "#bdae93"
bright_foreground = "#d4be98"

red = "#ea6962"
yellow = "#d8a657"
orange = "#e1875c"
green = "#a9b665"
cyan = "#89b482"
blue = "#7daea3"
magenta = "#d3869b"
brown = "#70432e"`,
  },
  {
    name: "nord",
    label: "Nord",
    toml: `mode = "dark"

accent = "#81a1c1"
selection = "#434c5e"
muted = "#4c566a"

background = "#2e3440"
dark_background = "#222730"
darker_background = "#191c23"
lighter_background = "#3b4252"

foreground = "#d8dee9"
dark_foreground = "#667080"
light_foreground = "#adb5c4"
bright_foreground = "#d8dee9"

red = "#bf616a"
yellow = "#ebcb8b"
orange = "#d5967a"
green = "#a3be8c"
cyan = "#88c0d0"
blue = "#81a1c1"
magenta = "#b48ead"
brown = "#6a4b3d"`,
  },
  {
    name: "catppuccin-latte",
    label: "Catppuccin Latte",
    toml: `mode = "light"

accent = "#1e66f5"
selection = "#ccd0da"
muted = "#acb0be"

background = "#eff1f5"
dark_background = "#e3e4e8"
darker_background = "#d7d8dc"
lighter_background = "#dce0e8"

foreground = "#4c4f69"
dark_foreground = "#9ca0b0"
light_foreground = "#5c5f77"
bright_foreground = "#4c4f69"

red = "#d20f39"
yellow = "#df8e1d"
orange = "#d84e2b"
green = "#40a02b"
cyan = "#179299"
blue = "#1e66f5"
magenta = "#ea76cb"
brown = "#6c2715"`,
  },
  {
    name: "rose-pine",
    label: "Rose Pine Dawn",
    toml: `mode = "light"

accent = "#56949f"
selection = "#dfdad9"
muted = "#cecacd"

background = "#faf4ed"
dark_background = "#ede7e1"
darker_background = "#e1dbd5"
lighter_background = "#f2e9e1"

foreground = "#575279"
dark_foreground = "#9893a5"
light_foreground = "#6e6a86"
bright_foreground = "#575279"

red = "#b4637a"
yellow = "#ea9d34"
orange = "#cf8057"
green = "#286983"
cyan = "#d7827e"
blue = "#56949f"
magenta = "#907aa9"
brown = "#67402b"`,
  },
];

/**
 * The neutral theme: it follows the system mode and overrides no palette slot,
 * so the ramp in `src/styles.css` is what renders.
 */
const DEFAULT_THEME: ThemeRecord = {
  name: DEFAULT_THEME_NAME,
  label: "Default",
  mode: "system",
  source: "builtin",
  palette: {},
  warnings: [],
};

function themeLabel(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter((part) => part !== "")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function themeFromToml(name: string, label: string, source: ThemeRecord["source"], toml: string): ThemeRecord {
  const resolved = parseThemeFile(toml);
  return { name, label, mode: resolved.mode, source, palette: resolved.palette, warnings: resolved.warnings };
}

/** Theme files the user dropped next to the database; a name overrides a built-in. */
export function themesDirectory(databasePath: string): string {
  return path.join(path.dirname(databasePath), "themes");
}

function workspaceThemes(databasePath: string): ThemeRecord[] {
  const directory = themesDirectory(databasePath);
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return [];
  }

  const themes: ThemeRecord[] = [];
  for (const entry of entries.sort()) {
    if (!entry.toLowerCase().endsWith(".toml")) continue;
    const name = entry.slice(0, -".toml".length);
    if (name === "") continue;
    try {
      themes.push(themeFromToml(name, themeLabel(name), "workspace", readFileSync(path.join(directory, entry), "utf8")));
    } catch (error) {
      themes.push({
        name,
        label: themeLabel(name),
        mode: "system",
        source: "workspace",
        palette: {},
        warnings: [`could not read ${entry}: ${error instanceof Error ? error.message : String(error)}`],
      });
    }
  }
  return themes;
}

export function availableThemes(databasePath: string): ThemeRecord[] {
  const themes = new Map<string, ThemeRecord>([[DEFAULT_THEME.name, DEFAULT_THEME]]);
  for (const theme of BUILTIN_THEME_FILES) {
    themes.set(theme.name, themeFromToml(theme.name, theme.label, "builtin", theme.toml));
  }
  for (const theme of workspaceThemes(databasePath)) {
    themes.set(theme.name, theme);
  }
  return [...themes.values()];
}

/** The stored choice, or the default when it is missing or the theme is gone. */
function selectedThemeName(database: DatabaseSync, themes: ThemeRecord[]): string {
  const row = database.prepare("SELECT value FROM settings WHERE key = ?").get(THEME_SETTING_KEY) as
    | { value?: unknown }
    | undefined;
  const stored = typeof row?.value === "string" ? row.value : null;
  if (stored !== null && themes.some((theme) => theme.name === stored)) {
    return stored;
  }
  // A stored name whose file is gone is left alone: the workspace reports the
  // default, and the choice returns if the theme file comes back.
  return DEFAULT_THEME_NAME;
}

export function executeThemeCommand(
  database: DatabaseSync,
  databasePath: string,
  request: ProtocolRequest,
): Record<string, unknown> {
  const themes = availableThemes(databasePath);

  if (request.command === "theme.list") {
    return { themes, selected: selectedThemeName(database, themes) };
  }

  if (request.command !== "theme.set") {
    throw new CommandError("UNKNOWN_COMMAND", `${request.command} is not a theme command`);
  }

  const name = request.args.name;
  if (typeof name !== "string" || name.trim() === "") {
    throw new CommandError("INVALID_ARGUMENT", "name must be a non-empty string");
  }
  const theme = themes.find((candidate) => candidate.name === name);
  if (!theme) {
    throw new CommandError("UNKNOWN_THEME", `theme "${name}" is not available`);
  }

  const selected = selectedThemeName(database, themes);
  const changed = selected !== theme.name;
  if (request.readOnly || request.dryRun) {
    return { theme, selected, changed, dryRun: true, readOnly: Boolean(request.readOnly) };
  }
  if (changed) {
    database
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(THEME_SETTING_KEY, theme.name, new Date().toISOString());
  }
  return { theme, selected: theme.name, changed };
}
