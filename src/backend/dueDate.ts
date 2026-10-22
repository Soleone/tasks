/** Due dates are local calendar days written `YYYY-MM-DD`, never instants. */
const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/;
const weekdays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const weekdayNames = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthNames = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

// Day arithmetic runs in UTC so daylight saving never shifts a day.
function utcDay(date: string): Date {
  const [, year, month, day] = isoDate.exec(date)!;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function calendarDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month, day));
  date.setUTCFullYear(year);
  return date.getUTCMonth() === month && date.getUTCDate() === day && year >= 1 && year <= 9999
    ? isoDay(date)
    : null;
}

export function isDueDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = isoDate.exec(value);
  return match !== null && calendarDate(+match[1], +match[2] - 1, +match[3]) === value;
}

/** Today's date on this device. */
export function localToday(now = new Date()): string {
  return calendarDate(now.getFullYear(), now.getMonth(), now.getDate())!;
}

export function addDays(date: string, days: number): string {
  const day = utcDay(date);
  day.setUTCDate(day.getUTCDate() + days);
  return isoDay(day);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcDay(to).getTime() - utcDay(from).getTime()) / 86_400_000);
}

/** 0 for Sunday through 6 for Saturday. */
export function weekdayOf(date: string): number {
  return utcDay(date).getUTCDay();
}

function addMonths(date: string, count: number): string {
  const day = utcDay(date);
  const target = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + count, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day.getUTCDate(), lastDay));
  return isoDay(target);
}

/**
 * The date a word after `^` names, or null when it names none. Weekdays and month days mean the
 * next one after or on today, except a weekday never means today.
 */
export function parseDueWord(word: string, today: string): string | null {
  const lower = word.toLowerCase();
  if (isDueDate(lower)) return lower;
  if (lower === "today") return today;
  if (lower === "tomorrow" || lower === "tmr") return addDays(today, 1);
  const weekday = Math.max(weekdays.indexOf(lower), weekdayNames.indexOf(lower));
  if (weekday !== -1) {
    const ahead = (weekday - weekdayOf(today) + 7) % 7 || 7;
    return addDays(today, ahead);
  }
  const relative = /^(\d{1,3})([dwm])$/.exec(lower);
  if (relative) {
    const count = Number(relative[1]);
    if (relative[2] === "m") return addMonths(today, count);
    return addDays(today, count * (relative[2] === "w" ? 7 : 1));
  }
  const monthDay = /^([a-z]+)(\d{1,2})$/.exec(lower);
  if (monthDay) {
    const month = Math.max(months.indexOf(monthDay[1]), monthNames.indexOf(monthDay[1]));
    if (month === -1) return null;
    const year = utcDay(today).getUTCFullYear();
    const day = Number(monthDay[2]);
    const thisYear = calendarDate(year, month, day);
    if (thisYear !== null && thisYear >= today) return thisYear;
    return calendarDate(year + 1, month, day);
  }
  return null;
}
