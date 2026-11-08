import { WEEKDAYS, type Goal, type SharedSettings, type Swatch } from "@/platform/sharedSettings";

const DAY_MS = 24 * 60 * 60 * 1000;

/** One goal's progress today. `slug` is null for the goal covering every other task. */
export type GoalProgress = {
  slug: string | null;
  name: string;
  swatch: Swatch | null;
  done: number;
  /** Today's target: the goal itself, or for a weekly goal what's left of the week over the days left. */
  target: number;
  /** A weekly goal's whole week, today included. */
  week?: { done: number; count: number };
};

/**
 * Everything done today, and the done count's ring: each goal's progress up to its target
 * (`filled`) against all of today's targets added up, so it's full only once every goal is met.
 */
export type GoalsToday = { done: number; filled: number; target: number; goals: GoalProgress[] };

export const isMet = (goal: { done: number; target: number }): boolean => goal.done >= goal.target;

export function hasGoals(settings: SharedSettings): boolean {
  return settings.otherGoal !== null || Object.keys(settings.goals).length > 0;
}

/** When today began: the last time the clock passed "day ends at". */
export function dayStart(settings: SharedSettings, now = new Date()): Date {
  const [hours, minutes] = settings.dayEndsAt.split(":").map(Number);
  const start = new Date(now);
  start.setHours(hours, minutes, 0, 0);
  if (start > now) start.setDate(start.getDate() - 1);
  return start;
}

/** When this week began, at the hour days begin, and how many days it has left, today included. */
export function weekStart(
  settings: SharedSettings,
  now = new Date(),
): { start: Date; daysLeft: number } {
  const start = dayStart(settings, now);
  const daysIn = (start.getDay() - WEEKDAYS.indexOf(settings.weekStartsOn) + 7) % 7;
  // Calendar days, not 24-hour steps, so a daylight saving change keeps the hour.
  start.setDate(start.getDate() - daysIn);
  return { start, daysLeft: 7 - daysIn };
}

/**
 * Where "done today" begins: at the start of the day once goals are set, so a goal fills from zero
 * each morning; otherwise the last 24 hours, so a fresh morning shows no empty score.
 */
export function doneTodaySince(settings: SharedSettings, now = new Date()): Date {
  return hasGoals(settings) ? dayStart(settings, now) : new Date(now.getTime() - DAY_MS);
}

type DoneTask = { category: { slug: string } | null; closedAt: string | null };

function todayTarget(goal: Goal, doneBeforeToday: number, daysLeft: number): number {
  if (goal.per === "day") return goal.count;
  return Math.ceil(Math.max(0, goal.count - doneBeforeToday) / daysLeft);
}

/**
 * Each task done today fills its category's goal, or the goal for everything else. A category with
 * a goal never spills into everything else, and no goal past its target fills the done count's
 * ring for another.
 * Null without goals.
 */
export function goalsToday(
  settings: SharedSettings,
  doneTasks: readonly DoneTask[],
  now = new Date(),
): GoalsToday | null {
  if (!hasGoals(settings)) return null;
  const today = dayStart(settings, now).toISOString();
  const { start, daysLeft } = weekStart(settings, now);
  const week = start.toISOString();
  const goalOf = (task: DoneTask): string | null | undefined => {
    const slug = task.category?.slug;
    if (slug !== undefined && slug in settings.goals) return slug;
    return settings.otherGoal ? null : undefined;
  };
  const entries: [string | null, Goal][] = Object.entries(settings.goals).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (settings.otherGoal) entries.push([null, settings.otherGoal]);
  let done = 0;
  const goals = entries.map(([slug, goal]): GoalProgress => {
    let doneToday = 0;
    let doneBefore = 0;
    for (const task of doneTasks) {
      if (task.closedAt === null || task.closedAt < week || goalOf(task) !== slug) continue;
      if (task.closedAt >= today) doneToday += 1;
      else doneBefore += 1;
    }
    return {
      slug,
      name: slug !== null ? `@${slug}` : entries.length > 1 ? "Everything else" : "All tasks",
      swatch: slug !== null ? (settings.colors[slug] ?? null) : null,
      done: doneToday,
      target: todayTarget(goal, doneBefore, daysLeft),
      ...(goal.per === "week" ? { week: { done: doneBefore + doneToday, count: goal.count } } : {}),
    };
  });
  for (const task of doneTasks) if (task.closedAt !== null && task.closedAt >= today) done += 1;
  return {
    done,
    filled: goals.reduce((sum, goal) => sum + Math.min(goal.done, goal.target), 0),
    target: goals.reduce((sum, goal) => sum + goal.target, 0),
    goals,
  };
}
