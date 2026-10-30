import { isAndroid, keyName, modKey } from "@/platform/runtime";

/** Keyboard devices learn shortcuts; touch devices learn taps and gestures. */
export type Device = "keyboard" | "touch";

/** How one device learns a move. */
type Lesson = { label: string; keys?: readonly string[] };

type MoveDefinition = {
  id: string;
  keyboard?: Lesson;
  touch?: Lesson;
};

// Each id is the spec rule the move performs. The quests decide the teaching order.
const MOVE_DEFINITIONS = [
  {
    id: "capture.open",
    keyboard: { label: "New task", keys: ["C"] },
    touch: { label: "Tap + for a new task" },
  },
  {
    id: "shorthand.category",
    keyboard: { label: "Set a category while typing", keys: ["@"] },
    touch: { label: "Tap @ above the keyboard for a category" },
  },
  {
    id: "shorthand.tags",
    keyboard: { label: "Add tags while typing", keys: ["#"] },
    touch: { label: "Tap # for tags" },
  },
  {
    id: "capture.save",
    keyboard: { label: "Save the editor", keys: ["Enter"] },
    touch: { label: "Save a task" },
  },
  {
    id: "shorthand.due",
    keyboard: { label: "Set a due date while typing", keys: ["!"] },
    touch: { label: "Tap ! for a due date" },
  },
  {
    id: "shorthand.tab",
    keyboard: { label: "Complete a suggestion", keys: ["Tab"] },
  },
  {
    id: "edit.description",
    keyboard: { label: "Write a description", keys: ["Tab"] },
  },
  {
    id: "attach.paste",
    keyboard: { label: "Paste an image", keys: [modKey, "V"] },
  },
  {
    id: "shorthand.unlift",
    keyboard: { label: "Put a pill back as text", keys: ["Backspace"] },
  },
  {
    id: "status.forward",
    keyboard: { label: "Start, then complete the active task", keys: ["Space"] },
    touch: { label: "Tap a status icon to start or complete a task" },
  },
  {
    id: "home.open-editor",
    keyboard: { label: "Edit the active task", keys: ["Enter"] },
    touch: { label: "Tap a task to edit it" },
  },
  {
    id: "priority.set",
    keyboard: { label: "Set priority from the list", keys: ["0–4"] },
  },
  {
    id: "effort.set",
    keyboard: { label: "Make a task bigger or smaller", keys: ["[", "]"] },
    touch: { label: "Long-press a task to set its effort" },
  },
  {
    id: "status.back",
    keyboard: { label: "Step a status back", keys: ["Shift", "Space"] },
  },
  {
    id: "status.cancel",
    keyboard: { label: "Cancel a task", keys: ["Delete"] },
  },
  {
    id: "status.pause",
    keyboard: { label: "Pause or resume", keys: ["P"] },
  },
  {
    id: "home.task-context-menu",
    touch: { label: "Long-press a task for its actions" },
  },
  {
    id: "undo.latest",
    keyboard: { label: "Undo", keys: [modKey, "Z"] },
  },
  {
    id: "filter.mode",
    keyboard: { label: "Filter, then a key", keys: ["F"] },
  },
  {
    id: "sort.mode",
    keyboard: { label: "Sort, then a key", keys: ["S"] },
  },
  {
    id: "sort.priority",
    keyboard: { label: "Most urgent first", keys: ["S", "P"] },
  },
  {
    id: "sort.effort",
    keyboard: { label: "Biggest first", keys: ["S", "E"] },
  },
  {
    id: "filter.search",
    keyboard: { label: "Search", keys: ["/"] },
  },
  {
    id: "filter.category",
    keyboard: { label: "Filter by category", keys: ["@"] },
  },
  {
    id: "filter.tags",
    keyboard: { label: "Filter by tag", keys: ["#"] },
  },
  {
    id: "filter.escape",
    keyboard: { label: "Reset filters", keys: ["Esc"] },
  },
  {
    id: "capture.child",
    keyboard: { label: "New child of the active task", keys: ["Shift", "C"] },
  },
  {
    id: "home.arrows",
    keyboard: { label: "Move between tasks", keys: ["↑↓"] },
  },
  {
    id: "home.home-end",
    keyboard: { label: "Jump to the first or last task", keys: ["Home", "End"] },
  },
  {
    id: "home.left-collapse",
    keyboard: { label: "Collapse a parent", keys: ["←"] },
  },
  {
    id: "home.right-category",
    keyboard: { label: "Show only the active task's category", keys: ["→"] },
  },
  {
    id: "home.left-clear-category",
    keyboard: { label: "Show every category again", keys: ["←"] },
  },
  {
    id: "home.right-expand",
    keyboard: { label: "Expand a parent", keys: ["→"] },
  },
  {
    id: "pick.parent",
    keyboard: { label: "Move under another task", keys: ["M"] },
    touch: { label: "Move a task under another" },
  },
  {
    id: "pick.blocker",
    keyboard: { label: "Add or remove a blocker", keys: ["B"] },
    touch: { label: "Mark what blocks a task" },
  },
  {
    id: "select.extend",
    keyboard: { label: "Select several tasks", keys: ["Shift", "↑↓"] },
  },
  {
    id: "reorder.step",
    keyboard: { label: "Reorder", keys: [modKey, "↑↓"] },
  },
  {
    id: "reorder.edge",
    keyboard: { label: "Move to the top or bottom", keys: [modKey, "Home/End"] },
  },
  {
    id: "copy.text",
    keyboard: { label: "Copy the active task's text", keys: [modKey, "C"] },
  },
  {
    id: "attach.copy",
    keyboard: { label: "Copy its newest image", keys: [modKey, "Shift", "C"] },
  },
  {
    id: "done.lens",
    keyboard: { label: "What you've done today", keys: ["D"] },
    touch: { label: "Tap the done count to see today's work" },
  },
  {
    id: "done.lens-window",
    keyboard: { label: "Look further back for done tasks", keys: ["Shift", "D"] },
  },
  {
    id: "due.lens",
    keyboard: { label: "What's due now", keys: ["!"] },
    touch: { label: "Tap the due count to see what's due now" },
  },
  {
    id: "details.toggle-active",
    keyboard: { label: "Show details of the active task", keys: ["V"] },
  },
  {
    id: "details.toggle-all",
    keyboard: { label: "Show details of every task", keys: ["Shift", "V"] },
  },
  {
    id: "help.palette",
    keyboard: { label: "Every shortcut", keys: [modKey, "K"] },
  },
  {
    id: "learn.panel",
    keyboard: { label: "Quests and the keys you've learned", keys: ["?"] },
  },
  {
    id: "theme.picker",
    keyboard: { label: "Pick a theme", keys: [keyName("Alt"), "T"] },
  },
  {
    id: "settings.open",
    keyboard: { label: "Settings", keys: [modKey, ","] },
  },
] as const satisfies readonly MoveDefinition[];

export type MoveId = (typeof MOVE_DEFINITIONS)[number]["id"];

/** A move as one device learns it. */
export type Move = Lesson & { id: MoveId };

export function currentDevice(): Device {
  return isAndroid() ? "touch" : "keyboard";
}

/** This device's moves. */
export function movesFor(device: Device): Move[] {
  return MOVE_DEFINITIONS.flatMap((definition: MoveDefinition) => {
    const lesson = definition[device];
    return lesson ? [{ ...lesson, id: definition.id as MoveId }] : [];
  });
}
