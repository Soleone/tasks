import type { KeyboardEvent, ReactElement, RefObject } from "react";
import { cn } from "cn";
import { addDays, localToday } from "@/backend/dueDate";
import { FOCUS_RING } from "@/components/variants/focus";

export type LoggedWhen = "now" | "morning" | "yesterday" | "day";

const CHOICES: [LoggedWhen, string][] = [
  ["now", "Done now"],
  ["morning", "Done this morning"],
  ["yesterday", "Done yesterday"],
  ["day", "Done on"],
];

/** Noon on a calendar day, so a logged day stays that day in any time zone nearby. */
const noonOf = (day: string): Date => new Date(`${day}T12:00:00`);

/** When a logged task was done, never later than now: a day picked is its noon, the morning 9:00. */
export function loggedAt(when: LoggedWhen, day: string, now = new Date()): string {
  const today = localToday(now);
  const at =
    when === "now"
      ? now
      : when === "morning"
        ? new Date(`${today}T09:00:00`)
        : noonOf(when === "yesterday" ? addDays(today, -1) : day);
  return (at > now ? now : at).toISOString();
}

/**
 * The editor's "when" pill for `L`: a task logged as already done. One pill shows the choice; Left
 * and Right, or a click, step through them. Pick a day adds a date field.
 */
export function LoggedWhenPill({
  when,
  day,
  onWhen,
  onDay,
  onKeyDown,
  pillRef,
}: {
  when: LoggedWhen;
  day: string;
  onWhen: (when: LoggedWhen) => void;
  onDay: (day: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  pillRef: RefObject<HTMLButtonElement | null>;
}): ReactElement {
  const index = CHOICES.findIndex(([value]) => value === when);
  const step = (by: number) => onWhen(CHOICES[(index + by + CHOICES.length) % CHOICES.length][0]);
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-xs" onKeyDown={onKeyDown}>
      <button
        ref={pillRef}
        type="button"
        aria-label={`${CHOICES[index][1]}. Left and Right change when.`}
        data-logged-when={when}
        onClick={() => step(1)}
        onKeyDown={(event) => {
          // Enter saves, as it does from the title, rather than stepping the pill.
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
            return;
          }
          const by = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          if (by === 0 || event.altKey || event.ctrlKey || event.metaKey) return;
          event.preventDefault();
          step(by);
        }}
        className={cn(
          FOCUS_RING,
          "flex items-center gap-1 rounded-full bg-success-faint px-2 py-0.5 text-success",
        )}
      >
        <span aria-hidden="true">‹</span>
        {CHOICES[index][1]}
        <span aria-hidden="true">›</span>
      </button>
      {when === "day" ? (
        <input
          type="date"
          aria-label="Done on"
          max={localToday()}
          value={day}
          onChange={(event) => onDay(event.target.value)}
          className={cn(FOCUS_RING, "rounded-md border bg-transparent px-1.5 py-0.5")}
        />
      ) : null}
    </span>
  );
}
