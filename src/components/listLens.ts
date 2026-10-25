import { addDays, localToday } from "@/backend/dueDate";
import type { TaskStatus } from "@/backend/taskModel";

/** How far back the done lens looks. Day is the last 24 hours, like the header count. */
export type DoneWindow = "day" | "week" | "month";

/**
 * A lens turns the list itself into one question, such as what was done
 * today or what is due now, and the same key or count goes back. It is never
 * remembered between launches.
 */
export type ListLens = { kind: "done"; window: DoneWindow } | { kind: "due" };

/** The tasks a lens shows, on top of the list's other filters. Its statuses replace the status filter. */
export type LensFilter = { statuses: TaskStatus[]; closedSince?: string; dueBefore?: string };

const DONE_WINDOW_DAYS: Record<DoneWindow, number> = { day: 1, week: 7, month: 30 };

export function lensFilter(lens: ListLens, now = new Date()): LensFilter {
  if (lens.kind === "done") {
    const days = DONE_WINDOW_DAYS[lens.window];
    return {
      statuses: ["done"],
      closedSince: new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString(),
    };
  }
  // Due now is due today or earlier, matching the warning color on rows.
  return { statuses: ["open", "in_progress", "paused"], dueBefore: addDays(localToday(now), 1) };
}

/** The next window Shift+D shows, wrapping from month back to day. */
export function widerDoneWindow(doneWindow: DoneWindow): DoneWindow {
  return doneWindow === "day" ? "week" : doneWindow === "week" ? "month" : "day";
}

/** What the lens shows, after a count: "done today", "done in the last 7 days", "due now". */
export function lensPhrase(lens: ListLens): string {
  if (lens.kind === "due") return "due now";
  return lens.window === "day"
    ? "done today"
    : `done in the last ${DONE_WINDOW_DAYS[lens.window]} days`;
}
