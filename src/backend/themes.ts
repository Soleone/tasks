import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CommandError } from "./errors.js";
import { builtinThemes } from "./builtinThemes.js";
import type { ProtocolRequest, ThemeRecord } from "./protocol.js";
import { GILT_THEME_NAME, THEME_SETTING_KEY, parseThemeFile } from "./themePalette.js";

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

/** The fixed name for the palette Omarchy currently has installed. */
export const OMARCHY_SYSTEM_THEME_NAME = "omarchy-system";

/**
 * Omarchy stages the active theme here when its theme changes. Reading this
 * file, rather than copying it into the workspace, keeps the app in sync with
 * Omarchy without needing a watcher or a theme-set hook.
 */
export function omarchyColorsPath(
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory = environment.HOME ?? environment.USERPROFILE ?? process.cwd(),
): string {
  // Omarchy's own theme scripts use this fixed path rather than XDG_STATE_HOME.
  return path.join(homeDirectory, ".local", "state", "omarchy", "current", "theme", "colors.toml");
}

function omarchySystemTheme(
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory = environment.HOME ?? environment.USERPROFILE ?? process.cwd(),
): ThemeRecord | undefined {
  const colorsPath = omarchyColorsPath(environment, homeDirectory);
  if (!existsSync(colorsPath)) return undefined;
  try {
    return themeFromToml(
      OMARCHY_SYSTEM_THEME_NAME,
      "Omarchy System",
      "omarchy",
      readFileSync(colorsPath, "utf8"),
    );
  } catch (error) {
    return {
      name: OMARCHY_SYSTEM_THEME_NAME,
      label: "Omarchy System",
      mode: "system",
      source: "omarchy",
      palette: {},
      warnings: [`could not read ${colorsPath}: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
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

export function availableThemes(
  databasePath: string,
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory = environment.HOME ?? environment.USERPROFILE ?? process.cwd(),
): ThemeRecord[] {
  const themes = new Map<string, ThemeRecord>();
  for (const theme of builtinThemes()) {
    themes.set(theme.name, theme);
  }
  for (const theme of workspaceThemes(databasePath)) {
    themes.set(theme.name, theme);
  }
  // Add this last so a workspace file cannot shadow the live Omarchy palette.
  const systemTheme = omarchySystemTheme(environment, homeDirectory);
  if (systemTheme) themes.set(systemTheme.name, systemTheme);
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
  // Missing or legacy selections fall back to Gilt without writing until the
  // user makes a new choice.
  return GILT_THEME_NAME;
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
