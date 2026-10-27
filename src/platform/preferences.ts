import type { HomeDocuments } from "./homeDocuments";

/** Every preference the app keeps, under the browser storage names it had before Tasks homes. */
const PREFERENCE_KEYS = new Set([
  "tasks.selectedTheme",
  "tasks.fontSizeIncrease",
  "tasks.statusPreset",
  "tasks.exactStatus",
  "tasks.priorityFilter",
  "tasks.tagFilter",
  "tasks.categoryFilter",
  "tasks.searchQuery",
  "tasks.showUnblocked",
  "tasks.sortField",
  "tasks.sortDirection",
  "tasks.completedSort",
  "tasks.showDetails",
  "tasks.foldedToolbarGroups",
  "tasks.showQuests",
  "tasks.questProgress",
  "tasks.welcomed",
  "tasks.learnedMoves",
]);
// Earlier versions kept these; they are dropped on load so those settings still open.
const RETIRED_KEYS = new Set(["tasks.helpMode"]);
const LEGACY_SHOW_TIMESTAMPS = "tasks.showTimestamps";

/** `settings.json` exists but isn't a settings file this app can read. */
export class DamagedSettingsError extends Error {}

// Once a home is loaded its settings are the preferences; until then (tests, plain browsers)
// the browser's own storage is.
let home: { documents: HomeDocuments; values: Map<string, string> } | null = null;

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readPreference(key: string): string | null {
  if (home) return home.values.get(key) ?? null;
  try {
    return browserStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Takes effect now; the home's copy is saved in the background, newest value first. */
export function writePreference(key: string, value: string): void {
  try {
    // The browser copy lets the theme and font size apply before the home answers.
    browserStorage()?.setItem(key, value);
  } catch {
    // Without browser storage the first paint uses the defaults.
  }
  if (!home || home.values.get(key) === value) return;
  home.values.set(key, value);
  void home.documents.save("settings", serialize(home.values));
}

function serialize(values: Map<string, string>): string {
  return `${JSON.stringify(
    { format: "tasks.settings", version: 1, preferences: Object.fromEntries(values) },
    null,
    2,
  )}\n`;
}

function parseSettings(text: string): Map<string, string> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new DamagedSettingsError("settings.json isn't valid JSON.");
  }
  const settings = value as { format?: unknown; version?: unknown; preferences?: unknown };
  const preferences = settings?.preferences;
  if (
    settings?.format !== "tasks.settings" ||
    settings.version !== 1 ||
    typeof preferences !== "object" ||
    preferences === null ||
    Array.isArray(preferences) ||
    Object.keys(settings).length !== 3
  )
    throw new DamagedSettingsError("settings.json isn't a Tasks settings file.");
  const entries = Object.entries(preferences).filter(([key]) => !RETIRED_KEYS.has(key));
  for (const [key, entry] of entries)
    if (!PREFERENCE_KEYS.has(key) || typeof entry !== "string")
      throw new DamagedSettingsError(`settings.json has an unknown or invalid ${key}.`);
  return new Map(entries as [string, string][]);
}

/** What this browser remembered before the home existed, read once when the home has none. */
function browserPreferences(): Map<string, string> {
  const values = new Map<string, string>();
  for (const key of PREFERENCE_KEYS) {
    const value = readPreference(key);
    if (value !== null) values.set(key, value);
  }
  const timestamps = readPreference(LEGACY_SHOW_TIMESTAMPS);
  if (!values.has("tasks.showDetails") && timestamps !== null)
    values.set("tasks.showDetails", timestamps);
  return values;
}

function adopt(documents: HomeDocuments, values: Map<string, string>): void {
  home = { documents, values };
  const storage = browserStorage();
  try {
    for (const key of PREFERENCE_KEYS) {
      const value = values.get(key);
      if (value === undefined) storage?.removeItem(key);
      else storage?.setItem(key, value);
    }
  } catch {
    // The browser copy only speeds up the first paint.
  }
}

/**
 * Makes the home's settings the app's preferences before the list renders. A home without
 * settings starts from what this browser remembered. Damaged settings throw
 * {@link DamagedSettingsError} and are never silently replaced.
 */
export async function loadPreferences(documents: HomeDocuments): Promise<void> {
  const text = await documents.read("settings");
  if (text !== null) {
    adopt(documents, parseSettings(text));
    return;
  }
  const values = browserPreferences();
  adopt(documents, values);
  await documents.save("settings", serialize(values));
}

/** Starts over with default preferences, keeping the damaged file beside the new one. */
export async function resetPreferences(documents: HomeDocuments): Promise<void> {
  const values = new Map<string, string>();
  adopt(documents, values);
  await documents.save("settings", serialize(values), true);
}
