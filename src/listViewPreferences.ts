import type { ClassificationToken } from "@/backend/taskText";
import type { TaskPriority, TaskStatus } from "@/backend/taskModel";
import type { ClassificationOption } from "@/components/taskView";
import { TOOLBAR_FOLD_GROUPS, type ToolbarFoldGroup } from "@/components/TaskListToolbar";
import type { SortDirection, SortField, StatusPreset } from "@/components/taskFilters";
import { readPreference } from "@/platform/preferences";

const STATUS_PRESET_KEY = "tasks.statusPreset";
const EXACT_STATUS_KEY = "tasks.exactStatus";
const PRIORITY_FILTER_KEY = "tasks.priorityFilter";
const TAG_FILTER_KEY = "tasks.tagFilter";
export const SEARCH_QUERY_KEY = "tasks.searchQuery";
export const UNBLOCKED_FILTER_KEY = "tasks.showUnblocked";
const CATEGORY_FILTER_KEY = "tasks.categoryFilter";
const SORT_FIELD_KEY = "tasks.sortField";
const SORT_DIRECTION_KEY = "tasks.sortDirection";
export const COMPLETED_SORT_KEY = "tasks.completedSort";
export const SHOW_DETAILS_KEY = "tasks.showDetails";
export const FOLDED_TOOLBAR_GROUPS_KEY = "tasks.foldedToolbarGroups";
const LEGACY_SHOW_TIMESTAMPS_KEY = "tasks.showTimestamps";

export function readStatusPreset(): StatusPreset {
  const stored = readPreference(STATUS_PRESET_KEY);
  return stored === "inactive" || stored === "all" ? stored : "active";
}

export function readExactStatus(): TaskStatus | null {
  const stored = readPreference(EXACT_STATUS_KEY);
  return stored === "open" ||
    stored === "in_progress" ||
    stored === "paused" ||
    stored === "done" ||
    stored === "canceled"
    ? stored
    : null;
}

export function readPriorityFilter(): TaskPriority | null {
  const stored = readPreference(PRIORITY_FILTER_KEY);
  return stored !== null && /^[0-4]$/.test(stored) ? (Number(stored) as TaskPriority) : null;
}

export function readInitialCategoryFilter(): ClassificationToken | null {
  const slug = readPreference(CATEGORY_FILTER_KEY);
  return slug ? { slug, label: slug } : null;
}

export function readInitialTagFilter(): ClassificationOption[] {
  const stored = readPreference(TAG_FILTER_KEY);
  if (!stored) return [];
  try {
    const value: unknown = JSON.parse(stored);
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) return [];
    return value.map((slug) => ({ slug, label: slug, taskCount: 0 }));
  } catch {
    return [];
  }
}

export function readSortField(): SortField {
  const stored = readPreference(SORT_FIELD_KEY);
  return stored === "created" ||
    stored === "updated" ||
    stored === "priority" ||
    stored === "effort" ||
    stored === "due" ||
    stored === "manual"
    ? stored
    : "created";
}

export function readSortDirection(): SortDirection {
  return readPreference(SORT_DIRECTION_KEY) === "asc" ? "asc" : "desc";
}

export function readShowDetails(): boolean {
  return (
    (readPreference(SHOW_DETAILS_KEY) ?? readPreference(LEGACY_SHOW_TIMESTAMPS_KEY)) === "true"
  );
}

export function readFoldedToolbarGroups(): ToolbarFoldGroup[] {
  try {
    const stored: unknown = JSON.parse(readPreference(FOLDED_TOOLBAR_GROUPS_KEY) ?? "[]");
    return TOOLBAR_FOLD_GROUPS.filter((group) => Array.isArray(stored) && stored.includes(group));
  } catch {
    return [];
  }
}

/** What the list shows: remembered between launches, and set aside while the done lens is on. */
export type ListView = {
  statusPreset: StatusPreset;
  exactStatus: TaskStatus | null;
  priorityFilter: TaskPriority | null;
  tagFilter: ClassificationOption[];
  searchQuery: string;
  showUnblocked: boolean;
  categoryFilter: ClassificationToken | null;
  sortField: SortField;
  sortDirection: SortDirection;
  /** Whether the Done filter sorts by completion; other views never do. */
  completedSort: boolean;
};

/** How each part of the list view is stored. */
export const VIEW_PREFERENCES: [key: string, stored: (view: ListView) => string][] = [
  [STATUS_PRESET_KEY, (view) => view.statusPreset],
  [EXACT_STATUS_KEY, (view) => view.exactStatus ?? ""],
  [
    PRIORITY_FILTER_KEY,
    (view) => (view.priorityFilter === null ? "" : String(view.priorityFilter)),
  ],
  [TAG_FILTER_KEY, (view) => JSON.stringify(view.tagFilter.map((tag) => tag.slug))],
  [SEARCH_QUERY_KEY, (view) => view.searchQuery],
  [UNBLOCKED_FILTER_KEY, (view) => String(view.showUnblocked)],
  [CATEGORY_FILTER_KEY, (view) => view.categoryFilter?.slug ?? ""],
  [SORT_FIELD_KEY, (view) => view.sortField],
  [SORT_DIRECTION_KEY, (view) => view.sortDirection],
  [COMPLETED_SORT_KEY, (view) => String(view.completedSort)],
];
