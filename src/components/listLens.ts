import { addDays, localToday } from "@/backend/dueDate";
import type { TaskStatus } from "@/backend/taskModel";
import { doneTodaySince } from "@/goals";
import { readSharedSettings } from "@/platform/sharedSettings";

/**
 * How far back the done lens looks. Day is today, like the header count (doneTodaySince), and
 * yesterday is the day before it.
 */
export type DoneWindow = "day" | "yesterday" | "week" | "month";

/**
 * A lens turns the list itself into one question, such as what was done
 * today or what is due now, and the same key or count goes back. It is never
 * remembered between launches.
 */
export type ListLens = { kind: "done"; window: DoneWindow; goal?: GoalLens } | { kind: "due" };

/** The done lens narrowed to one goal: a category's, or everything outside the goal categories. */
export type GoalLens = { category: string } | { excludeCategories: string[] };

/** The tasks a lens shows, on top of the list's other filters. Its statuses replace the status filter. */
export type LensFilter = {
  statuses: TaskStatus[];
  closedSince?: string;
  closedBefore?: string;
  dueBefore?: string;
  category?: string;
  excludeCategories?: string[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DONE_WINDOW_DAYS = { week: 7, month: 30 };

export function lensFilter(lens: ListLens, now = new Date()): LensFilter {
  if (lens.kind === "done") {
    const done = { statuses: ["done"] as TaskStatus[], ...lens.goal };
    if (lens.window === "week" || lens.window === "month") {
      const since = new Date(now.getTime() - DONE_WINDOW_DAYS[lens.window] * DAY_MS);
      return { ...done, closedSince: since.toISOString() };
    }
    const today = doneTodaySince(readSharedSettings(), now);
    if (lens.window === "day") return { ...done, closedSince: today.toISOString() };
    // Calendar days, not 24-hour steps, so a daylight saving change keeps the hour.
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return { ...done, closedSince: yesterday.toISOString(), closedBefore: today.toISOString() };
  }
  // Due now is due today or earlier, matching the red dates on rows.
  return { statuses: ["open", "in_progress", "paused"], dueBefore: addDays(localToday(now), 1) };
}

const DONE_WINDOWS: DoneWindow[] = ["day", "yesterday", "week", "month"];

/** The next window Shift+D shows, wrapping from month back to day. */
export function widerDoneWindow(doneWindow: DoneWindow): DoneWindow {
  return DONE_WINDOWS[(DONE_WINDOWS.indexOf(doneWindow) + 1) % DONE_WINDOWS.length];
}

/** What the lens shows, after a count: "done today", "done in the last 7 days", "due now". */
export function lensPhrase(lens: ListLens): string {
  if (lens.kind === "due") return "due now";
  if (lens.window === "day") return "done today";
  if (lens.window === "yesterday") return "done yesterday";
  return `done in the last ${DONE_WINDOW_DAYS[lens.window]} days`;
}
