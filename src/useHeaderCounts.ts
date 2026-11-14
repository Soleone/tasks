import { useEffect, useRef, useState } from "react";
import type { TaskView } from "@/components/taskView";
import { lensFilter, type ListLens } from "@/components/listLens";
import { goalsToday, hasGoals, weekStart, type GoalsToday } from "@/goals";
import { listTasksTogether, type TaskListQuery } from "@/platform/backendClient";
import { useSharedSettings, type SharedSettings } from "@/platform/sharedSettings";

/** Tasks age out of the window, and days turn, without any write, so the counts also recheck on their own. */
const RECHECK_MS = 60 * 1000;

type HeaderCounts = { doneToday: number; dueNow: number; goals: GoalsToday | null };

function lensQuery(lens: ListLens): TaskListQuery {
  const { statuses, ...bounds } = lensFilter(lens);
  return { status: statuses, ...bounds, limit: 1 };
}

/**
 * The counts in one request, since each request looks at every task file. With goals, this
 * week's done tasks give each goal's progress and the done count; a week holds far fewer than a
 * page.
 */
async function countAll(settings: SharedSettings): Promise<HeaderCounts> {
  const now = new Date();
  const goalsSet = hasGoals(settings);
  const {
    lists: [due, done],
  } = await listTasksTogether(
    [
      lensQuery({ kind: "due" }),
      goalsSet
        ? {
            status: ["done"],
            closedSince: weekStart(settings, now).start.toISOString(),
            limit: 500,
          }
        : lensQuery({ kind: "done", window: "day" }),
    ],
    false,
  );
  const goals = goalsSet ? goalsToday(settings, done.tasks, now)! : null;
  return { doneToday: goals ? goals.done : done.total, dueNow: due.total, goals };
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
        const next = await countAll(settings);
        if (sequence === querySequence.current) setCounts(next);
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
