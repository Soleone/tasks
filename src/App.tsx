import { useWorkspaceTasks } from "./useWorkspaceTasks";
import { useWorkspaceActions } from "./useWorkspaceActions";
import { useAppUpdate } from "./useAppUpdate";
import { useHeaderCounts } from "./useHeaderCounts";
import { useEffect, useEffectEvent, useRef, useState, type ReactElement } from "react";
import { Palette, Settings2 } from "lucide-react";
import { AppIcon } from "@/components/AppIcon";
import { WorkspaceRequestRecovery } from "@/components/WorkspaceRequestRecovery";
import type { MainWorkspace } from "@/platform/mainWorkspace";
import type { ClassificationToken } from "@/backend/taskText";
import type { TaskPriority, TaskStatus } from "@/backend/taskModel";
import type { ClassificationOption, TaskView } from "@/components/taskView";
import { lensPhrase, widerDoneWindow, type ListLens } from "@/components/listLens";
import {
  sortSummary,
  type SortDirection,
  type SortField,
  type StatusPreset,
} from "@/components/taskFilters";
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
import { DoneToday, DueNow } from "@/components/LensCounts";
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
import { ToggleButton } from "@/components/variants/button";
import { ButtonRow } from "@/components/variants/button-group";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { preventFocusSteal, useFocusNavigation, useFocusStack } from "@/navigation";
import { selectMainWorkspace } from "@/platform/backendClient";
import { APP_NAME } from "./backend/branding";
import {
  readStoredFontSizeIncrease,
  storeFontSizeIncrease,
  type FontSizeIncrease,
} from "@/fontSize";
import { practice, useLearning } from "@/learning/progress";
import { useQuests } from "@/learning/questProgress";
import { readPreference, writePreference } from "@/platform/preferences";
import { isAndroid } from "@/platform/runtime";
import { THEME_STORAGE_KEY } from "@/theme/config";

const STATUS_PRESET_KEY = "tasks.statusPreset";
const EXACT_STATUS_KEY = "tasks.exactStatus";
const PRIORITY_FILTER_KEY = "tasks.priorityFilter";
const TAG_FILTER_KEY = "tasks.tagFilter";
const SEARCH_QUERY_KEY = "tasks.searchQuery";
const UNBLOCKED_FILTER_KEY = "tasks.showUnblocked";
const CATEGORY_FILTER_KEY = "tasks.categoryFilter";
const SORT_FIELD_KEY = "tasks.sortField";
const SORT_DIRECTION_KEY = "tasks.sortDirection";
const COMPLETED_SORT_KEY = "tasks.completedSort";
const SHOW_DETAILS_KEY = "tasks.showDetails";
const FOLDED_TOOLBAR_GROUPS_KEY = "tasks.foldedToolbarGroups";
const LEGACY_SHOW_TIMESTAMPS_KEY = "tasks.showTimestamps";

function readStatusPreset(): StatusPreset {
  const stored = readPreference(STATUS_PRESET_KEY);
  return stored === "inactive" || stored === "all" ? stored : "active";
}

function readExactStatus(): TaskStatus | null {
  const stored = readPreference(EXACT_STATUS_KEY);
  return stored === "open" ||
    stored === "in_progress" ||
    stored === "paused" ||
    stored === "done" ||
    stored === "canceled"
    ? stored
    : null;
}

function readPriorityFilter(): TaskPriority | null {
  const stored = readPreference(PRIORITY_FILTER_KEY);
  return stored !== null && /^[0-4]$/.test(stored) ? (Number(stored) as TaskPriority) : null;
}

function readCategorySlug(): string | null {
  const stored = readPreference(CATEGORY_FILTER_KEY);
  return stored !== null && stored !== "" ? stored : null;
}

function readInitialTagFilter(): ClassificationOption[] {
  return readSlugs(TAG_FILTER_KEY).map((slug) => ({ slug, label: slug, taskCount: 0 }));
}

function readInitialCategoryFilter(): ClassificationToken | null {
  const slug = readCategorySlug();
  return slug ? { slug, label: slug } : null;
}

function readSlugs(key: string): string[] {
  const stored = readPreference(key);
  if (!stored) return [];
  try {
    const value: unknown = JSON.parse(stored);
    return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : [];
  } catch {
    return [];
  }
}

function readSortField(): SortField {
  const stored = readPreference(SORT_FIELD_KEY);
  return stored === "created" ||
    stored === "updated" ||
    stored === "priority" ||
    stored === "effort" ||
    stored === "due" ||
    stored === "manual"
    ? stored
    : "created";
}

function readSortDirection(): SortDirection {
  return readPreference(SORT_DIRECTION_KEY) === "asc" ? "asc" : "desc";
}

function readShowDetails(): boolean {
  return (
    (readPreference(SHOW_DETAILS_KEY) ?? readPreference(LEGACY_SHOW_TIMESTAMPS_KEY)) === "true"
  );
}

function readFoldedToolbarGroups(): ToolbarFoldGroup[] {
  try {
    const stored: unknown = JSON.parse(readPreference(FOLDED_TOOLBAR_GROUPS_KEY) ?? "[]");
    return TOOLBAR_FOLD_GROUPS.filter((group) => Array.isArray(stored) && stored.includes(group));
  } catch {
    return [];
  }
}

/** What the list shows: remembered between launches, and set aside while the done lens is on. */
type ListView = {
  statusPreset: StatusPreset;
  exactStatus: TaskStatus | null;
  priorityFilter: TaskPriority | null;
  tagFilter: ClassificationOption[];
  searchQuery: string;
  showUnblocked: boolean;
  categoryFilter: ClassificationToken | null;
  sortField: SortField;
  sortDirection: SortDirection;
  /** Whether the Done filter sorts by completion; other views never do. */
  completedSort: boolean;
};

/** How each part of the list view is stored. */
const VIEW_PREFERENCES: [key: string, stored: (view: ListView) => string][] = [
  [STATUS_PRESET_KEY, (view) => view.statusPreset],
  [EXACT_STATUS_KEY, (view) => view.exactStatus ?? ""],
  [
    PRIORITY_FILTER_KEY,
    (view) => (view.priorityFilter === null ? "" : String(view.priorityFilter)),
  ],
  [TAG_FILTER_KEY, (view) => JSON.stringify(view.tagFilter.map((tag) => tag.slug))],
  [SEARCH_QUERY_KEY, (view) => view.searchQuery],
  [UNBLOCKED_FILTER_KEY, (view) => String(view.showUnblocked)],
  [CATEGORY_FILTER_KEY, (view) => view.categoryFilter?.slug ?? ""],
  [SORT_FIELD_KEY, (view) => view.sortField],
  [SORT_DIRECTION_KEY, (view) => view.sortDirection],
  [COMPLETED_SORT_KEY, (view) => String(view.completedSort)],
];

/** The lens on screen and the way back from it. Switching lenses keeps the way back. */
type OpenLens = { lens: ListLens; returnTo: ListView; place: TaskListPlace | null };

// The list is the default surface. Create and edit use an inline editor opened
// by the New task button, the C key, or the palette. Tab does not leave the
// task editor or list.
export default function App({ workspace }: { workspace: MainWorkspace }): ReactElement {
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
  const android = isAndroid();
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
    contextTasks,
    contextOrder,
    total,
    loading,
    loadError,
    sortFieldRef,
    categoryFilterRef,
    refreshTasks,
    isCurrentViewMatch,
  } = taskView;
  const { doneToday: doneTodayCount, dueNow: dueNowCount } = useHeaderCounts(tasks);
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

  function openCreate(parentId?: string): void {
    if (composerRef.current) return;
    if (parentId && !workspace.supportsRelationships) {
      setAnnouncement("Child capture is not yet available in this selected workspace.");
      return;
    }
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
    const initialTitle = classification.length > 0 ? `${classification.join(" ")} ` : undefined;
    setComposer(
      parentId
        ? { mode: "create", parentId, ...(initialTitle ? { initialTitle } : {}) }
        : { mode: "create", ...(initialTitle ? { initialTitle } : {}) },
    );
  }

  function openEdit(task: TaskView): void {
    if (composerRef.current?.mode === "create") return;
    setComposer({ mode: "edit", task });
  }

  function closeComposer(): void {
    setComposer(null);
  }

  const onAppKeyDown = useEffectEvent((event: KeyboardEvent): void => {
    if (event.isComposing || event.repeat) return;
    const target = event.target;
    const typing =
      target instanceof HTMLElement &&
      (target.matches("input, textarea, [contenteditable=true]") ||
        target.closest('[role="dialog"], [data-inline-task-editor]') !== null);
    if (event.key === "?" && !event.ctrlKey && !event.metaKey && !event.altKey && !typing) {
      event.preventDefault();
      toggleLearn("keys");
      return;
    }
    if (event.key === "Escape" && learnOpen) {
      event.preventDefault();
      setLearnOpen(false);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key === ",") {
      event.preventDefault();
      if (settingsOpen) setSettingsOpen(false);
      else {
        practice("settings.open");
        openSettings();
      }
      return;
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "t") {
      event.preventDefault();
      if (themesOpen) setThemesOpen(false);
      else {
        practice("theme.picker");
        openThemes();
      }
      return;
    }
    if (event.altKey) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (helpOpen) setHelpOpen(false);
      else {
        practice("help.palette");
        openHelp();
      }
      return;
    }
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => onAppKeyDown(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function openHelp(): void {
    focusStack.push("help");
    setHelpOpen(true);
  }

  function openThemes(): void {
    const fromPalette = helpOpen ? focusStack.restore("help") : undefined;
    focusStack.push("themes", fromPalette);
    setHelpOpen(false);
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
    // Done sorts by its own Completed order; due sorts soonest first.
    return next.kind === "done"
      ? { ...cleared, exactStatus: "done", sortField, completedSort: true }
      : { ...cleared, exactStatus: null, sortField: "due", completedSort };
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
    setOpenLens(null);
    showListView(openLens.returnTo);
    if (openLens.place) taskListRef.current?.restorePlace(openLens.place);
    requestActiveTask(openLens.place?.activeTaskId ?? null, true);
    setAnnouncement("Back to your list");
  }

  function toggleLens(kind: ListLens["kind"]): void {
    if (lens?.kind === kind) leaveLens();
    else enterLens(kind === "done" ? { kind, window: "day" } : { kind });
  }

  function widenDoneLens(): void {
    if (openLens?.lens.kind !== "done") {
      enterLens({ kind: "done", window: "week" });
      return;
    }
    const next: ListLens = { kind: "done", window: widerDoneWindow(openLens.lens.window) };
    setHelpOpen(false);
    setOpenLens({ ...openLens, lens: next });
    requestActiveTask();
    setAnnouncement(`Showing tasks ${lensPhrase(next)}`);
  }

  // From the palette the active element is its search field, which unmounts
  // on close, so settings inherits the palette's own return target. Consume
  // it now: otherwise the palette's close would steal focus back from the
  // settings dialog opening on top of it.
  function openSettings(): void {
    const fromPalette = helpOpen ? focusStack.restore("help") : undefined;
    focusStack.push("settings", fromPalette);
    setHelpOpen(false);
    setSettingsOpen(true);
  }

  function openPicker(mode: TaskPickerMode, subject: TaskView): void {
    if (!workspace.supportsRelationships) {
      setAnnouncement("Relationship changes are not yet available in this selected workspace.");
      return;
    }
    // From the palette, inherit its return target like settings does so the
    // picker's close restores focus past the unmounted palette search field.
    const fromPalette = helpOpen ? focusStack.restore("help") : undefined;
    focusStack.push("picker", fromPalette ?? undefined);
    setHelpOpen(false);
    setPicker({ mode, subject });
  }

  function closePicker(): void {
    setPicker(null);
  }

  function openCategoryPicker(): void {
    const fromPalette = helpOpen ? focusStack.restore("help") : undefined;
    focusStack.push("category-picker", fromPalette ?? undefined);
    setHelpOpen(false);
    setCategoryPickerOpen(true);
  }

  function closeCategoryPicker(): void {
    setCategoryPickerOpen(false);
  }

  function openStatusMenu(): void {
    const fromPalette = helpOpen ? focusStack.restore("help") : undefined;
    focusStack.push("status-menu", fromPalette ?? undefined);
    setHelpOpen(false);
    setStatusMenuOpen(true);
  }

  function openPriorityMenu(): void {
    const fromPalette = helpOpen ? focusStack.restore("help") : undefined;
    focusStack.push("priority-menu", fromPalette ?? undefined);
    setHelpOpen(false);
    setPriorityMenuOpen(true);
  }

  function openTagPicker(): void {
    const fromPalette = helpOpen ? focusStack.restore("help") : undefined;
    focusStack.push("tag-picker", fromPalette ?? undefined);
    setHelpOpen(false);
    setTagPickerOpen(true);
  }

  function openSearch(): void {
    const fromPalette = helpOpen ? focusStack.restore("help") : undefined;
    setHelpOpen(false);
    if (searchOpen) {
      searchInput.current?.focus();
      return;
    }
    focusStack.push("search", fromPalette ?? undefined);
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

  function chooseExactStatus(status: TaskStatus | null): void {
    setStatusMenuOpen(false);
    setOpenLens(null);
    setExactStatus(status);
    requestActiveTask();
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

  function resetStatusFilter(): void {
    chooseStatusSelection("active", null);
  }

  function showAllStatuses(): void {
    chooseStatusSelection("all", null);
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

  function chooseSearch(query: string): void {
    if (searchOpen) closeSearch();
    const next = query.trim();
    setSearchQuery(next);
    requestActiveTask();
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
        <header className="flex items-center justify-between gap-4">
          <h1 className="flex items-center font-semibold">
            {/* Center the artwork on the first cell and the title's ink rather than its line box. */}
            <AppIcon className="size-8 shrink-0 -translate-y-0.25" />
            <span className="text-3xl leading-none">{APP_NAME}</span>
          </h1>
          {/* The count stands apart from the joined group, so its pressed state keeps round corners. */}
          <div className="flex items-center">
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
              landing={landingTaskIds.size}
              lensOn={lens?.kind === "done"}
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
                      aria-keyshortcuts="Shift+/"
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
                  Learn <Kbd>?</Kbd>
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
                      aria-keyshortcuts="Alt+t"
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
                  Themes <Kbd>Alt T</Kbd>
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
                      aria-keyshortcuts="Control+, Meta+,"
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
        {android && tasksLoaded ? <QuestCard onLearn={() => toggleLearn("pointer")} /> : null}
        <TaskList
          ref={taskListRef}
          tasks={tasks}
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
          statusPreset={statusPreset}
          exactStatus={exactStatus}
          onToggleStatusPreset={toggleStatusPreset}
          onResetStatusFilter={resetStatusFilter}
          onShowAllStatuses={showAllStatuses}
          onExactStatus={chooseExactStatus}
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
                onSelect={chooseSearch}
                onClose={closeSearch}
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
        {android || !tasksLoaded ? null : <QuestCard onLearn={() => toggleLearn("pointer")} />}
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
        onCreate={openCreate}
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
          onClose={closeCategoryPicker}
          finalFocus={() => focusStack.restore("category-picker") ?? undefined}
          onSelect={chooseCategory}
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
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        finalFocus={() => focusStack.restore("settings")}
        fontSizeIncrease={fontSizeIncrease}
        onFontSizeIncreaseChange={changeFontSizeIncrease}
      />
    </main>
  );
}
