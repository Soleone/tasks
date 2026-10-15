import type { TaskStatus } from "@/backend/taskModel";

export type StatusCommand = "task.start" | "task.pause" | "task.complete" | "task.reopen";
export type StatusTransition = { next: TaskStatus; command: StatusCommand };

// Paused is a separate pause/resume state, but both Space directions keep it
// reachable: forward completes it, while reverse returns it to in progress.
export const forwardStatusTransition: Record<TaskStatus, StatusTransition> = {
  open: { next: "in_progress", command: "task.start" },
  in_progress: { next: "done", command: "task.complete" },
  paused: { next: "done", command: "task.complete" },
  done: { next: "open", command: "task.reopen" },
  canceled: { next: "open", command: "task.reopen" },
};

export const reverseStatusTransition: Record<TaskStatus, StatusTransition> = {
  open: { next: "done", command: "task.complete" },
  in_progress: { next: "open", command: "task.reopen" },
  paused: { next: "in_progress", command: "task.start" },
  done: { next: "in_progress", command: "task.start" },
  canceled: { next: "open", command: "task.reopen" },
};
