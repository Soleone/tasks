import type { Device, MoveId } from "./moves";

/**
 * One step of a quest (`quest.step`). Text in backticks shows as keys, and `{}` in the success
 * line is what was typed, like the category's name.
 */
export type QuestStep = {
  move: MoveId;
  prompt: string;
  success: string;
  /** The key caps to show, when the move's own keys say too little. */
  keys?: readonly string[];
  /** Done inside the editor, so with the editor closed the card asks to open it first. */
  inEditor?: true;
};

type QuestDefinition = {
  id: string;
  title: string;
  /** What the quest teaches, shown under its offer (`quest.offer`). */
  summary: string;
  keyboard: readonly QuestStep[];
  touch?: readonly QuestStep[];
};

// In teaching order. Each quest builds on the tasks made in the ones before it.
const QUEST_DEFINITIONS = [
  {
    id: "first-task",
    title: "First task",
    summary: "Learn the basics in about two minutes",
    keyboard: [
      {
        move: "capture.open",
        prompt: "Press `C` to create your first task",
        success: "A fresh task",
      },
      {
        move: "shorthand.category",
        prompt:
          "Type what needs doing, then `@` and a word for its category, like `@life`. `Space` selects it, `Enter` saves the task",
        success: "Filed under {}",
        inEditor: true,
      },
      {
        move: "shorthand.tags",
        prompt: "Add a tag with `#`, like `#quick`",
        success: "Tagged {}",
        inEditor: true,
      },
      {
        move: "capture.save",
        prompt: "Press `Enter` to save it",
        success: "Saved",
        inEditor: true,
      },
      { move: "status.forward", prompt: "Press `Space` to start it", success: "In progress" },
      {
        move: "status.forward",
        prompt: "Press `Space` again when it's done",
        success: "Done",
      },
      {
        move: "done.lens",
        prompt: "Press `D` to see what you finished today",
        success: "That's your day so far",
      },
      {
        move: "done.lens",
        prompt: "Press `D` again to go back to your list",
        success: "Back to your list",
      },
    ],
    touch: [
      { move: "capture.open", prompt: "Tap + to create your first task", success: "A fresh task" },
      {
        move: "shorthand.category",
        prompt: "Type what needs doing, then tap `@` above the keyboard and add a category",
        success: "Filed under {}",
        inEditor: true,
      },
      {
        move: "shorthand.tags",
        prompt: "Tap `#` and add a tag",
        success: "Tagged {}",
        inEditor: true,
      },
      { move: "capture.save", prompt: "Save it", success: "Saved", inEditor: true },
      { move: "status.forward", prompt: "Tap its status icon to start it", success: "In progress" },
      { move: "status.forward", prompt: "Tap it again when it's done", success: "Done" },
      {
        move: "done.lens",
        prompt: "Tap the done count up top to see what you finished today",
        success: "That's your day so far",
      },
      {
        move: "done.lens",
        prompt: "Tap the done count again to go back to your list",
        success: "Back to your list",
      },
    ],
  },
  {
    id: "plan-ahead",
    title: "Plan ahead",
    summary: "Due dates, priorities, pausing and undo",
    keyboard: [
      {
        move: "capture.open",
        prompt: "Press `C` for a new task",
        success: "A fresh task",
      },
      {
        move: "shorthand.due",
        prompt: "Type what needs doing, then give it a due date with `^`, like `^today`",
        success: "Due {}",
        inEditor: true,
      },
      {
        move: "capture.save",
        prompt: "Press `Enter` to save it",
        success: "Saved",
        inEditor: true,
      },
      {
        move: "priority.set",
        prompt: "Press a number from `0` to `4` to set its priority. `0` is the most urgent",
        success: "{} it is",
      },
      { move: "status.pause", prompt: "Press `P` to pause it", success: "Paused" },
      {
        move: "undo.latest",
        prompt: "Changed your mind? Press `Ctrl/⌘`+`Z` to undo",
        success: "Undone",
      },
      {
        move: "due.lens",
        prompt: "Press `N` to see everything that's due",
        success: "That's what's due",
      },
      {
        move: "due.lens",
        prompt: "Press `N` again to go back to your list",
        success: "Back to your list",
      },
    ],
    touch: [
      {
        move: "capture.open",
        prompt: "Tap + for a new task",
        success: "A fresh task",
      },
      {
        move: "shorthand.due",
        prompt: "Type what needs doing, then tap `^` and pick a due date",
        success: "Due {}",
        inEditor: true,
      },
      { move: "capture.save", prompt: "Save it", success: "Saved", inEditor: true },
      {
        move: "due.lens",
        prompt: "Tap the due count up top to see everything that's due",
        success: "That's what's due",
      },
      {
        move: "due.lens",
        prompt: "Tap the due count again to go back to your list",
        success: "Back to your list",
      },
    ],
  },
  {
    id: "find-your-way",
    title: "Find your way",
    summary: "Filters, sorting and search",
    keyboard: [
      {
        move: "filter.mode",
        prompt: "Press `F`, then one of the keys it shows to filter the list",
        success: "Filtered",
      },
      {
        move: "sort.mode",
        prompt: "Press `S`, then one of its keys to sort",
        success: "Sorted",
      },
      {
        move: "filter.category",
        prompt: "Press `@` and pick a category to see only its tasks",
        success: "Pick one with `Enter`",
      },
      {
        move: "filter.escape",
        prompt: "Press `Esc` on the list to clear every filter",
        success: "Everything's back",
      },
      {
        move: "filter.search",
        prompt: "Press `/` to search",
        success: "Type to search. `Esc` closes it",
      },
    ],
  },
  {
    id: "shape-your-list",
    title: "Shape your list",
    summary: "Child tasks, blockers and reordering",
    keyboard: [
      {
        move: "capture.child",
        prompt: "Press `Shift`+`C` for a task under the active one",
        success: "A child task",
      },
      {
        move: "capture.save",
        prompt: "Press `Enter` to save it",
        success: "Saved",
        inEditor: true,
      },
      {
        move: "pick.parent",
        prompt: "Press `M` to move the active task under another one",
        success: "Pick its new parent",
      },
      {
        move: "pick.blocker",
        prompt: "Press `B` to say which task blocks the active one",
        success: "Pick what's in the way",
      },
      {
        move: "select.extend",
        prompt: "Hold `Shift` and press `↓` to select more than one task",
        success: "Selected",
      },
      {
        move: "reorder.step",
        prompt: "Press `Ctrl/⌘`+`↑` or `↓` to move tasks up or down",
        success: "Moved",
      },
    ],
    touch: [
      {
        move: "home.task-context-menu",
        prompt: "Long-press a task for everything you can do with it",
        success: "Its actions",
      },
      {
        move: "pick.parent",
        prompt: "Tap Move under, then pick another task",
        success: "Pick its new parent",
      },
      {
        move: "pick.blocker",
        prompt: "Long-press again and tap Blockers",
        success: "Pick what's in the way",
      },
    ],
  },
  {
    id: "fast-hands",
    title: "Fast hands",
    summary: "Quicker edits and every shortcut there is",
    keyboard: [
      {
        move: "home.open-editor",
        prompt: "Press `Enter` to edit the active task",
        success: "Editing",
      },
      {
        move: "shorthand.tab",
        prompt: "Type `@` and the first letters of a category, then `Tab` to complete it",
        success: "Completed",
        inEditor: true,
      },
      {
        move: "shorthand.unlift",
        prompt:
          "Press `Backspace` right after a pill to turn it back into text. `Tab` again makes your completed name a pill",
        success: "Back to text",
        inEditor: true,
      },
      {
        move: "edit.priority",
        prompt: "Press `Tab` until you reach priority, then a number from `0` to `4`",
        success: "Priority set",
        keys: ["Tab", "0–4"],
        inEditor: true,
      },
      { move: "capture.save", prompt: "Press `Enter` to save", success: "Saved", inEditor: true },
      {
        move: "details.toggle-active",
        prompt: "Press `V` to see the active task's details",
        success: "`V` again hides them",
      },
      {
        move: "help.palette",
        prompt: "Press `Ctrl/⌘`+`K` for every shortcut there is",
        success: "It's all in here",
      },
    ],
  },
] as const satisfies readonly QuestDefinition[];

export type QuestId = (typeof QUEST_DEFINITIONS)[number]["id"];

/** A quest as one device plays it. */
export type Quest = { id: QuestId; title: string; summary: string; steps: readonly QuestStep[] };

/** This device's quests, in teaching order. */
export function questsFor(device: Device): Quest[] {
  return QUEST_DEFINITIONS.flatMap((definition: QuestDefinition) => {
    const steps = definition[device];
    const { id, title, summary } = definition;
    return steps ? [{ id: id as QuestId, title, summary, steps }] : [];
  });
}

const REOPEN_STEPS: Record<Device, QuestStep> = {
  keyboard: {
    move: "home.open-editor",
    prompt: "Press `Enter` to open the active task, or `C` for a new one",
    success: "Editing",
  },
  touch: {
    move: "home.open-editor",
    prompt: "Tap a task to open it, or + for a new one",
    success: "Editing",
  },
};

/** Shown in place of an editor step while the editor is closed (`quest.reopen`). */
export function reopenStep(device: Device): QuestStep {
  return REOPEN_STEPS[device];
}
