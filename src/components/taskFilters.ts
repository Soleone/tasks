import {
  Circle,
  CircleCheck,
  CirclePause,
  CircleDashed,
  CircleX,
  type LucideIcon,
} from "lucide-react";
import type { TaskPriority, TaskStatus } from "@/backend/protocol";

type TaskStatusMeta = {
  label: string;
  Icon: LucideIcon;
  color: string;
};

export const taskStatusMeta: Record<TaskStatus, TaskStatusMeta> = {
  open: { label: "Open", Icon: Circle, color: "text-muted-foreground" },
  in_progress: { label: "In progress", Icon: CircleDashed, color: "text-primary" },
  paused: { label: "Paused", Icon: CirclePause, color: "text-warning" },
  done: { label: "Done", Icon: CircleCheck, color: "text-success" },
  canceled: { label: "Canceled", Icon: CircleX, color: "text-destructive" },
};

export const ACTIVE_TASK_STATUSES: TaskStatus[] = ["open", "in_progress", "paused"];
export const INACTIVE_TASK_STATUSES: TaskStatus[] = ["done", "canceled"];

export type StatusPreset = "active" | "inactive";

export function presetStatuses(preset: StatusPreset): TaskStatus[] {
  return preset === "active" ? ACTIVE_TASK_STATUSES : INACTIVE_TASK_STATUSES;
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

export type SortField = "created" | "updated";
export type SortDirection = "asc" | "desc";

/** Quiet count-line suffix, e.g. by updated, desc. */
export function sortSummary(field: SortField, direction: SortDirection): string {
  return `by ${field}, ${direction}`;
}
