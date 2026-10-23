import { useEffect, useRef, useState } from "react";
import type { TaskView } from "@/components/taskView";
import { doneSince } from "@/components/taskFilters";
import { listTasks } from "@/platform/backendClient";

/** Tasks age out of the window without any write, so the count also rechecks on its own. */
const RECHECK_MS = 60 * 1000;

/**
 * How many tasks were completed in the last 24 hours. It counts again
 * whenever the loaded list changes, which covers this client's changes, undo,
 * redo and writes from the CLI or another device.
 */
export function useDoneToday(listTasksShown: readonly TaskView[]): number {
  const [total, setTotal] = useState(0);
  const querySequence = useRef(0);

  useEffect(() => {
    const count = async (): Promise<void> => {
      const sequence = ++querySequence.current;
      try {
        const result = await listTasks("done", 0, false, undefined, {
          closedSince: doneSince("day"),
        });
        if (sequence === querySequence.current) setTotal(result.total);
      } catch {
        // The list reports backend failures; the count keeps its last answer.
      }
    };
    void count();
    const interval = window.setInterval(() => void count(), RECHECK_MS);
    return () => window.clearInterval(interval);
  }, [listTasksShown]);

  return total;
}
