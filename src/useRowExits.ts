import { useEffect, useRef, useState } from "react";
import type { TaskView } from "@/components/taskView";
import { useStableHandler } from "@/components/useStableHandler";

/** How long a leaving row slides out (task-list-exit in styles.css). */
const ROW_EXIT_MS = 300;

type RowExit = { tasks: Map<string, TaskView>; timers: number[] };

/**
 * Rows leaving the view: each batch stays put for `lingerMs`, slides out, and
 * then `remove` drops it from the list. A row updated while leaving keeps its
 * exit with the newer task; a stopped row stays where it is.
 */
export function useRowExits(remove: (tasks: TaskView[]) => void) {
  const [exitingTaskIds, setExitingTaskIds] = useState<ReadonlySet<string>>(() => new Set());
  const exits = useRef(new Set<RowExit>());
  const removeRows = useStableHandler(remove);

  useEffect(() => {
    const running = exits.current;
    return () => running.forEach((exit) => exit.timers.forEach((timer) => clearTimeout(timer)));
  }, []);

  function setSliding(taskIds: readonly string[], sliding: boolean): void {
    setExitingTaskIds((previous) => {
      const next = new Set(previous);
      for (const id of taskIds) {
        if (sliding) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function exitRows(tasks: readonly TaskView[], lingerMs: number, afterRemove?: () => void): void {
    const fresh = tasks.filter((task) => {
      const running = [...exits.current].find((exit) => exit.tasks.has(task.id));
      running?.tasks.set(task.id, task);
      return running === undefined;
    });
    if (fresh.length === 0) return;
    const exit: RowExit = { tasks: new Map(fresh.map((task) => [task.id, task])), timers: [] };
    exit.timers.push(
      window.setTimeout(() => setSliding([...exit.tasks.keys()], true), lingerMs),
      window.setTimeout(() => {
        exits.current.delete(exit);
        setSliding([...exit.tasks.keys()], false);
        removeRows([...exit.tasks.values()]);
        afterRemove?.();
      }, lingerMs + ROW_EXIT_MS),
    );
    exits.current.add(exit);
  }

  /** Keeps the given rows (all when omitted) in the list. */
  function stopRowExits(taskIds?: readonly string[]): void {
    const stopped: string[] = [];
    for (const exit of exits.current) {
      for (const id of taskIds ?? [...exit.tasks.keys()]) {
        if (exit.tasks.delete(id)) stopped.push(id);
      }
      if (exit.tasks.size === 0) {
        exit.timers.forEach((timer) => window.clearTimeout(timer));
        exits.current.delete(exit);
      }
    }
    if (stopped.length > 0) setSliding(stopped, false);
  }

  return { exitingTaskIds, exitRows, stopRowExits };
}
