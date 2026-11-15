import { expect, test } from "vite-plus/test";
import {
  dayOf,
  dayStart,
  doneTodaySince,
  goalsOn,
  goalsToday,
  tallyOf,
  tallyTasks,
  weekStart,
} from "./goals";
import type { SharedSettings } from "@/platform/sharedSettings";

const base: SharedSettings = {
  colors: { life: "magenta" },
  goals: { life: { count: 2, per: "day" }, work: { count: 10, per: "week" } },
  otherGoal: { count: 3, per: "day" },
  dayEndsAt: "04:00",
  weekStartsOn: "monday",
  tally: {},
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

test("goals.fill: each task fills its own goal, never spilling over into another", () => {
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
  // The ring: life's third task doesn't stand in for work or everything else.
  expect(today.filled).toBe(3);
  expect(today.target).toBe(7);
});

test("goals.names: the only goal is All tasks; no goals means no rings", () => {
  const only = { ...base, goals: {} };
  expect(goalsToday(only, [], now)!.goals[0].name).toBe("All tasks");
  expect(goalsToday({ ...only, otherGoal: null }, [], now)).toBeNull();
});

test("goals.report-judged: a past day is judged like its own done count, by today's goals", () => {
  const history = [
    done("life", at(9, 8)),
    done("life", at(9, 9)),
    done(null, at(9, 10)),
    // 2am on the 10th still counts toward the 9th.
    done(null, at(10, 2)),
    done(null, at(10, 9)),
    done("work", at(9, 12)),
  ];
  expect(dayOf(base, new Date(2026, 10, 10, 2))).toBe("2026-11-09");
  const monday = goalsOn(base, history, "2026-11-09");
  expect(monday.done).toBe(5);
  expect(monday.goals.map((goal) => [goal.slug, goal.done, goal.target])).toEqual([
    ["life", 2, 2],
    ["work", 1, 2],
    [null, 2, 3],
  ]);
  // Tuesday sees Monday's work toward the week, and nothing done later.
  const tuesday = goalsOn(base, history, "2026-11-10");
  expect(tuesday.done).toBe(1);
  expect(tuesday.goals[1]).toMatchObject({ done: 0, target: 2, week: { done: 1, count: 10 } });
});

test("goals.report-tally: deleted tasks count again as done at noon of their day", () => {
  const tally = tallyOf(base, [
    done("life", at(9, 8)),
    done("life", at(10, 2)),
    done(null, at(10, 9)),
  ]);
  expect(tally).toEqual({ "2026-11-09": { life: 2 }, "2026-11-10": { "": 1 } });
  const counted = tallyTasks({ ...base, tally });
  expect(counted).toHaveLength(3);
  expect(goalsOn(base, counted, "2026-11-09").goals[0]).toMatchObject({ done: 2, target: 2 });
  expect(goalsOn(base, counted, "2026-11-10").goals[2]).toMatchObject({ done: 1 });
});
