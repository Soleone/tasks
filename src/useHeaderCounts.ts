import { useEffect, useRef, useState } from "react";
import type { TaskView } from "@/components/taskView";
import { lensFilter, type ListLens } from "@/components/listLens";
import { goalsToday, hasGoals, weekStart, type GoalsToday } from "@/goals";
import { listTasks } from "@/platform/backendClient";
import { useSharedSettings, type SharedSettings } from "@/platform/sharedSettings";

/** Tasks age out of the window, and days turn, without any write, so the counts also recheck on their own. */
const RECHECK_MS = 60 * 1000;

type HeaderCounts = { doneToday: number; dueNow: number; goals: GoalsToday | null };

/** How many tasks the lens shows with no other filter. */
async function countLens(lens: ListLens): Promise<number> {
  const { statuses, ...bounds } = lensFilter(lens);
  return (await listTasks(statuses, 0, false, undefined, { ...bounds, limit: 1 })).total;
}

/** Each goal's progress, from this week's done tasks; a week holds far fewer than a page. */
async function countGoals(settings: SharedSettings): Promise<GoalsToday> {
  const now = new Date();
  const { tasks } = await listTasks(["done"], 0, false, undefined, {
    closedSince: weekStart(settings, now).start.toISOString(),
    limit: 500,
  });
  return goalsToday(settings, tasks, now)!;
}

/**
 * How many tasks the done-today and due-now lenses show, and with goals set, how far each goal
 * got today. They count again whenever the loaded list or the goals change, which covers this
 * client's changes, undo, redo and writes from the CLI or another device.
 */
export function useHeaderCounts(listTasksShown: readonly TaskView[]): HeaderCounts {
  const settings = useSharedSettings();
  const [counts, setCounts] = useState<HeaderCounts>({ doneToday: 0, dueNow: 0, goals: null });
  const querySequence = useRef(0);

  useEffect(() => {
    const count = async (): Promise<void> => {
      const sequence = ++querySequence.current;
      try {
        const [goals, dueNow] = await Promise.all([
          hasGoals(settings) ? countGoals(settings) : null,
          countLens({ kind: "due" }),
        ]);
        const doneToday = goals?.done ?? (await countLens({ kind: "done", window: "day" }));
        if (sequence === querySequence.current) setCounts({ doneToday, dueNow, goals });
      } catch {
        // The list reports backend failures; the counts keep their last answer.
      }
    };
    void count();
    const interval = window.setInterval(() => void count(), RECHECK_MS);
    return () => window.clearInterval(interval);
  }, [listTasksShown, settings]);

  return counts;
}
