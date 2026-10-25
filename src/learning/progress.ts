import { useMemo, useSyncExternalStore } from "react";
import { readPreference, writePreference } from "@/platform/preferences";
import { currentDevice, movesFor, type Move, type MoveId } from "./moves";
import { advanceQuest, resetQuests } from "./questProgress";

const LEARNED_MOVES_KEY = "tasks.learnedMoves";

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) listener();
}

// The stored string is the snapshot, so React sees a change only when the preference changes.
function storedLearned(): string {
  return readPreference(LEARNED_MOVES_KEY) ?? "[]";
}

function parseLearned(stored: string): ReadonlySet<string> {
  try {
    const value: unknown = JSON.parse(stored);
    return new Set(Array.isArray(value) ? value.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export type Learning = {
  /** This device's moves. */
  moves: Move[];
  learned: ReadonlySet<string>;
  learnedCount: number;
};

export function useLearning(): Learning {
  const stored = useSyncExternalStore(subscribe, storedLearned);
  return useMemo(() => {
    const learned = parseLearned(stored);
    const moves = movesFor(currentDevice());
    return { moves, learned, learnedCount: moves.filter((move) => learned.has(move.id)).length };
  }, [stored]);
}

/**
 * Records that a move was performed: it counts for the quest under way (`quest.step`), and is
 * learned (`learn.practice`) unless the mouse did it on a keyboard device (`quest.pointer`).
 * `detail` is what was typed, for the step's success line.
 */
export function practice(id: MoveId, via: "keys" | "pointer" = "keys", detail?: string): void {
  advanceQuest(id, via, detail);
  const device = currentDevice();
  if (via === "pointer" && device === "keyboard") return;
  const learned = parseLearned(storedLearned());
  if (learned.has(id) || !movesFor(device).some((move) => move.id === id)) return;
  writePreference(LEARNED_MOVES_KEY, JSON.stringify([...learned, id]));
  notify();
}

/** Forgets every learned move and every quest's progress (`learn.reset`). */
export function resetProgress(): void {
  writePreference(LEARNED_MOVES_KEY, "[]");
  notify();
  resetQuests();
}
