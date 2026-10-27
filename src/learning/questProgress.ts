import { useMemo, useSyncExternalStore } from "react";
import { CirclePause } from "lucide-react";
import { showTaskToast } from "@/components/TaskToaster";
import { readPreference, writePreference } from "@/platform/preferences";
import { currentDevice, movesFor, type MoveId } from "./moves";
import { questsFor, type Quest, type QuestId, type QuestStep } from "./quests";

const PROGRESS_KEY = "tasks.questProgress";
const SHOW_KEY = "tasks.showQuests";
const WELCOMED_KEY = "tasks.welcomed";
// How long a step's success line shows (`quest.success`) and a finished quest's card stays.
const SUCCESS_MS = 1500;
const COMPLETE_MS = 5000;
// Matches quest-card-leave in styles.css.
const LEAVE_MS = 300;
// Matches quest-card-welcome in styles.css.
const WELCOME_MS = 2800;

/** What is saved: the quest under way, the step each started quest is at, and the finished ones. */
type Stored = {
  active: QuestId | null;
  steps: Partial<Record<QuestId, number>>;
  complete: QuestId[];
};

/** A reward the card is showing right now. */
type QuestMoment =
  | { kind: "success"; line: string; tryKeys?: readonly string[] }
  | { kind: "complete"; quest: QuestId; leaving?: boolean };

type QuestState = "new" | "active" | "paused" | "complete";
export type QuestView = Quest & { state: QuestState; step: number };

const listeners = new Set<() => void>();
let moment: QuestMoment | null = null;
let momentTimer: ReturnType<typeof setTimeout> | undefined;
// Editor steps done before their turn in this editor, so typing `#` before `@` still counts.
let ahead: readonly number[] = [];
let editorOpen = false;
// The welcome is playing on the card (`quest.welcome`).
let welcome = false;
let welcomeTimer: ReturnType<typeof setTimeout> | undefined;
// What React reads of the four above; replaced on every change so it sees one.
let live: {
  moment: QuestMoment | null;
  ahead: readonly number[];
  editorOpen: boolean;
  welcome: boolean;
} = { moment, ahead, editorOpen, welcome };

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  live = { moment, ahead, editorOpen, welcome };
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

/** The first unfinished quest, while quests are shown and none is under way or put aside. */
function offered(stored: Stored, quests: Quest[], shown: boolean): Quest | null {
  if (!shown || stored.active !== null || Object.keys(stored.steps).length) return null;
  return quests.find((quest) => !stored.complete.includes(quest.id)) ?? null;
}

function showMoment(next: QuestMoment | null, ms = SUCCESS_MS): void {
  clearTimeout(momentTimer);
  moment = next;
  if (next)
    momentTimer = setTimeout(() => {
      if (moment?.kind === "complete" && !moment.leaving) return dismissComplete();
      moment = null;
      notify();
    }, ms);
}

/** The keys a step shows on this device, if it has any. */
export function stepKeys(step: QuestStep): readonly string[] | undefined {
  return step.keys ?? movesFor(currentDevice()).find((move) => move.id === step.move)?.keys;
}

/** Puts the quest under way aside at its step. */
function setAside(stored: Stored): Stored {
  if (!stored.active) return stored;
  ahead = [];
  return { ...stored, active: null };
}

type Quests = {
  quests: QuestView[];
  active: QuestView | null;
  /** The first unfinished quest, while none is under way or put aside (`quest.offer`). */
  offer: Quest | null;
  moment: QuestMoment | null;
  /** Steps of the active quest done ahead of their turn. */
  ahead: readonly number[];
  editorOpen: boolean;
  welcome: boolean;
  shown: boolean;
  /** Every quest on this device is complete, so the help icon is plain (`learn.progress-ring`). */
  allComplete: boolean;
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
      offer: offered(progress, quests, shown),
      moment: current.moment,
      ahead: current.ahead,
      editorOpen: current.editorOpen,
      welcome: current.welcome,
      shown,
      allComplete: quests.every((quest) => progress.complete.includes(quest.id)),
    };
  }, [stored, shown, current]);
}

function playWelcome(): void {
  clearTimeout(welcomeTimer);
  welcome = true;
  welcomeTimer = setTimeout(endWelcome, WELCOME_MS);
  notify();
}

function endWelcome(): void {
  clearTimeout(welcomeTimer);
  welcome = false;
  notify();
}

/** The first time a quest card shows on this Tasks home, it opens with the welcome (`quest.welcome`). */
export function welcomeOnce(): void {
  if (readPreference(WELCOMED_KEY) === "yes") return;
  writePreference(WELCOMED_KEY, "yes");
  playWelcome();
}

/** Replay welcome in the palette: over the card showing, or Task basics where it was left. */
export function replayWelcome(): void {
  const stored = read();
  const quests = questsFor(currentDevice());
  if (!stored.active && !offered(stored, quests, questsShown())) resumeQuest(quests[0]!.id);
  playWelcome();
}

/** Records a move for the quest under way (`quest.step`); doing the offered step starts it. */
export function advanceQuest(move: MoveId, via: "keys" | "pointer", detail?: string): void {
  const quests = questsFor(currentDevice());
  let stored = read();
  const offer = offered(stored, quests, questsShown());
  if (offer?.steps[0]?.move === move)
    stored = { ...stored, active: offer.id, steps: { [offer.id]: 0 } };
  const quest = quests.find((entry) => entry.id === stored.active);
  if (!quest) return;
  const index = stored.steps[quest.id] ?? 0;
  const step = quest.steps[index];
  if (!step) return;
  const tryKeys = via === "pointer" && currentDevice() === "keyboard" ? stepKeys(step) : undefined;
  const line = (done: QuestStep) => done.success.replace("{}", detail ?? "");
  if (step.move !== move) {
    // Saving closes the editor, so a save ahead of its turn would only be forgotten.
    const later = move === "capture.save" ? null : laterEditorStep(quest.steps, index, move);
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

/** The editor opened, so an editor step's own prompt shows (`quest.reopen`). */
export function enterEditor(): void {
  editorOpen = true;
  notify();
}

/** The editor closed: steps done ahead in it are forgotten, the rest stay done (`quest.reopen`). */
export function leaveEditor(): void {
  editorOpen = false;
  ahead = [];
  notify();
}

/** Starts a quest from its first step (`quest.one-at-a-time`). */
export function startQuest(id: QuestId): void {
  const stored = setAside(read());
  showMoment(null);
  write({ ...stored, active: id, steps: { ...stored.steps, [id]: 0 } });
  notify();
}

/** Picks a paused quest up where it was left (`quest.resume`). */
export function resumeQuest(id: QuestId): void {
  const stored = setAside(read());
  showMoment(null);
  write({ ...stored, active: id, steps: { ...stored.steps, [id]: stored.steps[id] ?? 0 } });
  notify();
}

/** Later, or Pause quest: the quest under way, or the offered one, waits for `?` (`quest.pause`). */
export function pauseQuest(): void {
  const stored = read();
  const offer = offered(stored, questsFor(currentDevice()), questsShown());
  if (stored.active) write(setAside(stored));
  else if (offer) write({ ...stored, steps: { [offer.id]: 0 } });
  else return;
  showMoment(null);
  endWelcome();
  showTaskToast("Quest paused. Pick it up from ? whenever you like.", { icon: CirclePause });
}

/** Sends a finished quest's card off to the right; the next quest's offer comes up after it. */
export function dismissComplete(): void {
  if (moment?.kind !== "complete" || moment.leaving) return;
  showMoment({ ...moment, leaving: true }, LEAVE_MS);
  notify();
}

/** Show quests (`learn.quests`). Turning it off puts the quest under way aside, quietly. */
export function setQuestsShown(on: boolean): void {
  writePreference(SHOW_KEY, on ? "on" : "off");
  if (!on) {
    write(setAside(read()));
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
