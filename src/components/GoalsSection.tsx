import { useState, type KeyboardEvent, type ReactElement } from "react";
import { X } from "lucide-react";
import { cn } from "cn";
import { QuietButton } from "@/components/variants/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { CountInput } from "@/components/variants/input";
import { InlineRadio, InlineRadioGroup } from "@/components/variants/radio-group";
import { SelectTrigger } from "@/components/variants/select";
import { practice } from "@/learning/progress";
import { listCategories } from "@/platform/backendClient";
import {
  MAX_GOAL,
  WEEKDAYS,
  setDayEndsAt,
  setGoal,
  setWeekStartsOn,
  useSharedSettings,
  type Goal,
  type Swatch,
  type Weekday,
} from "@/platform/sharedSettings";
import { useLoadOnOpen } from "./useLoadOnOpen";

const loadCategories = () => listCategories().then((result) => result.categories);

/** Up and Down move to the same control in the next goal, as Left and Right stay with the radios. */
function moveBetweenGoals(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const target = event.target as HTMLElement;
  const row = target.closest("[data-goal-row]");
  if (!row) return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-goal-row]")];
  const next = rows[rows.indexOf(row as HTMLElement) + (event.key === "ArrowDown" ? 1 : -1)];
  event.preventDefault();
  event.stopPropagation();
  if (!next) return;
  const radio = target.getAttribute("role") === "radio";
  (
    (radio && next.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')) ||
    next.querySelector<HTMLElement>("input[data-goal-count], button")
  )?.focus();
}

function GoalRow({
  slug,
  name,
  swatch,
  goal,
}: {
  slug: string | null;
  name: string;
  swatch: Swatch | null;
  goal: Goal | null;
}): ReactElement {
  const [draft, setDraft] = useState<string | null>(null);
  const id = `goal-${slug ?? "other"}`;
  const per = goal?.per ?? "day";
  return (
    <div
      data-goal-row
      className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-1.5 focus-within:bg-muted/50 sm:flex-nowrap sm:py-0"
    >
      <span className="flex min-w-0 flex-1 items-center gap-2 text-sm sm:w-36 sm:flex-none">
        <span
          aria-hidden="true"
          data-swatch={swatch ?? undefined}
          className={cn(
            "size-2.5 shrink-0 rounded-full",
            swatch ? "bg-(--swatch)" : slug ? "bg-classification-category" : "bg-foreground",
          )}
        />
        <label htmlFor={id} className="truncate">
          {name}
        </label>
      </span>
      <CountInput
        id={id}
        data-goal-count
        placeholder="–"
        value={draft ?? (goal ? String(goal.count) : "")}
        onChange={(event) => {
          const text = event.target.value.replace(/\D/g, "").slice(0, 2);
          setDraft(text);
          const count = Number(text);
          if (count < 1 || count > MAX_GOAL) return;
          void setGoal(slug, { count, per });
          practice("settings.goals");
        }}
        onBlur={() => {
          if (draft !== null && Number(draft) === 0) void setGoal(slug, null);
          setDraft(null);
        }}
      />
      <InlineRadioGroup
        aria-label={`${name} per`}
        // On a phone the radios take their own line, under the name.
        className="order-last ml-4.5 basis-full sm:order-none sm:ml-0 sm:basis-auto"
        value={per}
        disabled={!goal}
        onValueChange={(value) =>
          goal && void setGoal(slug, { ...goal, per: value as Goal["per"] })
        }
      >
        {(["day", "week"] as const).map((value) => (
          <Field key={value} orientation="horizontal" className="w-auto">
            <InlineRadio value={value} id={`${id}-${value}`} />
            <FieldLabel htmlFor={`${id}-${value}`} className="whitespace-nowrap">
              a {value}
            </FieldLabel>
          </Field>
        ))}
      </InlineRadioGroup>
      {slug ? (
        <QuietButton
          type="button"
          size="icon-xs"
          className="ml-auto"
          aria-label={`Remove ${name} goal`}
          title="Remove goal"
          onClick={(event) => {
            const row = event.currentTarget.closest("[data-goal-row]");
            row?.nextElementSibling
              ?.querySelector<HTMLElement>("input[data-goal-count], button")
              ?.focus();
            void setGoal(slug, null);
          }}
        >
          <X aria-hidden="true" />
        </QuietButton>
      ) : (
        // Holds the ×'s place so this row's number lines up with the others on a phone.
        <span aria-hidden="true" className="ml-auto size-6 shrink-0" />
      )}
    </div>
  );
}

/**
 * Settings › Goals: a goal per category and one for everything else, each a number a day or a
 * week. Clearing a number, or a category goal's ×, removes the goal. Colors come from Settings ›
 * Categories.
 */
export function GoalsSection({ open }: { open: boolean }): ReactElement {
  const { goals, otherGoal, colors } = useSharedSettings();
  const { value } = useLoadOnOpen(open, loadCategories);
  const slugs = Object.keys(goals).sort((a, b) => a.localeCompare(b));
  const addable = (value ?? []).map((category) => category.slug).filter((slug) => !(slug in goals));
  return (
    <section aria-labelledby="settings-goals" className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-col gap-1">
        <h2 id="settings-goals" className="text-sm font-medium">
          Goals
        </h2>
        <p className="text-sm text-muted-foreground">
          Each finished task fills its category's goal, or the one for everything else, and the done
          count's ring adds them up. Shared by all your devices.
        </p>
      </div>
      <div className="flex flex-col" onKeyDownCapture={moveBetweenGoals}>
        {slugs.map((slug) => (
          <GoalRow
            key={slug}
            slug={slug}
            name={`@${slug}`}
            swatch={colors[slug] ?? null}
            goal={goals[slug]}
          />
        ))}
        <div data-goal-row className="flex min-h-10 items-center px-2">
          <Select
            value={null as string | null}
            onValueChange={(slug) => {
              if (typeof slug !== "string") return;
              void setGoal(slug, { count: 1, per: "day" });
              requestAnimationFrame(() => document.getElementById(`goal-${slug}`)?.focus());
            }}
          >
            <SelectTrigger size="sm" aria-label="Add a goal" disabled={addable.length === 0}>
              <SelectValue
                placeholder={addable.length === 0 ? "Every category has a goal" : "Add a goal…"}
              />
            </SelectTrigger>
            <SelectContent align="start">
              {addable.map((slug) => (
                <SelectItem key={slug} value={slug}>
                  @{slug}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <GoalRow
          slug={null}
          name={slugs.length > 0 ? "Everything else" : "All tasks"}
          swatch={null}
          goal={otherGoal}
        />
      </div>
      <p className="text-xs text-muted-foreground" aria-hidden="true">
        ↑ ↓ goal · Tab number, then a day / a week · × or clear a number to remove its goal
      </p>
    </section>
  );
}

/** Midnight to 11:00, for anyone whose night runs into the morning. */
const DAY_ENDS = Array.from({ length: 12 }, (_, hour) => {
  const time = `${String(hour).padStart(2, "0")}:00`;
  return { value: time, label: hour === 0 ? "Midnight" : time };
});
const WEEK_STARTS = WEEKDAYS.map((day) => ({
  value: day,
  label: day[0].toUpperCase() + day.slice(1),
}));

/** Settings › General: when today ends and the week starts, for goals and the done count. */
export function DaysSection(): ReactElement {
  const { dayEndsAt, weekStartsOn } = useSharedSettings();
  return (
    <section aria-labelledby="settings-days" className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex flex-col gap-1">
        <h2 id="settings-days" className="text-sm font-medium">
          Days and weeks
        </h2>
        <p className="text-sm text-muted-foreground">
          With goals set, today ends here instead of after 24 hours, for night owls. Weekly goals
          start over on the first day of the week.
        </p>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span id="settings-day-ends" className="text-sm font-medium">
          Day ends at
        </span>
        <Select
          items={DAY_ENDS}
          value={dayEndsAt}
          onValueChange={(time) => time && void setDayEndsAt(time)}
        >
          <SelectTrigger size="sm" aria-labelledby="settings-day-ends">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {DAY_ENDS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span id="settings-week-starts" className="text-sm font-medium">
          Week starts on
        </span>
        <Select
          items={WEEK_STARTS}
          value={weekStartsOn}
          onValueChange={(day) => day && void setWeekStartsOn(day as Weekday)}
        >
          <SelectTrigger size="sm" aria-labelledby="settings-week-starts">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {WEEK_STARTS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  );
}
