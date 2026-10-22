import assert from "node:assert/strict";
import test from "node:test";
import { formatRecentTime, formatTaskDate, formatTaskDateTime, sameTaskDay } from "./taskDates.js";

const NOW = new Date(2026, 8, 10, 12, 0, 0);

/** ISO strings built from local components so midnight boundaries hold in any timezone. */
function iso(year: number, monthIndex: number, day: number, hour = 12, minute = 0): string {
  return new Date(year, monthIndex, day, hour, minute).toISOString();
}

test("formatTaskDate names recent relative dates and older calendar dates", () => {
  assert.equal(formatTaskDate(iso(2026, 8, 10, 8), NOW), "today");
  assert.equal(formatTaskDate(iso(2026, 8, 9, 23, 59), NOW), "yesterday");
  assert.equal(formatTaskDate(iso(2026, 8, 8), NOW), "2 days ago");
  assert.equal(formatTaskDate(iso(2026, 8, 4), NOW), "6 days ago");
  assert.equal(formatTaskDate(iso(2026, 8, 3), NOW), "Sep 3");
  assert.equal(formatTaskDate(iso(2026, 0, 1), NOW), "Jan 1");
  assert.equal(formatTaskDate(iso(2025, 11, 10), NOW), "Dec 10, 2025");
  assert.equal(formatTaskDate(iso(2026, 8, 11), NOW), "Sep 11");
  assert.equal(formatTaskDate("not-a-date", NOW), "");
});

test("formatTaskDateTime renders the local date and time", () => {
  assert.equal(formatTaskDateTime(iso(2026, 8, 8, 14, 32)), "Sep 8, 2026, 14:32");
  assert.equal(formatTaskDateTime("not-a-date"), "");
});

test("formatRecentTime shows the clock today and names yesterday", () => {
  assert.equal(formatRecentTime(iso(2026, 8, 10, 9, 5), NOW), "09:05");
  assert.equal(formatRecentTime(iso(2026, 8, 9, 22, 10), NOW), "yesterday 22:10");
  assert.equal(formatRecentTime("not-a-date", NOW), "");
});

test("sameTaskDay compares local calendar days", () => {
  assert.equal(sameTaskDay(iso(2026, 8, 10, 0, 1), iso(2026, 8, 10, 23, 59)), true);
  assert.equal(sameTaskDay(iso(2026, 8, 10), iso(2026, 8, 9)), false);
  assert.equal(sameTaskDay("not-a-date", iso(2026, 8, 10)), false);
});
