import { useSyncExternalStore } from "react";
import { readPreference, writePreference } from "@/platform/preferences";
import { keyName } from "@/platform/runtime";

/**
 * A key is written as its modifiers, then the key, joined by `+`: `C`, `Shift+C`, `Mod+Shift+C`,
 * `Alt+T`, `Space`, `!`. `Mod` is Ctrl, or ⌘ on macOS.
 */
type Binding = { id: string; label: string; group: KeyGroup; key: string };

export type KeyGroup = "Task actions" | "Filter and sort" | "Workspace";

// Ids follow the spec rule each key performs, where it has one of its own (`keys.rebind`).
export const BINDINGS = [
  { id: "capture.open", label: "New task", group: "Task actions", key: "C" },
  { id: "capture.log", label: "Log a task already done", group: "Task actions", key: "L" },
  { id: "capture.child", label: "New child task", group: "Task actions", key: "Shift+C" },
  { id: "status.forward", label: "Change task status", group: "Task actions", key: "Space" },
  { id: "status.back", label: "Step status back", group: "Task actions", key: "Shift+Space" },
  { id: "status.pause", label: "Pause or resume task", group: "Task actions", key: "P" },
  { id: "status.cancel", label: "Cancel task", group: "Task actions", key: "Delete" },
  { id: "priority.raise", label: "Raise priority", group: "Task actions", key: "]" },
  { id: "priority.lower", label: "Lower priority", group: "Task actions", key: "[" },
  { id: "effort.bigger", label: "Bigger effort", group: "Task actions", key: "." },
  { id: "effort.smaller", label: "Smaller effort", group: "Task actions", key: "," },
  { id: "copy.text", label: "Copy task text", group: "Task actions", key: "Mod+C" },
  { id: "attach.copy", label: "Copy newest image", group: "Task actions", key: "Mod+Shift+C" },
  { id: "details.open-link", label: "Open link", group: "Task actions", key: "O" },
  {
    id: "details.toggle-active",
    label: "Show details of the active task",
    group: "Task actions",
    key: "V",
  },
  {
    id: "details.toggle-all",
    label: "Show details of all tasks",
    group: "Task actions",
    key: "Shift+V",
  },
  { id: "pick.blocker", label: "Add blocker", group: "Task actions", key: "B" },
  { id: "pick.parent", label: "Move under…", group: "Task actions", key: "M" },
  { id: "home.task-context-menu", label: "Open task menu", group: "Task actions", key: "A" },
  { id: "undo.latest", label: "Undo last change", group: "Task actions", key: "Mod+Z" },
  { id: "redo.latest", label: "Redo last change", group: "Task actions", key: "Mod+Shift+Z" },
  { id: "filter.mode", label: "Filter shortcuts", group: "Filter and sort", key: "F" },
  { id: "sort.mode", label: "Sort shortcuts", group: "Filter and sort", key: "S" },
  { id: "filter.category", label: "Filter by category", group: "Filter and sort", key: "@" },
  { id: "filter.tags", label: "Filter by tags", group: "Filter and sort", key: "#" },
  { id: "filter.search", label: "Search tasks", group: "Filter and sort", key: "/" },
  { id: "done.lens", label: "Done today", group: "Workspace", key: "D" },
  { id: "done.lens-window", label: "Look further back", group: "Workspace", key: "Shift+D" },
  { id: "due.lens", label: "Due now", group: "Workspace", key: "!" },
  { id: "agents.lens", label: "Changed by agents", group: "Workspace", key: "Shift+A" },
  { id: "help.palette", label: "Shortcuts and syntax", group: "Workspace", key: "Mod+K" },
  { id: "learn.panel", label: "Quests and learned keys", group: "Workspace", key: "?" },
  { id: "theme.picker", label: "Themes", group: "Workspace", key: "Alt+T" },
  { id: "settings.open", label: "Settings", group: "Workspace", key: "Mod+," },
] as const satisfies readonly Binding[];

export type BindingId = (typeof BINDINGS)[number]["id"];

const KEYS_PREFERENCE = "tasks.keys";
const MODIFIERS = ["Mod", "Alt", "Shift"] as const;
const BINDING_IDS: ReadonlySet<string> = new Set(BINDINGS.map((binding) => binding.id));

/**
 * Keys that always keep their meaning, so they can't be picked (`keys.fixed`): moving around,
 * the editor, priorities by number, the Menu key and Ctrl+Y for redo.
 */
const FIXED_KEYS = new Set(["Tab", "Esc", "Enter", "Backspace", "ContextMenu"]);
const FIXED_WITH_ANY_MODIFIER = new Set(["↑", "↓", "←", "→", "Home", "End", ...FIXED_KEYS]);
const FIXED_COMBOS = new Set(["0", "1", "2", "3", "4", "Mod+Y"]);

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// The stored string is the snapshot, so React sees a change only when the preference changes.
function storedKeys(): string {
  return readPreference(KEYS_PREFERENCE) ?? "{}";
}

let parsed = { stored: "", changes: new Map<BindingId, string | null>() };

/** The keys changed from the defaults; `null` turns a key off. Unknown entries are skipped. */
function changes(): ReadonlyMap<BindingId, string | null> {
  const stored = storedKeys();
  if (stored === parsed.stored) return parsed.changes;
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    value = {};
  }
  const entries = typeof value === "object" && value !== null ? Object.entries(value) : [];
  parsed = {
    stored,
    changes: new Map(
      entries.filter(
        (entry): entry is [BindingId, string | null] =>
          BINDING_IDS.has(entry[0]) && (typeof entry[1] === "string" || entry[1] === null),
      ),
    ),
  };
  return parsed.changes;
}

function save(next: ReadonlyMap<BindingId, string | null>): void {
  writePreference(KEYS_PREFERENCE, JSON.stringify(Object.fromEntries(next)));
  for (const listener of listeners) listener();
}

/** Re-renders when any key changes; the snapshot is only a change marker. */
export function useKeymap(): string {
  return useSyncExternalStore(subscribe, storedKeys);
}

export function defaultKey(id: BindingId): string {
  return BINDINGS.find((binding) => binding.id === id)!.key;
}

/** The key that does `id` now, or null when it was turned off. */
export function keyFor(id: BindingId): string | null {
  const current = changes();
  return current.has(id) ? current.get(id)! : defaultKey(id);
}

/** Gives `id` a new key, or none. A default key is stored as no change. */
export function setKey(id: BindingId, key: string | null): void {
  const next = new Map(changes());
  if (key === defaultKey(id)) next.delete(id);
  else next.set(id, key);
  save(next);
}

/** Gives `id` the key `other` had, and `other` the key `id` had (`keys.conflict`). */
export function swapKeys(id: BindingId, key: string, other: BindingId): void {
  const previous = keyFor(id);
  setKey(other, previous);
  setKey(id, key);
}

export function resetKeys(): void {
  save(new Map());
}

/** The binding that already uses `key`, other than `id`. */
export function keyOwner(key: string, id?: BindingId): BindingId | undefined {
  return BINDINGS.find((binding) => binding.id !== id && keyFor(binding.id) === key)?.id;
}

export function isFixedKey(key: string): boolean {
  return FIXED_COMBOS.has(key) || FIXED_WITH_ANY_MODIFIER.has(splitKey(key).at(-1)!);
}

function splitKey(key: string): string[] {
  const parts: string[] = [];
  let rest = key;
  for (const modifier of MODIFIERS)
    if (rest.startsWith(`${modifier}+`) && rest.length > modifier.length + 1) {
      parts.push(modifier);
      rest = rest.slice(modifier.length + 1);
    }
  return [...parts, rest];
}

/** A key as caps to show, with this platform's modifier names: `["Ctrl", "Shift", "C"]`. */
export function keyCaps(key: string): string[] {
  return splitKey(key).map((part) => (part === "Mod" || part === "Alt" ? keyName(part) : part));
}

/** The caps for what `id` does now; none when it is off. */
export function bindingCaps(id: BindingId): string[] {
  const key = keyFor(id);
  return key === null ? [] : keyCaps(key);
}

export function isBindingId(text: string): text is BindingId {
  return BINDING_IDS.has(text);
}

/** Key caps where a binding id stands for that action's current key (`keys.everywhere`). */
export function expandKeys(keys: readonly string[]): string[] {
  return keys.flatMap((key) => (isBindingId(key) ? bindingCaps(key) : [key]));
}

const NAMED_KEYS: Partial<Record<string, string>> = {
  " ": "Space",
  Escape: "Esc",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta", "OS", "Dead"]);

/** The key a keydown presses, in binding form, or null for a modifier on its own. */
export function keyFromEvent(event: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key) || event.key === "Unidentified") return null;
  // AltGr types @ and # on many layouts, and arrives as Ctrl+Alt.
  const altGraph = event.getModifierState("AltGraph");
  const alt = event.altKey && !altGraph;
  // On macOS, Option turns letters into symbols (Option+T types "†"), so Alt goes by the key's place.
  const physical = alt ? /^(?:Key|Digit)(.)$/.exec(event.code)?.[1] : undefined;
  const key =
    physical ??
    NAMED_KEYS[event.key] ??
    (event.key.length === 1 ? event.key.toUpperCase() : event.key);
  // A symbol already says Shift made it: `!` is Shift+1 on most layouts.
  const symbol = key.length === 1 && !/[\p{L}\p{N}]/u.test(key);
  return [
    (event.ctrlKey || event.metaKey) && !altGraph && "Mod",
    alt && "Alt",
    event.shiftKey && !symbol && "Shift",
    key,
  ]
    .filter(Boolean)
    .join("+");
}

/** The action a keydown asks for, if any. */
export function boundAction(event: KeyboardEvent): BindingId | undefined {
  const key = keyFromEvent(event);
  return key === null ? undefined : keyOwner(key);
}

/** What `id` does now in `aria-keyshortcuts` form, or nothing while it is off. */
export function ariaShortcut(id: BindingId): string | undefined {
  return keyFor(id)?.replace(/^Mod\+/, "Control+");
}
