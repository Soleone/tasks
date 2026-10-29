import type { Device, MoveId } from "./moves";
import { modKey } from "@/platform/runtime";

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
    title: "Task basics",
    summary: "Create, edit and complete a task in about a minute",
    keyboard: [
      {
        move: "capture.open",
        prompt: "Press `C` to create your first task",
        success: "New task",
      },
      {
        move: "capture.save",
        prompt: "Type what needs doing, then press `Enter` to save it",
        success: "Saved",
        inEditor: true,
      },
      { move: "home.open-editor", prompt: "Press `Enter` to change it", success: "Editing" },
      {
        move: "capture.save",
        prompt: "Change what it says, then press `Enter` to save it",
        success: "Saved",
        inEditor: true,
      },
      { move: "status.forward", prompt: "Press `Space` to start the task", success: "In progress" },
      {
        move: "status.forward",
        prompt: "Press `Space` again to complete it",
        success: "Done",
      },
      {
        move: "done.lens",
        prompt: "Press `D` to see what you've done today",
        success: "Done today",
      },
      {
        move: "done.lens",
        prompt: "Press `D` again to go back to your previous view",
        success: "Back where you were",
      },
    ],
    touch: [
      { move: "capture.open", prompt: "Tap + to create your first task", success: "New task" },
      {
        move: "capture.save",
        prompt: "Type what needs doing, then tap Save",
        success: "Saved",
        inEditor: true,
      },
      { move: "home.open-editor", prompt: "Tap the task to change it", success: "Editing" },
      {
        move: "capture.save",
        prompt: "Change what it says, then tap Save",
        success: "Saved",
        inEditor: true,
      },
      { move: "status.forward", prompt: "Tap its status icon to start it", success: "In progress" },
      { move: "status.forward", prompt: "Tap it again to complete it", success: "Done" },
      {
        move: "done.lens",
        prompt: "Tap the done count up top to see what you've done today",
        success: "Done today",
      },
      {
        move: "done.lens",
        prompt: "Tap the done count again to go back to your previous view",
        success: "Back where you were",
      },
    ],
  },
  {
    id: "in-its-place",
    title: "In its place",
    summary: "Categories, and seeing one at a time",
    keyboard: [
      {
        move: "capture.open",
        prompt: "Press `C` for a new task",
        success: "New task",
      },
      {
        move: "shorthand.category",
        prompt:
          "Type what needs doing, then `@` and a word for its category, like `@life`. `Space` turns it into a pill",
        success: "Filed under {}",
        inEditor: true,
      },
      {
        move: "capture.save",
        prompt: "Press `Enter` to save the task. Trailing spaces are trimmed automatically",
        success: "Saved",
        inEditor: true,
      },
      {
        move: "home.right-category",
        prompt: "Press `→` to see only its category",
        success: "Showing {} tasks",
      },
      {
        move: "capture.open",
        prompt: "Press `C` for another task. While you see one category, new tasks start in it",
        success: "New task",
      },
      {
        move: "capture.save",
        prompt: "Type what needs doing, then press `Enter` to save it",
        success: "Saved",
        inEditor: true,
      },
      {
        move: "home.left-clear-category",
        prompt: "Press `←` to see every category again",
        success: "All categories",
      },
      {
        move: "filter.category",
        prompt: "Press `@` and pick a category to see only its tasks",
        success: "Category filter. `Enter` picks one",
      },
      {
        move: "home.left-clear-category",
        prompt: "Press `←` to see every category again",
        success: "All categories",
      },
    ],
    touch: [
      { move: "capture.open", prompt: "Tap + for a new task", success: "New task" },
      {
        move: "shorthand.category",
        prompt: "Type what needs doing, then tap `@` above the keyboard and add a category",
        success: "Filed under {}",
        inEditor: true,
      },
      {
        move: "capture.save",
        prompt: "Tap Save",
        success: "Saved",
        inEditor: true,
      },
    ],
  },
  {
    id: "first-things-first",
    title: "First things first",
    summary: "Priority, effort and sorting by them",
    keyboard: [
      {
        move: "priority.set",
        prompt: "Press a number from `0` to `4` to set the task's priority. `0` is the most urgent",
        success: "Priority set to {}",
      },
      {
        move: "effort.set",
        prompt:
          "Big job or a quick one? Press `]` to make the task bigger or `[` to make it smaller",
        success: "Effort {}",
      },
      {
        move: "sort.priority",
        prompt: "Press `S`, then `P` to put the most urgent first",
        success: "Most urgent first",
      },
      {
        move: "sort.effort",
        prompt: "Press `S`, then `E` to put the biggest first",
        success: "Biggest first",
      },
      {
        move: "sort.mode",
        prompt: "Press `S`, then `C` to go back to newest first",
        success: "Sorted",
        keys: ["S", "C"],
      },
    ],
    touch: [
      {
        move: "home.task-context-menu",
        prompt: "Long-press a task for everything you can do with it",
        success: "Task actions",
      },
      {
        move: "effort.set",
        prompt: "Big job or a quick one? Tap Effort and pick its size",
        success: "Effort {}",
      },
    ],
  },
  {
    id: "plan-ahead",
    title: "Plan ahead",
    summary: "Due dates, tags and what's due now",
    keyboard: [
      {
        move: "capture.open",
        prompt: "Press `C` for a new task",
        success: "New task",
      },
      {
        move: "shorthand.due",
        prompt:
          "Type what needs doing, then give it a due date with `!`, like `!today`. `Enter` picks the highlighted date",
        success: "Due {}",
        inEditor: true,
      },
      {
        move: "shorthand.tags",
        prompt: "Add a tag with `#`, like `#quick`. `Space` turns it into a pill",
        success: "Tagged {}",
        inEditor: true,
      },
      {
        move: "capture.save",
        prompt: "Press `Enter` to save the task. Trailing spaces are trimmed automatically",
        success: "Saved",
        inEditor: true,
      },
      {
        move: "due.lens",
        prompt: "Press `!` to see what's due now",
        success: "Due now",
      },
      {
        move: "due.lens",
        prompt: "Press `!` again to go back to your previous view",
        success: "Back where you were",
      },
      {
        move: "filter.tags",
        prompt: "Press `#` and pick a tag to see only tasks with it",
        success: "Tag filter. `Enter` picks one",
      },
      {
        move: "filter.escape",
        prompt: "Press `Esc` to clear every filter",
        success: "Filters cleared",
      },
    ],
    touch: [
      {
        move: "capture.open",
        prompt: "Tap + for a new task",
        success: "New task",
      },
      {
        move: "shorthand.due",
        prompt: "Type what needs doing, then tap `!` and pick a due date",
        success: "Due {}",
        inEditor: true,
      },
      {
        move: "shorthand.tags",
        prompt: "Tap `#` and add a tag",
        success: "Tagged {}",
        inEditor: true,
      },
      {
        move: "capture.save",
        prompt: "Tap Save",
        success: "Saved",
        inEditor: true,
      },
      {
        move: "due.lens",
        prompt: "Tap the due count up top to see what's due now",
        success: "Due now",
      },
      {
        move: "due.lens",
        prompt: "Tap the due count again to go back to your previous view",
        success: "Back where you were",
      },
    ],
  },
  {
    id: "change-of-plans",
    title: "Change of plans",
    summary: "Step back, pause, undo and cancel, on a task made to practice on",
    keyboard: [
      {
        move: "capture.open",
        prompt: "Press `C` to create a task to practice on",
        success: "New task",
      },
      {
        move: "capture.save",
        prompt: "Type anything, then press `Enter` to save the task",
        success: "Saved",
        inEditor: true,
      },
      { move: "status.forward", prompt: "Press `Space` to start it", success: "In progress" },
      {
        move: "status.back",
        prompt: "Started too soon? Press `Shift`+`Space` to step back",
        success: "Open",
      },
      { move: "status.pause", prompt: "Press `P` to pause it", success: "Paused" },
      {
        move: "undo.latest",
        prompt: `Changed your mind? Press \`${modKey}\`+\`Z\` to undo`,
        success: "Undone",
      },
      {
        move: "status.cancel",
        prompt: "Press `Delete` to cancel the practice task",
        success: "Canceled",
      },
    ],
  },
  {
    id: "find-your-way",
    title: "Find your way",
    summary: "Moving around, filters and search",
    keyboard: [
      {
        move: "home.arrows",
        prompt: "Press `↑` or `↓` to move between tasks",
        success: "Moved",
      },
      {
        move: "home.home-end",
        prompt: "Press `Home` or `End` to jump to the first or last task",
        success: "{} task",
      },
      {
        move: "filter.mode",
        prompt: "Press `F`, then one of the keys it shows to filter the list",
        success: "Filtered",
      },
      {
        move: "filter.search",
        prompt: "Press `/` to search",
        success: "Searching. `Enter` applies it",
      },
      {
        move: "filter.escape",
        prompt: "Press `Esc` to clear the search and every filter",
        success: "Filters cleared",
      },
    ],
  },
  {
    id: "shape-your-list",
    title: "Shape your list",
    summary: "Child tasks, collapsing, blockers and reordering",
    keyboard: [
      {
        move: "capture.child",
        prompt: "Press `Shift`+`C` for a task under the active one",
        success: "New child task",
      },
      {
        move: "capture.save",
        prompt: "Type what needs doing, then press `Enter` to save the task",
        success: "Saved",
        inEditor: true,
      },
      {
        move: "home.left-collapse",
        prompt: "Press `←` to reach its parent, then `←` again to collapse it",
        success: "Collapsed",
      },
      {
        move: "home.right-expand",
        prompt:
          "Press `→` until it expands again. With a category, the first `→` shows only that category",
        success: "Expanded",
      },
      {
        move: "pick.parent",
        prompt: "Press `M` to move the active task under another one",
        success: "Moving. Pick its new parent",
      },
      {
        move: "pick.blocker",
        prompt: "Press `B` to say which task blocks the active one",
        success: "Adding a blocker. Pick what's in the way",
      },
      {
        move: "select.extend",
        prompt: "Hold `Shift` and press `↓` to select more than one task",
        success: "Selected",
      },
      {
        move: "reorder.step",
        prompt: `Press \`${modKey}\`+\`↑\` or \`↓\` to move tasks up or down`,
        success: "Moved",
      },
      {
        move: "reorder.edge",
        prompt: `Press \`${modKey}\`+\`Home\` or \`End\` to move them to the top or bottom`,
        success: "Moved to the {}",
        keys: [modKey, "Home", "End"],
      },
    ],
    touch: [
      {
        move: "home.task-context-menu",
        prompt: "Long-press a task for everything you can do with it",
        success: "Task actions",
      },
      {
        move: "pick.parent",
        prompt: "Tap Move under, then pick another task",
        success: "Moving. Pick its new parent",
      },
      {
        move: "pick.blocker",
        prompt: "Long-press again and tap Blockers",
        success: "Adding a blocker. Pick what's in the way",
      },
    ],
  },
  {
    id: "fast-hands",
    title: "Fast hands",
    summary: "Descriptions, images, quicker edits and every shortcut there is",
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
        prompt: "Press `Tab` again to make it a pill, then `Backspace` to turn it back into text",
        success: "Back to text",
        keys: ["Tab", "Backspace"],
        inEditor: true,
      },
      {
        move: "edit.description",
        prompt:
          "Press `Tab` until the description opens, then write in it. It can be as long as you like",
        success: "Description added",
        inEditor: true,
      },
      {
        move: "attach.paste",
        prompt: `Copy any image, then press \`${modKey}\`+\`V\` here to attach it`,
        success: "Image added",
        inEditor: true,
      },
      {
        move: "capture.save",
        prompt: `Press \`${modKey}\`+\`Enter\` to save. \`Enter\` alone starts a new line here`,
        success: "Saved",
        keys: [modKey, "Enter"],
        inEditor: true,
      },
      {
        move: "copy.text",
        prompt: `Press \`${modKey}\`+\`C\` to copy the task's text, ready to paste anywhere`,
        success: "Copied",
      },
      {
        move: "attach.copy",
        prompt: `Press \`${modKey}\`+\`Shift\`+\`C\` to copy its image`,
        success: "Image copied",
      },
      {
        move: "help.palette",
        prompt: `Press \`${modKey}\`+\`K\` for every shortcut there is. \`Esc\` closes it`,
        success: "Every shortcut",
      },
      {
        move: "details.toggle-active",
        prompt: "Press `V` to see its description in the list",
        success: "Details shown. `V` again hides them",
      },
      {
        move: "details.toggle-all",
        prompt: "Press `Shift`+`V` to show the details of every task",
        success: "Details for every task. `Shift`+`V` again hides them",
      },
    ],
  },
  {
    id: "make-it-yours",
    title: "Make it yours",
    summary: "Themes, settings, your progress and a longer look back",
    keyboard: [
      {
        move: "theme.picker",
        prompt: "Press `Alt`+`T` to pick a theme. `Esc` closes it without changing anything",
        success: "Themes",
      },
      {
        move: "settings.open",
        prompt: `Press \`${modKey}\`+\`,\` for settings. \`Esc\` closes them`,
        success: "Settings",
      },
      {
        move: "learn.panel",
        prompt: "Press `?` to see every quest and the keys you've learned",
        success: "Your progress",
      },
      {
        move: "learn.panel",
        prompt: "Press `?` again to close it",
        success: "Closed",
      },
      {
        move: "done.lens-window",
        prompt: "Press `Shift`+`D` to see what you've done this week",
        success: "Done this week. `Shift`+`D` again looks further back",
      },
      {
        move: "done.lens",
        prompt: "Press `D` to go back to your previous view",
        success: "Back where you were",
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
