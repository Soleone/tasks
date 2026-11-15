import { useEffect, useMemo, useState } from "react";
import type { TaskView } from "@/components/taskView";
import { tallyTasks, type DoneTask } from "@/goals";
import { listCompletions } from "@/platform/backendClient";
import { useSharedSettings } from "@/platform/sharedSettings";

/**
 * Every task ever done, the tally's deleted ones too, for the goal report. Loads while `active`
 * and again whenever the loaded list changes, so a completion from anywhere shows up.
 */
export function useDoneHistory(active: boolean, listTasksShown: readonly TaskView[]) {
  const settings = useSharedSettings();
  const [done, setDone] = useState<DoneTask[] | null>(null);
  useEffect(() => {
    if (!active) return;
    let current = true;
    listCompletions().then(
      (completions) => {
        if (current) setDone(completions);
      },
      // The list reports backend failures; the report keeps its last answer.
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [active, listTasksShown]);
  return useMemo(() => done && [...done, ...tallyTasks(settings)], [done, settings]);
}
