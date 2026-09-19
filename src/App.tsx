import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { CircleHelp, Palette, Settings2, type LucideIcon } from "lucide-react";
import { AppIcon } from "@/components/AppIcon";
import type { ClassificationToken, TagRecord, TaskPriority, TaskRecord, TaskStatus, ThemeRecord } from "@/backend/protocol";
import { ACTIVE_TASK_STATUSES, INACTIVE_TASK_STATUSES, presetStatuses, sortSummary, taskStatusMeta, type SortDirection, type SortField, type StatusPreset } from "@/components/taskFilters";
import { CategoryPicker } from "@/components/CategoryPicker";
import { StatusMenu } from "@/components/StatusMenu";
import { PriorityMenu } from "@/components/PriorityMenu";
import { TagPicker } from "@/components/TagPicker";
import { SearchDialog } from "@/components/SearchDialog";
import { TaskComposerDialog, type ComposerState } from "@/components/TaskComposerDialog";
import { HelpPalette } from "@/components/HelpPalette";
import { StarterHelp } from "@/components/StarterHelp";
import { TaskPicker, type TaskPickerMode } from "@/components/TaskPicker";
import { ThemePalette } from "@/components/ThemePalette";
import { SettingsDialog } from "@/components/SettingsDialog";
import { copyTaskText, TaskList, type TaskListHandle } from "@/components/TaskList";
import { taskGroupOrder } from "@/components/taskTree";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { preventFocusSteal, useFocusNavigation, useFocusStack } from "@/navigation";
import { BackendCommandError, abortReceiveWorkspace, addDependency, closeBackendSession, getWorkspaceInfo, listTasks, listThemes, moveTask, prepareReceiveWorkspace, purgeCanceledTasks as purgeCanceledTasksCommand, receiveWorkspaceStatus, removeDependency, setTheme, transitionTask, undoOperation, type ReceiveWorkspaceResult, type TaskMutationResult } from "@/platform/backendClient";
import { APP_NAME } from "./backend/branding";
import { taskTitleDisplay } from "@/components/TaskRow";
import { applyTheme } from "@/theme";
import { DEFAULT_GLOBAL_SHORTCUT, isShortcutConfigured, setGlobalShortcut } from "@/platform/globalShortcut";
import { readStoredFontSizeIncrease, storeFontSizeIncrease, type FontSizeIncrease } from "@/fontSize";

const ACTIVE_TASK_STATUS_SET = new Set<TaskStatus>(ACTIVE_TASK_STATUSES);
const INACTIVE_TASK_STATUS_SET = new Set<TaskStatus>(INACTIVE_TASK_STATUSES);

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
const WORKSPACE_REVISION_POLL_MS = 1500;

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
  return stored === "open" || stored === "in_progress" || stored === "paused" || stored === "done" || stored === "canceled" ? stored : null;
}

function readPriorityFilter(): TaskPriority | null {
  const stored = readStored(PRIORITY_FILTER_KEY);
  return stored !== null && /^[0-4]$/.test(stored) ? Number(stored) as TaskPriority : null;
}

function readCategorySlug(): string | null {
  const stored = readStored(CATEGORY_FILTER_KEY);
  return stored !== null && stored !== "" ? stored : null;
}

function readInitialTagFilter(): TagRecord[] {
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
  return stored === "created" || stored === "priority" || stored === "manual" ? stored : "updated";
}

function readSortDirection(): SortDirection {
  return readStored(SORT_DIRECTION_KEY) === "asc" ? "asc" : "desc";
}

function readShowDetails(): boolean {
  return (readStored(SHOW_DETAILS_KEY) ?? readStored(LEGACY_SHOW_TIMESTAMPS_KEY)) === "true";
}

function readHelpMode(): boolean {
  return readStored(HELP_MODE_KEY) === "true";
}

function taskIsVisible(
  task: TaskRecord,
  exactStatus: TaskStatus | null,
  statusPreset: StatusPreset,
  showUnblocked: boolean,
  categorySlug: string | null,
  priorityFilter: TaskPriority | null,
  tagSlugs: readonly string[],
  searchQuery: string,
): boolean {
  const statusOk = exactStatus !== null
    ? task.status === exactStatus
    : (statusPreset === "inactive" ? INACTIVE_TASK_STATUS_SET : ACTIVE_TASK_STATUS_SET).has(task.status);
  if (!statusOk) return false;
  if (showUnblocked && task.blockedByIds.length > 0) return false;
  if (categorySlug !== null && task.category?.slug !== categorySlug) return false;
  if (priorityFilter !== null && task.priority !== priorityFilter) return false;
  if (tagSlugs.length > 0) {
    const taskTags = new Set(task.tags.map((tag) => tag.slug));
    if (!tagSlugs.every((slug) => taskTags.has(slug))) return false;
  }
  if (searchQuery.trim() !== "") {
    const needle = searchQuery.trim().toLowerCase();
    const haystack = `${task.title}\n${task.descriptionMarkdown}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

function contextAncestorIds(tasks: readonly TaskRecord[], knownTasks: readonly TaskRecord[]): Set<string> {
  const byId = new Map(knownTasks.map((task) => [task.id, task]));
  const contextIds = new Set<string>();
  for (const task of tasks) {
    const seen = new Set<string>([task.id]);
    let parentId = task.parentId;
    while (parentId !== null && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      contextIds.add(parent.id);
      parentId = parent.parentId;
    }
  }
  return contextIds;
}

type OperationUndoEntry = {
  operationId: string;
  key: string;
  affectedTaskIds: string[];
  createdTaskIds: string[];
  title: string;
  statusLike: boolean;
  wasActiveTaskId: string | null;
};

type Toast = {
  message: string;
  Icon?: LucideIcon;
};

const STATUS_CHANGE_TOASTS: Partial<Record<TaskStatus, string>> = {
  paused: "Task paused",
  done: "Task marked done",
  canceled: "Task canceled",
};

const UNDO_TOAST_DURATION_MS = 3000;

function compareTasksForSort(a: TaskRecord, b: TaskRecord, field: SortField, direction: SortDirection): number {
  if (field === "manual") return 0;
  if (field === "priority") {
    const priorityDirection = direction === "desc" ? 1 : -1;
    return priorityDirection * (a.priority - b.priority) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }
  const keyA = field === "created" ? a.createdAt : a.updatedAt;
  const keyB = field === "created" ? b.createdAt : b.updatedAt;
  if (keyA !== keyB) {
    const newerFirst = direction === "desc";
    if (keyA > keyB) return newerFirst ? -1 : 1;
    return newerFirst ? 1 : -1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// The list is the default surface. Create and edit share one dialog opened
// by the New task button, the C key, or the palette. Tab does not leave the
// focused task list.
export default function App(): ReactElement {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [contextTasks, setContextTasks] = useState<TaskRecord[]>([]);
  const [contextOrder, setContextOrder] = useState<Map<string, number>>(() => new Map());
  const [total, setTotal] = useState(0);
  const [statusPreset, setStatusPreset] = useState<StatusPreset>(readStatusPreset);
  const [exactStatus, setExactStatus] = useState<TaskStatus | null>(readExactStatus);
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | null>(readPriorityFilter);
  const [tagFilter, setTagFilter] = useState<TagRecord[]>(readInitialTagFilter);
  const [searchQuery, setSearchQuery] = useState(() => readStored(SEARCH_QUERY_KEY) ?? "");
  const [showUnblocked, setShowUnblocked] = useState(() => readStored(UNBLOCKED_FILTER_KEY) === "true");
  const [showDetails, setShowDetails] = useState(readShowDetails);
  const [helpMode, setHelpMode] = useState(readHelpMode);
  const [fontSizeIncrease, setFontSizeIncrease] = useState<FontSizeIncrease>(readStoredFontSizeIncrease);
  const [sortField, setSortField] = useState(readSortField);
  const [sortDirection, setSortDirection] = useState(readSortDirection);
  const [categoryFilter, setCategoryFilter] = useState<ClassificationToken | null>(readInitialCategoryFilter);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [priorityMenuOpen, setPriorityMenuOpen] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [activeTaskRequest, setActiveTaskRequest] = useState({ key: 0, taskId: null as string | null, preserveTaskOnRefresh: false });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [starterHelpOpen, setStarterHelpOpen] = useState(false);
  const [themesOpen, setThemesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themes, setThemes] = useState<ThemeRecord[]>([]);
  const [selectedTheme, setSelectedTheme] = useState("");
  const [globalShortcut, setGlobalShortcutValue] = useState(() => readStored(GLOBAL_SHORTCUT_KEY) ?? DEFAULT_GLOBAL_SHORTCUT);
  const [picker, setPicker] = useState<{ mode: TaskPickerMode; subject: TaskRecord } | null>(null);
  const [statusUndo, setStatusUndo] = useState<OperationUndoEntry | null>(null);
  const [newTaskId, setNewTaskId] = useState<string | null>(null);
  const [exitingTaskIds, setExitingTaskIds] = useState<Set<string>>(() => new Set());
  const [toast, setToast] = useState<Toast | null>(null);
  const [receiveState, setReceiveState] = useState<ReceiveWorkspaceResult | null>(null);
  const querySequence = useRef(0);
  const initialLoadRetry = useRef(0);
  const statusUndoRef = useRef<OperationUndoEntry | null>(null);
  const cancelExitTimer = useRef<number | null>(null);
  const toastTimer = useRef<number | null>(null);
  const statusPresetRef = useRef<StatusPreset>(statusPreset);
  const exactStatusRef = useRef<TaskStatus | null>(exactStatus);
  const priorityFilterRef = useRef<TaskPriority | null>(priorityFilter);
  const tagFilterRef = useRef<string[]>(tagFilter.map((tag) => tag.slug));
  const searchQueryRef = useRef(searchQuery);
  const showUnblockedRef = useRef(showUnblocked);
  const sortFieldRef = useRef<SortField>(sortField);
  const sortDirectionRef = useRef<SortDirection>(sortDirection);
  const categoryFilterRef = useRef<string | null>(categoryFilter?.slug ?? null);
  const globalShortcutRef = useRef(globalShortcut);
  const restoredMetadataRef = useRef(false);
  const composerRef = useRef<ComposerState | null>(null);
  const taskListRef = useRef<TaskListHandle>(null);
  const workspaceRevisionRef = useRef<number | null>(null);
  composerRef.current = composer;

  const nav = useFocusNavigation(["list"]);
  const focusStack = useFocusStack();

  function requestActiveTask(taskId: string | null = null, preserveTaskOnRefresh = false): void {
    setActiveTaskRequest((previous) => ({ key: previous.key + 1, taskId, preserveTaskOnRefresh }));
  }

  useEffect(() => {
    void setGlobalShortcut(globalShortcut, null).catch(() => undefined);
  }, []);

  async function changeGlobalShortcut(value: string): Promise<void> {
    const next = value.trim();
    if (!isShortcutConfigured(next)) throw new Error("Use at least one modifier and a key, such as Ctrl+Alt+Space.");
    await setGlobalShortcut(next, globalShortcutRef.current);
    globalShortcutRef.current = next;
    setGlobalShortcutValue(next);
    writeStored(GLOBAL_SHORTCUT_KEY, next);
    setAnnouncement(`Global shortcut set to ${next}`);
  }

  const refreshTasks = useCallback(async (offset = 0, preserveContextOrder = false): Promise<boolean> => {
    const sequence = ++querySequence.current;
    setLoading(true);
    setLoadError(null);
    try {
      const exact = exactStatusRef.current;
      const statuses = exact !== null ? [exact] : presetStatuses(statusPresetRef.current);
      const result = await listTasks(
        statuses,
        offset,
        showUnblockedRef.current,
        categoryFilterRef.current ?? undefined,
        {
          ...(priorityFilterRef.current !== null ? { priority: priorityFilterRef.current } : {}),
          ...(tagFilterRef.current.length > 0 ? { tags: [...tagFilterRef.current] } : {}),
          ...(searchQueryRef.current.trim() !== "" ? { search: searchQueryRef.current.trim() } : {}),
          sort: sortFieldRef.current,
          direction: sortDirectionRef.current,
          includeAncestors: true,
        },
      );
      if (sequence !== querySequence.current) return false;
      workspaceRevisionRef.current = result.workspaceRevision;
      if (!offset && !preserveContextOrder) setContextOrder(new Map());
      setTasks((previous) => offset ? [...previous, ...result.tasks.filter((task) => !previous.some((existing) => existing.id === task.id))] : result.tasks);
      setContextTasks((previous) => {
        if (!offset) return result.contextTasks;
        const next = new Map(previous.map((task) => [task.id, task]));
        for (const task of result.contextTasks) next.set(task.id, task);
        return [...next.values()];
      });
      if (!offset && !restoredMetadataRef.current) {
        restoredMetadataRef.current = true;
        const categorySlug = categoryFilterRef.current;
        const tagSlugs = [...tagFilterRef.current];
        if (categorySlug !== null || tagSlugs.length > 0) {
          const loadedTasks = [...result.tasks, ...result.contextTasks];
          if (categorySlug !== null) {
            const category = loadedTasks.find((task) => task.category?.slug === categorySlug)?.category;
            const enriched: ClassificationToken = category
              ? { slug: category.slug, label: category.label }
              : { slug: categorySlug, label: categorySlug };
            setCategoryFilter((previous) => previous?.slug === enriched.slug && previous.label === enriched.label ? previous : enriched);
          }
          if (tagSlugs.length > 0) {
            const tags = new Map(loadedTasks.flatMap((task) => task.tags).map((tag) => [tag.slug, tag]));
            const enriched = tagSlugs.map((slug) => {
              const tag = tags.get(slug);
              return tag
                ? { ...tag, taskCount: loadedTasks.filter((task) => task.tags.some((entry) => entry.slug === tag.slug)).length }
                : { slug, label: slug, taskCount: 0 };
            });
            setTagFilter((previous) => {
              const previousSlugs = previous.map((tag) => tag.slug);
              const sameSlugs = previousSlugs.length === enriched.length && previousSlugs.every((slug, index) => slug === enriched[index].slug);
              const sameMeta = previous.length === enriched.length && previous.every((tag, index) => tag.label === enriched[index].label && tag.taskCount === enriched[index].taskCount);
              return sameSlugs && sameMeta ? previous : enriched;
            });
          }
        }
      }
      setTotal(result.total);
      initialLoadRetry.current = 0;
      return true;
    } catch (caught) {
      if (sequence === querySequence.current) setLoadError(caught instanceof Error ? caught.message : String(caught));
      return false;
    } finally {
      if (sequence === querySequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    statusPresetRef.current = statusPreset;
    exactStatusRef.current = exactStatus;
    priorityFilterRef.current = priorityFilter;
    tagFilterRef.current = tagFilter.map((tag) => tag.slug);
    searchQueryRef.current = searchQuery;
    showUnblockedRef.current = showUnblocked;
    sortFieldRef.current = sortField;
    sortDirectionRef.current = sortDirection;
    categoryFilterRef.current = categoryFilter?.slug ?? null;
    if (!receiveState?.waiting) void refreshTasks();
  }, [statusPreset, exactStatus, priorityFilter, tagFilter, searchQuery, showUnblocked, sortField, sortDirection, categoryFilter, refreshTasks, receiveState?.waiting]);

  useEffect(() => {
    void receiveWorkspaceStatus()
      .then((status) => setReceiveState(status.waiting ? status : null))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (loading || !loadError || tasks.length > 0 || initialLoadRetry.current >= 3) return;

    const attempt = initialLoadRetry.current;
    initialLoadRetry.current += 1;
    const timeout = window.setTimeout(() => {
      void refreshTasks();
    }, 250 * (attempt + 1));
    return () => window.clearTimeout(timeout);
  }, [loading, loadError, tasks.length, refreshTasks]);

  useEffect(() => {
    if (loading || receiveState?.waiting) return;

    let disposed = false;
    let checking = false;

    const checkWorkspaceRevision = async (): Promise<void> => {
      if (disposed || checking || document.visibilityState === "hidden") return;
      checking = true;
      try {
        const info = await getWorkspaceInfo();
        if (disposed) return;
        const previousRevision = workspaceRevisionRef.current;
        if (previousRevision !== null && info.workspaceRevision !== previousRevision) {
          taskListRef.current?.startIdentityPreservingRefresh();
          try {
            await refreshTasks();
          } finally {
            finishIdentityPreservingRefresh();
          }
        } else if (previousRevision === null) {
          workspaceRevisionRef.current = info.workspaceRevision;
        }
      } catch {
        // Focus and explicit refresh still surface backend failures.
      } finally {
        checking = false;
      }
    };

    const refreshOnVisibility = (): void => {
      if (document.visibilityState === "visible") void checkWorkspaceRevision();
    };
    const interval = window.setInterval(() => void checkWorkspaceRevision(), WORKSPACE_REVISION_POLL_MS);
    document.addEventListener("visibilitychange", refreshOnVisibility);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshOnVisibility);
    };
  }, [loading, receiveState?.waiting, refreshTasks]);

  useEffect(() => {
    const refreshOnFocus = (): void => { void refreshTasks(); };
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      ++querySequence.current;
      window.removeEventListener("focus", refreshOnFocus);
      void closeBackendSession();
    };
  }, [refreshTasks]);

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

  // Theme files can appear or disappear while the app runs, so the picker
  // re-reads them every time it opens.
  useEffect(() => {
    if (helpOpen || themesOpen) void refreshThemes(false);
  }, [helpOpen, themesOpen, refreshThemes]);

  // Omarchy replaces its current palette outside this process. When the live
  // theme is selected, refresh often enough to feel immediate without making
  // every installation pay for a filesystem watcher or an event protocol.
  useEffect(() => {
    if (selectedTheme !== OMARCHY_SYSTEM_THEME_NAME) return;
    const refresh = (): void => { void refreshThemes(true); };
    const interval = window.setInterval(refresh, 1500);
    return () => window.clearInterval(interval);
  }, [selectedTheme, refreshThemes]);

  function openCreate(parentId?: string): void {
    if (composerRef.current) return;
    if (parentId) {
      const parent = tasks.find((task) => task.id === parentId);
      if (parent?.status === "canceled") {
        setAnnouncement(`${taskTitleDisplay(parent.title)} is canceled. Reopen it before creating a child.`);
        return;
      }
    }
    const fromPalette = helpOpen ? focusStack.restore("help") : undefined;
    focusStack.push("composer", fromPalette ?? undefined);
    setHelpOpen(false);
    const classification = [
      ...(categoryFilter ? [`@${categoryFilter.slug}`] : []),
      ...tagFilter.map((tag) => `#${tag.slug}`),
    ];
    const initialTitle = classification.length > 0 ? `${classification.join(" ")} ` : undefined;
    setComposer(parentId
      ? { mode: "create", parentId, ...(initialTitle ? { initialTitle } : {}) }
      : { mode: "create", ...(initialTitle ? { initialTitle } : {}) });
  }

  function openEdit(task: TaskRecord): void {
    if (composerRef.current) return;
    focusStack.push("composer");
    setComposer({ mode: "edit", task });
  }

  function closeComposer(): void {
    setComposer(null);
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing || event.repeat) return;
      const target = event.target;
      const typing = target instanceof HTMLElement && (target.matches("input, textarea, [contenteditable=true]") || target.closest('[role="dialog"]') !== null);
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

  function openPicker(mode: TaskPickerMode, subject: TaskRecord): void {
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

  function finishIdentityPreservingRefresh(): void {
    window.requestAnimationFrame(() => taskListRef.current?.finishIdentityPreservingRefresh());
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
    setAnnouncement(field === "manual" ? "Sorted by manual order" : `Sorted ${sortSummary(field, sortDirection)}`);
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

  function changeHelpMode(enabled: boolean): void {
    setHelpMode(enabled);
    writeStored(HELP_MODE_KEY, String(enabled));
    setAnnouncement(enabled ? "Context-sensitive keyboard help enabled" : "Context-sensitive keyboard help disabled");
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

  function chooseStatusSelection(preset: StatusPreset | undefined, exact: TaskStatus | null | undefined): void {
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

  function choosePriority(priority: TaskPriority | null): void {
    setPriorityMenuOpen(false);
    setPriorityFilter(priority);
    writeStored(PRIORITY_FILTER_KEY, priority === null ? "" : String(priority));
    requestActiveTask();
  }

  function chooseTags(tags: TagRecord[]): void {
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

  const hasActiveFilters = exactStatus !== null
    || statusPreset !== "active"
    || priorityFilter !== null
    || tagFilter.length > 0
    || searchQuery.trim() !== ""
    || categoryFilter !== null
    || showUnblocked;

  function clearCategoryFilter(_category: ClassificationToken | null = null, activeTaskId?: string): void {
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

  async function pickerRemoveBlocker(blockerId: string): Promise<void> {
    if (!picker) return;
    const { subject } = picker;
    const current = tasks.find((task) => task.id === subject.id) ?? subject;
    const blocker = tasks.find((task) => task.id === blockerId);
    const subjectTitle = taskTitleDisplay(current.title);
    const blockerTitle = blocker ? taskTitleDisplay(blocker.title) : "blocker";
    setPicker(null);
    try {
      const result = await removeDependency(current.id, blockerId, current.version, { idempotencyKey: crypto.randomUUID() });
      updateVisibleTask(result.task);
      if (result.operationId) recordOperationUndo(result.operationId, [current], [result.task]);
      setAnnouncement(`${subjectTitle} is no longer blocked by ${blockerTitle}`);
    } catch (caught) {
      setAnnouncement(caught instanceof BackendCommandError && caught.code === "STALE_TASK_VERSION"
        ? `${current.title} changed elsewhere. Refresh and try again.`
        : caught instanceof Error ? caught.message : String(caught));
      void refreshTasks();
    }
  }

  async function pickerRemoveParent(): Promise<void> {
    if (!picker) return;
    const { subject } = picker;
    const current = tasks.find((task) => task.id === subject.id) ?? subject;
    const subjectTitle = taskTitleDisplay(current.title);
    setPicker(null);
    try {
      const result = await moveTask(current.id, null, current.version, { idempotencyKey: crypto.randomUUID() });
      const refreshManualOrder = result.changed !== false && sortFieldRef.current === "manual";
      if (refreshManualOrder) taskListRef.current?.startIdentityPreservingRefresh();
      updateVisibleTask(result.task);
      if (result.operationId) recordOperationUndo(result.operationId, [current], [result.task]);
      if (refreshManualOrder) void refreshTasks(0).finally(finishIdentityPreservingRefresh);
      setAnnouncement(`${subjectTitle} is now a top-level task`);
    } catch (caught) {
      setAnnouncement(caught instanceof BackendCommandError && caught.code === "STALE_TASK_VERSION"
        ? `${current.title} changed elsewhere. Refresh and try again.`
        : caught instanceof Error ? caught.message : String(caught));
      void refreshTasks();
    }
  }

  async function pickerSelected(target: TaskRecord): Promise<void> {
    if (!picker) return;
    const { mode, subject } = picker;
    const current = tasks.find((task) => task.id === subject.id) ?? subject;
    setPicker(null);
    try {
      const result = mode === "blocker"
        ? await addDependency(current.id, target.id, current.version, { idempotencyKey: crypto.randomUUID() })
        : await moveTask(current.id, target.id, current.version, { idempotencyKey: crypto.randomUUID() });
      const refreshManualOrder = mode === "move" && result.changed !== false && sortFieldRef.current === "manual";
      if (refreshManualOrder) taskListRef.current?.startIdentityPreservingRefresh();
      updateVisibleTask(result.task);
      if (result.operationId) recordOperationUndo(result.operationId, [current], [result.task]);
      if (refreshManualOrder) void refreshTasks(0).finally(finishIdentityPreservingRefresh);
      const subjectTitle = taskTitleDisplay(current.title);
      const targetTitle = taskTitleDisplay(target.title);
      setAnnouncement(mode === "blocker"
        ? `${subjectTitle} is now blocked by ${targetTitle}`
        : `${subjectTitle} moved under ${targetTitle}`);
    } catch (caught) {
      setAnnouncement(caught instanceof BackendCommandError && caught.code === "STALE_TASK_VERSION"
        ? `${current.title} changed elsewhere. Refresh and try again.`
        : caught instanceof Error ? caught.message : String(caught));
      void refreshTasks();
    }
  }

  async function pauseTaskFromPalette(task: TaskRecord): Promise<void> {
    const current = tasks.find((candidate) => candidate.id === task.id) ?? task;
    const wasActive = taskListRef.current?.getActiveTask()?.id === current.id;
    setHelpOpen(false);
    if (current.status === "done" || current.status === "canceled") {
      setAnnouncement(`${current.title} is ${taskStatusMeta[current.status].label.toLowerCase()}. Reopen it before pausing.`);
      return;
    }
    try {
      const result = current.status === "paused"
        ? await transitionTask("task.start", current.id, current.version, { idempotencyKey: crypto.randomUUID() })
        : await transitionTask("task.pause", current.id, current.version, { idempotencyKey: crypto.randomUUID() });
      updateVisibleTask(result.task);
      if (result.operationId) recordOperationUndo(result.operationId, [current], [result.task]);
      if (result.changed !== false) handleStatusChanged(current, result.task, wasActive);
      setAnnouncement(`${current.title}: ${result.task.status === "paused" ? "Paused" : "In progress"}`);
    } catch (caught) {
      setAnnouncement(caught instanceof BackendCommandError && caught.code === "STALE_TASK_VERSION"
        ? `${current.title} changed elsewhere. Refresh and try again.`
        : caught instanceof Error ? caught.message : String(caught));
      void refreshTasks();
    }
  }

  function recordOperationUndo(
    operationId: string | undefined,
    previous: TaskRecord[],
    current: TaskRecord[],
    options: { createdTaskIds?: string[]; wasActiveTaskId?: string | null } = {},
  ): void {
    if (!operationId) return;
    if (toastTimer.current !== null) {
      window.clearTimeout(toastTimer.current);
      toastTimer.current = null;
    }
    setToast(null);
    const previousById = new Map(previous.map((task) => [task.id, task]));
    const currentById = new Map(current.map((task) => [task.id, task]));
    const affectedTaskIds = [...new Set([...previous, ...current].map((task) => task.id))].filter((taskId) => {
      const before = previousById.get(taskId);
      const after = currentById.get(taskId);
      return before === undefined || after === undefined || before.version !== after.version;
    });
    const statusLike = affectedTaskIds.length > 0 && affectedTaskIds.every((taskId) => {
      const before = previousById.get(taskId);
      const after = currentById.get(taskId);
      return before !== undefined && after !== undefined && before.status !== after.status;
    });
    const titleTask = current.find((task) => affectedTaskIds.includes(task.id)) ?? previous.find((task) => affectedTaskIds.includes(task.id));
    const entry: OperationUndoEntry = {
      operationId,
      key: crypto.randomUUID(),
      affectedTaskIds,
      createdTaskIds: options.createdTaskIds ?? [],
      title: titleTask?.title ?? "task",
      statusLike,
      wasActiveTaskId: options.wasActiveTaskId ?? (() => {
        const activeTaskId = taskListRef.current?.getActiveTask()?.id ?? null;
        return activeTaskId !== null && affectedTaskIds.includes(activeTaskId) ? activeTaskId : null;
      })(),
    };
    statusUndoRef.current = entry;
    setStatusUndo(entry);
  }

  function retireStatusUndo(): void {
    statusUndoRef.current = null;
    setStatusUndo(null);
  }

  function showToast(nextToast: Toast): void {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToast(nextToast);
    toastTimer.current = window.setTimeout(() => {
      setToast(null);
      toastTimer.current = null;
    }, UNDO_TOAST_DURATION_MS);
  }

  async function handleUndoStatus(): Promise<void> {
    const entry = statusUndoRef.current;
    if (!entry) return;
    try {
      const result = await undoOperation(entry.operationId, { idempotencyKey: entry.key });
      const restored = result.tasks;
      if (cancelExitTimer.current !== null) {
        window.clearTimeout(cancelExitTimer.current);
        cancelExitTimer.current = null;
      }
      setExitingTaskIds(new Set());
      if (result.deletedTaskIds && result.deletedTaskIds.length > 0) removeVisibleTasks(result.deletedTaskIds);
      updateVisibleTasks(restored);
      if (entry.wasActiveTaskId && restored.some((task) => task.id === entry.wasActiveTaskId)) {
        requestActiveTask(entry.wasActiveTaskId);
      }
      retireStatusUndo();
      const label = restored.length === 1 ? taskStatusMeta[restored[0].status]?.label ?? restored[0].status : null;
      const message = entry.createdTaskIds.length > 0
        ? `Removed: ${entry.title}`
        : entry.statusLike && restored.length === 1
          ? `${restored[0].title}: ${label}`
          : restored.length === 1
            ? `Undid change to ${restored[0].title}`
            : `Undid changes for ${entry.affectedTaskIds.length} tasks`;
      setAnnouncement(message);
      showToast({ message: entry.statusLike && label ? `Undo status change to ${label}` : message });
      void refreshTasks(0, true);
    } catch (caught) {
      if (caught instanceof BackendCommandError && (caught.code === "OPERATION_CONFLICT" || caught.code === "OPERATION_UNAVAILABLE" || caught.code === "OPERATION_NOT_FOUND" || caught.code === "STALE_TASK_VERSION" || caught.code === "TASK_NOT_FOUND")) {
        retireStatusUndo();
        setExitingTaskIds(new Set());
        setAnnouncement(`${entry.title} changed elsewhere. Undo is no longer available.`);
        void refreshTasks();
        return;
      }
      setAnnouncement(caught instanceof Error ? caught.message : String(caught));
    }
  }

  useEffect(() => {
    statusUndoRef.current = statusUndo;
  }, [statusUndo]);

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);

  useEffect(() => {
    if (newTaskId === null) return;
    const timeout = window.setTimeout(() => setNewTaskId(null), 240);
    return () => window.clearTimeout(timeout);
  }, [newTaskId]);

  function taskSaved(result: TaskMutationResult): void {
    const task = result.task;
    const composerBeforeSave = composerRef.current;
    const creating = composerBeforeSave?.mode === "create";
    const previous = composerBeforeSave?.mode === "edit" ? [composerBeforeSave.task] : [];
    const visible = isCurrentViewMatch(task);
    if (visible) {
      setTasks((previous) => creating
        ? [task, ...previous.filter((existing) => existing.id !== task.id)]
        : previous.map((existing) => existing.id === task.id ? task : existing));
      if (creating) setNewTaskId(task.id);
    } else {
      setTasks((previous) => previous.filter((existing) => existing.id !== task.id));
    }
    if (!creating) requestActiveTask();
    if (result.operationId) {
      recordOperationUndo(result.operationId, previous, [task], { createdTaskIds: creating ? [task.id] : [] });
    }
    setAnnouncement(`${creating ? "Added" : "Saved"}: ${task.title}`);
    // Creating one task returns to the list instead of reopening capture.
    // The next task can still be started with C or the New task action.
    setComposer(null);
    void refreshTasks();
  }

  function syncContextTasks(nextTasks: TaskRecord[], candidates?: TaskRecord | readonly TaskRecord[]): void {
    const candidateList = candidates === undefined ? [] : Array.isArray(candidates) ? candidates : [candidates];
    setContextTasks((previous) => {
      const visibleIds = new Set(nextTasks.map((entry) => entry.id));
      const knownTasks = [...previous, ...nextTasks, ...candidateList];
      const requiredContextIds = contextAncestorIds(nextTasks, knownTasks);
      const byId = new Map(previous.map((entry) => [entry.id, entry]));
      for (const candidate of candidateList) byId.set(candidate.id, candidate);
      return [...byId.values()].filter((entry) => !visibleIds.has(entry.id) && requiredContextIds.has(entry.id));
    });
  }

  function removeVisibleTasks(taskIds: string[]): void {
    const ids = new Set(taskIds);
    const nextTasks = tasks.filter((task) => !ids.has(task.id));
    const removed = tasks.length - nextTasks.length;
    if (removed === 0) return;
    const currentGroupOrder = taskGroupOrder(tasks, contextTasks);
    setContextOrder((previous) => {
      const next = new Map(previous);
      let nextOrder = Math.max(-1, ...next.values()) + 1;
      for (const rootId of currentGroupOrder.keys()) {
        if (next.has(rootId)) continue;
        next.set(rootId, nextOrder);
        nextOrder += 1;
      }
      return next;
    });
    setTasks(nextTasks);
    setTotal((previous) => Math.max(previous - removed, 0));
    syncContextTasks(nextTasks);
  }

  function updateVisibleTask(task: TaskRecord): void {
    updateVisibleTasks([task]);
  }

  function updateVisibleTasks(updatedTasks: TaskRecord[]): void {
    if (updatedTasks.length === 0) return;
    const updates = new Map(updatedTasks.map((task) => [task.id, task]));
    let nextTasks = tasks;
    let totalDelta = 0;
    let membershipChanged = false;
    let removedTask = false;
    for (const task of updates.values()) {
      const currentIndex = nextTasks.findIndex((existing) => existing.id === task.id);
      const wasVisible = currentIndex !== -1;
      const visible = isCurrentViewMatch(task);
      if (visible) {
        if (wasVisible) {
          nextTasks = nextTasks.map((existing) => existing.id === task.id ? task : existing);
        } else {
          nextTasks = [...nextTasks, task].sort((a, b) => compareTasksForSort(a, b, sortField, sortDirection));
          totalDelta += 1;
          membershipChanged = true;
        }
      } else if (wasVisible) {
        nextTasks = nextTasks.filter((existing) => existing.id !== task.id);
        totalDelta -= 1;
        membershipChanged = true;
        removedTask = true;
      }
    }
    if (removedTask) {
      const currentGroupOrder = taskGroupOrder(tasks, contextTasks);
      setContextOrder((previous) => {
        const next = new Map(previous);
        let nextOrder = Math.max(-1, ...next.values()) + 1;
        for (const rootId of currentGroupOrder.keys()) {
          if (next.has(rootId)) continue;
          next.set(rootId, nextOrder);
          nextOrder += 1;
        }
        return next;
      });
    }
    setTasks(nextTasks);
    if (totalDelta !== 0) setTotal((previous) => Math.max(previous + totalDelta, 0));
    syncContextTasks(nextTasks, updatedTasks);
    if (membershipChanged && sortField === "manual") void refreshTasks(0, true);
  }

  function isCurrentViewMatch(task: TaskRecord): boolean {
    return taskIsVisible(
      task,
      exactStatus,
      statusPreset,
      showUnblocked,
      categoryFilter?.slug ?? null,
      priorityFilter,
      tagFilter.map((tag) => tag.slug),
      searchQuery,
    );
  }

  function taskIsInCurrentView(task: TaskRecord, visibleTasks: readonly TaskRecord[] = tasks): boolean {
    if (isCurrentViewMatch(task)) return true;

    const otherVisibleTasks = visibleTasks.filter((entry) => entry.id !== task.id);
    return contextAncestorIds(otherVisibleTasks, [...otherVisibleTasks, ...contextTasks, task]).has(task.id);
  }

  function visibleTasksAfterUpdate(updatedTasks: readonly TaskRecord[]): TaskRecord[] {
    const updates = new Map(updatedTasks.map((task) => [task.id, task]));
    const nextTasks = tasks.flatMap((existing) => {
      const updated = updates.get(existing.id);
      if (!updated) return [existing];
      return isCurrentViewMatch(updated) ? [updated] : [];
    });
    const existingIds = new Set(tasks.map((task) => task.id));
    for (const updated of updatedTasks) {
      if (!existingIds.has(updated.id) && isCurrentViewMatch(updated)) nextTasks.push(updated);
    }
    return nextTasks;
  }

  function showMovedOutOfViewToast(movedTasks: readonly TaskRecord[]): void {
    if (movedTasks.length === 0) return;
    const statuses = new Set(movedTasks.map((task) => task.status));
    const Icon = statuses.size === 1 ? taskStatusMeta[movedTasks[0].status].Icon : undefined;
    showToast({
      message: movedTasks.length === 1 ? "Task moved out of current view" : `${movedTasks.length} tasks moved out of current view`,
      ...(Icon ? { Icon } : {}),
    });
  }

  // Status-specific feedback is retained for changes that stay in view. A
  // transition that removes rows must explain the view change instead.
  function handleStatusChanged(previous: TaskRecord, current: TaskRecord, _wasActive: boolean): void {
    const nextTasks = visibleTasksAfterUpdate([current]);
    const movedOutOfView = taskIsInCurrentView(previous) && !taskIsInCurrentView(current, nextTasks);
    if (movedOutOfView) showMovedOutOfViewToast([current]);
    else {
      const message = STATUS_CHANGE_TOASTS[current.status];
      if (message) showToast({ message, Icon: taskStatusMeta[current.status].Icon });
    }
    if (previous.status === "canceled" && current.status !== "canceled") void refreshTasks(0, true);
  }

  function handleStatusBatchChanged(previous: TaskRecord[], current: TaskRecord[], _wasActiveTaskId: string | null): void {
    const nextTasks = visibleTasksAfterUpdate(current);
    const previousById = new Map(previous.map((task) => [task.id, task]));
    const movedOutOfView = current.filter((task) => {
      const before = previousById.get(task.id);
      return before !== undefined
        && taskIsInCurrentView(before)
        && !taskIsInCurrentView(task, nextTasks);
    });
    if (movedOutOfView.length > 0) {
      showMovedOutOfViewToast(movedOutOfView);
      return;
    }

    const changedStatuses = new Set(current.map((task) => task.status));
    const toastStatus = changedStatuses.size === 1 ? [...changedStatuses][0] : null;
    const message = toastStatus ? STATUS_CHANGE_TOASTS[toastStatus] : null;
    if (toastStatus !== null && message) showToast({ message, Icon: taskStatusMeta[toastStatus].Icon });
  }

  function handleCanceledMany(previous: TaskRecord[], current: TaskRecord[]): void {
    ++querySequence.current;
    if (cancelExitTimer.current !== null) {
      window.clearTimeout(cancelExitTimer.current);
      cancelExitTimer.current = null;
    }
    const previousIds = new Set(previous.map((task) => task.id));
    const exiting = current.filter((task) => previousIds.has(task.id) && tasks.some((existing) => existing.id === task.id) && !isCurrentViewMatch(task));
    const remove = (): void => {
      updateVisibleTasks(current);
      setExitingTaskIds(new Set());
      cancelExitTimer.current = null;
      void refreshTasks(0, true);
    };
    if (exiting.length > 0) {
      setExitingTaskIds(new Set(exiting.map((task) => task.id)));
      cancelExitTimer.current = window.setTimeout(remove, 150);
    } else {
      updateVisibleTasks(current);
    }
    setAnnouncement(current.length === 1 ? `Canceled: ${current[0].title}` : `Canceled ${current.length} tasks`);
  }

  const ToastIcon = toast?.Icon;

  useEffect(() => {
    if (!receiveState?.waiting) return;
    const timer = window.setInterval(() => {
      void receiveWorkspaceStatus().then((status) => setReceiveState(status.waiting ? status : null));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [receiveState?.waiting]);

  async function purgeCanceledTasks(): Promise<number> {
    const result = await purgeCanceledTasksCommand({ idempotencyKey: crypto.randomUUID() });
    statusUndoRef.current = null;
    setStatusUndo(null);
    if (toastTimer.current !== null) {
      window.clearTimeout(toastTimer.current);
      toastTimer.current = null;
    }
    setToast(null);
    if (cancelExitTimer.current !== null) {
      window.clearTimeout(cancelExitTimer.current);
      cancelExitTimer.current = null;
    }
    setExitingTaskIds(new Set());
    requestActiveTask();
    await refreshTasks();
    setAnnouncement(result.deletedCount === 1
      ? "Permanently deleted 1 canceled task"
      : `Permanently deleted ${result.deletedCount} canceled tasks`);
    return result.deletedCount;
  }

  async function beginReceiveWorkspace(): Promise<void> {
    const prepared = await prepareReceiveWorkspace();
    setReceiveState(prepared);
    setSettingsOpen(false);
  }

  async function abortReceive(): Promise<void> {
    const restored = await abortReceiveWorkspace();
    setReceiveState(null);
    setAnnouncement(`Restored ${restored.taskCount ?? 0} tasks`);
    void refreshTasks();
  }

  return (
    <main className="min-h-svh bg-background text-foreground">
      {receiveState?.waiting ? <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/95 p-6">
        <section aria-labelledby="receive-title" className="w-full max-w-md space-y-4 rounded-lg border bg-card p-6 shadow-lg">
          <h1 id="receive-title" className="text-lg font-semibold">Waiting for workspace</h1>
          <p className="text-sm text-muted-foreground">{APP_NAME} is locked while this device receives the existing workspace. Add the empty sync folder to Syncthing, then wait for the transfer to finish.</p>
          {receiveState.syncRoot ? <p className="wrap-anywhere rounded bg-muted p-2 font-mono text-xs">{receiveState.syncRoot}</p> : null}
          <p className="text-sm text-muted-foreground"><a className="underline" href="https://github.com/Soleone/tasks/blob/main/docs/syncthing.md" target="_blank" rel="noreferrer">Read the Syncthing setup guide</a></p>
          <Button variant="outline" onClick={() => void abortReceive()}>Abort and restore backup</Button>
        </section>
      </div> : null}
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 p-4 md:p-8">
        <header className="flex items-center justify-between gap-4">
          <h1 className="flex items-center gap-1 font-semibold">
            <AppIcon className="size-8 shrink-0" />
            <span className="text-3xl leading-none">{APP_NAME}</span>
          </h1>
          <ButtonGroup
            onKeyDown={(event) => {
              if (event.key === "Tab" && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
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
              <TooltipContent>Help <Kbd>?</Kbd></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={<Button variant="ghost" size="icon-sm" tabIndex={-1} aria-keyshortcuts="Alt+t" onMouseDown={preventFocusSteal} onClick={openThemes} />}
              >
                <Palette aria-hidden="true" />
                <span className="sr-only">Themes</span>
              </TooltipTrigger>
              <TooltipContent>Themes <Kbd>Alt T</Kbd></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={<Button variant="ghost" size="icon-sm" tabIndex={-1} aria-keyshortcuts="Control+, Meta+," onMouseDown={preventFocusSteal} onClick={openSettings} />}
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
          onRefresh={refreshTasks}
          onAnnounce={setAnnouncement}
          onToast={(message) => showToast({ message })}
          onEdit={openEdit}
          onTaskUpdated={updateVisibleTask}
          onTasksUpdated={updateVisibleTasks}
          onOperation={(operationId, previous, current) => recordOperationUndo(operationId, previous, current)}
          onStatusChanged={handleStatusChanged}
          onStatusBatchChanged={handleStatusBatchChanged}
          canUndoStatus={statusUndo !== null}
          onUndoStatus={() => void handleUndoStatus()}
          onCanceled={(task) => handleCanceledMany([task], [task])}
          onCanceledMany={handleCanceledMany}
          onAddBlocker={(task) => openPicker("blocker", task)}
          onMoveUnder={(task) => openPicker("move", task)}
        />
        <p role="status" className="sr-only">{announcement}</p>
        {toast ? (
          <div data-undo-toast role="status" aria-live="polite" className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-md bg-foreground px-3 py-2 text-sm text-background shadow-lg">
            {ToastIcon ? <ToastIcon aria-hidden="true" className="size-4 shrink-0 text-background" /> : null}
            <span>{toast.message}</span>
          </div>
        ) : null}
      </div>
      <TaskComposerDialog
        composer={composer}
        onClose={closeComposer}
        onSaved={taskSaved}
        finalFocus={() => focusStack.restore("composer")}
        helpMode={helpMode}
      />
      <StarterHelp open={starterHelpOpen} onClose={() => setStarterHelpOpen(false)} />
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
        canUndoStatus={statusUndo !== null}
        onUndoStatus={() => {
          setHelpOpen(false);
          void handleUndoStatus();
        }}
      />
      {categoryPickerOpen ? <CategoryPicker
        open
        onClose={closeCategoryPicker}
        finalFocus={() => focusStack.restore("category-picker") ?? undefined}
        onSelect={chooseCategory}
      /> : null}
      {statusMenuOpen ? <StatusMenu
        open
        onClose={() => setStatusMenuOpen(false)}
        finalFocus={() => focusStack.restore("status-menu") ?? undefined}
        preset={statusPreset}
        exactStatus={exactStatus}
        onSelect={chooseStatusSelection}
      /> : null}
      {priorityMenuOpen ? <PriorityMenu
        open
        onClose={() => setPriorityMenuOpen(false)}
        finalFocus={() => focusStack.restore("priority-menu") ?? undefined}
        selected={priorityFilter}
        onSelect={choosePriority}
      /> : null}
      {tagPickerOpen ? <TagPicker
        open
        onClose={() => setTagPickerOpen(false)}
        finalFocus={() => focusStack.restore("tag-picker") ?? undefined}
        selected={tagFilter}
        onChange={chooseTags}
      /> : null}
      {searchOpen ? <SearchDialog
        open
        onClose={() => setSearchOpen(false)}
        finalFocus={() => focusStack.restore("search") ?? undefined}
        initialQuery={searchQuery}
        onSelect={chooseSearch}
      /> : null}
      {picker ? <TaskPicker
        open
        mode={picker.mode}
        subject={tasks.find((task) => task.id === picker.subject.id) ?? picker.subject}
        onClose={closePicker}
        finalFocus={() => focusStack.restore("picker") ?? undefined}
        onSelect={(target) => void pickerSelected(target)}
        onRemoveBlocker={(blockerId) => void pickerRemoveBlocker(blockerId)}
        onRemoveParent={() => void pickerRemoveParent()}
      /> : null}
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
      />
    </main>
  );
}
