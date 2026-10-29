import {
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  ChevronUp,
  Circle,
  CircleCheck,
  CirclePause,
  Minus,
  RotateCw,
  CircleX,
  type LucideIcon,
} from "lucide-react";
import type { TaskEffort, TaskPriority, TaskStatus } from "@/backend/taskModel";
import type { TaskView } from "./taskView";
import type { LensFilter } from "./listLens";

type TaskStatusMeta = {
  label: string;
  Icon: LucideIcon;
  color: string;
};

export const taskStatusMeta: Record<TaskStatus, TaskStatusMeta> = {
  open: { label: "Open", Icon: Circle, color: "text-muted-foreground" },
  in_progress: { label: "In progress", Icon: RotateCw, color: "text-primary" },
  paused: { label: "Paused", Icon: CirclePause, color: "text-warning" },
  done: { label: "Done", Icon: CircleCheck, color: "text-success" },
  canceled: { label: "Canceled", Icon: CircleX, color: "text-destructive" },
};

const ACTIVE_TASK_STATUSES: TaskStatus[] = ["open", "in_progress"];
const INACTIVE_TASK_STATUSES: TaskStatus[] = ["paused", "done", "canceled"];

export type StatusPreset = "active" | "inactive" | "all";

const PRESET_STATUSES: Record<StatusPreset, TaskStatus[]> = {
  active: ACTIVE_TASK_STATUSES,
  inactive: INACTIVE_TASK_STATUSES,
  all: [...ACTIVE_TASK_STATUSES, ...INACTIVE_TASK_STATUSES],
};

export function presetStatuses(preset: StatusPreset): TaskStatus[] {
  return PRESET_STATUSES[preset];
}

export const STATUS_PRESET_LABELS: Record<StatusPreset, string> = {
  active: "Active",
  inactive: "Inactive",
  all: "All",
};

const ACTIVE_TASK_STATUS_SET = new Set<TaskStatus>(ACTIVE_TASK_STATUSES);

export type TaskViewFilters = {
  exactStatus: TaskStatus | null;
  statusPreset: StatusPreset;
  showUnblocked: boolean;
  categorySlug: string | null;
  priorityFilter: TaskPriority | null;
  tagSlugs: readonly string[];
  searchQuery: string;
  /** What the open lens shows, or null outside one. */
  lens: LensFilter | null;
};

/** Matches a task against the current UI view while optimistic changes settle. */
export function taskMatchesViewFilters(task: TaskView, filters: TaskViewFilters): boolean {
  const { lens } = filters;
  const statusOk =
    lens !== null
      ? lens.statuses.includes(task.status)
      : filters.exactStatus !== null
        ? task.status === filters.exactStatus
        : presetStatuses(filters.statusPreset).includes(task.status);
  if (!statusOk) return false;
  if (lens?.closedSince !== undefined && (task.closedAt ?? "") < lens.closedSince) return false;
  if (lens?.dueBefore !== undefined && (task.due === null || task.due >= lens.dueBefore))
    return false;
  if (filters.showUnblocked && task.blockedByIds.length > 0) return false;
  if (filters.categorySlug !== null && task.category?.slug !== filters.categorySlug) return false;
  if (filters.priorityFilter !== null && task.priority !== filters.priorityFilter) return false;
  if (filters.tagSlugs.length > 0) {
    const taskTags = new Set(task.tags.map((tag) => tag.slug));
    if (!filters.tagSlugs.every((slug) => taskTags.has(slug))) return false;
  }
  if (filters.searchQuery.trim() !== "") {
    const needle = filters.searchQuery.trim().toLowerCase();
    const haystack = `${task.title}\n${task.description}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

export type PriorityMeta = {
  value: TaskPriority;
  label: string;
  shortLabel: string;
  /** Dot color for the priority. */
  dot: string;
  /** Color for an open or in-progress task's status glyph. */
  glyph: string;
  /** Weight and color for an active or done task's title. Normal is the baseline. */
  title: string;
};

// The theme's accent marks the top two, bold marks the highest, and the lower two quiet down: a
// title halfway to muted, then a muted one with a fainter icon. Titles stop at muted, the lowest
// text contrast the themes guarantee. The faint icon color comes from the theme (priorityColors.ts).
export const PRIORITY_META: PriorityMeta[] = [
  {
    value: 0,
    label: "highest",
    shortLabel: "P0",
    dot: "bg-primary",
    glyph: "text-primary",
    title: "font-bold",
  },
  {
    value: 1,
    label: "high",
    shortLabel: "P1",
    dot: "bg-primary",
    glyph: "text-primary",
    title: "",
  },
  {
    value: 2,
    label: "normal",
    shortLabel: "P2",
    dot: "bg-muted-foreground",
    glyph: "text-muted-foreground",
    title: "",
  },
  {
    value: 3,
    label: "low",
    shortLabel: "P3",
    dot: "bg-muted-foreground",
    glyph: "text-muted-foreground",
    title: "font-normal text-priority-soft",
  },
  {
    value: 4,
    label: "lowest",
    shortLabel: "P4",
    dot: "bg-priority-faint",
    glyph: "text-priority-faint",
    title: "font-normal text-muted-foreground",
  },
];

export function priorityMeta(value: TaskPriority): PriorityMeta {
  const found = PRIORITY_META.find((meta) => meta.value === value);
  if (!found) throw new Error(`unsupported priority ${String(value)}`);
  return found;
}

/** Effort names, smallest first. */
export const EFFORT_LABELS: Record<TaskEffort, string> = {
  1: "tiny",
  2: "small",
  3: "normal",
  4: "large",
  5: "huge",
};

/** An effort's name as a menu item or heading, like "Large". */
export function effortTitle(effort: TaskEffort): string {
  const label = EFFORT_LABELS[effort];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Effort's badge on the status glyph and its icon in menus. Normal shows no badge. */
export const EFFORT_ICONS: Record<TaskEffort, LucideIcon> = {
  1: ChevronsDown,
  2: ChevronDown,
  3: Minus,
  4: ChevronUp,
  5: ChevronsUp,
};

/** Largest first, the order the effort menus list them. */
export const EFFORTS_LARGEST_FIRST: TaskEffort[] = [5, 4, 3, 2, 1];

/**
 * Active tasks show their priority as the glyph's color; the rest keep their status color, which a
 * done P4 fades like an active one.
 */
export function statusGlyphColor(task: Pick<TaskView, "status" | "priority">): string {
  if (ACTIVE_TASK_STATUS_SET.has(task.status)) return priorityMeta(task.priority).glyph;
  if (task.status === "done" && task.priority === 4) return "text-success-faint";
  return taskStatusMeta[task.status].color;
}

/**
 * An active highest-priority task fills its glyph, so it stands out even in a theme with no red. A
 * done task can't use the accent, so its top two both fill instead.
 */
export function isSolidGlyph(task: Pick<TaskView, "status" | "priority">): boolean {
  if (task.status === "done") return task.priority <= 1;
  return task.priority === 0 && ACTIVE_TASK_STATUS_SET.has(task.status);
}

/** Active and done tasks style their title by priority; paused and canceled ones keep a plain title. */
export function taskTitleClass(task: Pick<TaskView, "status" | "priority">): string {
  return ACTIVE_TASK_STATUS_SET.has(task.status) || task.status === "done"
    ? priorityMeta(task.priority).title
    : "";
}

export const EXACT_STATUS_META: Array<{ status: TaskStatus; label: string; key: string }> = [
  { status: "open", label: "Open", key: "O" },
  { status: "in_progress", label: "In progress", key: "I" },
  { status: "done", label: "Done", key: "D" },
  { status: "paused", label: "Paused", key: "P" },
  { status: "canceled", label: "Canceled", key: "X" },
];

export type SortField = "created" | "updated" | "priority" | "effort" | "due" | "closed" | "manual";
export type SortDirection = "asc" | "desc";

/** Quiet status message for a selected sort. */
export function sortSummary(field: SortField, direction: SortDirection): string {
  if (field === "manual") return "manual order";
  if (field === "priority")
    return `by priority, ${direction === "desc" ? "highest first" : "lowest first"}`;
  if (field === "effort")
    return `by effort, ${direction === "desc" ? "largest first" : "smallest first"}`;
  if (field === "due")
    return `by due date, ${direction === "desc" ? "soonest first" : "latest first"}`;
  if (field === "closed") return `by completed, ${direction}`;
  return `by ${field}, ${direction}`;
}

/** Orders optimistic view updates until a fresh list query supplies authoritative order. */
export function compareTasksForViewSort(
  a: TaskView,
  b: TaskView,
  field: SortField,
  direction: SortDirection,
): number {
  if (field === "manual") return 0;
  if (field === "due") {
    // Undated tasks stay last in either direction, as in the engine.
    if ((a.due === null) !== (b.due === null)) return a.due === null ? 1 : -1;
    if (a.due !== b.due) return (a.due! < b.due! ? -1 : 1) * (direction === "desc" ? 1 : -1);
    return a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }
  if (field === "effort") {
    const effortDirection = direction === "desc" ? -1 : 1;
    return (
      effortDirection * (a.effort - b.effort) ||
      a.priority - b.priority ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
  }
  if (field === "priority") {
    const priorityDirection = direction === "desc" ? 1 : -1;
    return (
      priorityDirection * (a.priority - b.priority) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
  }
  if (field === "closed" && (a.closedAt === null) !== (b.closedAt === null))
    return a.closedAt === null ? 1 : -1;
  const sortKey = (task: TaskView): string =>
    field === "created"
      ? task.createdAt
      : field === "closed"
        ? (task.closedAt ?? "")
        : task.updatedAt;
  const keyA = sortKey(a);
  const keyB = sortKey(b);
  if (keyA !== keyB) {
    const newerFirst = direction === "desc";
    if (keyA > keyB) return newerFirst ? -1 : 1;
    return newerFirst ? 1 : -1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
