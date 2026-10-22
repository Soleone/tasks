/** Concise task timestamps. Date-only in rows; the time survives in tooltips. */
import { daysBetween, weekdayOf } from "./dueDate.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A due date in full: Fri, Oct 23, with the year outside the current one. */
export function formatDueDate(due: string, today: string): string {
  const [year, month, day] = due.split("-").map(Number);
  const date = `${WEEKDAYS[weekdayOf(due)]}, ${MONTHS[month - 1]} ${day}`;
  return due.slice(0, 4) === today.slice(0, 4) ? date : `${date}, ${year}`;
}

/** How a row names a due date within the coming week, or one already past; null further out. */
export function dueSoonLabel(due: string, today: string): string | null {
  const days = daysBetween(today, due);
  if (days < 0) return `${-days}d late`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return days < 7 ? WEEKDAYS[weekdayOf(due)] : null;
}

/** Recent past dates use relative wording; older dates use calendar dates. */
export function formatTaskDate(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const startOfDay = (value: Date): number =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const daysAgo = Math.round((startOfDay(now) - startOfDay(date)) / (24 * 60 * 60 * 1000));
  if (daysAgo === 0) return "today";
  if (daysAgo === 1) return "yesterday";
  if (daysAgo > 1 && daysAgo < 7) return `${daysAgo} days ago`;
  const monthDay = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === now.getFullYear() ? monthDay : `${monthDay}, ${date.getFullYear()}`;
}

function clockTime(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Full local timestamp for tooltips, e.g. Sep 8, 2026, 14:32. */
export function formatTaskDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}, ${clockTime(date)}`;
}

/** A time within the last day: 14:32 today, or yesterday 22:10. */
export function formatRecentTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = formatTaskDate(iso, now);
  return day === "today" ? clockTime(date) : `${day} ${clockTime(date)}`;
}

/** Whether two timestamps fall on the same local calendar day. */
export function sameTaskDay(leftIso: string, rightIso: string): boolean {
  const left = new Date(leftIso);
  const right = new Date(rightIso);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return false;
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}
