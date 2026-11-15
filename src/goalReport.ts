import { addDays, weekdayOf } from "@/backend/dueDate";
import { WEEKDAYS, type SharedSettings } from "@/platform/sharedSettings";
import { dayOf, goalsOn, isMet, type DoneTask, type GoalsToday } from "@/goals";

export type ReportRange = "month" | "year";

/**
 * How far a day got (`goals.report-judged`): its daily goals, each up to its target, against their
 * targets added up. Weekly goals have their own column, so they never hold a day back; with only
 * weekly goals, a day counts as met once they are met for its week.
 */
export function dayProgress(goals: GoalsToday): { filled: number; target: number } {
  const daily = goals.goals.filter((goal) => !goal.week);
  if (daily.length === 0) {
    const met = goals.goals.every((goal) => goal.week!.done >= goal.week!.count);
    return { filled: met ? 1 : 0, target: 1 };
  }
  return {
    filled: daily.reduce((sum, goal) => sum + Math.min(goal.done, goal.target), 0),
    target: daily.reduce((sum, goal) => sum + goal.target, 0),
  };
}

export function dayMet(goals: GoalsToday): boolean {
  const { filled, target } = dayProgress(goals);
  return isMet({ done: filled, target });
}

/** A day's share of its goals, from nothing to all met. */
export function dayShare(goals: GoalsToday): number {
  const { filled, target } = dayProgress(goals);
  return Math.min(1, filled / target);
}

/** The days the report can show: from the first day anything was done, up to today. */
export type ReportSpan = { first: string; today: string };

export function reportSpan(
  settings: SharedSettings,
  done: readonly DoneTask[],
  now = new Date(),
): ReportSpan {
  const today = dayOf(settings, now);
  let first = today;
  for (const task of done)
    if (task.closedAt !== null) {
      const day = dayOf(settings, new Date(task.closedAt));
      if (day < first) first = day;
    }
  return { first, today };
}

/** The day a week starts on (`settings.days`) on or before `day`. */
function weekOf(settings: SharedSettings, day: string): string {
  return addDays(day, -((weekdayOf(day) - WEEKDAYS.indexOf(settings.weekStartsOn) + 7) % 7));
}

/** Seven days from `start`. */
const weekFrom = (start: string): string[] =>
  Array.from({ length: 7 }, (_, index) => addDays(start, index));

/** The weeks a month view shows, each a row of seven days, with the days around the month filling them out. */
export function monthWeeks(settings: SharedSettings, day: string): string[][] {
  const month = day.slice(0, 7);
  const weeks: string[][] = [];
  for (
    let start = weekOf(settings, `${month}-01`);
    start.slice(0, 7) <= month;
    start = addDays(start, 7)
  )
    weeks.push(weekFrom(start));
  return weeks;
}

/** The weeks a year view shows, each a column of seven days, from the week of 1 January to the week of 31 December. */
export function yearWeeks(settings: SharedSettings, day: string): string[][] {
  const year = day.slice(0, 4);
  const weeks: string[][] = [];
  for (
    let start = weekOf(settings, `${year}-01-01`);
    start <= `${year}-12-31`;
    start = addDays(start, 7)
  )
    weeks.push(weekFrom(start));
  return weeks;
}

/** This week's days, from the day it started. */
export const thisWeek = (settings: SharedSettings, today: string): string[] =>
  weekFrom(weekOf(settings, today));

/** How each shown day went, or null for a day after today or before the first one. */
export function judgeDays(
  settings: SharedSettings,
  done: readonly DoneTask[],
  days: readonly string[],
  span: ReportSpan,
): Map<string, GoalsToday | null> {
  return new Map(
    days.map((day) => [
      day,
      day < span.first || day > span.today ? null : goalsOn(settings, done, day),
    ]),
  );
}

/** Met days in a row up to today, or up to yesterday while today is still open. */
export function currentStreak(
  settings: SharedSettings,
  done: readonly DoneTask[],
  span: ReportSpan,
): number {
  let day = span.today;
  if (!dayMet(goalsOn(settings, done, day))) day = addDays(day, -1);
  let streak = 0;
  while (day >= span.first && dayMet(goalsOn(settings, done, day))) {
    streak += 1;
    day = addDays(day, -1);
  }
  return streak;
}

export type RangeStats = { met: number; days: number; done: number; best: number };

/** The shown days up to today: how many were met, out of how many, what got done and the longest streak. */
export function rangeStats(judged: ReadonlyMap<string, GoalsToday | null>): RangeStats {
  const stats = { met: 0, days: 0, done: 0, best: 0 };
  let run = 0;
  for (const goals of [...judged.keys()].sort().map((day) => judged.get(day)!)) {
    if (goals === null) {
      run = 0;
      continue;
    }
    stats.days += 1;
    stats.done += goals.done;
    run = dayMet(goals) ? run + 1 : 0;
    if (run > 0) stats.met += 1;
    stats.best = Math.max(stats.best, run);
  }
  return stats;
}

/** The same day of the month a month or year away, on the month's last day when it has fewer. */
export function shiftDay(day: string, range: ReportRange, step: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const months = range === "month" ? step : step * 12;
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0));
  target.setUTCDate(Math.min(date, last.getUTCDate()));
  return target.toISOString().slice(0, 10);
}

/** Keeps a day within what the report can show. */
export const clampDay = (day: string, span: ReportSpan): string =>
  day < span.first ? span.first : day > span.today ? span.today : day;
