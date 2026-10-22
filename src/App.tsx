import { useWorkspaceTasks } from "./useWorkspaceTasks";
import { useWorkspaceActions } from "./useWorkspaceActions";
import { useEffect, useEffectEvent, useRef, useState, type ReactElement } from "react";
import { CircleHelp, Palette, Settings2 } from "lucide-react";
import { AppIcon } from "@/components/AppIcon";
import { WorkspaceRequestRecovery } from "@/components/WorkspaceRequestRecovery";
import type { MainWorkspace } from "@/platform/mainWorkspace";
import type { ClassificationToken } from "@/backend/taskText";
import type { TaskPriority, TaskStatus } from "@/backend/taskModel";
import type { ClassificationOption, TaskView } from "@/components/taskView";
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
import { StarterHelp } from "@/components/StarterHelp";
import { DisableKeyboardHelpDialog } from "@/components/DisableKeyboardHelpDialog";
import { TaskPicker, type TaskPickerMode } from "@/components/TaskPicker";
import { useTheme } from "@/components/soleone/theme";
import { ThemePicker } from "@/components/soleone/theme-picker";
import { SettingsDialog } from "@/components/SettingsDialog";
import { copyTaskText, TaskList, type TaskListHandle } from "@/components/TaskList";
import { TOOLBAR_FOLD_GROUPS, type ToolbarFoldGroup } from "@/components/TaskListToolbar";
import { showTaskToast, TaskToaster } from "@/components/TaskToaster";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
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
import { isKeyboardHelpMode, type KeyboardHelpMode } from "@/keyboardHelp";
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
const SHOW_DETAILS_KEY = "tasks.showDetails";
const FOLDED_TOOLBAR_GROUPS_KEY = "tasks.foldedToolbarGroups";
const LEGACY_SHOW_TIMESTAMPS_KEY = "tasks.showTimestamps";
const HELP_MODE_KEY = "tasks.helpMode";

function readStatusPreset(): StatusPreset {
  return readPreference(STATUS_PRESET_KEY) === "inactive" ? "inactive" : "active";
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

function readHelpMode(): KeyboardHelpMode {
  const stored = readPreference(HELP_MODE_KEY);
  if (isKeyboardHelpMode(stored)) return stored;
  // Preserve the old checkbox preference: enabled meant full contextual help,
  // while disabled left the task-list shortcut guides available.
  if (stored === "true") return "full";
  if (stored === "false") return "basic";
  return isAndroid() ? "none" : "full";
}

// The list is the default surface. Create and edit use an inline editor opened
// by the New task button, the C key, or the palette. Tab does not leave the
// task editor or list.
export default function App({ workspace }: { workspace: MainWorkspace }): ReactElement {
  // Rebind after development module reloads before the list's query effects run.
  useEffect(() => {
    selectMainWorkspace(workspace);
  }, [workspace]);
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
  const [helpMode, setHelpMode] = useState(readHelpMode);
  const [fontSizeIncrease, setFontSizeIncrease] = useState<FontSizeIncrease>(
    readStoredFontSizeIncrease,
  );
  const [sortField, setSortField] = useState(readSortField);
  const [sortDirection, setSortDirection] = useState(readSortDirection);
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
  const [starterHelpOpen, setStarterHelpOpen] = useState(false);
  const [disableHelpTarget, setDisableHelpTarget] = useState<"basic" | "none" | null>(null);
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

  const taskView = useWorkspaceTasks({
    statusPreset,
    exactStatus,
    priorityFilter,
    tagFilter,
    searchQuery,
    showUnblocked,
    sortField,
    sortDirection,
    categoryFilter,
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
  const {
    optimisticCreate,
    setOptimisticCreate,
    statusUndo,
    redoEntry,
    historyBusy,
    newTaskId,
    exitingTaskIds,
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
    if (composerRef.current) return;
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
      setStarterHelpOpen((open) => !open);
      return;
    }
    if (event.key === "Escape" && starterHelpOpen) {
      event.preventDefault();
      setStarterHelpOpen(false);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key === ",") {
      event.preventDefault();
      if (settingsOpen) setSettingsOpen(false);
      else openSettings();
      return;
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "t") {
      event.preventDefault();
      if (themesOpen) setThemesOpen(false);
      else openThemes();
      return;
    }
    if (event.altKey) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (helpOpen) setHelpOpen(false);
      else openHelp();
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

  function openDisableHelpDialog(mode: "basic" | "none"): void {
    focusStack.push("disable-help");
    setDisableHelpTarget(mode);
  }

  function confirmDisableHelp(): void {
    if (disableHelpTarget === null) return;
    changeHelpMode(disableHelpTarget);
    setDisableHelpTarget(null);
  }

  function openThemes(): void {
    const fromPalette = helpOpen ? focusStack.restore("help") : undefined;
    focusStack.push("themes", fromPalette);
    setHelpOpen(false);
    setThemesOpen(true);
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
    // Clearing an exact status returns to the current preset; otherwise toggle.
    if (exactStatus !== null) {
      setExactStatus(null);
      writePreference(EXACT_STATUS_KEY, "");
    } else {
      const next = statusPreset === "active" ? "inactive" : "active";
      setStatusPreset(next);
      writePreference(STATUS_PRESET_KEY, next);
    }
    requestActiveTask();
  }

  function chooseSortField(field: SortField): void {
    if (field === sortField) return;
    sortFieldRef.current = field;
    setSortField(field);
    requestActiveTask();
    writePreference(SORT_FIELD_KEY, field);
    setAnnouncement(
      field === "manual" ? "Sorted by manual order" : `Sorted ${sortSummary(field, sortDirection)}`,
    );
  }

  function reverseSort(): void {
    if (sortField === "manual") return;
    const next = sortDirection === "desc" ? "asc" : "desc";
    setSortDirection(next);
    requestActiveTask();
    writePreference(SORT_DIRECTION_KEY, next);
    setAnnouncement(`Sorted ${sortSummary(sortField, next)}`);
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

  function changeHelpMode(mode: KeyboardHelpMode): void {
    setHelpMode(mode);
    writePreference(HELP_MODE_KEY, mode);
    setAnnouncement(
      mode === "full"
        ? "Full keyboard help enabled"
        : mode === "basic"
          ? "Basic keyboard help enabled"
          : "Keyboard help disabled",
    );
  }

  function changeFontSizeIncrease(increase: FontSizeIncrease): void {
    setFontSizeIncrease(increase);
    storeFontSizeIncrease(increase);
    setAnnouncement(increase === 0 ? "Font size reset" : `Font size increased by ${increase}%`);
  }

  function chooseExactStatus(status: TaskStatus | null): void {
    setStatusMenuOpen(false);
    setExactStatus(status);
    writePreference(EXACT_STATUS_KEY, status ?? "");
    requestActiveTask();
  }

  function chooseStatusSelection(
    preset: StatusPreset | undefined,
    exact: TaskStatus | null | undefined,
  ): void {
    setStatusMenuOpen(false);
    if (exact !== undefined) {
      setExactStatus(exact);
      writePreference(EXACT_STATUS_KEY, exact ?? "");
    }
    if (preset !== undefined) {
      setStatusPreset(preset);
      writePreference(STATUS_PRESET_KEY, preset);
      if (exact === undefined) {
        setExactStatus(null);
        writePreference(EXACT_STATUS_KEY, "");
      }
    }
    requestActiveTask();
  }

  function resetStatusFilter(): void {
    chooseStatusSelection("active", null);
  }

  function choosePriority(priority: TaskPriority | null): void {
    setPriorityMenuOpen(false);
    setPriorityFilter(priority);
    writePreference(PRIORITY_FILTER_KEY, priority === null ? "" : String(priority));
    requestActiveTask();
  }

  function chooseTags(tags: ClassificationOption[]): void {
    setTagFilter(tags);
    writePreference(TAG_FILTER_KEY, JSON.stringify(tags.map((tag) => tag.slug)));
    requestActiveTask();
  }

  function chooseSearch(query: string): void {
    if (searchOpen) closeSearch();
    const next = query.trim();
    setSearchQuery(next);
    writePreference(SEARCH_QUERY_KEY, next);
    requestActiveTask();
  }

  function clearAllFilters(): void {
    setExactStatus(null);
    setStatusPreset("active");
    setPriorityFilter(null);
    setTagFilter([]);
    setSearchQuery("");
    setCategoryFilter(null);
    setShowUnblocked(false);
    writePreference(EXACT_STATUS_KEY, "");
    writePreference(STATUS_PRESET_KEY, "active");
    writePreference(PRIORITY_FILTER_KEY, "");
    writePreference(TAG_FILTER_KEY, "[]");
    writePreference(SEARCH_QUERY_KEY, "");
    writePreference(CATEGORY_FILTER_KEY, "");
    writePreference(UNBLOCKED_FILTER_KEY, "false");
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
    showUnblocked;

  function clearCategoryFilter(
    _category: ClassificationToken | null = null,
    activeTaskId?: string,
  ): void {
    setCategoryFilter(null);
    categoryFilterRef.current = null;
    writePreference(CATEGORY_FILTER_KEY, "");
    requestActiveTask(activeTaskId ?? null, activeTaskId !== undefined);
  }

  function chooseCategory(category: ClassificationToken, activeTaskId?: string): void {
    setCategoryPickerOpen(false);
    setCategoryFilter(category);
    categoryFilterRef.current = category.slug;
    writePreference(CATEGORY_FILTER_KEY, category.slug);
    requestActiveTask(activeTaskId ?? null, activeTaskId !== undefined);
    setAnnouncement(`Showing ${category.label} tasks`);
  }

  return (
    <main className="fixed inset-0 overflow-hidden bg-background text-foreground">
      <WorkspaceRequestRecovery workspace={workspace} />
      {/* Desktop content is 22 mouse cells wide, keeping the header buttons on the toolbar grid. */}
      <div className="app-shell mx-auto flex h-full min-h-0 w-full max-w-170 flex-col gap-6 overflow-hidden">
        <header className="flex items-center justify-between gap-4">
          <h1 className="flex items-center font-semibold">
            {/* Center the artwork on the first cell and the title's ink rather than its line box. */}
            <AppIcon className="size-8 shrink-0 -translate-x-0.5 -translate-y-0.25 pointer-coarse:translate-x-0" />
            <span className="text-3xl leading-none">{APP_NAME}</span>
          </h1>
          <ButtonGroup
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
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    tabIndex={-1}
                    aria-keyshortcuts="Shift+/"
                    onMouseDown={preventFocusSteal}
                    onClick={() => setStarterHelpOpen(true)}
                  />
                }
              >
                <CircleHelp aria-hidden="true" />
                <span className="sr-only">Help</span>
              </TooltipTrigger>
              <TooltipContent>
                Help <Kbd>?</Kbd>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    tabIndex={-1}
                    aria-keyshortcuts="Alt+t"
                    onMouseDown={preventFocusSteal}
                    onClick={openThemes}
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
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    tabIndex={-1}
                    aria-keyshortcuts="Control+, Meta+,"
                    onMouseDown={preventFocusSteal}
                    onClick={openSettings}
                  />
                }
              >
                <Settings2 aria-hidden="true" />
                <span className="sr-only">Settings</span>
              </TooltipTrigger>
              <TooltipContent>Settings</TooltipContent>
            </Tooltip>
          </ButtonGroup>
        </header>

        <TaskList
          ref={taskListRef}
          tasks={tasks}
          newTaskId={newTaskId}
          exitingTaskIds={exitingTaskIds}
          contextTasks={contextTasks}
          contextOrder={contextOrder}
          total={total}
          statusPreset={statusPreset}
          exactStatus={exactStatus}
          onToggleStatusPreset={toggleStatusPreset}
          onResetStatusFilter={resetStatusFilter}
          onExactStatus={chooseExactStatus}
          onOpenStatusMenu={openStatusMenu}
          priorityFilter={priorityFilter}
          onPriorityFilter={choosePriority}
          onOpenPriorityMenu={openPriorityMenu}
          showUnblocked={showUnblocked}
          onShowUnblockedChange={(next) => {
            setShowUnblocked(next);
            writePreference(UNBLOCKED_FILTER_KEY, String(next));
            requestActiveTask();
          }}
          sortField={sortField}
          sortDirection={sortDirection}
          onSortFieldChange={chooseSortField}
          onReverseSort={reverseSort}
          showDetails={showDetails}
          helpMode={helpMode}
          onDisableHelp={() => openDisableHelpDialog("none")}
          onDisableComposerHelp={() => openDisableHelpDialog("basic")}
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
          onOperation={(operationId, previous, current) =>
            recordOperationUndo(operationId, previous, current)
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
        <p role="status" className="sr-only">
          {announcement}
        </p>
        <TaskToaster />
      </div>
      <StarterHelp open={starterHelpOpen} onClose={() => setStarterHelpOpen(false)} />
      <DisableKeyboardHelpDialog
        open={disableHelpTarget !== null}
        mode={disableHelpTarget ?? "none"}
        onOpenChange={(open) => {
          if (!open) setDisableHelpTarget(null);
        }}
        onConfirm={confirmDisableHelp}
        finalFocus={() => focusStack.restore("disable-help")}
      />
      <HelpPalette
        open={helpOpen}
        onOpenChange={setHelpOpen}
        finalFocus={() => focusStack.restore("help")}
        onOpenSettings={openSettings}
        onOpenThemes={openThemes}
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
        statusUndoOnly={!workspace.supportsOperationUndo}
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
        helpMode={helpMode}
        onHelpModeChange={changeHelpMode}
        fontSizeIncrease={fontSizeIncrease}
        onFontSizeIncreaseChange={changeFontSizeIncrease}
      />
    </main>
  );
}
