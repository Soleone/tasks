import { randomUUID } from "./lib/randomUUID";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { CircleHelp, Palette, Settings2, type LucideIcon } from "lucide-react";
import { toast as sonnerToast } from "sonner";
import { AppIcon } from "@/components/AppIcon";
import { WorkspaceRequestRecovery } from "@/components/WorkspaceRequestRecovery";
import type { MainWorkspace } from "@/platform/mainWorkspace";
import { EditorError } from "@/platform/editorClient";
import type { UndoEntry } from "@/platform/undoHistory";
import type { ClassificationToken, TagRecord, TaskPriority, TaskRecord, TaskStatus, ThemeRecord } from "@/legacy/backend/protocol";
import { classifyTaskText } from "@/backend/taskText";
import { parseShorthand } from "@/backend/updateInputs";
import type { TaskView } from "@/components/taskView";
import { compareTasksForViewSort, presetStatuses, sortSummary, taskMatchesViewFilters, taskStatusMeta, type SortDirection, type SortField, type StatusPreset } from "@/components/taskFilters";
import { CategoryPicker } from "@/components/CategoryPicker";
import { StatusMenu } from "@/components/StatusMenu";
import { PriorityMenu } from "@/components/PriorityMenu";
import { TagPicker } from "@/components/TagPicker";
import { SearchDialog } from "@/components/SearchDialog";
import type { ComposerState, TaskCreateDraft } from "@/components/TaskComposer";
import { HelpPalette } from "@/components/HelpPalette";
import { StarterHelp } from "@/components/StarterHelp";
import { DisableKeyboardHelpDialog } from "@/components/DisableKeyboardHelpDialog";
import { TaskPicker, type TaskPickerMode } from "@/components/TaskPicker";
import { ThemePalette } from "@/components/ThemePalette";
import { SettingsDialog } from "@/components/SettingsDialog";
import { copyTaskText, TaskList, type TaskListHandle } from "@/components/TaskList";
import { contextAncestorIds, taskGroupOrder } from "@/components/taskTree";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { preventFocusSteal, useFocusNavigation, useFocusStack } from "@/navigation";
import { BackendCommandError, abortReceiveWorkspace, addDependency, closeBackendSession, getWorkspaceRevision, listTasks, listThemes, moveTask, prepareReceiveWorkspace, purgeCanceledTasks as purgeCanceledTasksCommand, receiveWorkspaceStatus, removeDependency, setTheme, transitionTask, undoOperation, undoStatusChange, selectMainWorkspace, type ReceiveWorkspaceResult, type TaskListResult, type TaskMutationResult } from "@/platform/backendClient";
import { APP_NAME } from "./backend/branding";
import { taskTitleDisplay } from "@/components/TaskRow";
import { applyTheme } from "@/theme";
import { DEFAULT_GLOBAL_SHORTCUT, isShortcutConfigured, setGlobalShortcut } from "@/platform/globalShortcut";
import { runtimeKind } from "@/platform/runtime";
import { readStoredFontSizeIncrease, storeFontSizeIncrease, type FontSizeIncrease } from "@/fontSize";
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
// Android re-reads the whole SAF workspace on every poll (~50 IPCs for a
// mid-size task set), so it polls far less often than desktop, where the read
// is a cheap local-filesystem scan.
const WORKSPACE_REVISION_POLL_MS = runtimeKind() === "android" ? 15000 : 1500;

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
  return stored === "created" || stored === "updated" || stored === "priority" || stored === "manual" ? stored : "created";
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

type OperationUndoEntry = UndoEntry & { expectedVersion?: number };

type ToastDisplayOptions = {
  icon?: LucideIcon;
  completion?: boolean;
};

type StatusChangeFeedback = {
  message: string;
  notifyWhenVisible: boolean;
};

const STATUS_CHANGE_FEEDBACK: Record<TaskStatus, StatusChangeFeedback> = {
  open: { message: "Task marked as open", notifyWhenVisible: false },
  in_progress: { message: "Task marked as in progress", notifyWhenVisible: false },
  paused: { message: "Task marked as paused", notifyWhenVisible: true },
  done: { message: "Task marked as done", notifyWhenVisible: true },
  canceled: { message: "Task marked as canceled", notifyWhenVisible: true },
};

const TOAST_DURATION_MS = 3000;

// The list is the default surface. Create and edit use an inline editor opened
// by the New task button, the C key, or the palette. Tab does not leave the
// task editor or list.
export default function App({ workspace }: { workspace?: MainWorkspace } = {}): ReactElement {
  // Rebind after development module reloads before the list's query effects run.
  useEffect(() => { if (workspace) selectMainWorkspace(workspace); }, [workspace, selectMainWorkspace]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [optimisticCreate, setOptimisticCreate] = useState<TaskRecord | null>(null);
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
  const [disableHelpTarget, setDisableHelpTarget] = useState<"basic" | "none" | null>(null);
  const [themesOpen, setThemesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themes, setThemes] = useState<ThemeRecord[]>([]);
  const [selectedTheme, setSelectedTheme] = useState("");
  const [globalShortcut, setGlobalShortcutValue] = useState(() => readStored(GLOBAL_SHORTCUT_KEY) ?? DEFAULT_GLOBAL_SHORTCUT);
  const [picker, setPicker] = useState<{ mode: TaskPickerMode; subject: TaskRecord } | null>(null);
  const [statusUndo, setStatusUndo] = useState<OperationUndoEntry | null>(null);
  const [newTaskId, setNewTaskId] = useState<string | null>(null);
  const [exitingTaskIds, setExitingTaskIds] = useState<Set<string>>(() => new Set());
  const [receiveState, setReceiveState] = useState<ReceiveWorkspaceResult | null>(null);
  const [unresolvedConflicts, setUnresolvedConflicts] = useState<NonNullable<TaskListResult["unresolvedConflicts"]>>([]);
  const querySequence = useRef(0);
  const initialLoadRetry = useRef(0);
  const statusUndoRef = useRef<OperationUndoEntry | null>(null);
  const cancelExitTimer = useRef<number | null>(null);
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
    if (!workspace) void setGlobalShortcut(globalShortcut, null).catch(() => undefined);
  }, []);

  async function changeGlobalShortcut(value: string): Promise<void> {
    if (workspace) throw new Error("Global shortcuts are not yet enabled for this selected workspace.");
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
      setUnresolvedConflicts(result.unresolvedConflicts ?? []);
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
        const revision = await getWorkspaceRevision();
        if (disposed) return;
        const previousRevision = workspaceRevisionRef.current;
        if (previousRevision !== null && revision !== previousRevision) {
          taskListRef.current?.startIdentityPreservingRefresh();
          try {
            await refreshTasks();
          } finally {
            finishIdentityPreservingRefresh();
          }
        } else if (previousRevision === null) {
          workspaceRevisionRef.current = revision;
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
    const refresh = (): void => { void refreshThemes(true); };
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
        setAnnouncement(`${taskTitleDisplay(parent.title)} is canceled. Reopen it before creating a child.`);
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
    setComposer(parentId
      ? { mode: "create", parentId, ...(initialTitle ? { initialTitle } : {}) }
      : { mode: "create", ...(initialTitle ? { initialTitle } : {}) });
  }

  function openEdit(task: TaskRecord): void {
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
      const typing = target instanceof HTMLElement && (target.matches("input, textarea, [contenteditable=true]") || target.closest('[role="dialog"], [data-inline-task-editor]') !== null);
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

  function openPicker(mode: TaskPickerMode, subject: TaskRecord): void {
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

  function changeHelpMode(mode: KeyboardHelpMode): void {
    setHelpMode(mode);
    writeStored(HELP_MODE_KEY, mode);
    setAnnouncement(mode === "full"
      ? "Full keyboard help enabled"
      : mode === "basic"
        ? "Basic keyboard help enabled"
        : "Keyboard help disabled");
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

  function resetStatusFilter(): void {
    chooseStatusSelection("active", null);
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
      const result = await removeDependency(current.id, blockerId, current.version, { idempotencyKey: randomUUID() });
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
      const result = await moveTask(current.id, null, current.version, { idempotencyKey: randomUUID() });
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
        ? await addDependency(current.id, target.id, current.version, { idempotencyKey: randomUUID() })
        : await moveTask(current.id, target.id, current.version, { idempotencyKey: randomUUID() });
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
        ? await transitionTask("task.start", current.id, current.version, { idempotencyKey: randomUUID() })
        : await transitionTask("task.pause", current.id, current.version, { idempotencyKey: randomUUID() });
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
    // The native route keeps single-task status undo; the Linux route records every own operation for operation.undo.
    const singleStatus = statusLike && affectedTaskIds.length === 1;
    if (workspace && !workspace.supportsOperationUndo && !singleStatus) {
      retireStatusUndo();
      return;
    }
    const titleTask = current.find((task) => affectedTaskIds.includes(task.id)) ?? previous.find((task) => affectedTaskIds.includes(task.id));
    const entry: OperationUndoEntry = {
      operationId,
      ...(workspace && !workspace.supportsOperationUndo && singleStatus ? { expectedVersion: current[0].version } : {}),
      key: randomUUID(),
      affectedTaskIds,
      createdTaskIds: options.createdTaskIds ?? [],
      title: titleTask?.title ?? "task",
      statusLike,
      wasActiveTaskId: options.wasActiveTaskId ?? (() => {
        const activeTaskId = taskListRef.current?.getActiveTask()?.id ?? null;
        return activeTaskId !== null && affectedTaskIds.includes(activeTaskId) ? activeTaskId : null;
      })(),
    };
    showUndo(entry);
    if (!workspace?.supportsOperationUndo) return;
    // Re-show after pushing, so a history load that resolves late cannot replace this newer entry.
    void workspace.undoHistory().then((history) => {
      history.push(entry);
      showUndo(history.latest());
    }, () => undefined);
  }

  function showUndo(entry: OperationUndoEntry | null): void {
    statusUndoRef.current = entry;
    setStatusUndo(entry);
  }

  function retireStatusUndo(): void {
    showUndo(null);
  }

  // On the Linux route, an undone or gateway-refused entry leaves this client's next older entry.
  function retireUndo(entry: OperationUndoEntry): void {
    retireStatusUndo();
    if (!workspace?.supportsOperationUndo) return;
    void workspace.undoHistory().then((history) => {
      history.remove(entry.operationId);
      showUndo(history.latest());
    }, () => undefined);
  }

  function showToast(message: string, options: ToastDisplayOptions = {}): void {
    const Icon = options.icon;
    const iconClassName = options.completion ? "size-4 task-completion-icon" : "size-4";
    sonnerToast(message, {
      duration: TOAST_DURATION_MS,
      ...(Icon ? { icon: <Icon aria-hidden="true" className={iconClassName} /> } : {}),
    });
  }

  async function handleUndoStatus(): Promise<void> {
    const entry = statusUndoRef.current;
    if (!entry) return;
    try {
      const result = entry.expectedVersion !== undefined
        ? { tasks: [(await undoStatusChange(entry.affectedTaskIds[0], entry.expectedVersion!, { idempotencyKey: entry.key })).task], deletedTaskIds: [] }
        : await undoOperation(entry.operationId, { idempotencyKey: entry.key });
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
      retireUndo(entry);
      const label = restored.length === 1 ? taskStatusMeta[restored[0].status]?.label ?? restored[0].status : null;
      const message = entry.createdTaskIds.length > 0
        ? `Removed: ${entry.title}`
        : entry.statusLike && restored.length === 1
          ? `${restored[0].title}: ${label}`
          : restored.length === 1
            ? `Undid change to ${restored[0].title}`
            : `Undid changes for ${entry.affectedTaskIds.length} tasks`;
      setAnnouncement(message);
      showToast(entry.statusLike && label ? `Undo status change to ${label}` : message);
      void refreshTasks(0, true);
    } catch (caught) {
      if ((caught instanceof BackendCommandError || caught instanceof EditorError) && (caught.code === "OPERATION_CONFLICT" || caught.code === "OPERATION_UNAVAILABLE" || caught.code === "OPERATION_NOT_FOUND" || caught.code === "STALE_TASK_VERSION" || caught.code === "TASK_NOT_FOUND"
        || (caught instanceof EditorError && (caught.code === "PARENT_CYCLE" || caught.code === "DEPENDENCY_CYCLE")))) {
        retireUndo(entry);
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

  // After confirmation, the Linux route reloads this client's retained history for the same root/cache/profile.
  useEffect(() => {
    if (!workspace?.supportsOperationUndo) return;
    let cancelled = false;
    void workspace.undoHistory().then((history) => { if (!cancelled) showUndo(history.latest()); }, () => undefined);
    return () => { cancelled = true; };
  }, [workspace]);

  useEffect(() => {
    if (newTaskId === null) return;
    const timeout = window.setTimeout(() => setNewTaskId(null), 240);
    return () => window.clearTimeout(timeout);
  }, [newTaskId]);

  function showOptimisticCreate(draft: TaskCreateDraft): void {
    const literal = workspace ? parseShorthand(draft.title) : null;
    const classification = literal ? {
      category: literal.category === null ? null : { slug: literal.category, label: literal.category },
      tags: literal.tags.map(slug => ({ slug, label: slug })),
    } : classifyTaskText(draft.title);
    const now = new Date().toISOString();
    const task: TaskView = {
      id: `pending-${randomUUID()}`,
      title: literal?.title ?? draft.title,
      ...(literal ? { literalTitle: literal.title, inputText: draft.title } : {}),
      descriptionMarkdown: draft.descriptionMarkdown,
      status: "open",
      priority: draft.priority,
      category: classification.category,
      tags: classification.tags,
      parentId: draft.parentId ?? null,
      dependencyIds: [],
      blockedByIds: [],
      version: 1,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      canceledAt: null,
    };
    setOptimisticCreate(isCurrentViewMatch(task) ? task : null);
  }

  function taskSaved(result: TaskMutationResult): void {
    const task = result.task;
    const composerBeforeSave = composerRef.current;
    const creating = composerBeforeSave?.mode === "create";
    const previous = composerBeforeSave?.mode === "edit" ? [composerBeforeSave.task] : [];
    const visible = isCurrentViewMatch(task);
    if (creating) {
      setOptimisticCreate(null);
      if (visible) {
        updateVisibleTasks([task]);
        setNewTaskId(task.id);
      }
    } else if (visible) {
      setTasks((previous) => previous.map((existing) => existing.id === task.id ? task : existing));
    } else {
      setTasks((previous) => previous.filter((existing) => existing.id !== task.id));
    }
    if (!creating) requestActiveTask(task.id);
    if (result.operationId) {
      recordOperationUndo(result.operationId, previous, [task], { createdTaskIds: creating ? [task.id] : [] });
    }
    setAnnouncement(`${creating ? "Added" : "Saved"}: ${task.title}`);
    // Creating one task returns to the list instead of reopening capture.
    // The next task can still be started with C or the New task action.
    setComposer(null);
    if (!creating) void refreshTasks();
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
          nextTasks = [...nextTasks, task].sort((a, b) => compareTasksForViewSort(a, b, sortField, sortDirection));
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
    return taskMatchesViewFilters(task, {
      exactStatus,
      statusPreset,
      showUnblocked,
      categorySlug: categoryFilter?.slug ?? null,
      priorityFilter,
      tagSlugs: tagFilter.map((tag) => tag.slug),
      searchQuery,
    });
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

  function showStatusChangeToast(changedTasks: readonly TaskRecord[], movedOutOfView = false): void {
    if (changedTasks.length === 0) return;
    const statuses = [...new Set(changedTasks.map((task) => task.status))];
    if (!movedOutOfView && statuses.length !== 1) return;
    const feedback = statuses
      .map((status) => STATUS_CHANGE_FEEDBACK[status])
      .filter((entry) => movedOutOfView || entry.notifyWhenVisible);
    if (feedback.length === 0) return;
    const Icon = statuses.length === 1 ? taskStatusMeta[statuses[0]].Icon : undefined;
    showToast(
      feedback.length === 1 ? feedback[0].message : `Tasks: ${feedback.map((entry) => entry.message).join("; ")}`,
      {
        ...(Icon ? { icon: Icon } : {}),
        ...(statuses.length === 1 && statuses[0] === "done" ? { completion: true } : {}),
      },
    );
  }

  function handleStatusChanged(previous: TaskRecord, current: TaskRecord, _wasActive: boolean): void {
    const nextTasks = visibleTasksAfterUpdate([current]);
    const movedOutOfView = taskIsInCurrentView(previous) && !taskIsInCurrentView(current, nextTasks);
    showStatusChangeToast([current], movedOutOfView);
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
      showStatusChangeToast(movedOutOfView, true);
      return;
    }
    showStatusChangeToast(current);
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

  useEffect(() => {
    if (!receiveState?.waiting) return;
    const timer = window.setInterval(() => {
      void receiveWorkspaceStatus().then((status) => setReceiveState(status.waiting ? status : null));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [receiveState?.waiting]);

  async function purgeCanceledTasks(): Promise<number> {
    const result = await purgeCanceledTasksCommand({ idempotencyKey: randomUUID() });
    statusUndoRef.current = null;
    setStatusUndo(null);
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
    <main className="fixed inset-0 overflow-hidden bg-background text-foreground">
      {workspace && <WorkspaceRequestRecovery workspace={workspace} />}
      {receiveState?.waiting ? <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/95 p-6">
        <section aria-labelledby="receive-title" className="w-full max-w-md space-y-4 rounded-lg border bg-card p-6 shadow-lg">
          <h1 id="receive-title" className="text-lg font-semibold">Waiting for workspace</h1>
          <p className="text-sm text-muted-foreground">{APP_NAME} is locked while this device receives the existing workspace. Add the empty sync folder to Syncthing, then wait for the transfer to finish.</p>
          {receiveState.syncRoot ? <p className="wrap-anywhere rounded bg-muted p-2 font-mono text-xs">{receiveState.syncRoot}</p> : null}
          <p className="text-sm text-muted-foreground"><a className="underline" href="https://github.com/Soleone/tasks/blob/f762b50c8739b994629c68e4ab62a3a01142aaae/docs/syncthing.md" target="_blank" rel="noreferrer">Read the Syncthing setup guide</a></p>
          <Button variant="outline" onClick={() => void abortReceive()}>Abort and restore backup</Button>
        </section>
      </div> : null}
      <div className="app-shell mx-auto flex h-full min-h-0 w-full max-w-xl flex-col gap-6 overflow-hidden">
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

        {runtimeKind() === "android" && unresolvedConflicts.length > 0 ? <Alert variant="destructive">
          <AlertTitle>Syncthing conflict copies need attention</AlertTitle>
          <AlertDescription>
            <div className="flex flex-col gap-2">
              <p>{unresolvedConflicts.length} conflict {unresolvedConflicts.length === 1 ? "copy was" : "copies were"} found. Android leaves them untouched. Resolve them on a desktop or CLI client, and do not delete the copies before checking the workspace.</p>
              <ul className="max-h-24 space-y-1 overflow-auto font-mono text-xs">
                {unresolvedConflicts.map((conflict) => <li key={conflict.sourcePath} className="break-all">{conflict.sourcePath}</li>)}
              </ul>
            </div>
          </AlertDescription>
        </Alert> : null}

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
          optimisticTask={optimisticCreate && isCurrentViewMatch(optimisticCreate) ? optimisticCreate : null}
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
        <Toaster theme={themes.find((theme) => theme.name === selectedTheme)?.mode ?? "system"} />
      </div>
      <StarterHelp open={starterHelpOpen} onClose={() => setStarterHelpOpen(false)} />
      <DisableKeyboardHelpDialog
        open={disableHelpTarget !== null}
        mode={disableHelpTarget ?? "none"}
        onOpenChange={(open) => { if (!open) setDisableHelpTarget(null); }}
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
        themes={themes}
        selectedTheme={selectedTheme}
        onSelectTheme={(name) => void chooseTheme(name)}
      />
    </main>
  );
}
