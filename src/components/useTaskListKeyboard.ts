import { useEffect, useEffectEvent, type RefObject } from "react";
import type { TaskPriority, TaskStatus } from "@/backend/taskModel";
import { EXACT_STATUS_META, type SortField } from "./taskFilters";
import type { ListLens } from "./listLens";
import type { TaskListMode as ToolbarMode } from "./TaskListModeHelp";
import type { TaskMoveDirection } from "./taskReordering";
import type { TaskView } from "./taskView";
import { practice } from "@/learning/progress";

const EXACT_STATUS_BY_KEY = new Map(
  EXACT_STATUS_META.map((entry) => [entry.key.toLowerCase(), entry.status]),
);

const SORT_BY_KEY = new Map<string, SortField>([
  ["c", "created"],
  ["u", "updated"],
  ["m", "manual"],
  ["p", "priority"],
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
  toggleAllDetails: () => void;
  setPriority: (task: TaskView, priority: TaskPriority) => Promise<void>;
  openSearch: () => void;
  createTask: (parentId?: string) => void;
  toggleStatusPreset: () => void;
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
};

/** What the second key of `F` does, or null for a key with no filter. */
function filterChoice(key: string, actions: HomeShortcutActions): (() => void) | null {
  if (key === "s") return actions.toggleStatusPreset;
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
      }
      return;
    }
    if (
      toolbarModeRef.current !== null &&
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      event.key.toLowerCase() === "t"
    ) {
      // Let the app-level theme shortcut continue, but make its modal return
      // target the task list rather than this temporary toolbar surface.
      actions.returnToList();
      return;
    }
    if (
      toolbarModeRef.current !== null &&
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      event.key.toLowerCase() === "k"
    ) {
      // The help palette is another app-level shortcut with a modal return
      // target. Clear the toolbar first for the same reason as themes.
      actions.returnToList();
      return;
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      (event.key.toLowerCase() === "z" ||
        (event.ctrlKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === "y"))
    ) {
      if (toolbarModeRef.current !== null) return;
      if (event.repeat || event.isComposing || event.keyCode === 229) return;
      const redo = event.shiftKey || event.key.toLowerCase() === "y";
      if (redo ? !actions.canRedo : !actions.canUndoStatus) return;
      event.preventDefault();
      if (redo) actions.redo();
      else {
        practice("undo.latest");
        actions.undoStatus();
      }
      return;
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      event.shiftKey &&
      event.key.toLowerCase() === "c"
    ) {
      if (event.repeat || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      practice("attach.copy");
      if (actions.activeTask) actions.copyImage(actions.activeTask);
      return;
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "c"
    ) {
      if (event.repeat || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      practice("copy.text");
      if (actions.activeTask) void actions.copyTask(actions.activeTask);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
      const moveDirection =
        event.key === "ArrowUp"
          ? "up"
          : event.key === "ArrowDown"
            ? "down"
            : event.key === "Home"
              ? "start"
              : event.key === "End"
                ? "end"
                : null;
      if (moveDirection !== null) {
        if (event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        if (moveDirection === "start" || moveDirection === "end")
          practice("reorder.edge", "keys", moveDirection === "start" ? "top" : "bottom");
        else practice("reorder.step");
        void actions.reorderSelection(moveDirection);
        return;
      }
    }
    if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        practice("select.extend");
        actions.moveActive(event.key === "ArrowUp" ? "previous" : "next", true);
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        actions.selectBoundary("start");
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        actions.selectBoundary("end");
        return;
      }
    }
    if (
      event.isComposing ||
      event.keyCode === 229 ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;

    // A toolbar mode owns the keyboard until an option is chosen or Escape
    // returns focus to the task list. It has no timeout or fall-through to
    // unrelated home shortcuts.
    const activeToolbarMode = toolbarModeRef.current;
    if (activeToolbarMode !== null) {
      event.preventDefault();
      if (event.repeat || event.shiftKey) return;
      const key = event.key.toLowerCase();
      // The mode's own key closes it again.
      if (key === (activeToolbarMode === "filter" ? "f" : "s")) {
        actions.returnToList();
        return;
      }
      const choice =
        activeToolbarMode === "filter" ? filterChoice(key, actions) : sortChoice(key, actions);
      if (!choice) return;
      practice(activeToolbarMode === "filter" ? "filter.mode" : "sort.mode");
      choice();
      return;
    }
    if (event.key === "Delete") {
      if (
        event.repeat ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey
      )
        return;
      event.preventDefault();
      practice("status.cancel");
      void actions.deleteSelectedTasks();
      return;
    }
    if (event.key === "/") {
      if (event.repeat) return;
      event.preventDefault();
      practice("filter.search");
      actions.openSearch();
    } else if (event.key === "@") {
      if (event.repeat) return;
      event.preventDefault();
      practice("filter.category");
      actions.openCategoryPicker();
    } else if (event.key === "#") {
      if (event.repeat) return;
      event.preventDefault();
      practice("filter.tags");
      actions.openTagPicker();
    } else if (event.key === "!") {
      if (event.repeat) return;
      event.preventDefault();
      practice("due.lens");
      actions.toggleLens("due");
    } else if (event.key.toLowerCase() === "c") {
      if (event.repeat) return;
      event.preventDefault();
      practice(event.shiftKey ? "capture.child" : "capture.open");
      actions.createTask(event.shiftKey ? actions.activeTask?.id : undefined);
    } else if (event.key.toLowerCase() === "f" && !event.shiftKey) {
      if (event.repeat) return;
      event.preventDefault();
      actions.startFilterMode();
    } else if (event.key.toLowerCase() === "s" && !event.shiftKey) {
      if (event.repeat) return;
      event.preventDefault();
      actions.startSortMode();
    } else if (event.key.toLowerCase() === "v") {
      if (event.repeat) return;
      event.preventDefault();
      if (event.shiftKey) {
        practice("details.toggle-all");
        actions.toggleAllDetails();
      } else if (actions.activeTask) {
        practice("details.toggle-active");
        actions.toggleActiveDetails(actions.activeTask);
      }
    } else if (event.key >= "0" && event.key <= "4" && !event.shiftKey) {
      if (event.repeat) return;
      event.preventDefault();
      if (actions.activeTask) {
        practice("priority.set", "keys", `P${event.key}`);
        void actions.setPriority(actions.activeTask, Number(event.key) as TaskPriority);
      }
    } else if (event.key.toLowerCase() === "d") {
      if (event.repeat) return;
      event.preventDefault();
      if (event.shiftKey) {
        practice("done.lens-window");
        actions.widenDoneLens();
      } else {
        practice("done.lens");
        actions.toggleLens("done");
      }
    } else if (event.key.toLowerCase() === "b") {
      if (event.repeat || event.shiftKey) return;
      event.preventDefault();
      if (actions.activeTask) {
        practice("pick.blocker");
        actions.addBlocker(actions.activeTask);
      }
    } else if (event.key.toLowerCase() === "m") {
      if (event.repeat || event.shiftKey) return;
      event.preventDefault();
      if (actions.activeTask) {
        practice("pick.parent");
        actions.moveUnder(actions.activeTask);
      }
    } else if (event.key.toLowerCase() === "p" && !event.shiftKey) {
      if (event.repeat) return;
      event.preventDefault();
      practice("status.pause");
      void actions.pauseSelectedTasks();
    } else if (event.key === " ") {
      if (event.repeat || isNativeButtonAction(event.target)) return;
      event.preventDefault();
      if (actions.activeTask) {
        practice(event.shiftKey ? "status.back" : "status.forward");
        void (event.shiftKey ? actions.reverseSelectedStatus() : actions.toggleSelectedStatus());
      }
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      practice("home.arrows");
      actions.moveActive("next");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      practice("home.arrows");
      actions.moveActive("previous");
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
      if (actions.activeTask) {
        practice("home.open-editor");
        actions.editTask(actions.activeTask);
      }
    }
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
