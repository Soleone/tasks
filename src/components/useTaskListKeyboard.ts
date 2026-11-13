import { useEffect, useEffectEvent, type RefObject } from "react";
import { isEffort, type TaskEffort, type TaskPriority, type TaskStatus } from "@/backend/taskModel";
import { EFFORT_LABELS, EXACT_STATUS_META, type SortField } from "./taskFilters";
import type { ListLens } from "./listLens";
import type { TaskListMode as ToolbarMode } from "./TaskListModeHelp";
import type { TaskMoveDirection } from "./taskReordering";
import type { TaskView } from "./taskView";
import { practice } from "@/learning/progress";
import { escapeFoundNothing } from "@/useAndroidBack";
import { boundAction, type BindingId } from "@/keymap";

const EXACT_STATUS_BY_KEY = new Map(
  EXACT_STATUS_META.map((entry) => [entry.key.toLowerCase(), entry.status]),
);

const SORT_BY_KEY = new Map<string, SortField>([
  ["c", "created"],
  ["u", "updated"],
  ["m", "manual"],
  ["p", "priority"],
  ["e", "effort"],
  ["t", "due"],
  ["d", "closed"],
]);

// Home shortcuts work anywhere on the home surface, not only when the listbox
// is focused. Typing targets, the inline editor, and open dialogs always win.
function isHomeTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('[role="dialog"], [role="menu"], [data-slot="command"]')) return true;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable ||
    target.getAttribute("role") === "combobox" ||
    target.hasAttribute("cmdk-input")
  );
}

// Space and Enter keep their native meaning on real buttons (Retry, Load
// more, Clear filters). Backup buttons are tabIndex -1 and mouse-only, so
// list commands win there.
function isNativeButtonAction(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('button:not([tabindex="-1"]), a[href], input, textarea, select') !== null;
}

type HomeShortcutActions = {
  hasActiveFilters: boolean;
  activeTask: TaskView | undefined;
  visibleRowCount: number;
  canUndoStatus: boolean;
  undoStatus: () => void;
  canRedo: boolean;
  redo: () => void;
  deleteSelectedTasks: () => Promise<void>;
  returnToList: () => void;
  clearAllFilters: () => void;
  startFilterMode: () => void;
  startSortMode: () => void;
  applyExactStatus: (status: TaskStatus) => void;
  applySortField: (field: SortField) => void;
  reverseSort: () => void;
  toggleActiveDetails: (task: TaskView) => void;
  openLink: (task: TaskView) => void;
  toggleAllDetails: () => void;
  setPriority: (task: TaskView, priority: TaskPriority) => Promise<void>;
  setEffort: (task: TaskView, effort: TaskEffort) => Promise<void>;
  openSearch: () => void;
  createTask: (parentId?: string) => void;
  logDoneTask: () => void;
  toggleStatusPreset: () => void;
  showAllStatuses: () => void;
  applyPriorityFilter: (priority: TaskPriority) => void;
  toggleUnblockedFilter: () => void;
  openCategoryPicker: () => void;
  openTagPicker: () => void;
  addBlocker: (task: TaskView) => void;
  toggleLens: (kind: ListLens["kind"]) => void;
  widenDoneLens: () => void;
  moveUnder: (task: TaskView) => void;
  toggleSelectedStatus: () => Promise<void>;
  reverseSelectedStatus: () => Promise<void>;
  pauseSelectedTasks: () => Promise<void>;
  moveActive: (next: number | "next" | "previous", extend?: boolean) => void;
  selectBoundary: (end: "start" | "end") => void;
  reorderSelection: (direction: TaskMoveDirection) => Promise<void>;
  clearSelection: () => boolean;
  handleHorizontalNavigation: (key: "ArrowLeft" | "ArrowRight") => void;
  editTask: (task: TaskView) => void;
  copyTask: (task: TaskView) => Promise<void>;
  copyImage: (task: TaskView) => void;
  openTaskMenu: (task: TaskView) => void;
};

/** What the second key of `F` does, or null for a key with no filter. */
function filterChoice(key: string, actions: HomeShortcutActions): (() => void) | null {
  if (key === "s") return actions.toggleStatusPreset;
  if (key === "a") return actions.showAllStatuses;
  const exact = EXACT_STATUS_BY_KEY.get(key);
  if (exact) return () => actions.applyExactStatus(exact);
  if (key >= "0" && key <= "4")
    return () => actions.applyPriorityFilter(Number(key) as TaskPriority);
  if (key === "c") return actions.openCategoryPicker;
  if (key === "t") return actions.openTagPicker;
  if (key === "u") return actions.toggleUnblockedFilter;
  if (key === "/") return actions.openSearch;
  return null;
}

/** What the second key of `S` does, or null for a key with no sort. */
function sortChoice(key: string, actions: HomeShortcutActions): (() => void) | null {
  if (key === "r") return actions.reverseSort;
  const field = SORT_BY_KEY.get(key);
  return field ? () => actions.applySortField(field) : null;
}

/** Keys that keep working while held down. */
const REPEATING: ReadonlySet<BindingId> = new Set([
  "priority.raise",
  "priority.lower",
  "effort.bigger",
  "effort.smaller",
]);

/** Selecting and reordering with Shift or Ctrl/⌘ and the arrows, which no one rebinds. */
function moveSelection(event: KeyboardEvent, actions: HomeShortcutActions): boolean {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
    const direction =
      event.key === "ArrowUp"
        ? "up"
        : event.key === "ArrowDown"
          ? "down"
          : event.key === "Home"
            ? "start"
            : event.key === "End"
              ? "end"
              : null;
    if (direction === null) return false;
    event.preventDefault();
    if (direction === "start" || direction === "end")
      practice("reorder.edge", "keys", direction === "start" ? "top" : "bottom");
    else practice("reorder.step");
    void actions.reorderSelection(direction);
    return true;
  }
  if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    practice("select.extend");
    actions.moveActive(event.key === "ArrowUp" ? "previous" : "next", true);
    return true;
  }
  if (event.key !== "Home" && event.key !== "End") return false;
  event.preventDefault();
  actions.selectBoundary(event.key === "Home" ? "start" : "end");
  return true;
}

function undo(event: KeyboardEvent, actions: HomeShortcutActions): void {
  if (!actions.canUndoStatus) return;
  event.preventDefault();
  practice("undo.latest");
  actions.undoStatus();
}

function redo(event: KeyboardEvent, actions: HomeShortcutActions): void {
  if (!actions.canRedo) return;
  event.preventDefault();
  actions.redo();
}

function stepPriority(
  task: TaskView | undefined,
  step: number,
  actions: HomeShortcutActions,
): void {
  // Raising priority makes the number smaller.
  const priority = task ? task.priority + step : -1;
  if (!task || priority < 0 || priority > 4) return;
  practice("priority.set", "keys", `P${priority}`);
  void actions.setPriority(task, priority as TaskPriority);
}

function stepEffort(task: TaskView | undefined, step: number, actions: HomeShortcutActions): void {
  const effort = task ? task.effort + step : 0;
  if (!task || !isEffort(effort)) return;
  practice("effort.set", "keys", EFFORT_LABELS[effort]);
  void actions.setEffort(task, effort);
}

/** Does what a rebindable key asks for on the list (`keys.rebind`). */
function runBinding(id: BindingId, event: KeyboardEvent, actions: HomeShortcutActions): void {
  const task = actions.activeTask;
  switch (id) {
    // The app itself answers these, from anywhere.
    case "help.palette":
    case "learn.panel":
    case "theme.picker":
    case "settings.open":
      return;
    case "undo.latest":
      return undo(event, actions);
    case "redo.latest":
      return redo(event, actions);
    case "status.forward":
    case "status.back":
      if (isNativeButtonAction(event.target)) return;
  }
  event.preventDefault();
  switch (id) {
    case "capture.open":
      practice("capture.open");
      return actions.createTask();
    case "capture.child":
      practice("capture.child");
      return actions.createTask(task?.id);
    case "capture.log":
      practice("capture.log");
      return actions.logDoneTask();
    case "status.forward":
      if (!task) return;
      practice("status.forward");
      return void actions.toggleSelectedStatus();
    case "status.back":
      if (!task) return;
      practice("status.back");
      return void actions.reverseSelectedStatus();
    case "status.pause":
      practice("status.pause");
      return void actions.pauseSelectedTasks();
    case "status.cancel":
      practice("status.cancel");
      return void actions.deleteSelectedTasks();
    case "priority.raise":
      return stepPriority(task, -1, actions);
    case "priority.lower":
      return stepPriority(task, 1, actions);
    case "effort.bigger":
      return stepEffort(task, 1, actions);
    case "effort.smaller":
      return stepEffort(task, -1, actions);
    case "copy.text":
      practice("copy.text");
      if (task) void actions.copyTask(task);
      return;
    case "attach.copy":
      practice("attach.copy");
      if (task) actions.copyImage(task);
      return;
    case "details.open-link":
      if (task) actions.openLink(task);
      return;
    case "details.toggle-active":
      if (!task) return;
      practice("details.toggle-active");
      return actions.toggleActiveDetails(task);
    case "details.toggle-all":
      practice("details.toggle-all");
      return actions.toggleAllDetails();
    case "pick.blocker":
      if (!task) return;
      practice("pick.blocker");
      return actions.addBlocker(task);
    case "pick.parent":
      if (!task) return;
      practice("pick.parent");
      return actions.moveUnder(task);
    case "home.task-context-menu":
      if (task) actions.openTaskMenu(task);
      return;
    case "filter.mode":
      return actions.startFilterMode();
    case "sort.mode":
      return actions.startSortMode();
    case "filter.category":
      practice("filter.category");
      return actions.openCategoryPicker();
    case "filter.tags":
      practice("filter.tags");
      return actions.openTagPicker();
    case "filter.search":
      practice("filter.search");
      return actions.openSearch();
    case "done.lens":
      practice("done.lens");
      return actions.toggleLens("done");
    case "done.lens-window":
      practice("done.lens-window");
      return actions.widenDoneLens();
    case "due.lens":
      practice("due.lens");
      return actions.toggleLens("due");
    case "agents.lens":
      return actions.toggleLens("agents");
  }
}

/** The keys that always mean the same (`keys.fixed`). */
function runFixedKey(event: KeyboardEvent, actions: HomeShortcutActions): void {
  const task = actions.activeTask;
  if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    if (event.key.toLowerCase() === "y" && !event.repeat) redo(event, actions);
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === "ContextMenu") {
    if (event.repeat) return;
    event.preventDefault();
    if (task) actions.openTaskMenu(task);
  } else if (event.key >= "0" && event.key <= "4" && event.key.length === 1 && !event.shiftKey) {
    if (event.repeat) return;
    event.preventDefault();
    if (task) {
      practice("priority.set", "keys", `P${event.key}`);
      void actions.setPriority(task, Number(event.key) as TaskPriority);
    }
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    practice("home.arrows");
    actions.moveActive(event.key === "ArrowDown" ? "next" : "previous");
  } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    event.preventDefault();
    actions.handleHorizontalNavigation(event.key);
  } else if (event.key === "Home") {
    event.preventDefault();
    practice("home.home-end", "keys", "First");
    actions.moveActive(0);
  } else if (event.key === "End") {
    event.preventDefault();
    practice("home.home-end", "keys", "Last");
    actions.moveActive(actions.visibleRowCount - 1);
  } else if (event.key === "Enter") {
    if (isNativeButtonAction(event.target)) return;
    event.preventDefault();
    if (task) {
      practice("home.open-editor");
      actions.editTask(task);
    }
  }
}

type HomeShortcutSurface = {
  toolbarModeRef: RefObject<ToolbarMode | null>;
  composerOpenRef: RefObject<boolean>;
  list: RefObject<HTMLDivElement | null>;
  section: RefObject<HTMLElement | null>;
};

/** Whether a dialog holds the keyboard. Toasts are non-modal dialogs and leave it to the list. */
export function isDialogOpen(): boolean {
  return document.querySelector('[role="dialog"]:not([aria-modal="false"]):not([hidden])') !== null;
}

export function useTaskListKeyboard(
  actions: HomeShortcutActions,
  surface: HomeShortcutSurface,
): void {
  const { toolbarModeRef, composerOpenRef, list, section } = surface;

  const onWindowKeyDown = useEffectEvent((event: KeyboardEvent): void => {
    if (event.key === "Tab") {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (
        toolbarModeRef.current !== null ||
        event.target === list.current ||
        event.target === section.current
      )
        event.preventDefault();
      return;
    }
    if (isDialogOpen() || composerOpenRef.current) return;
    if (isHomeTypingTarget(event.target)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (toolbarModeRef.current !== null) {
        actions.returnToList();
        return;
      }
      if (actions.clearSelection()) return;
      if (actions.hasActiveFilters) {
        practice("filter.escape");
        actions.clearAllFilters();
      } else escapeFoundNothing();
      return;
    }
    if (event.isComposing || event.keyCode === 229) return;
    if (moveSelection(event, actions)) return;

    const id = boundAction(event);
    // A toolbar mode owns the plain keys until an option is chosen or Escape returns focus to
    // the task list. It has no timeout or fall-through to unrelated home shortcuts.
    const mode = toolbarModeRef.current;
    if (mode !== null) {
      if (id === "theme.picker" || id === "help.palette" || id === "settings.open") {
        // Let the app-level shortcut continue, but make its modal return target the task list
        // rather than this temporary toolbar surface.
        actions.returnToList();
        return;
      }
      if (id === "copy.text" || id === "attach.copy") {
        if (!event.repeat) runBinding(id, event, actions);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      // The mode's own key closes it again.
      if (id === `${mode}.mode`) {
        actions.returnToList();
        return;
      }
      if (event.repeat || event.shiftKey) return;
      const key = event.key.toLowerCase();
      const choice = mode === "filter" ? filterChoice(key, actions) : sortChoice(key, actions);
      if (!choice) return;
      practice(mode === "filter" ? "filter.mode" : "sort.mode");
      const sorted = mode === "sort" ? SORT_BY_KEY.get(key) : undefined;
      if (sorted === "priority" || sorted === "effort") practice(`sort.${sorted}`);
      choice();
      return;
    }
    if (id) {
      if (event.repeat && !REPEATING.has(id)) return;
      runBinding(id, event, actions);
      return;
    }
    runFixedKey(event, actions);
  });

  // Keep one window listener so state changes cannot leave a gap between
  // removing an old listener and installing its replacement. The effect event
  // always sees the current actions.
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => onWindowKeyDown(event);
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, []);
}
