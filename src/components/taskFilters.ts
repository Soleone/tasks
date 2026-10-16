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
};

export const PRIORITY_META: PriorityMeta[] = [
  { value: 0, label: "highest", shortLabel: "P0", dot: "bg-red-500" },
  { value: 1, label: "high", shortLabel: "P1", dot: "bg-yellow-500" },
  { value: 2, label: "normal", shortLabel: "P2", dot: "bg-green-500" },
  { value: 3, label: "low", shortLabel: "P3", dot: "bg-blue-500" },
  { value: 4, label: "lowest", shortLabel: "P4", dot: "bg-muted-foreground" },
];

export function priorityMeta(value: TaskPriority): PriorityMeta {
  const found = PRIORITY_META.find((meta) => meta.value === value);
  if (!found) throw new Error(`unsupported priority ${String(value)}`);
  return found;
}

export const EXACT_STATUS_META: Array<{ status: TaskStatus; label: string; key: string }> = [
  { status: "open", label: "Open", key: "O" },
  { status: "in_progress", label: "In progress", key: "I" },
  { status: "done", label: "Done", key: "D" },
  { status: "paused", label: "Paused", key: "P" },
  { status: "canceled", label: "Canceled", key: "X" },
];

export type SortField = "created" | "updated" | "priority" | "manual";
export type SortDirection = "asc" | "desc";

/** Quiet status message for a selected sort. */
export function sortSummary(field: SortField, direction: SortDirection): string {
  if (field === "manual") return "manual order";
  if (field === "priority")
    return `by priority, ${direction === "desc" ? "highest first" : "lowest first"}`;
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
  if (field === "priority") {
    const priorityDirection = direction === "desc" ? 1 : -1;
    return (
      priorityDirection * (a.priority - b.priority) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
  }
  const keyA = field === "created" ? a.createdAt : a.updatedAt;
  const keyB = field === "created" ? b.createdAt : b.updatedAt;
  if (keyA !== keyB) {
    const newerFirst = direction === "desc";
    if (keyA > keyB) return newerFirst ? -1 : 1;
    return newerFirst ? 1 : -1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
