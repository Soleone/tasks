import { useEffect, useRef, useState } from "react";

/** Delay between rows of a batch's sheen (--sheen-step in styles.css). */
const SHEEN_STEP_MS = 90;
/** Later rows of a large batch join the last step instead of waiting their turn. */
const LAST_SHEEN_STEP = 8;
/** One sheen (task-completion-sheen in styles.css). */
const SHEEN_MS = 520;
/** How long a completed row stays put once its check has drawn, before it slides out. */
const COMPLETION_LINGER_MS = 320;

const waveStep = (step: number): number => Math.min(step, LAST_SHEEN_STEP) * SHEEN_STEP_MS;

/** How long the row at `step` in a completed batch stays before it slides out of the view. */
export function completionExitLinger(step: number): number {
  return COMPLETION_LINGER_MS + waveStep(step);
}

/**
 * Rows this client just completed, each with its step in the wave. Marks clear
 * once the wave is over, so a remount (scroll, filter, refresh) never replays it.
 */
export function useCompletionSheen() {
  const [sheenSteps, setSheenSteps] = useState<ReadonlyMap<string, number>>(() => new Map());
  const timers = useRef(new Set<number>());

  useEffect(() => {
    const running = timers.current;
    return () => running.forEach((timer) => window.clearTimeout(timer));
  }, []);

  function playSheen(taskIds: readonly string[]): void {
    if (taskIds.length === 0) return;
    setSheenSteps((previous) => {
      const next = new Map(previous);
      taskIds.forEach((id, index) => next.set(id, Math.min(index, LAST_SHEEN_STEP)));
      return next;
    });
    const timer = window.setTimeout(
      () => {
        timers.current.delete(timer);
        setSheenSteps((previous) => {
          const next = new Map(previous);
          for (const id of taskIds) next.delete(id);
          return next;
        });
      },
      SHEEN_MS + waveStep(taskIds.length - 1),
    );
    timers.current.add(timer);
  }

  return { sheenSteps, playSheen };
}
