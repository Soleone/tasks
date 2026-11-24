import { useWorkspaceTasks } from "./useWorkspaceTasks";
import { useWorkspaceActions } from "./useWorkspaceActions";
import { useAppUpdate } from "./useAppUpdate";
import { useGlobalHotkeys } from "./useGlobalHotkeys";
import { useAndroidBack } from "./useAndroidBack";
import { useAgentChanges } from "./useAgentChanges";
import { useHeaderCounts } from "./useHeaderCounts";
import { useDoneHistory } from "./useDoneHistory";
import { GoalReport } from "@/components/GoalReport";
import { weekDots, type ReportTakeOff } from "@/components/goalReportMotion";
import type { ReportRange } from "@/goalReport";
import { dayOf, goalsOn, hasGoals } from "@/goals";
import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Palette, Settings2 } from "lucide-react";
import { AppIcon } from "@/components/AppIcon";
import { WorkspaceRequestRecovery } from "@/components/WorkspaceRequestRecovery";
import type { MainWorkspace } from "@/platform/mainWorkspace";
import type { ClassificationToken } from "@/backend/taskText";
import type { TaskPriority, TaskStatus } from "@/backend/taskModel";
import type { ClassificationOption, TaskView } from "@/components/taskView";
import {
  agentChangeNote,
  lensPhrase,
  nextDoneWindow,
  type GoalLens,
  type ListLens,
} from "@/components/listLens";
import { sortSummary, type SortField, type StatusPreset } from "@/components/taskFilters";
import { CategoryPicker } from "@/components/CategoryPicker";
import { StatusMenu } from "@/components/StatusMenu";
import { PriorityMenu } from "@/components/PriorityMenu";
import { TagPicker } from "@/components/TagPicker";
import { InlineSearch } from "@/components/InlineSearch";
import type { ComposerState } from "@/components/TaskComposer";
import { HelpPalette } from "@/components/HelpPalette";
import { LearnIcon } from "@/components/LearnIcon";
import { LearnPanel } from "@/components/LearnPanel";
import { QuestCard } from "@/components/QuestCard";
import { AgentChanges, DoneToday, DueNow } from "@/components/LensCounts";
import { ConflictCount, ConflictDialog } from "@/components/SyncConflicts";
import { TaskPicker, type TaskPickerMode } from "@/components/TaskPicker";
import { useTheme } from "@/components/soleone/theme";
import { ThemePicker } from "@/components/soleone/theme-picker";
import { SettingsDialog } from "@/components/SettingsDialog";
import {
  copyImageMessage,
  copyTaskText,
  TaskList,
  type TaskListHandle,
  type TaskListPlace,
} from "@/components/TaskList";
import { TOOLBAR_FOLD_GROUPS, type ToolbarFoldGroup } from "@/components/TaskListToolbar";
import { showTaskToast, TaskToaster } from "@/components/TaskToaster";
import { takeCapture, type Capture } from "@/platform/mobileImages";
import { ToggleButton } from "@/components/variants/button";
import { ButtonRow } from "@/components/variants/button-group";
import { Tooltip, TooltipContent } from "@/components/variants/tooltip";
import { TooltipTrigger } from "@/components/ui/tooltip";
import { preventFocusSteal, useFocusNavigation, useFocusStack } from "@/navigation";
import { keepSyncConflictVersion, selectMainWorkspace } from "@/platform/backendClient";
import { APP_NAME } from "./backend/branding";
import {
  readStoredFontSizeIncrease,
  storeFontSizeIncrease,
  type FontSizeIncrease,
} from "@/fontSize";
import { practice, useLearning } from "@/learning/progress";
import { useQuests } from "@/learning/questProgress";
import { readPreference, writePreference } from "@/platform/preferences";
import {
  COMPLETED_SORT_KEY,
  FOLDED_TOOLBAR_GROUPS_KEY,
  type ListView,
  readExactStatus,
  readFoldedToolbarGroups,
  readInitialCategoryFilter,
  readInitialTagFilter,
  readPriorityFilter,
  readShowDetails,
  readSortDirection,
  readSortField,
  readStatusPreset,
  SEARCH_QUERY_KEY,
  SHOW_DETAILS_KEY,
  UNBLOCKED_FILTER_KEY,
  VIEW_PREFERENCES,
} from "@/listViewPreferences";
import { renameCategorySettings, useSharedSettings } from "@/platform/sharedSettings";
import { isMobileApp } from "@/platform/runtime";
import { ariaShortcut, boundAction } from "@/keymap";
import { BindingKbd } from "@/components/variants/kbd";
import { THEME_STORAGE_KEY } from "@/theme/config";
import { takeUserThemeProblems } from "@/theme/userThemes";

/** The lens on screen and the way back from it. Switching lenses keeps the way back. */
type OpenLens = { lens: ListLens; returnTo: ListView; place: TaskListPlace | null };

/**
 * The goal report in place of the list (`goals.report`). While a day it opened shows in the done
 * lens, `dayLens` keeps the lens that day replaced, so going back returns to the report.
 */
type OpenReport = {
  range: ReportRange;
  day: string;
  takeOff: ReportTakeOff;
  dayLens?: { under: OpenLens | null };
};

// The list is the default surface. Create and edit use an inline editor opened
// by the New task button, the C key, or the palette. Tab does not leave the
// task editor or list.
export default function App({
  workspace,
  homeSection,
}: {
  workspace: MainWorkspace;
  /** The Settings › Data section for a build that keeps its home elsewhere, as the web version does. */
  homeSection?: ReactNode;
}): ReactElement {
  // Rebind after development module reloads before the list's query effects run.
  useEffect(() => {
    selectMainWorkspace(workspace);
  }, [workspace]);
  useAppUpdate();
  useEffect(
    () =>
      workspace.documents?.onFailure((name) =>
        showTaskToast(
          name === "settings"
            ? "Couldn't save settings in the Tasks home"
            : "Couldn't save undo history in the Tasks home",
        ),
      ),
    [workspace],
  );
  useEffect(() => {
    for (const problem of takeUserThemeProblems()) showTaskToast(problem);
  }, []);
  // The theme picker remembers its choice in browser storage; the home keeps the real copy.
  const { theme } = useTheme();
  useEffect(() => {
    if (theme) writePreference(THEME_STORAGE_KEY, theme);
  }, [theme]);
  const [statusPreset, setStatusPreset] = useState<StatusPreset>(readStatusPreset);
  const [exactStatus, setExactStatus] = useState<TaskStatus | null>(readExactStatus);
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | null>(readPriorityFilter);
  const [tagFilter, setTagFilter] = useState<ClassificationOption[]>(readInitialTagFilter);
  const [searchQuery, setSearchQuery] = useState(() => readPreference(SEARCH_QUERY_KEY) ?? "");
  const [showUnblocked, setShowUnblocked] = useState(
    () => readPreference(UNBLOCKED_FILTER_KEY) === "true",
  );
  const [showDetails, setShowDetails] = useState(readShowDetails);
  const [foldedToolbarGroups, setFoldedToolbarGroups] = useState(readFoldedToolbarGroups);
  const learning = useLearning();
  const { shown: questsShown, moment: questMoment, allComplete: questsAllComplete } = useQuests();
  const questCelebrating = questMoment?.kind === "complete" && !questMoment.leaving;
  const mobile = isMobileApp();
  const [fontSizeIncrease, setFontSizeIncrease] = useState<FontSizeIncrease>(
    readStoredFontSizeIncrease,
  );
  const [sortField, setSortField] = useState(readSortField);
  const [sortDirection, setSortDirection] = useState(readSortDirection);
  const [completedSort, setCompletedSort] = useState(
    () => readPreference(COMPLETED_SORT_KEY) !== "false",
  );
  const [openLens, setOpenLens] = useState<OpenLens | null>(null);
  const lens = openLens?.lens ?? null;
  const [report, setReport] = useState<OpenReport | null>(null);
  const reportShown = report !== null && report.dayLens === undefined;
  // A day the report opened is its way back only while the done lens still shows that day.
  if (report?.dayLens && !(lens?.kind === "done" && lens.day === report.day)) setReport(null);
  const sharedSettings = useSharedSettings();
  const [categoryFilter, setCategoryFilter] = useState<ClassificationToken | null>(
    readInitialCategoryFilter,
  );
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [priorityMenuOpen, setPriorityMenuOpen] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [activeTaskRequest, setActiveTaskRequest] = useState({
    key: 0,
    taskId: null as string | null,
    preserveTaskOnRefresh: false,
  });
  const [announcement, setAnnouncement] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [learnOpen, setLearnOpen] = useState(false);
  const toggleLearn = (via: "keys" | "pointer") => {
    practice("learn.panel", via);
    setLearnOpen((open) => !open);
  };
  const [themesOpen, setThemesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [picker, setPicker] = useState<{ mode: TaskPickerMode; subject: TaskView } | null>(null);
  const composerRef = useRef<ComposerState | null>(null);
  const taskListRef = useRef<TaskListHandle>(null);
  composerRef.current = composer;

  const nav = useFocusNavigation(["list"]);
  const focusStack = useFocusStack();

  useEffect(() => {
    if (searchOpen && !helpOpen) searchInput.current?.focus();
  }, [helpOpen, searchOpen]);

  function requestActiveTask(taskId: string | null = null, preserveTaskOnRefresh = false): void {
    setActiveTaskRequest((previous) => ({ key: previous.key + 1, taskId, preserveTaskOnRefresh }));
  }

  const listView: ListView = {
    statusPreset,
    exactStatus,
    priorityFilter,
    tagFilter,
    searchQuery,
    showUnblocked,
    categoryFilter,
    sortField,
    sortDirection,
    completedSort,
  };
  // Completed is the Done filter's own sort, so leaving Done returns to the main one.
  const shownSortField: SortField = exactStatus === "done" && completedSort ? "closed" : sortField;

  // The lens is never remembered, so a relaunch inside it returns to the view it set aside.
  const rememberedView = useRef(listView);
  useEffect(() => {
    if (openLens) return;
    for (const [key, stored] of VIEW_PREFERENCES) {
      const value = stored(listView);
      if (value !== stored(rememberedView.current)) writePreference(key, value);
    }
    rememberedView.current = listView;
  });

  const taskView = useWorkspaceTasks({
    statusPreset,
    exactStatus,
    priorityFilter,
    tagFilter,
    searchQuery,
    showUnblocked,
    sortField: shownSortField,
    sortDirection,
    categoryFilter,
    lens,
    setCategoryFilter,
    setTagFilter,
    taskListRef,
  });
  const {
    tasks,
    categories,
    contextTasks,
    contextOrder,
    total,
    loading,
    loadError,
    sortFieldRef,
    categoryFilterRef,
    refreshTasks,
    syncConflicts,
    reloadSyncConflicts,
    isCurrentViewMatch,
  } = taskView;
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const { doneToday: doneTodayCount, dueNow: dueNowCount, goals, week } = useHeaderCounts(tasks);
  const doneHistory = useDoneHistory(report !== null, tasks);
  // A day from the report shows that day's goals in the done lens.
  const lensGoals =
    lens?.kind === "done" && lens.day !== undefined && doneHistory && hasGoals(sharedSettings)
      ? goalsOn(sharedSettings, doneHistory, lens.day)
      : goals;
  const agentChanges = useAgentChanges(tasks);
  const agentTaskIds = useMemo(
    () => agentChanges.changes.map((change) => change.taskId),
    [agentChanges.changes],
  );
  const agentNotes = useMemo(
    () => new Map(agentChanges.changes.map((change) => [change.taskId, agentChangeNote(change)])),
    [agentChanges.changes],
  );
  // A change that arrives while the agents lens is open joins it.
  if (openLens?.lens.kind === "agents" && openLens.lens.taskIds.join() !== agentTaskIds.join())
    setOpenLens({ ...openLens, lens: { kind: "agents", taskIds: agentTaskIds } });
  // However the agents lens ends, what it showed now counts as looked at.
  const inAgentsLens = lens?.kind === "agents";
  const wasInAgentsLens = useRef(false);
  const { markSeen: markAgentChangesSeen } = agentChanges;
  useEffect(() => {
    if (wasInAgentsLens.current && !inAgentsLens) markAgentChangesSeen();
    wasInAgentsLens.current = inAgentsLens;
  }, [inAgentsLens, markAgentChangesSeen]);
  // The quest card waits for the first load, so the welcome starts over the first task.
  const [tasksLoaded, setTasksLoaded] = useState(false);
  if (!tasksLoaded && !loading) setTasksLoaded(true);
  const {
    optimisticCreate,
    setOptimisticCreate,
    statusUndo,
    redoEntry,
    historyBusy,
    newTaskId,
    savedTask,
    exitingTaskIds,
    landingTaskIds,
    pickerRemoveBlocker,
    pickerRemoveParent,
    pickerSelected,
    pauseTaskFromPalette,
    recordOperationUndo,
    classificationRenamed,
    handleUndoStatus,
    handleRedo,
    showOptimisticCreate,
    taskSaved,
    handleStatusChanged,
    handleStatusBatchChanged,
    handleCanceledMany,
    showTaskUpdates,
  } = useWorkspaceActions({
    workspace,
    taskView,
    taskListRef,
    composerRef,
    picker,
    requestActiveTask,
    setAnnouncement,
    closePicker,
    closeComposer,
    closeHelp: () => setHelpOpen(false),
  });

  /** `L`: the New task editor, for a task already done. */
  function openLog(): void {
    if (composerRef.current) return;
    openCreate();
    setComposer((current) => (current?.mode === "create" ? { ...current, logged: true } : current));
  }

  function openCreate(parentId?: string, capture?: Capture): void {
    if (composerRef.current) return;
    if (parentId) {
      const parent = tasks.find((task) => task.id === parentId);
      if (parent?.status === "canceled") {
        setAnnouncement(`${parent.title} is canceled. Reopen it before creating a child.`);
        return;
      }
    }
    if (helpOpen) {
      focusStack.restore("help");
      setHelpOpen(false);
    }
    taskListRef.current?.clearActiveTaskSelection();
    const classification = [
      ...(categoryFilter ? [`@${categoryFilter.slug}`] : []),
      ...tagFilter.map((tag) => `#${tag.slug}`),
    ];
    const initialTitle = [...classification, capture?.title ?? ""].join(" ").trimStart();
    setComposer({
      mode: "create",
      ...(parentId ? { parentId } : {}),
      ...(initialTitle ? { initialTitle } : {}),
      ...(capture?.description ? { initialDescription: capture.description } : {}),
      ...(capture?.image ? { initialImage: capture.image } : {}),
    });
  }

  function openEdit(task: TaskView): void {
    if (composerRef.current?.mode === "create") return;
    setComposer({ mode: "edit", task });
  }

  function closeComposer(): void {
    setComposer(null);
  }
  useGlobalHotkeys(() => openCreate());
  // Android: the launcher's New task shortcut, or something shared from another app. An editor
  // already open keeps the launch waiting rather than losing what was shared.
  const takeLaunch = useEffectEvent(() => {
    if (document.visibilityState !== "visible" || composerRef.current) return;
    void takeCapture().then(
      (capture) => capture && openCreate(undefined, capture),
      (error: unknown) => showTaskToast(error instanceof Error ? error.message : String(error)),
    );
  });
  useEffect(() => {
    takeLaunch();
    document.addEventListener("visibilitychange", takeLaunch);
    return () => document.removeEventListener("visibilitychange", takeLaunch);
  }, []);
  useAndroidBack();

  const onAppKeyDown = useEffectEvent((event: KeyboardEvent): void => {
    if (event.isComposing || event.repeat) return;
    const target = event.target;
    const typing =
      target instanceof HTMLElement &&
      (target.matches("input, textarea, [contenteditable=true]") ||
        target.closest('[role="dialog"], [data-inline-task-editor]') !== null);
    if (event.key === "Escape" && learnOpen) {
      event.preventDefault();
      setLearnOpen(false);
      return;
    }
    const id = boundAction(event);
    // A plain key types into fields and dialogs; only Ctrl/⌘ or Alt keys reach past them.
    if (typing && !event.ctrlKey && !event.metaKey && !event.altKey) return;
    if (id === "learn.panel") {
      event.preventDefault();
      toggleLearn("keys");
    } else if (id === "settings.open") {
      event.preventDefault();
      if (settingsOpen) setSettingsOpen(false);
      else {
        practice("settings.open");
        openSettings();
      }
    } else if (id === "theme.picker") {
      event.preventDefault();
      if (themesOpen) setThemesOpen(false);
      else {
        practice("theme.picker");
        openThemes();
      }
    } else if (id === "help.palette") {
      event.preventDefault();
      if (helpOpen) setHelpOpen(false);
      else {
        practice("help.palette");
        openHelp();
      }
    }
  });
  useEffect(() => {
    window.addEventListener("keydown", onAppKeyDown);
    return () => window.removeEventListener("keydown", onAppKeyDown);
  }, []);

  function openHelp(): void {
    focusStack.push("help");
    setHelpOpen(true);
  }

  // From the palette the active element is its search field, which unmounts
  // on close, so a layer opened from it inherits the palette's own return
  // target. Consume it now: otherwise the palette's close would steal focus
  // back from the layer opening on top of it.
  function pushOverPalette(id: string): void {
    focusStack.push(id, helpOpen ? focusStack.restore("help") : undefined);
    setHelpOpen(false);
  }

  function openThemes(): void {
    pushOverPalette("themes");
    setThemesOpen(true);
  }

  function showListView(view: ListView): void {
    setStatusPreset(view.statusPreset);
    setExactStatus(view.exactStatus);
    setPriorityFilter(view.priorityFilter);
    setTagFilter(view.tagFilter);
    setSearchQuery(view.searchQuery);
    setShowUnblocked(view.showUnblocked);
    setCategoryFilter(view.categoryFilter);
    categoryFilterRef.current = view.categoryFilter?.slug ?? null;
    setSortField(view.sortField);
    setSortDirection(view.sortDirection);
    setCompletedSort(view.completedSort);
  }

  /** The view a lens shows: every other filter cleared, in the lens's own order. */
  function lensView(next: ListLens): ListView {
    const cleared = {
      statusPreset: "active" as const,
      priorityFilter: null,
      tagFilter: [],
      searchQuery: "",
      showUnblocked: false,
      categoryFilter: null,
      sortDirection: "desc" as const,
    };
    // Done sorts by its own Completed order; due sorts soonest first; agents, latest change first.
    return next.kind === "done"
      ? { ...cleared, exactStatus: "done", sortField, completedSort: true }
      : {
          ...cleared,
          exactStatus: null,
          sortField: next.kind === "due" ? "due" : "updated",
          completedSort,
        };
  }

  function enterLens(next: ListLens): void {
    setHelpOpen(false);
    setOpenLens({
      lens: next,
      returnTo: openLens?.returnTo ?? listView,
      place: openLens ? openLens.place : (taskListRef.current?.currentPlace() ?? null),
    });
    showListView(lensView(next));
    requestActiveTask();
    setAnnouncement(`Showing tasks ${lensPhrase(next)}`);
  }

  function leaveLens(): void {
    if (!openLens) return;
    // Back to the report, on the day it showed (`goals.report-back`).
    if (report?.dayLens) {
      const { under } = report.dayLens;
      setReport({ ...report, dayLens: undefined, takeOff: { kind: "day" } });
      if (under) {
        setOpenLens(under);
        showListView(lensView(under.lens));
        return;
      }
    }
    setOpenLens(null);
    showListView(openLens.returnTo);
    if (openLens.place) taskListRef.current?.restorePlace(openLens.place);
    requestActiveTask(openLens.place?.activeTaskId ?? null, true);
    setAnnouncement("Back to your list");
  }

  function toggleLens(kind: ListLens["kind"]): void {
    if (reportShown) {
      // The done count stands for the report too, so it closes it.
      closeGoalReport();
      if (kind === "done") return;
    }
    if (lens?.kind === kind) leaveLens();
    else
      enterLens(
        kind === "done"
          ? { kind, window: "day" }
          : kind === "agents"
            ? { kind, taskIds: agentTaskIds }
            : { kind },
      );
  }

  /** Narrows the done lens to one goal's tasks, or with undefined back to all of them. */
  function narrowDoneLens(goal: GoalLens | undefined): void {
    if (openLens?.lens.kind !== "done") return;
    const { window, day } = openLens.lens;
    const next: ListLens = { kind: "done", window, ...(day && { day }), ...(goal && { goal }) };
    setOpenLens({ ...openLens, lens: next });
    requestActiveTask();
  }

  function widenDoneLens(backward = false): void {
    if (reportShown) closeGoalReport();
    if (openLens?.lens.kind !== "done") {
      enterLens({ kind: "done", window: "week" });
      return;
    }
    const next: ListLens = {
      kind: "done",
      window: nextDoneWindow(openLens.lens.window, backward),
    };
    setHelpOpen(false);
    setOpenLens({ ...openLens, lens: next });
    requestActiveTask();
    setAnnouncement(`Showing tasks ${lensPhrase(next)}`);
  }

  /** Opens the goal report on today, flying in from the done lens's week dots when they show. */
  function openGoalReport(range: ReportRange): void {
    if (!hasGoals(sharedSettings)) {
      showTaskToast("Set a goal in Settings › Goals to see how your days went");
      return;
    }
    const dots = weekDots();
    setHelpOpen(false);
    setReport({
      range,
      day: dayOf(sharedSettings, new Date()),
      takeOff: dots.size > 0 ? { kind: "week", dots } : { kind: "count" },
    });
    setAnnouncement("Showing the goal report");
  }

  function closeGoalReport(): void {
    setReport(null);
    setAnnouncement("Back to your list");
    requestAnimationFrame(() => nav.last());
  }

  /** Shows one of the report's days in the done lens; going back returns to the report. */
  function openReportDay(day: string): void {
    if (!report) return;
    setReport({ ...report, day, dayLens: { under: openLens } });
    enterLens({ kind: "done", window: "day", day });
  }

  function openSettings(): void {
    pushOverPalette("settings");
    setSettingsOpen(true);
  }

  function openPicker(mode: TaskPickerMode, subject: TaskView): void {
    pushOverPalette("picker");
    setPicker({ mode, subject });
  }

  function closePicker(): void {
    setPicker(null);
  }

  function openCategoryPicker(): void {
    pushOverPalette("category-picker");
    setCategoryPickerOpen(true);
  }

  function openStatusMenu(): void {
    pushOverPalette("status-menu");
    setStatusMenuOpen(true);
  }

  function openPriorityMenu(): void {
    pushOverPalette("priority-menu");
    setPriorityMenuOpen(true);
  }

  function openTagPicker(): void {
    pushOverPalette("tag-picker");
    setTagPickerOpen(true);
  }

  function openSearch(): void {
    const fromPalette = helpOpen ? focusStack.restore("help") : undefined;
    setHelpOpen(false);
    if (searchOpen) {
      searchInput.current?.focus();
      return;
    }
    focusStack.push("search", fromPalette);
    setSearchOpen(true);
  }

  function closeSearch(): void {
    setSearchOpen(false);
    focusStack.restore("search")?.focus();
  }

  function toggleStatusPreset(): void {
    // A status change inside the lens settles on that ordinary view.
    setOpenLens(null);
    // Clearing an exact status returns to the current preset; otherwise toggle.
    if (exactStatus !== null) setExactStatus(null);
    else setStatusPreset(statusPreset === "active" ? "inactive" : "active");
    requestActiveTask();
  }

  function chooseSortField(field: SortField): void {
    if (field === shownSortField) return;
    if (field === "closed" && exactStatus !== "done") {
      setAnnouncement("Sorting by completed needs the Done filter");
      showTaskToast("Sorting by completed needs the Done filter");
      return;
    }
    sortFieldRef.current = field;
    if (exactStatus === "done") setCompletedSort(field === "closed");
    if (field !== "closed") setSortField(field);
    requestActiveTask();
    setAnnouncement(
      field === "manual" ? "Sorted by manual order" : `Sorted ${sortSummary(field, sortDirection)}`,
    );
  }

  function reverseSort(): void {
    if (shownSortField === "manual") return;
    const next = sortDirection === "desc" ? "asc" : "desc";
    setSortDirection(next);
    requestActiveTask();
    setAnnouncement(`Sorted ${sortSummary(shownSortField, next)}`);
  }

  function toggleDetails(): void {
    const next = !showDetails;
    setShowDetails(next);
    writePreference(SHOW_DETAILS_KEY, String(next));
    setAnnouncement(next ? "Showing task details" : "Hiding task details");
  }

  function setToolbarGroupFolded(group: ToolbarFoldGroup, folded: boolean): void {
    const next = TOOLBAR_FOLD_GROUPS.filter((entry) =>
      entry === group ? folded : foldedToolbarGroups.includes(entry),
    );
    setFoldedToolbarGroups(next);
    writePreference(FOLDED_TOOLBAR_GROUPS_KEY, JSON.stringify(next));
  }

  function changeFontSizeIncrease(increase: FontSizeIncrease): void {
    setFontSizeIncrease(increase);
    storeFontSizeIncrease(increase);
    setAnnouncement(increase === 0 ? "Font size reset" : `Font size increased by ${increase}%`);
  }

  function chooseStatusSelection(
    preset: StatusPreset | undefined,
    exact: TaskStatus | null | undefined,
  ): void {
    setStatusMenuOpen(false);
    setOpenLens(null);
    if (exact !== undefined) setExactStatus(exact);
    if (preset !== undefined) {
      setStatusPreset(preset);
      if (exact === undefined) setExactStatus(null);
    }
    requestActiveTask();
  }

  function choosePriority(priority: TaskPriority | null): void {
    setPriorityMenuOpen(false);
    setPriorityFilter(priority);
    requestActiveTask();
  }

  function chooseTags(tags: ClassificationOption[]): void {
    setTagFilter(tags);
    requestActiveTask();
  }

  function typeSearch(query: string): void {
    setSearchQuery(query);
    requestActiveTask();
  }

  function chooseSearch(query: string): void {
    if (searchOpen) closeSearch();
    typeSearch(query.trim());
  }

  function clearAllFilters(): void {
    // The lens's reset is its way back.
    if (openLens) {
      leaveLens();
      return;
    }
    setExactStatus(null);
    setStatusPreset("active");
    setPriorityFilter(null);
    setTagFilter([]);
    setSearchQuery("");
    setCategoryFilter(null);
    setShowUnblocked(false);
    requestActiveTask();
    setAnnouncement("Cleared all filters");
  }

  const hasActiveFilters =
    exactStatus !== null ||
    statusPreset !== "active" ||
    priorityFilter !== null ||
    tagFilter.length > 0 ||
    searchQuery.trim() !== "" ||
    categoryFilter !== null ||
    showUnblocked ||
    lens !== null;

  function clearCategoryFilter(
    _category: ClassificationToken | null = null,
    activeTaskId?: string,
  ): void {
    setCategoryFilter(null);
    categoryFilterRef.current = null;
    requestActiveTask(activeTaskId ?? null, activeTaskId !== undefined);
  }

  /** Filters follow a rename, the set-aside view too; tags that end up the same collapse to one. */
  function followRename(kind: "category" | "tag", from: string, to: string): void {
    const renamed = { slug: to, label: to };
    const follow = (view: Pick<ListView, "tagFilter" | "categoryFilter">) => ({
      tagFilter:
        kind === "tag"
          ? [
              ...new Map(
                view.tagFilter.map((tag) => [
                  tag.slug === from ? to : tag.slug,
                  tag.slug === from ? { ...tag, ...renamed } : tag,
                ]),
              ).values(),
            ]
          : view.tagFilter,
      categoryFilter:
        kind === "category" && view.categoryFilter?.slug === from ? renamed : view.categoryFilter,
    });
    const next = follow({ tagFilter, categoryFilter });
    setTagFilter(next.tagFilter);
    setCategoryFilter(next.categoryFilter);
    categoryFilterRef.current = next.categoryFilter?.slug ?? null;
    if (openLens)
      setOpenLens({
        ...openLens,
        returnTo: { ...openLens.returnTo, ...follow(openLens.returnTo) },
      });
  }

  function chooseCategory(category: ClassificationToken, activeTaskId?: string): void {
    setCategoryPickerOpen(false);
    setCategoryFilter(category);
    categoryFilterRef.current = category.slug;
    requestActiveTask(activeTaskId ?? null, activeTaskId !== undefined);
    setAnnouncement(`Showing ${category.label} tasks`);
  }

  return (
    <main className="fixed inset-0 overflow-hidden bg-background text-foreground">
      <WorkspaceRequestRecovery workspace={workspace} />
      {/* Desktop content is 20 cells wide, keeping the header buttons on the toolbar grid. */}
      <div className="app-shell mx-auto flex h-full min-h-0 w-full max-w-170 flex-col gap-6 overflow-hidden md:max-w-224">
        <header className="relative flex items-center justify-between gap-4" data-app-header>
          <h1 className="flex items-center font-semibold">
            {/* Center the artwork on the first cell and the title's ink rather than its line box. */}
            <AppIcon className="size-8 shrink-0 -translate-y-0.25" />
            <span className="text-3xl leading-none">{APP_NAME}</span>
          </h1>
          {/* The count stands apart from the joined group, so its pressed state keeps round corners. */}
          <div className="flex items-center">
            <ConflictCount total={syncConflicts.length} onOpen={() => setConflictsOpen(true)} />
            <AgentChanges
              total={agentChanges.total}
              agents={[...new Set(agentChanges.changes.map((change) => change.agent))]}
              lensOn={lens?.kind === "agents"}
              onToggleLens={() => toggleLens("agents")}
            />
            <DueNow
              total={dueNowCount}
              lensOn={lens?.kind === "due"}
              onToggleLens={() => {
                practice("due.lens", "pointer");
                toggleLens("due");
              }}
            />
            <DoneToday
              total={doneTodayCount}
              goals={goals}
              week={week}
              categoryFilter={categoryFilter?.slug ?? null}
              landing={landingTaskIds.size}
              lensOn={lens?.kind === "done" || reportShown}
              onToggleLens={() => {
                practice("done.lens", "pointer");
                toggleLens("done");
              }}
            />
            <ButtonRow
              onKeyDown={(event) => {
                if (
                  event.key === "Tab" &&
                  event.shiftKey &&
                  !event.ctrlKey &&
                  !event.metaKey &&
                  !event.altKey
                ) {
                  event.preventDefault();
                  nav.last();
                }
              }}
            >
              <Tooltip>
                <TooltipTrigger
                  render={
                    <ToggleButton
                      selected={learnOpen}
                      variant="ghost"
                      size="icon"
                      tabIndex={-1}
                      aria-keyshortcuts={ariaShortcut("learn.panel")}
                      onMouseDown={preventFocusSteal}
                      onClick={() => toggleLearn("pointer")}
                    />
                  }
                >
                  <LearnIcon
                    progress={
                      questsShown && !questsAllComplete
                        ? learning.learnedCount / learning.moves.length
                        : 1
                    }
                    celebrate={questCelebrating}
                    finale={questCelebrating && questsAllComplete}
                  />
                  <span className="sr-only">Learn</span>
                </TooltipTrigger>
                <TooltipContent>
                  Learn <BindingKbd id="learn.panel" />
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <ToggleButton
                      selected={themesOpen}
                      variant="ghost"
                      size="icon"
                      tabIndex={-1}
                      aria-keyshortcuts={ariaShortcut("theme.picker")}
                      onMouseDown={preventFocusSteal}
                      onClick={() => {
                        practice("theme.picker", "pointer");
                        openThemes();
                      }}
                    />
                  }
                >
                  <Palette aria-hidden="true" />
                  <span className="sr-only">Themes</span>
                </TooltipTrigger>
                <TooltipContent>
                  Themes <BindingKbd id="theme.picker" />
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <ToggleButton
                      selected={settingsOpen}
                      variant="ghost"
                      size="icon"
                      tabIndex={-1}
                      aria-keyshortcuts={ariaShortcut("settings.open")}
                      onMouseDown={preventFocusSteal}
                      onClick={() => {
                        practice("settings.open", "pointer");
                        openSettings();
                      }}
                    />
                  }
                >
                  <Settings2 aria-hidden="true" />
                  <span className="sr-only">Settings</span>
                </TooltipTrigger>
                <TooltipContent>Settings</TooltipContent>
              </Tooltip>
            </ButtonRow>
          </div>
        </header>

        {/* Under the header on Android, so the soft keyboard never hides it (`platform.quest-card`). */}
        {mobile && tasksLoaded ? <QuestCard onLearn={() => toggleLearn("pointer")} /> : null}
        <TaskList
          ref={taskListRef}
          tasks={tasks}
          categories={categories}
          newTaskId={newTaskId}
          savedTask={savedTask}
          exitingTaskIds={exitingTaskIds}
          contextTasks={contextTasks}
          contextOrder={contextOrder}
          total={total}
          doneTodayCount={doneTodayCount}
          lens={lens}
          onToggleLens={toggleLens}
          onWidenDoneLens={widenDoneLens}
          onOpenGoalReport={openGoalReport}
          hidden={reportShown}
          goals={lensGoals}
          week={lens?.kind === "done" && lens.day === undefined ? week : null}
          onGoalLens={narrowDoneLens}
          agentNotes={agentNotes}
          statusPreset={statusPreset}
          exactStatus={exactStatus}
          onToggleStatusPreset={toggleStatusPreset}
          onResetStatusFilter={() => chooseStatusSelection("active", null)}
          onShowAllStatuses={() => chooseStatusSelection("all", null)}
          onExactStatus={(status) => chooseStatusSelection(undefined, status)}
          onOpenStatusMenu={openStatusMenu}
          priorityFilter={priorityFilter}
          onPriorityFilter={choosePriority}
          onOpenPriorityMenu={openPriorityMenu}
          showUnblocked={showUnblocked}
          onShowUnblockedChange={(next) => {
            setShowUnblocked(next);
            requestActiveTask();
          }}
          sortField={shownSortField}
          sortDirection={sortDirection}
          onSortFieldChange={chooseSortField}
          onReverseSort={reverseSort}
          showDetails={showDetails}
          onToggleDetails={toggleDetails}
          foldedToolbarGroups={foldedToolbarGroups}
          onToolbarGroupFoldedChange={setToolbarGroupFolded}
          categoryFilter={categoryFilter}
          onCategoryFilterChange={clearCategoryFilter}
          onSelectCategory={chooseCategory}
          onOpenCategoryPicker={openCategoryPicker}
          tagFilter={tagFilter}
          onTagFilterChange={chooseTags}
          onOpenTagPicker={openTagPicker}
          searchQuery={searchQuery}
          onSearchChange={chooseSearch}
          onOpenSearch={openSearch}
          searchInput={
            searchOpen ? (
              <InlineSearch
                ref={searchInput}
                initialQuery={searchQuery}
                onType={typeSearch}
                onSelect={chooseSearch}
              />
            ) : null
          }
          hasActiveFilters={hasActiveFilters}
          onClearAllFilters={clearAllFilters}
          activeTaskRequest={activeTaskRequest}
          loading={loading}
          error={loadError}
          nav={nav}
          onCreate={openCreate}
          onLogDone={openLog}
          composer={composer}
          optimisticTask={
            optimisticCreate && isCurrentViewMatch(optimisticCreate) ? optimisticCreate : null
          }
          onCloseComposer={closeComposer}
          onComposerSaved={taskSaved}
          onCreatePending={showOptimisticCreate}
          onCreateFailed={() => setOptimisticCreate(null)}
          onRefresh={refreshTasks}
          onAnnounce={setAnnouncement}
          onToast={(message) => showTaskToast(message)}
          onEdit={openEdit}
          onTaskUpdated={(task) => showTaskUpdates([task])}
          onTasksUpdated={showTaskUpdates}
          onOperation={(operationId, previous, current, wasActiveTaskId) =>
            recordOperationUndo(operationId, previous, current, { wasActiveTaskId })
          }
          onStatusChanged={handleStatusChanged}
          onStatusBatchChanged={handleStatusBatchChanged}
          canUndoStatus={statusUndo !== null && !historyBusy}
          onUndoStatus={() => void handleUndoStatus()}
          canRedo={redoEntry !== null && !historyBusy}
          onRedo={() => void handleRedo()}
          onCanceled={(task) => handleCanceledMany([task], [task])}
          onCanceledMany={handleCanceledMany}
          onAddBlocker={(task) => openPicker("blocker", task)}
          onMoveUnder={(task) => openPicker("move", task)}
        />
        {reportShown ? (
          <GoalReport
            settings={sharedSettings}
            done={doneHistory}
            range={report.range}
            day={report.day}
            takeOff={report.takeOff}
            onMove={(day) => setReport({ ...report, day })}
            onRange={(range) => setReport({ ...report, range })}
            onOpenDay={openReportDay}
            onClose={closeGoalReport}
          />
        ) : null}
        {mobile || !tasksLoaded ? null : <QuestCard onLearn={() => toggleLearn("pointer")} />}
        <p role="status" className="sr-only">
          {announcement}
        </p>
        <TaskToaster />
      </div>
      <LearnPanel
        open={learnOpen}
        onClose={() => setLearnOpen(false)}
        onOpenPalette={() => {
          setLearnOpen(false);
          openHelp();
        }}
      />
      <HelpPalette
        open={helpOpen}
        onOpenChange={setHelpOpen}
        finalFocus={() => focusStack.restore("help")}
        onOpenSettings={openSettings}
        onOpenThemes={openThemes}
        onToggleLens={toggleLens}
        onWidenDoneLens={widenDoneLens}
        onOpenGoalReport={() => openGoalReport("month")}
        onCreate={openCreate}
        onLogDone={openLog}
        onCreateChild={(task) => openCreate(task.id)}
        onOpenCategoryPicker={openCategoryPicker}
        onOpenStatusMenu={openStatusMenu}
        onOpenPriorityMenu={openPriorityMenu}
        onOpenTagPicker={openTagPicker}
        onOpenSearch={openSearch}
        activeTask={taskListRef.current?.getActiveTask()}
        onAddBlocker={(task) => openPicker("blocker", task)}
        onMoveUnder={(task) => openPicker("move", task)}
        onPauseTask={(task) => void pauseTaskFromPalette(task)}
        onCopyTask={(task) => void copyTaskText(task)}
        onCopyImage={(task) =>
          void copyImageMessage(task.attachments.at(-1)).then((message) => showTaskToast(message))
        }
        canUndoStatus={statusUndo !== null && !historyBusy}
        canRedo={redoEntry !== null && !historyBusy}
        onRedo={() => {
          setHelpOpen(false);
          void handleRedo();
        }}
        onUndoStatus={() => {
          setHelpOpen(false);
          void handleUndoStatus();
        }}
      />
      {categoryPickerOpen ? (
        <CategoryPicker
          open
          onClose={() => setCategoryPickerOpen(false)}
          finalFocus={() => focusStack.restore("category-picker") ?? undefined}
          onSelect={chooseCategory}
          onRenamed={(renamed) => {
            followRename("category", renamed.from, renamed.to);
            void renameCategorySettings(renamed.from, renamed.to);
            classificationRenamed(renamed, "@");
          }}
        />
      ) : null}
      {statusMenuOpen ? (
        <StatusMenu
          open
          onClose={() => setStatusMenuOpen(false)}
          finalFocus={() => focusStack.restore("status-menu") ?? undefined}
          preset={statusPreset}
          exactStatus={exactStatus}
          onSelect={chooseStatusSelection}
        />
      ) : null}
      {priorityMenuOpen ? (
        <PriorityMenu
          open
          onClose={() => setPriorityMenuOpen(false)}
          finalFocus={() => focusStack.restore("priority-menu") ?? undefined}
          selected={priorityFilter}
          onSelect={choosePriority}
        />
      ) : null}
      {tagPickerOpen ? (
        <TagPicker
          open
          onClose={() => setTagPickerOpen(false)}
          finalFocus={() => focusStack.restore("tag-picker") ?? undefined}
          selected={tagFilter}
          onChange={chooseTags}
          onRenamed={(renamed) => {
            followRename("tag", renamed.from, renamed.to);
            classificationRenamed(renamed, "#");
          }}
        />
      ) : null}
      {picker ? (
        <TaskPicker
          open
          mode={picker.mode}
          subject={tasks.find((task) => task.id === picker.subject.id) ?? picker.subject}
          onClose={closePicker}
          finalFocus={() => focusStack.restore("picker") ?? undefined}
          onSelect={(target) => void pickerSelected(target)}
          onRemoveBlocker={(blockerId) => void pickerRemoveBlocker(blockerId)}
          onRemoveParent={() => void pickerRemoveParent()}
        />
      ) : null}
      <ThemePicker
        open={themesOpen}
        onOpenChange={setThemesOpen}
        trigger={null}
        shortcut={false}
        finalFocus={() => focusStack.restore("themes")}
        tagline={{ text: "Capture quickly,", highlight: "choose what matters" }}
      />
      {conflictsOpen && syncConflicts.length > 0 ? (
        <ConflictDialog
          conflicts={syncConflicts}
          onClose={() => setConflictsOpen(false)}
          onKeep={async (conflict, versionRef) => {
            try {
              await keepSyncConflictVersion(conflict.issueId, versionRef);
            } finally {
              // A refusal usually means the versions changed underneath, so show the current ones.
              if ((await reloadSyncConflicts()).length === 0) setConflictsOpen(false);
              void refreshTasks();
            }
          }}
        />
      ) : null}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        finalFocus={() => focusStack.restore("settings")}
        fontSizeIncrease={fontSizeIncrease}
        onFontSizeIncreaseChange={changeFontSizeIncrease}
        homeSection={homeSection}
      />
    </main>
  );
}
