import { expect, test } from "vite-plus/test";
import { dayStart, doneTodaySince, goalsToday, weekStart } from "./goals";
import type { SharedSettings } from "@/platform/sharedSettings";

const base: SharedSettings = {
  colors: { life: "magenta" },
  goals: { life: { count: 2, per: "day" }, work: { count: 10, per: "week" } },
  otherGoal: { count: 3, per: "day" },
  dayEndsAt: "04:00",
  weekStartsOn: "monday",
};
// Wednesday 2026-11-11, 10:00 local: the week began Monday 04:00, five days are left.
const now = new Date(2026, 10, 11, 10, 0);
const at = (day: number, hour: number) => new Date(2026, 10, day, hour).toISOString();
const done = (category: string | null, closedAt: string) => ({
  category: category === null ? null : { slug: category },
  closedAt,
});

test("goals.day-ends: today begins when the day ends, so 2am still counts as yesterday", () => {
  expect(dayStart(base, now)).toEqual(new Date(2026, 10, 11, 4, 0));
  expect(dayStart(base, new Date(2026, 10, 11, 2, 0))).toEqual(new Date(2026, 10, 10, 4, 0));
  expect(weekStart(base, now)).toEqual({ start: new Date(2026, 10, 9, 4, 0), daysLeft: 5 });
  expect(weekStart({ ...base, weekStartsOn: "wednesday" }, now).daysLeft).toBe(7);
  expect(doneTodaySince({ ...base, goals: {}, otherGoal: null }, now)).toEqual(
    new Date(now.getTime() - 24 * 60 * 60 * 1000),
  );
});

test("goals.fill: each task fills its own goal and the big ring, never spilling over", () => {
  const today = goalsToday(
    base,
    [
      done("life", at(11, 8)),
      done("life", at(11, 9)),
      done("life", at(11, 9)),
      done("home", at(11, 9)),
      done(null, at(11, 3)),
      done("work", at(10, 12)),
      done("work", at(9, 12)),
      done("work", at(9, 13)),
      done("work", at(9, 14)),
      done("work", at(8, 12)),
    ],
    now,
  )!;
  expect(today.goals).toEqual([
    { slug: "life", name: "@life", swatch: "magenta", done: 3, target: 2 },
    // 4 done before today, 6 left over 5 days: 2 today.
    { slug: "work", name: "@work", swatch: null, done: 0, target: 2, week: { done: 4, count: 10 } },
    { slug: null, name: "Everything else", swatch: null, done: 1, target: 3 },
  ]);
  expect(today.done).toBe(4);
  expect(today.target).toBe(7);
});

test("goals.names: the only goal is All tasks; no goals means no rings", () => {
  const only = { ...base, goals: {} };
  expect(goalsToday(only, [], now)!.goals[0].name).toBe("All tasks");
  expect(goalsToday({ ...only, otherGoal: null }, [], now)).toBeNull();
});
