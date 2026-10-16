import { useWorkspaceTasks } from "./useWorkspaceTasks";
import { useWorkspaceActions } from "./useWorkspaceActions";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { CircleHelp, Palette, Settings2 } from "lucide-react";
import { AppIcon } from "@/components/AppIcon";
import { WorkspaceRequestRecovery } from "@/components/WorkspaceRequestRecovery";
import type { MainWorkspace } from "@/platform/mainWorkspace";
import type { ClassificationToken } from "@/backend/taskText";
import type { TaskPriority, TaskStatus } from "@/backend/taskModel";
import type { ThemeRecord } from "@/backend/themePalette";
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
import { SearchDialog } from "@/components/SearchDialog";
import type { ComposerState } from "@/components/TaskComposer";
import { HelpPalette } from "@/components/HelpPalette";
import { StarterHelp } from "@/components/StarterHelp";
import { DisableKeyboardHelpDialog } from "@/components/DisableKeyboardHelpDialog";
import { TaskPicker, type TaskPickerMode } from "@/components/TaskPicker";
import { ThemePalette } from "@/components/ThemePalette";
import { SettingsDialog } from "@/components/SettingsDialog";
import { copyTaskText, TaskList, type TaskListHandle } from "@/components/TaskList";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { preventFocusSteal, useFocusNavigation, useFocusStack } from "@/navigation";
import { listThemes, setTheme, selectMainWorkspace } from "@/platform/backendClient";
import { APP_NAME } from "./backend/branding";
import { applyTheme } from "@/theme";
import {
  DEFAULT_GLOBAL_SHORTCUT,
  isShortcutConfigured,
  setGlobalShortcut,
} from "@/platform/globalShortcut";
import { runtimeKind } from "@/platform/runtime";
import {
  readStoredFontSizeIncrease,
  storeFontSizeIncrease,
  type FontSizeIncrease,
} from "@/fontSize";
import { isKeyboardHelpMode, type KeyboardHelpMode } from "@/keyboardHelp";

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
const LEGACY_SHOW_TIMESTAMPS_KEY = "tasks.showTimestamps";
const HELP_MODE_KEY = "tasks.helpMode";
const OMARCHY_SYSTEM_THEME_NAME = "omarchy-system";
const GLOBAL_SHORTCUT_KEY = "tasks.globalShortcut";

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Without storage the choice lasts for this session.
  }
}

function readStatusPreset(): StatusPreset {
  return readStored(STATUS_PRESET_KEY) === "inactive" ? "inactive" : "active";
}

function readExactStatus(): TaskStatus | null {
  const stored = readStored(EXACT_STATUS_KEY);
  return stored === "open" ||
    stored === "in_progress" ||
    stored === "paused" ||
    stored === "done" ||
    stored === "canceled"
    ? stored
    : null;
}

function readPriorityFilter(): TaskPriority | null {
  const stored = readStored(PRIORITY_FILTER_KEY);
  return stored !== null && /^[0-4]$/.test(stored) ? (Number(stored) as TaskPriority) : null;
}

function readCategorySlug(): string | null {
  const stored = readStored(CATEGORY_FILTER_KEY);
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
  const stored = readStored(key);
  if (!stored) return [];
  try {
    const value: unknown = JSON.parse(stored);
    return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : [];
  } catch {
    return [];
  }
}

function readSortField(): SortField {
  const stored = readStored(SORT_FIELD_KEY);
  return stored === "created" ||
    stored === "updated" ||
    stored === "priority" ||
    stored === "manual"
    ? stored
    : "created";
}

function readSortDirection(): SortDirection {
  return readStored(SORT_DIRECTION_KEY) === "asc" ? "asc" : "desc";
}

function readShowDetails(): boolean {
  return (readStored(SHOW_DETAILS_KEY) ?? readStored(LEGACY_SHOW_TIMESTAMPS_KEY)) === "true";
}

function readHelpMode(): KeyboardHelpMode {
  const stored = readStored(HELP_MODE_KEY);
  if (isKeyboardHelpMode(stored)) return stored;
  // Preserve the old checkbox preference: enabled meant full contextual help,
  // while disabled left the task-list shortcut guides available.
  if (stored === "true") return "full";
  if (stored === "false") return "basic";
  return "full";
}

// The list is the default surface. Create and edit use an inline editor opened
// by the New task button, the C key, or the palette. Tab does not leave the
// task editor or list.
export default function App({ workspace }: { workspace?: MainWorkspace } = {}): ReactElement {
  // Rebind after development module reloads before the list's query effects run.
  useEffect(() => {
    if (workspace) selectMainWorkspace(workspace);
  }, [workspace, selectMainWorkspace]);
  const [statusPreset, setStatusPreset] = useState<StatusPreset>(readStatusPreset);
  const [exactStatus, setExactStatus] = useState<TaskStatus | null>(readExactStatus);
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | null>(readPriorityFilter);
  const [tagFilter, setTagFilter] = useState<ClassificationOption[]>(readInitialTagFilter);
  const [searchQuery, setSearchQuery] = useState(() => readStored(SEARCH_QUERY_KEY) ?? "");
  const [showUnblocked, setShowUnblocked] = useState(
    () => readStored(UNBLOCKED_FILTER_KEY) === "true",
  );
  const [showDetails, setShowDetails] = useState(readShowDetails);
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
  const [themes, setThemes] = useState<ThemeRecord[]>([]);
  const [selectedTheme, setSelectedTheme] = useState("");
  const [globalShortcut, setGlobalShortcutValue] = useState(
    () => readStored(GLOBAL_SHORTCUT_KEY) ?? DEFAULT_GLOBAL_SHORTCUT,
  );
  const [picker, setPicker] = useState<{ mode: TaskPickerMode; subject: TaskView } | null>(null);
  const globalShortcutRef = useRef(globalShortcut);
  const composerRef = useRef<ComposerState | null>(null);
  const taskListRef = useRef<TaskListHandle>(null);
  composerRef.current = composer;

  const nav = useFocusNavigation(["list"]);
  const focusStack = useFocusStack();

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
    receiveState,
    unresolvedConflicts,
    sortFieldRef,
    categoryFilterRef,
    refreshTasks,
    updateVisibleTask,
    updateVisibleTasks,
    isCurrentViewMatch,
  } = taskView;
  const {
    optimisticCreate,
    setOptimisticCreate,
    statusUndo,
    newTaskId,
    exitingTaskIds,
    pickerRemoveBlocker,
    pickerRemoveParent,
    pickerSelected,
    pauseTaskFromPalette,
    recordOperationUndo,
    showToast,
    handleUndoStatus,
    showOptimisticCreate,
    taskSaved,
    handleStatusChanged,
    handleStatusBatchChanged,
    handleCanceledMany,
    purgeCanceledTasks,
    beginReceiveWorkspace,
    abortReceive,
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
    closeSettings: () => setSettingsOpen(false),
  });

  useEffect(() => {
    if (!workspace) void setGlobalShortcut(globalShortcut, null).catch(() => undefined);
  }, []);

  async function changeGlobalShortcut(value: string): Promise<void> {
    if (workspace)
      throw new Error("Global shortcuts are not yet enabled for this selected workspace.");
    const next = value.trim();
    if (!isShortcutConfigured(next))
      throw new Error("Use at least one modifier and a key, such as Ctrl+Alt+Space.");
    await setGlobalShortcut(next, globalShortcutRef.current);
    globalShortcutRef.current = next;
    setGlobalShortcutValue(next);
    writeStored(GLOBAL_SHORTCUT_KEY, next);
    setAnnouncement(`Global shortcut set to ${next}`);
  }

  const refreshThemes = useCallback((applySelection: boolean): Promise<void> => {
    return listThemes()
      .then((result) => {
        setThemes(result.themes);
        setSelectedTheme(result.selected);
        if (!applySelection) return;
        const selected = result.themes.find((theme) => theme.name === result.selected);
        if (selected) applyTheme(selected);
      })
      .catch(() => {
        // The neutral ramp in styles.css stays applied without a workspace theme.
      });
  }, []);

  useEffect(() => {
    void refreshThemes(true);
  }, [refreshThemes]);

  // Theme files can appear or disappear while the app runs, so theme surfaces
  // re-read them every time they open.
  useEffect(() => {
    if (helpOpen || themesOpen || settingsOpen) void refreshThemes(false);
  }, [helpOpen, themesOpen, settingsOpen, refreshThemes]);

  // Omarchy replaces its current palette outside this process. When the live
  // theme is selected, refresh often enough to feel immediate without making
  // every installation pay for a filesystem watcher or an event protocol.
  useEffect(() => {
    if (selectedTheme !== OMARCHY_SYSTEM_THEME_NAME) return;
    const refresh = (): void => {
      void refreshThemes(true);
    };
    const interval = window.setInterval(refresh, 1500);
    return () => window.clearInterval(interval);
  }, [selectedTheme, refreshThemes]);

  function openCreate(parentId?: string): void {
    if (composerRef.current) return;
    if (workspace && parentId && !workspace.supportsRelationships) {
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
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
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key === ","
      ) {
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
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [helpOpen, settingsOpen, starterHelpOpen, themesOpen]);

  async function chooseTheme(name: string): Promise<void> {
    setThemesOpen(false);
    try {
      const result = await setTheme(name);
      applyTheme(result.theme);
      setSelectedTheme(result.selected);
      setAnnouncement(`Theme: ${result.theme.label}`);
    } catch (caught) {
      setAnnouncement(caught instanceof Error ? caught.message : String(caught));
    }
  }

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
    focusStack.push("themes");
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
    if (workspace && !workspace.supportsRelationships) {
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
    focusStack.push("search", fromPalette ?? undefined);
    setHelpOpen(false);
    setSearchOpen(true);
  }

  function toggleStatusPreset(): void {
    // Clearing an exact status returns to the current preset; otherwise toggle.
    if (exactStatus !== null) {
      setExactStatus(null);
      writeStored(EXACT_STATUS_KEY, "");
    } else {
      const next = statusPreset === "active" ? "inactive" : "active";
      setStatusPreset(next);
      writeStored(STATUS_PRESET_KEY, next);
    }
    requestActiveTask();
  }

  function chooseSortField(field: SortField): void {
    if (field === sortField) return;
    sortFieldRef.current = field;
    setSortField(field);
    requestActiveTask();
    writeStored(SORT_FIELD_KEY, field);
    setAnnouncement(
      field === "manual" ? "Sorted by manual order" : `Sorted ${sortSummary(field, sortDirection)}`,
    );
  }

  function reverseSort(): void {
    if (sortField === "manual") return;
    const next = sortDirection === "desc" ? "asc" : "desc";
    setSortDirection(next);
    requestActiveTask();
    writeStored(SORT_DIRECTION_KEY, next);
    setAnnouncement(`Sorted ${sortSummary(sortField, next)}`);
  }

  function toggleDetails(): void {
    const next = !showDetails;
    setShowDetails(next);
    writeStored(SHOW_DETAILS_KEY, String(next));
    setAnnouncement(next ? "Showing task details" : "Hiding task details");
  }

  function changeHelpMode(mode: KeyboardHelpMode): void {
    setHelpMode(mode);
    writeStored(HELP_MODE_KEY, mode);
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
    writeStored(EXACT_STATUS_KEY, status ?? "");
    requestActiveTask();
  }

  function chooseStatusSelection(
    preset: StatusPreset | undefined,
    exact: TaskStatus | null | undefined,
  ): void {
    setStatusMenuOpen(false);
    if (exact !== undefined) {
      setExactStatus(exact);
      writeStored(EXACT_STATUS_KEY, exact ?? "");
    }
    if (preset !== undefined) {
      setStatusPreset(preset);
      writeStored(STATUS_PRESET_KEY, preset);
      if (exact === undefined) {
        setExactStatus(null);
        writeStored(EXACT_STATUS_KEY, "");
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
    writeStored(PRIORITY_FILTER_KEY, priority === null ? "" : String(priority));
    requestActiveTask();
  }

  function chooseTags(tags: ClassificationOption[]): void {
    setTagFilter(tags);
    writeStored(TAG_FILTER_KEY, JSON.stringify(tags.map((tag) => tag.slug)));
    requestActiveTask();
  }

  function chooseSearch(query: string): void {
    setSearchOpen(false);
    const next = query.trim();
    setSearchQuery(next);
    writeStored(SEARCH_QUERY_KEY, next);
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
    writeStored(EXACT_STATUS_KEY, "");
    writeStored(STATUS_PRESET_KEY, "active");
    writeStored(PRIORITY_FILTER_KEY, "");
    writeStored(TAG_FILTER_KEY, "[]");
    writeStored(SEARCH_QUERY_KEY, "");
    writeStored(CATEGORY_FILTER_KEY, "");
    writeStored(UNBLOCKED_FILTER_KEY, "false");
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
    writeStored(CATEGORY_FILTER_KEY, "");
    requestActiveTask(activeTaskId ?? null, activeTaskId !== undefined);
  }

  function chooseCategory(category: ClassificationToken, activeTaskId?: string): void {
    setCategoryPickerOpen(false);
    setCategoryFilter(category);
    categoryFilterRef.current = category.slug;
    writeStored(CATEGORY_FILTER_KEY, category.slug);
    requestActiveTask(activeTaskId ?? null, activeTaskId !== undefined);
    setAnnouncement(`Showing ${category.label} tasks`);
  }

  return (
    <main className="fixed inset-0 overflow-hidden bg-background text-foreground">
      {workspace && <WorkspaceRequestRecovery workspace={workspace} />}
      {receiveState?.waiting ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/95 p-6">
          <section
            aria-labelledby="receive-title"
            className="w-full max-w-md space-y-4 rounded-lg border bg-card p-6 shadow-lg"
          >
            <h1 id="receive-title" className="text-lg font-semibold">
              Waiting for workspace
            </h1>
            <p className="text-sm text-muted-foreground">
              {APP_NAME} is locked while this device receives the existing workspace. Add the empty
              sync folder to Syncthing, then wait for the transfer to finish.
            </p>
            {receiveState.syncRoot ? (
              <p className="wrap-anywhere rounded bg-muted p-2 font-mono text-xs">
                {receiveState.syncRoot}
              </p>
            ) : null}
            <p className="text-sm text-muted-foreground">
              <a
                className="underline"
                href="https://github.com/Soleone/tasks/blob/f762b50c8739b994629c68e4ab62a3a01142aaae/docs/syncthing.md"
                target="_blank"
                rel="noreferrer"
              >
                Read the Syncthing setup guide
              </a>
            </p>
            <Button variant="outline" onClick={() => void abortReceive()}>
              Abort and restore backup
            </Button>
          </section>
        </div>
      ) : null}
      <div className="app-shell mx-auto flex h-full min-h-0 w-full max-w-xl flex-col gap-6 overflow-hidden">
        <header className="flex items-center justify-between gap-4">
          <h1 className="flex items-center gap-1 font-semibold">
            <AppIcon className="size-8 shrink-0" />
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

        {runtimeKind() === "android" && unresolvedConflicts.length > 0 ? (
          <Alert variant="destructive">
            <AlertTitle>Syncthing conflict copies need attention</AlertTitle>
            <AlertDescription>
              <div className="flex flex-col gap-2">
                <p>
                  {unresolvedConflicts.length} conflict{" "}
                  {unresolvedConflicts.length === 1 ? "copy was" : "copies were"} found. Android
                  leaves them untouched. Resolve them on a desktop or CLI client, and do not delete
                  the copies before checking the workspace.
                </p>
                <ul className="max-h-24 space-y-1 overflow-auto font-mono text-xs">
                  {unresolvedConflicts.map((conflict) => (
                    <li key={conflict.sourcePath} className="break-all">
                      {conflict.sourcePath}
                    </li>
                  ))}
                </ul>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}

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
            writeStored(UNBLOCKED_FILTER_KEY, String(next));
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
          onToast={(message) => showToast(message)}
          onEdit={openEdit}
          onTaskUpdated={updateVisibleTask}
          onTasksUpdated={updateVisibleTasks}
          onOperation={(operationId, previous, current) =>
            recordOperationUndo(operationId, previous, current)
          }
          onStatusChanged={handleStatusChanged}
          onStatusBatchChanged={handleStatusBatchChanged}
          canUndoStatus={statusUndo !== null}
          onUndoStatus={() => void handleUndoStatus()}
          onCanceled={(task) => handleCanceledMany([task], [task])}
          onCanceledMany={handleCanceledMany}
          onAddBlocker={(task) => openPicker("blocker", task)}
          onMoveUnder={(task) => openPicker("move", task)}
        />
        <p role="status" className="sr-only">
          {announcement}
        </p>
        <Toaster theme={themes.find((theme) => theme.name === selectedTheme)?.mode ?? "system"} />
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
        statusUndoOnly={workspace !== undefined && !workspace.supportsOperationUndo}
        canUndoStatus={statusUndo !== null}
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
      {searchOpen ? (
        <SearchDialog
          open
          onClose={() => setSearchOpen(false)}
          finalFocus={() => focusStack.restore("search") ?? undefined}
          initialQuery={searchQuery}
          onSelect={chooseSearch}
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
      <ThemePalette
        open={themesOpen}
        onOpenChange={setThemesOpen}
        finalFocus={() => focusStack.restore("themes")}
        themes={themes}
        selectedTheme={selectedTheme}
        onSelectTheme={(name) => void chooseTheme(name)}
      />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        finalFocus={() => focusStack.restore("settings")}
        onPrepareReceive={() => void beginReceiveWorkspace()}
        onPurgeCanceled={purgeCanceledTasks}
        globalShortcut={globalShortcut}
        onGlobalShortcutChange={changeGlobalShortcut}
        helpMode={helpMode}
        onHelpModeChange={changeHelpMode}
        fontSizeIncrease={fontSizeIncrease}
        onFontSizeIncreaseChange={changeFontSizeIncrease}
        themes={themes}
        selectedTheme={selectedTheme}
        onSelectTheme={(name) => void chooseTheme(name)}
      />
    </main>
  );
}
