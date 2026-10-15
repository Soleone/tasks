import { useEffect, useRef, type RefObject } from "react";
import type { TaskPriority, TaskStatus } from "@/backend/taskModel";
import { EXACT_STATUS_META, type SortField } from "./taskFilters";
import type { TaskListMode as ToolbarMode } from "./TaskListModeHelp";
import type { TaskMoveDirection } from "./taskReordering";
import type { TaskView } from "./taskView";

const EXACT_STATUS_BY_KEY = new Map(EXACT_STATUS_META.map((entry) => [entry.key.toLowerCase(), entry.status]));

// Home shortcuts work anywhere on the home surface, not only when the listbox
// is focused. Typing targets, the inline editor, and open dialogs always win.
function isHomeTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('[role="dialog"], [role="menu"], [data-slot="command"]')) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
    || target.isContentEditable
    || target.getAttribute("role") === "combobox"
    || target.hasAttribute("cmdk-input");
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
  deleteSelectedTasks: () => Promise<void>;
  returnToList: () => void;
  clearAllFilters: () => void;
  startFilterMode: () => void;
  startSortMode: () => void;
  applyExactStatus: (status: TaskStatus) => void;
  applySortField: (field: SortField) => void;
  reverseSort: () => void;
  toggleDetailsView: () => void;
  setPriority: (task: TaskView, priority: TaskPriority) => Promise<void>;
  openSearch: () => void;
  createTask: (parentId?: string) => void;
  toggleStatusPreset: () => void;
  applyPriorityFilter: (priority: TaskPriority) => void;
  toggleUnblockedFilter: () => void;
  openCategoryPicker: () => void;
  openTagPicker: () => void;
  addBlocker: (task: TaskView) => void;
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
};

type HomeShortcutSurface = {
  toolbarModeRef: RefObject<ToolbarMode | null>;
  composerOpenRef: RefObject<boolean>;
  list: RefObject<HTMLDivElement | null>;
  section: RefObject<HTMLElement | null>;
};

export function useTaskListKeyboard(actions: HomeShortcutActions, surface: HomeShortcutSurface): void {
  const { toolbarModeRef, composerOpenRef, list, section } = surface;
  const homeShortcutActions = useRef(actions);
  homeShortcutActions.current = actions;

  // Keep one window listener so state changes cannot leave a gap between
  // removing an old listener and installing its replacement. The ref is
  // updated during render, so the listener always invokes current actions.
  useEffect(() => {
    function onWindowKeyDown(event: KeyboardEvent): void {
      const actions = homeShortcutActions.current;
      if (event.key === "Tab") {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (toolbarModeRef.current !== null || event.target === list.current || event.target === section.current) event.preventDefault();
        return;
      }
      if (document.querySelector('[role="dialog"]') || composerOpenRef.current) return;
      if (isHomeTypingTarget(event.target)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (toolbarModeRef.current !== null) {
          actions.returnToList();
          return;
        }
        if (actions.clearSelection()) return;
        if (actions.hasActiveFilters) actions.clearAllFilters();
        return;
      }
      if (toolbarModeRef.current !== null && event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "t") {
        // Let the app-level theme shortcut continue, but make its modal return
        // target the task list rather than this temporary toolbar surface.
        actions.returnToList();
        return;
      }
      if (toolbarModeRef.current !== null && (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k") {
        // The help palette is another app-level shortcut with a modal return
        // target. Clear the toolbar first for the same reason as themes.
        actions.returnToList();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "z") {
        if (toolbarModeRef.current !== null) return;
        if (event.repeat || event.isComposing || event.keyCode === 229 || event.shiftKey) return;
        if (!actions.canUndoStatus) return;
        event.preventDefault();
        actions.undoStatus();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "c") {
        if (event.repeat || event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        if (actions.activeTask) void actions.copyTask(actions.activeTask);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
        const moveDirection = event.key === "ArrowUp"
          ? "up"
          : event.key === "ArrowDown"
            ? "down"
            : event.key === "Home"
              ? "start"
              : event.key === "End"
                ? "end"
                : null;
        if (moveDirection !== null) {
          if (event.repeat || event.isComposing || event.keyCode === 229) return;
          event.preventDefault();
          void actions.reorderSelection(moveDirection);
          return;
        }
      }
      if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.key === "ArrowUp") {
          event.preventDefault();
          actions.moveActive("previous", true);
          return;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          actions.moveActive("next", true);
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
      if (event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey) return;

      // A toolbar mode owns the keyboard until an option is chosen or Escape
      // returns focus to the task list. It has no timeout or fall-through to
      // unrelated home shortcuts.
      const activeToolbarMode = toolbarModeRef.current;
      if (activeToolbarMode === "filter") {
        if (event.repeat) {
          event.preventDefault();
          return;
        }
        const key = event.key.toLowerCase();
        if (key === "f" && !event.shiftKey) {
          event.preventDefault();
          actions.returnToList();
          return;
        }
        if (key === "s" && !event.shiftKey) {
          event.preventDefault();
          actions.toggleStatusPreset();
          return;
        }
        if (!event.shiftKey) {
          const exact = EXACT_STATUS_BY_KEY.get(key);
          if (exact) {
            event.preventDefault();
            actions.applyExactStatus(exact);
            return;
          }
        }
        if (key >= "0" && key <= "4" && !event.shiftKey) {
          event.preventDefault();
          actions.applyPriorityFilter(Number(key) as TaskPriority);
          return;
        }
        if (key === "c" && !event.shiftKey) {
          event.preventDefault();
          actions.openCategoryPicker();
          return;
        }
        if (key === "t" && !event.shiftKey) {
          event.preventDefault();
          actions.openTagPicker();
          return;
        }
        if (key === "u" && !event.shiftKey) {
          event.preventDefault();
          actions.toggleUnblockedFilter();
          return;
        }
        if (key === "/" && !event.shiftKey) {
          event.preventDefault();
          actions.openSearch();
          return;
        }
        event.preventDefault();
        return;
      }
      if (activeToolbarMode === "sort") {
        if (event.repeat) {
          event.preventDefault();
          return;
        }
        const key = event.key.toLowerCase();
        if (key === "s" && !event.shiftKey) {
          event.preventDefault();
          actions.returnToList();
          return;
        }
        if (key === "c" && !event.shiftKey) {
          event.preventDefault();
          actions.applySortField("created");
          return;
        }
        if (key === "u" && !event.shiftKey) {
          event.preventDefault();
          actions.applySortField("updated");
          return;
        }
        if (key === "m" && !event.shiftKey) {
          event.preventDefault();
          actions.applySortField("manual");
          return;
        }
        if (key === "p" && !event.shiftKey) {
          event.preventDefault();
          actions.applySortField("priority");
          return;
        }
        if (key === "r" && !event.shiftKey) {
          event.preventDefault();
          actions.reverseSort();
          return;
        }
        event.preventDefault();
        return;
      }
      if (event.key === "Delete") {
        if (event.repeat || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        event.preventDefault();
        void actions.deleteSelectedTasks();
        return;
      }
      if (event.key === "/") {
        if (event.repeat) return;
        event.preventDefault();
        actions.openSearch();
      } else if (event.key === "@") {
        if (event.repeat) return;
        event.preventDefault();
        actions.openCategoryPicker();
      } else if (event.key === "#") {
        if (event.repeat) return;
        event.preventDefault();
        actions.openTagPicker();
      } else if (event.key.toLowerCase() === "c") {
        if (event.repeat) return;
        event.preventDefault();
        actions.createTask(event.shiftKey ? actions.activeTask?.id : undefined);
      } else if (event.key.toLowerCase() === "f" && !event.shiftKey) {
        if (event.repeat) return;
        event.preventDefault();
        actions.startFilterMode();
      } else if (event.key.toLowerCase() === "s" && !event.shiftKey) {
        if (event.repeat) return;
        event.preventDefault();
        actions.startSortMode();
      } else if (event.key.toLowerCase() === "v" && !event.shiftKey) {
        if (event.repeat) return;
        event.preventDefault();
        actions.toggleDetailsView();
      } else if (event.key >= "0" && event.key <= "4" && !event.shiftKey) {
        if (event.repeat) return;
        event.preventDefault();
        if (actions.activeTask) void actions.setPriority(actions.activeTask, Number(event.key) as TaskPriority);
      } else if (event.key.toLowerCase() === "b") {
        if (event.repeat || event.shiftKey) return;
        event.preventDefault();
        if (actions.activeTask) actions.addBlocker(actions.activeTask);
      } else if (event.key.toLowerCase() === "m") {
        if (event.repeat || event.shiftKey) return;
        event.preventDefault();
        if (actions.activeTask) actions.moveUnder(actions.activeTask);
      } else if (event.key.toLowerCase() === "p" && !event.shiftKey) {
        if (event.repeat) return;
        event.preventDefault();
        void actions.pauseSelectedTasks();
      } else if (event.key === " ") {
        if (event.repeat || isNativeButtonAction(event.target)) return;
        event.preventDefault();
        if (actions.activeTask) {
          void (event.shiftKey
            ? actions.reverseSelectedStatus()
            : actions.toggleSelectedStatus());
        }
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        actions.moveActive("next");
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        actions.moveActive("previous");
      } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        actions.handleHorizontalNavigation(event.key);
      } else if (event.key === "Home") {
        event.preventDefault();
        actions.moveActive(0);
      } else if (event.key === "End") {
        event.preventDefault();
        actions.moveActive(actions.visibleRowCount - 1);
      } else if (event.key === "Enter") {
        if (isNativeButtonAction(event.target)) return;
        event.preventDefault();
        if (actions.activeTask) actions.editTask(actions.activeTask);
      }
    }
    window.addEventListener("keydown", onWindowKeyDown, true);
    return () => window.removeEventListener("keydown", onWindowKeyDown, true);
  }, []);
}
