import { useEffect, useRef, useState } from "react";
import type { TaskView } from "@/components/taskView";
import { listTasks } from "@/platform/backendClient";

/** "Today" is the last 24 hours, so a late night still counts and nothing needs a setting. */
const DONE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Tasks age out of the window without any write, so the count also rechecks on its own. */
const RECHECK_MS = 60 * 1000;

type DoneToday = { tasks: TaskView[]; total: number };

/**
 * Tasks completed in the last 24 hours, most recent first. It counts again
 * whenever the loaded list changes, which covers this client's changes, undo,
 * redo and writes from the CLI or another device.
 */
export function useDoneToday(listTasksShown: readonly TaskView[]): DoneToday {
  const [doneToday, setDoneToday] = useState<DoneToday>({ tasks: [], total: 0 });
  const querySequence = useRef(0);

  useEffect(() => {
    const count = async (): Promise<void> => {
      const sequence = ++querySequence.current;
      try {
        // One page is plenty to show; recently updated is the closest stored order to closing.
        const result = await listTasks("done", 0, false, undefined, {
          closedSince: new Date(Date.now() - DONE_WINDOW_MS).toISOString(),
          sort: "updated",
        });
        if (sequence !== querySequence.current) return;
        const tasks = [...result.tasks].sort((left, right) =>
          (right.closedAt ?? "").localeCompare(left.closedAt ?? ""),
        );
        setDoneToday({ tasks, total: result.total });
      } catch {
        // The list reports backend failures; the count keeps its last answer.
      }
    };
    void count();
    const interval = window.setInterval(() => void count(), RECHECK_MS);
    return () => window.clearInterval(interval);
  }, [listTasksShown]);

  return doneToday;
}
