import { expect, test } from "vite-plus/test";
import {
  clampDay,
  currentStreak,
  judgeDays,
  monthWeeks,
  rangeStats,
  reportSpan,
  shiftDay,
  yearWeeks,
} from "./goalReport";
import type { SharedSettings } from "@/platform/sharedSettings";

const settings: SharedSettings = {
  colors: {},
  // The weekly goal never holds a day back: days are judged by daily goals.
  goals: { app: { count: 2, per: "day" }, launch: { count: 3, per: "week" } },
  otherGoal: null,
  dayEndsAt: "04:00",
  weekStartsOn: "monday",
  tally: {},
};
const at = (day: number, hour = 10) => new Date(2026, 10, day, hour).toISOString();
const app = (day: number) => ({ category: { slug: "app" }, closedAt: at(day) });

test("goals.report-month: rows start on the week's first day and cover the whole month", () => {
  const weeks = monthWeeks(settings, "2026-11-15");
  expect(weeks[0][0]).toBe("2026-10-26");
  expect(weeks.at(-1)!.at(-1)).toBe("2026-12-06");
  expect(weeks).toHaveLength(6);
  expect(monthWeeks({ ...settings, weekStartsOn: "sunday" }, "2026-11-15")[0][0]).toBe(
    "2026-11-01",
  );
  const year = yearWeeks(settings, "2026-11-15");
  expect(year[0][0]).toBe("2025-12-29");
  expect(year.at(-1)!.at(-1)).toBe("2027-01-03");
});

test("goals.report-month: met days, streaks and what got done, up to today", () => {
  // Met on the 10th to 12th and the 14th; the 13th has one task; today, the 15th, is still open.
  const done = [10, 10, 11, 11, 12, 12, 13, 14, 14, 15].map(app);
  const span = reportSpan(settings, done, new Date(2026, 10, 15, 12));
  expect(span).toEqual({ first: "2026-11-10", today: "2026-11-15" });
  const judged = judgeDays(settings, done, monthWeeks(settings, "2026-11-15").flat(), span);
  expect(judged.get("2026-11-09")).toBeNull();
  expect(judged.get("2026-11-16")).toBeNull();
  expect(rangeStats(judged)).toEqual({ met: 4, days: 6, done: 10, best: 3 });
  // Today is still open, so the streak counts up to yesterday.
  expect(currentStreak(settings, done, span)).toBe(1);
  expect(currentStreak(settings, [...done, app(15)], span)).toBe(2);
});

test("goals.report-keys: a month or year away keeps the day of the month, within what can be shown", () => {
  expect(shiftDay("2026-03-31", "month", -1)).toBe("2026-02-28");
  expect(shiftDay("2026-11-15", "year", -1)).toBe("2025-11-15");
  const span = { first: "2026-10-03", today: "2026-11-15" };
  expect(clampDay("2026-12-15", span)).toBe("2026-11-15");
  expect(clampDay("2026-09-15", span)).toBe("2026-10-03");
});
