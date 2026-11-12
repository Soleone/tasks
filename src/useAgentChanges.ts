import { useCallback, useEffect, useRef, useState } from "react";
import type { TaskView } from "@/components/taskView";
import { lensFilter } from "@/components/listLens";
import { listAgentChanges, listTasks, type AgentChange } from "@/platform/backendClient";
import { readPreference, writePreference } from "@/platform/preferences";

const SEEN_KEY = "tasks.agentChangesSeen";
const DAY_MS = 24 * 60 * 60 * 1000;

type AgentChanges = {
  /** The newest unseen change per task, newest first. */
  changes: readonly AgentChange[];
  /** How many of those tasks still exist, which is what the lens can show. */
  total: number;
  /** Everything listed counts as looked at from here on. */
  markSeen: () => void;
};

const NONE: readonly AgentChange[] = [];

/**
 * What agents changed since you last looked, for the header count and its lens. It asks again
 * whenever the loaded list changes, which is how a write from the CLI arrives. A device that never
 * looked starts a day back.
 */
export function useAgentChanges(listTasksShown: readonly TaskView[]): AgentChanges {
  const [seen, setSeen] = useState(() => readPreference(SEEN_KEY));
  const [found, setFound] = useState({ changes: NONE, total: 0 });
  const changesRef = useRef(NONE);
  const querySequence = useRef(0);

  useEffect(() => {
    const sequence = ++querySequence.current;
    void (async () => {
      try {
        const changes = await listAgentChanges(seen ?? new Date(Date.now() - DAY_MS).toISOString());
        const taskIds = changes.map((change) => change.taskId);
        const { statuses, ...bounds } = lensFilter({ kind: "agents", taskIds });
        const total =
          changes.length === 0
            ? 0
            : (await listTasks(statuses, 0, false, undefined, { ...bounds, limit: 1 })).total;
        if (sequence !== querySequence.current) return;
        changesRef.current = changes;
        setFound({ changes, total });
      } catch {
        // The list reports backend failures; the count keeps its last answer.
      }
    })();
  }, [listTasksShown, seen]);

  const markSeen = useCallback(() => {
    const newest = changesRef.current[0]?.at;
    if (newest === undefined) return;
    writePreference(SEEN_KEY, newest);
    setSeen(newest);
  }, []);

  return { ...found, markSeen };
}
