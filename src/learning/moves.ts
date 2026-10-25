import { isAndroid } from "@/platform/runtime";

/** Keyboard devices learn shortcuts; touch devices learn taps and gestures. */
export type Device = "keyboard" | "touch";

export const CHAPTERS = ["Capture", "Editor", "Work", "Find", "Shape", "Look back"] as const;
type Chapter = (typeof CHAPTERS)[number];

/**
 * How one device learns a move. Text in backticks shows as keys. A nudge is the editor's
 * one-line lesson for the move (`learn.nudge`).
 */
type Lesson = { label: string; keys?: readonly string[]; nudge?: string };

type MoveDefinition = {
  id: string;
  chapter: Chapter;
  keyboard?: Lesson;
  touch?: Lesson;
};

// Each id is the spec rule the move performs. Within a chapter, moves are listed in teaching order.
const MOVE_DEFINITIONS = [
  {
    id: "capture.open",
    chapter: "Capture",
    keyboard: { label: "New task", keys: ["C"] },
    touch: { label: "Tap + for a new task" },
  },
  {
    id: "shorthand.category",
    chapter: "Capture",
    keyboard: {
      label: "Set a category while typing",
      keys: ["@"],
      nudge: "Type `@` and a word to set a category, like `@home`",
    },
    touch: {
      label: "Tap @ above the keyboard for a category",
      nudge: "Tap `@` above the keyboard to set a category",
    },
  },
  {
    id: "shorthand.tags",
    chapter: "Capture",
    keyboard: {
      label: "Add tags while typing",
      keys: ["#"],
      nudge: "Add tags with `#`, as many as you like",
    },
    touch: { label: "Tap # for tags", nudge: "Tap `#` above the keyboard to add tags" },
  },
  {
    id: "shorthand.due",
    chapter: "Capture",
    keyboard: {
      label: "Set a due date while typing",
      keys: ["^"],
      nudge: "Give it a due date with `^`, like `^fri` or `^3d`",
    },
    touch: {
      label: "Tap ^ for a due date",
      nudge: "Tap `^` above the keyboard to pick a due date",
    },
  },
  {
    id: "shorthand.tab",
    chapter: "Editor",
    keyboard: {
      label: "Complete a suggestion",
      keys: ["Tab"],
      nudge: "`Tab` completes a suggestion, and a second `Tab` picks it",
    },
  },
  {
    id: "edit.priority",
    chapter: "Editor",
    keyboard: {
      label: "Set priority in the editor",
      keys: ["Tab", "0–4"],
      nudge: "Press `Tab` for priority, then `0`–`4`",
    },
  },
  {
    id: "shorthand.unlift",
    chapter: "Editor",
    keyboard: {
      label: "Put a pill back as text",
      keys: ["Backspace"],
      nudge: "`Backspace` right after a pill puts it back as text",
    },
  },
  {
    id: "status.forward",
    chapter: "Work",
    keyboard: { label: "Start, then finish the active task", keys: ["Space"] },
    touch: { label: "Tap a status icon to start or finish a task" },
  },
  {
    id: "home.open-editor",
    chapter: "Work",
    keyboard: { label: "Edit the active task", keys: ["Enter"] },
    touch: { label: "Tap a task to edit it" },
  },
  {
    id: "priority.set",
    chapter: "Work",
    keyboard: { label: "Set priority from the list", keys: ["0–4"] },
  },
  {
    id: "status.pause",
    chapter: "Work",
    keyboard: { label: "Pause or resume", keys: ["P"] },
  },
  {
    id: "home.task-context-menu",
    chapter: "Work",
    touch: { label: "Long-press a task for its actions" },
  },
  {
    id: "undo.latest",
    chapter: "Work",
    keyboard: { label: "Undo", keys: ["Ctrl/⌘", "Z"] },
  },
  {
    id: "filter.mode",
    chapter: "Find",
    keyboard: { label: "Filter, then a key", keys: ["F"] },
  },
  {
    id: "sort.mode",
    chapter: "Find",
    keyboard: { label: "Sort, then a key", keys: ["S"] },
  },
  {
    id: "filter.search",
    chapter: "Find",
    keyboard: { label: "Search", keys: ["/"] },
  },
  {
    id: "filter.category",
    chapter: "Find",
    keyboard: { label: "Filter by category", keys: ["@"] },
  },
  {
    id: "filter.escape",
    chapter: "Find",
    keyboard: { label: "Reset filters", keys: ["Esc"] },
  },
  {
    id: "capture.child",
    chapter: "Shape",
    keyboard: { label: "New child of the active task", keys: ["Shift", "C"] },
  },
  {
    id: "pick.parent",
    chapter: "Shape",
    keyboard: { label: "Move under another task", keys: ["M"] },
  },
  {
    id: "pick.blocker",
    chapter: "Shape",
    keyboard: { label: "Add or remove a blocker", keys: ["B"] },
  },
  {
    id: "select.extend",
    chapter: "Shape",
    keyboard: { label: "Select several tasks", keys: ["Shift", "↑↓"] },
  },
  {
    id: "reorder.step",
    chapter: "Shape",
    keyboard: { label: "Reorder", keys: ["Ctrl/⌘", "↑↓"] },
  },
  {
    id: "done.lens",
    chapter: "Look back",
    keyboard: { label: "What you finished today", keys: ["D"] },
    touch: { label: "Tap the done count to see today's work" },
  },
  {
    id: "due.lens",
    chapter: "Look back",
    keyboard: { label: "What's due now", keys: ["N"] },
    touch: { label: "Tap the due count to see what's due" },
  },
  {
    id: "details.toggle-active",
    chapter: "Look back",
    keyboard: { label: "Show details of the active task", keys: ["V"] },
  },
  {
    id: "help.palette",
    chapter: "Look back",
    keyboard: { label: "Every shortcut", keys: ["Ctrl/⌘", "K"] },
  },
] as const satisfies readonly MoveDefinition[];

export type MoveId = (typeof MOVE_DEFINITIONS)[number]["id"];

/** A move as one device learns it. */
export type Move = Lesson & { id: MoveId; chapter: Chapter };

export function currentDevice(): Device {
  return isAndroid() ? "touch" : "keyboard";
}

/** This device's moves, in chapter order. */
export function movesFor(device: Device): Move[] {
  return CHAPTERS.flatMap((chapter) =>
    MOVE_DEFINITIONS.flatMap((definition: MoveDefinition) => {
      const lesson = definition[device];
      return definition.chapter === chapter && lesson
        ? [{ ...lesson, id: definition.id as MoveId, chapter }]
        : [];
    }),
  );
}
