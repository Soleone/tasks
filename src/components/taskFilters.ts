import { Circle, CircleCheck, CirclePause, RotateCw, CircleX, type LucideIcon } from "lucide-react";
import type { TaskPriority, TaskStatus } from "@/backend/taskModel";
import type { TaskView } from "./taskView";

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

export type StatusPreset = "active" | "inactive";

export function presetStatuses(preset: StatusPreset): TaskStatus[] {
  return preset === "active" ? ACTIVE_TASK_STATUSES : INACTIVE_TASK_STATUSES;
}

const ACTIVE_TASK_STATUS_SET = new Set<TaskStatus>(ACTIVE_TASK_STATUSES);
const INACTIVE_TASK_STATUS_SET = new Set<TaskStatus>(INACTIVE_TASK_STATUSES);

export type TaskViewFilters = {
  exactStatus: TaskStatus | null;
  statusPreset: StatusPreset;
  showUnblocked: boolean;
  categorySlug: string | null;
  priorityFilter: TaskPriority | null;
  tagSlugs: readonly string[];
  searchQuery: string;
  /** Only tasks closed at or after this time, while the done lens is on. */
  closedSince: string | null;
};

/** Matches a task against the current UI view while optimistic changes settle. */
export function taskMatchesViewFilters(task: TaskView, filters: TaskViewFilters): boolean {
  const statusOk =
    filters.exactStatus !== null
      ? task.status === filters.exactStatus
      : (filters.statusPreset === "inactive"
          ? INACTIVE_TASK_STATUS_SET
          : ACTIVE_TASK_STATUS_SET
        ).has(task.status);
  if (!statusOk) return false;
  if (filters.closedSince !== null && (task.closedAt ?? "") < filters.closedSince) return false;
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
  /** Dot color for the priority. Text stays neutral so contrast holds. */
  dot: string;
  /** Color for an open or in-progress task's status glyph. Normal stays neutral so other priorities stand out. */
  glyph: string;
};

// Yellow and green take a darker shade on light themes so the icons keep their contrast.
export const PRIORITY_META: PriorityMeta[] = [
  { value: 0, label: "highest", shortLabel: "P0", dot: "bg-red-500", glyph: "text-red-500" },
  {
    value: 1,
    label: "high",
    shortLabel: "P1",
    dot: "bg-yellow-600 dark:bg-yellow-500",
    glyph: "text-yellow-600 dark:text-yellow-500",
  },
  {
    value: 2,
    label: "normal",
    shortLabel: "P2",
    dot: "bg-muted-foreground",
    glyph: "text-muted-foreground",
  },
  {
    value: 3,
    label: "low",
    shortLabel: "P3",
    dot: "bg-green-600 dark:bg-green-500",
    glyph: "text-green-600 dark:text-green-500",
  },
  {
    value: 4,
    label: "lowest",
    shortLabel: "P4",
    dot: "bg-blue-500",
    glyph: "text-blue-500",
  },
];

export function priorityMeta(value: TaskPriority): PriorityMeta {
  const found = PRIORITY_META.find((meta) => meta.value === value);
  if (!found) throw new Error(`unsupported priority ${String(value)}`);
  return found;
}

/** Active tasks show their priority as the glyph's color; paused and closed ones keep their status color. */
export function statusGlyphColor(task: Pick<TaskView, "status" | "priority">): string {
  return ACTIVE_TASK_STATUS_SET.has(task.status)
    ? priorityMeta(task.priority).glyph
    : taskStatusMeta[task.status].color;
}

export const EXACT_STATUS_META: Array<{ status: TaskStatus; label: string; key: string }> = [
  { status: "open", label: "Open", key: "O" },
  { status: "in_progress", label: "In progress", key: "I" },
  { status: "done", label: "Done", key: "D" },
  { status: "paused", label: "Paused", key: "P" },
  { status: "canceled", label: "Canceled", key: "X" },
];

export type SortField = "created" | "updated" | "priority" | "due" | "closed" | "manual";
export type SortDirection = "asc" | "desc";

/** How far back the done lens looks. Day is the last 24 hours, like the header count. */
export type DoneWindow = "day" | "week" | "month";

const DONE_WINDOW_DAYS: Record<DoneWindow, number> = { day: 1, week: 7, month: 30 };

export function doneSince(doneWindow: DoneWindow, now = Date.now()): string {
  return new Date(now - DONE_WINDOW_DAYS[doneWindow] * 24 * 60 * 60 * 1000).toISOString();
}

/** The next window Shift+D shows, wrapping from month back to day. */
export function widerDoneWindow(doneWindow: DoneWindow): DoneWindow {
  return doneWindow === "day" ? "week" : doneWindow === "week" ? "month" : "day";
}

/** When the lens's tasks were done: "today", or "in the last 7 days". */
export function doneWindowPhrase(doneWindow: DoneWindow): string {
  return doneWindow === "day" ? "today" : `in the last ${DONE_WINDOW_DAYS[doneWindow]} days`;
}

/** Quiet status message for a selected sort. */
export function sortSummary(field: SortField, direction: SortDirection): string {
  if (field === "manual") return "manual order";
  if (field === "priority")
    return `by priority, ${direction === "desc" ? "highest first" : "lowest first"}`;
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
