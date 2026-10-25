import { useEffect, useRef, useState } from "react";
import type { TaskView } from "@/components/taskView";
import { lensFilter, type ListLens } from "@/components/listLens";
import { listTasks } from "@/platform/backendClient";

/** Tasks age out of the window, and days turn, without any write, so the counts also recheck on their own. */
const RECHECK_MS = 60 * 1000;

type HeaderCounts = { doneToday: number; dueNow: number };

/** How many tasks the lens shows with no other filter. */
async function countLens(lens: ListLens): Promise<number> {
  const { statuses, ...bounds } = lensFilter(lens);
  return (await listTasks(statuses, 0, false, undefined, { ...bounds, limit: 1 })).total;
}

/**
 * How many tasks the done-today and due-now lenses show. They count again
 * whenever the loaded list changes, which covers this client's changes, undo,
 * redo and writes from the CLI or another device.
 */
export function useHeaderCounts(listTasksShown: readonly TaskView[]): HeaderCounts {
  const [counts, setCounts] = useState<HeaderCounts>({ doneToday: 0, dueNow: 0 });
  const querySequence = useRef(0);

  useEffect(() => {
    const count = async (): Promise<void> => {
      const sequence = ++querySequence.current;
      try {
        const [doneToday, dueNow] = await Promise.all([
          countLens({ kind: "done", window: "day" }),
          countLens({ kind: "due" }),
        ]);
        if (sequence === querySequence.current) setCounts({ doneToday, dueNow });
      } catch {
        // The list reports backend failures; the counts keep their last answer.
      }
    };
    void count();
    const interval = window.setInterval(() => void count(), RECHECK_MS);
    return () => window.clearInterval(interval);
  }, [listTasksShown]);

  return counts;
}
