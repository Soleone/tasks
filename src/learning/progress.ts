import { useMemo, useSyncExternalStore } from "react";
import { Keyboard, Trophy } from "lucide-react";
import { showTaskToast } from "@/components/TaskToaster";
import { readPreference, writePreference } from "@/platform/preferences";
import { currentDevice, movesFor, type Move, type MoveId } from "./moves";

const LEARNED_MOVES_KEY = "tasks.learnedMoves";
const HINTS_KEY = "tasks.hints";

const listeners = new Set<() => void>();
// Moves whose pointer tip already showed this session (`learn.pointer-tip`).
const tipped = new Set<MoveId>();

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

function hintsOn(): boolean {
  return readPreference(HINTS_KEY) !== "off";
}

export type Learning = {
  /** This device's moves, in chapter order. */
  moves: Move[];
  learned: ReadonlySet<string>;
  learnedCount: number;
  hints: boolean;
};

export function useLearning(): Learning {
  const stored = useSyncExternalStore(subscribe, storedLearned);
  const hints = useSyncExternalStore(subscribe, hintsOn);
  return useMemo(() => {
    const learned = parseLearned(stored);
    const moves = movesFor(currentDevice());
    return {
      moves,
      learned,
      learnedCount: moves.filter((move) => learned.has(move.id)).length,
      hints,
    };
  }, [stored, hints]);
}

/**
 * Records that a move was performed (`learn.practice`). On a keyboard device the mouse doesn't
 * learn a move; it earns a tip naming the keys instead.
 */
export function practice(id: MoveId, via: "keys" | "pointer" = "keys"): void {
  const device = currentDevice();
  const moves = movesFor(device);
  const move = moves.find((entry) => entry.id === id);
  const learned = parseLearned(storedLearned());
  if (!move || learned.has(id)) return;
  if (via === "pointer" && device === "keyboard") {
    tip(move);
    return;
  }
  const next = new Set(learned).add(id);
  writePreference(LEARNED_MOVES_KEY, JSON.stringify([...next]));
  notify();
  if (hintsOn()) celebrate(move, moves, next);
}

function tip(move: Move): void {
  if (!hintsOn() || !move.keys || tipped.has(move.id)) return;
  tipped.add(move.id);
  showTaskToast(`Next time, press ${move.keys.join("+")}`, { icon: Keyboard });
}

function celebrate(move: Move, moves: Move[], learned: ReadonlySet<string>): void {
  if (moves.every((entry) => learned.has(entry.id)))
    showTaskToast("Every move learned", { icon: Trophy });
  else if (moves.every((entry) => entry.chapter !== move.chapter || learned.has(entry.id)))
    showTaskToast(`${move.chapter} chapter complete`, { icon: Trophy });
}

export function setHints(on: boolean): void {
  writePreference(HINTS_KEY, on ? "on" : "off");
  notify();
}

export function resetProgress(): void {
  writePreference(LEARNED_MOVES_KEY, "[]");
  tipped.clear();
  notify();
}
