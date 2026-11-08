import { useSyncExternalStore } from "react";
import type { HomeDocuments } from "./homeDocuments";

/**
 * Palette colors every theme has, stored by name so a category follows the theme. Green is left
 * out: it is already every folder's color.
 */
export const SWATCHES = ["red", "orange", "yellow", "cyan", "blue", "magenta", "brown"] as const;
export type Swatch = (typeof SWATCHES)[number];

export type Goal = { count: number; per: "day" | "week" };

export const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Settings every device shares, kept in the workspace's `settings.json`. */
export type SharedSettings = {
  colors: Readonly<Record<string, Swatch>>;
  /** Goals by category slug. */
  goals: Readonly<Record<string, Goal>>;
  /** The goal for tasks outside every goal category; "All tasks" while no category has one. */
  otherGoal: Goal | null;
  /** When today ends, as "HH:MM" after midnight. */
  dayEndsAt: string;
  weekStartsOn: Weekday;
};

const DEFAULTS: SharedSettings = {
  colors: {},
  goals: {},
  otherGoal: null,
  dayEndsAt: "04:00",
  weekStartsOn: "monday",
};
const FORMAT = "tasks.shared";
const SLUG = /^[a-z](?:[a-z0-9_-]*[a-z0-9_])?$/;
export const MAX_GOAL = 99;

type SettingsFile = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function readGoal(value: unknown): Goal | null {
  if (!isRecord(value)) return null;
  const { count, per } = value;
  return Number.isInteger(count) &&
    (count as number) >= 1 &&
    (count as number) <= MAX_GOAL &&
    (per === "day" || per === "week")
    ? { count: count as number, per }
    : null;
}

/** Reads leniently: another device or a hand edit may have written anything, so a bad value is skipped. */
function settingsOf(file: SettingsFile): SharedSettings {
  const colors: Record<string, Swatch> = {};
  if (isRecord(file.colors))
    for (const [slug, swatch] of Object.entries(file.colors))
      if (SLUG.test(slug) && SWATCHES.includes(swatch as Swatch)) colors[slug] = swatch as Swatch;
  const goals: Record<string, Goal> = {};
  if (isRecord(file.goals))
    for (const [slug, value] of Object.entries(file.goals)) {
      const goal = readGoal(value);
      if (SLUG.test(slug) && goal) goals[slug] = goal;
    }
  const { dayEndsAt, weekStartsOn } = file;
  return {
    colors,
    goals,
    otherGoal: readGoal(file.otherGoal),
    dayEndsAt:
      typeof dayEndsAt === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(dayEndsAt)
        ? dayEndsAt
        : DEFAULTS.dayEndsAt,
    weekStartsOn: WEEKDAYS.includes(weekStartsOn as Weekday)
      ? (weekStartsOn as Weekday)
      : DEFAULTS.weekStartsOn,
  };
}

/** The file as written, or null when it can't be read as one; fields this build doesn't know are kept. */
function parse(text: string | null): SettingsFile | null {
  if (text === null) return { format: FORMAT, version: 1 };
  try {
    const file: unknown = JSON.parse(text);
    return isRecord(file) && file.format === FORMAT ? file : null;
  } catch {
    return null;
  }
}

let documents: HomeDocuments | null = null;
let current = DEFAULTS;
let saving: Promise<unknown> = Promise.resolve();
// Edits not yet saved; what the disk says only shows once none are left, so it never undoes them.
let unsaved = 0;
const listeners = new Set<() => void>();

function publish(next: SharedSettings): void {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSharedSettings(): SharedSettings {
  return useSyncExternalStore(subscribe, () => current);
}

export function readSharedSettings(): SharedSettings {
  return current;
}

/** Loads the home's shared settings; reading again picks up what another device synced. */
export async function loadSharedSettings(home: HomeDocuments): Promise<void> {
  documents = home;
  await reloadSharedSettings();
}

export async function reloadSharedSettings(): Promise<void> {
  if (!documents) return;
  const file = parse(await documents.read("shared"));
  if (unsaved === 0) publish(file ? settingsOf(file) : DEFAULTS);
}

/**
 * Applies one edit now, then saves it onto the file as it is on disk, so whatever another device
 * synced in the meantime is kept. A file this app can't read is kept beside the new one.
 */
function edit(change: (file: SettingsFile) => void): Promise<void> {
  const optimistic = { ...current } as SettingsFile;
  change(optimistic);
  publish(settingsOf(optimistic));
  if (!documents) return Promise.resolve();
  const home = documents;
  unsaved += 1;
  const run = saving.then(async () => {
    try {
      const parsed = parse(await home.read("shared"));
      const file = parsed ?? { format: FORMAT, version: 1 };
      change(file);
      await home.save("shared", `${JSON.stringify(file, null, 2)}\n`, parsed === null);
      if (unsaved === 1) publish(settingsOf(file));
    } finally {
      unsaved -= 1;
    }
  });
  // A failed read fails this edit only; the next one still runs.
  saving = run.catch(() => undefined);
  return run;
}

function withEntry<T>(record: unknown, key: string, value: T | null): Record<string, unknown> {
  const next = isRecord(record) ? { ...record } : {};
  if (value === null) delete next[key];
  else next[key] = value;
  return next;
}

export function setCategoryColor(slug: string, swatch: Swatch | null): Promise<void> {
  return edit((file) => {
    file.colors = withEntry(file.colors, slug, swatch);
  });
}

/** A category's goal, or with `slug` null the goal for everything else. */
export function setGoal(slug: string | null, goal: Goal | null): Promise<void> {
  return edit((file) => {
    if (slug === null) file.otherGoal = goal;
    else file.goals = withEntry(file.goals, slug, goal);
  });
}

export function setDayEndsAt(time: string): Promise<void> {
  return edit((file) => {
    file.dayEndsAt = time;
  });
}

export function setWeekStartsOn(day: Weekday): Promise<void> {
  return edit((file) => {
    file.weekStartsOn = day;
  });
}

/** A renamed category keeps its color and goal; one the new name already had wins. */
export function renameCategorySettings(from: string, to: string): Promise<void> {
  return edit((file) => {
    for (const key of ["colors", "goals"] as const) {
      const record = isRecord(file[key]) ? { ...file[key] } : {};
      if (!(from in record)) continue;
      if (!(to in record)) record[to] = record[from];
      delete record[from];
      file[key] = record;
    }
  });
}
