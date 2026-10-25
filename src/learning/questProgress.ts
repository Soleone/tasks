import { useMemo, useSyncExternalStore } from "react";
import { CirclePause } from "lucide-react";
import { showTaskToast } from "@/components/TaskToaster";
import { readPreference, writePreference } from "@/platform/preferences";
import { currentDevice, movesFor, type MoveId } from "./moves";
import { questsFor, resumeStep, type Quest, type QuestId, type QuestStep } from "./quests";

const PROGRESS_KEY = "tasks.questProgress";
const SHOW_KEY = "tasks.showQuests";
// How long a step's success line shows (`quest.success`) and a finished quest's card stays.
const SUCCESS_MS = 1000;
const COMPLETE_MS = 5000;

/** What is saved: the quest under way, the step each started quest is at, and the finished ones. */
type Stored = {
  active: QuestId | null;
  steps: Partial<Record<QuestId, number>>;
  complete: QuestId[];
};

/** A reward the card is showing right now. */
type QuestMoment =
  | { kind: "success"; line: string; tryKeys?: readonly string[] }
  | { kind: "complete"; quest: QuestId };

type QuestState = "new" | "active" | "paused" | "complete";
export type QuestView = Quest & { state: QuestState; step: number };

const listeners = new Set<() => void>();
let moment: QuestMoment | null = null;
let momentTimer: ReturnType<typeof setTimeout> | undefined;
// Editor steps done before their turn in this editor, so typing `#` before `@` still counts.
let ahead: readonly number[] = [];
// What React reads of the two above; replaced on every change so it sees one.
let live: { moment: QuestMoment | null; ahead: readonly number[] } = { moment, ahead };

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  live = { moment, ahead };
  for (const listener of listeners) listener();
}

function storedProgress(): string {
  return readPreference(PROGRESS_KEY) ?? "";
}

function liveSnapshot(): typeof live {
  return live;
}

function questsShown(): boolean {
  return readPreference(SHOW_KEY) !== "off";
}

function parse(text: string): Stored {
  try {
    const value = JSON.parse(text) as Partial<Stored> | null;
    return {
      active: value?.active ?? null,
      steps: value?.steps ?? {},
      complete: Array.isArray(value?.complete) ? value.complete : [],
    };
  } catch {
    return { active: null, steps: {}, complete: [] };
  }
}

function read(): Stored {
  return parse(storedProgress());
}

function write(stored: Stored): void {
  writePreference(PROGRESS_KEY, JSON.stringify(stored));
}

function untouched(stored: Stored): boolean {
  return (
    stored.active === null && Object.keys(stored.steps).length === 0 && !stored.complete.length
  );
}

function showMoment(next: QuestMoment | null, ms = SUCCESS_MS): void {
  clearTimeout(momentTimer);
  moment = next;
  if (next)
    momentTimer = setTimeout(() => {
      moment = null;
      notify();
    }, ms);
}

/** The keys a step shows on this device, if it has any. */
export function stepKeys(step: QuestStep): readonly string[] | undefined {
  return step.keys ?? movesFor(currentDevice()).find((move) => move.id === step.move)?.keys;
}

/** Puts the quest under way aside where its prompt still makes sense. */
function setAside(stored: Stored, quests: Quest[]): Stored {
  const quest = quests.find((entry) => entry.id === stored.active);
  if (!quest) return stored;
  ahead = [];
  return {
    ...stored,
    active: null,
    steps: { ...stored.steps, [quest.id]: resumeStep(quest.steps, stored.steps[quest.id] ?? 0) },
  };
}

type Quests = {
  quests: QuestView[];
  active: QuestView | null;
  /** The first quest, while nothing was ever started or put aside and quests are shown. */
  offer: Quest | null;
  moment: QuestMoment | null;
  /** Steps of the active quest done ahead of their turn. */
  ahead: readonly number[];
  shown: boolean;
};

export function useQuests(): Quests {
  const stored = useSyncExternalStore(subscribe, storedProgress);
  const shown = useSyncExternalStore(subscribe, questsShown);
  const current = useSyncExternalStore(subscribe, liveSnapshot);
  return useMemo(() => {
    const progress = parse(stored);
    const quests = questsFor(currentDevice()).map((quest): QuestView => {
      const step = progress.steps[quest.id];
      const state: QuestState =
        progress.active === quest.id
          ? "active"
          : step !== undefined
            ? "paused"
            : progress.complete.includes(quest.id)
              ? "complete"
              : "new";
      return { ...quest, state, step: step ?? 0 };
    });
    return {
      quests,
      active: quests.find((quest) => quest.state === "active") ?? null,
      offer: shown && untouched(progress) ? (quests[0] ?? null) : null,
      moment: current.moment,
      ahead: current.ahead,
      shown,
    };
  }, [stored, shown, current]);
}

/** Records a move for the quest under way (`quest.step`); doing the offered step starts it. */
export function advanceQuest(move: MoveId, via: "keys" | "pointer", detail?: string): void {
  const quests = questsFor(currentDevice());
  let stored = read();
  const first = quests[0];
  if (first && untouched(stored) && questsShown() && first.steps[0]?.move === move)
    stored = { ...stored, active: first.id, steps: { [first.id]: 0 } };
  const quest = quests.find((entry) => entry.id === stored.active);
  if (!quest) return;
  let index = stored.steps[quest.id] ?? 0;
  const opener = resumeStep(quest.steps, index);
  // The editor opened again for a step that was left inside it.
  if (opener !== index && quest.steps[opener]?.move === move) {
    index = opener;
    ahead = [];
  }
  const step = quest.steps[index];
  if (!step) return;
  const tryKeys = via === "pointer" && currentDevice() === "keyboard" ? stepKeys(step) : undefined;
  const line = (done: QuestStep) => done.success.replace("{}", detail ?? "");
  if (step.move !== move) {
    const later = laterEditorStep(quest.steps, index, move);
    if (later === null) return;
    ahead = [...ahead, later];
    showMoment({ kind: "success", line: line(quest.steps[later]!), tryKeys });
    notify();
    return;
  }
  let next = index + 1;
  while (ahead.includes(next)) next += 1;
  ahead = [];
  if (next >= quest.steps.length) {
    const steps = { ...stored.steps };
    delete steps[quest.id];
    write({
      active: null,
      steps,
      complete: [...stored.complete.filter((id) => id !== quest.id), quest.id],
    });
    showMoment({ kind: "complete", quest: quest.id }, COMPLETE_MS);
  } else {
    write({ ...stored, steps: { ...stored.steps, [quest.id]: next } });
    showMoment({ kind: "success", line: line(step), tryKeys });
  }
  notify();
}

// A later step in the same stretch of editor steps, not yet done ahead.
function laterEditorStep(steps: readonly QuestStep[], index: number, move: MoveId): number | null {
  if (!steps[index]?.inEditor) return null;
  for (let later = index + 1; steps[later]?.inEditor; later += 1)
    if (steps[later]!.move === move && !ahead.includes(later)) return later;
  return null;
}

/** The editor closed: a step inside it goes back to the step that opens it (`quest.resume`). */
export function leaveEditor(): void {
  const stored = read();
  const quest = questsFor(currentDevice()).find((entry) => entry.id === stored.active);
  if (!quest) return;
  const step = stored.steps[quest.id] ?? 0;
  const opener = resumeStep(quest.steps, step);
  if (opener === step && !ahead.length) return;
  ahead = [];
  write({ ...stored, steps: { ...stored.steps, [quest.id]: opener } });
  notify();
}

/** Starts a quest from its first step (`quest.one-at-a-time`). */
export function startQuest(id: QuestId): void {
  const stored = setAside(read(), questsFor(currentDevice()));
  showMoment(null);
  write({ ...stored, active: id, steps: { ...stored.steps, [id]: 0 } });
  notify();
}

/** Picks a paused quest up where it was left (`quest.resume`). */
export function resumeQuest(id: QuestId): void {
  const stored = setAside(read(), questsFor(currentDevice()));
  showMoment(null);
  write({ ...stored, active: id, steps: { ...stored.steps, [id]: stored.steps[id] ?? 0 } });
  notify();
}

/** Later, or Pause quest: the quest under way, or the offered one, waits for `?` (`quest.pause`). */
export function pauseQuest(): void {
  const quests = questsFor(currentDevice());
  const stored = read();
  const first = quests[0];
  if (stored.active) write(setAside(stored, quests));
  else if (first && untouched(stored)) write({ ...stored, steps: { [first.id]: 0 } });
  else return;
  showMoment(null);
  notify();
  showTaskToast("Quest paused. Pick it up from ? whenever you like.", { icon: CirclePause });
}

export function dismissMoment(): void {
  showMoment(null);
  notify();
}

/** Show quests (`learn.quests`). Turning it off puts the quest under way aside, quietly. */
export function setQuestsShown(on: boolean): void {
  writePreference(SHOW_KEY, on ? "on" : "off");
  if (!on) {
    write(setAside(read(), questsFor(currentDevice())));
    showMoment(null);
  }
  notify();
}

export function resetQuests(): void {
  write({ active: null, steps: {}, complete: [] });
  ahead = [];
  showMoment(null);
  notify();
}
