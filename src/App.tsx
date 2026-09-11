import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { CircleHelp, Palette, Settings2, type LucideIcon } from "lucide-react";
import { AppIcon } from "@/components/AppIcon";
import type { CategoryRecord, TagRecord, TaskPriority, TaskRecord, TaskStatus, ThemeRecord } from "@/backend/protocol";
import { ACTIVE_TASK_STATUSES, INACTIVE_TASK_STATUSES, presetStatuses, sortSummary, taskStatusMeta, type SortDirection, type SortField, type StatusPreset } from "@/components/taskFilters";
import { CategoryPicker } from "@/components/CategoryPicker";
import { StatusMenu } from "@/components/StatusMenu";
import { PriorityMenu } from "@/components/PriorityMenu";
import { TagPicker } from "@/components/TagPicker";
import { SearchDialog } from "@/components/SearchDialog";
import { TaskComposerDialog, type ComposerState } from "@/components/TaskComposerDialog";
import { HelpPalette } from "@/components/HelpPalette";
import { TaskPicker, type TaskPickerMode } from "@/components/TaskPicker";
import { ThemePalette } from "@/components/ThemePalette";
import { SettingsDialog } from "@/components/SettingsDialog";
import { TaskList } from "@/components/TaskList";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useFocusNavigation, useFocusStack } from "@/navigation";
import { BackendCommandError, addDependency, closeBackendSession, listTasks, listThemes, moveTask, removeDependency, setTheme, transitionTask, undoStatusChange } from "@/platform/backendClient";
import { taskTitleDisplay } from "@/components/TaskRow";
import { applyTheme } from "@/theme";

const ACTIVE_TASK_STATUS_SET = new Set<TaskStatus>(ACTIVE_TASK_STATUSES);
const INACTIVE_TASK_STATUS_SET = new Set<TaskStatus>(INACTIVE_TASK_STATUSES);

const SORT_FIELD_KEY = "tasks.sortField";
const SORT_DIRECTION_KEY = "tasks.sortDirection";
const SHOW_DETAILS_KEY = "tasks.showDetails";
const LEGACY_SHOW_TIMESTAMPS_KEY = "tasks.showTimestamps";

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

function readSortField(): SortField {
  return readStored(SORT_FIELD_KEY) === "created" ? "created" : "updated";
}

function readSortDirection(): SortDirection {
  return readStored(SORT_DIRECTION_KEY) === "asc" ? "asc" : "desc";
}

function readShowDetails(): boolean {
  return (readStored(SHOW_DETAILS_KEY) ?? readStored(LEGACY_SHOW_TIMESTAMPS_KEY)) === "true";
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

type StatusUndoEntry = {
  kind: "status";
  taskId: string;
  title: string;
  from: TaskStatus;
  to: TaskStatus;
  version: number;
  key: string;
  wasActive: boolean;
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
  const [total, setTotal] = useState(0);
  const [statusPreset, setStatusPreset] = useState<StatusPreset>("active");
  const [exactStatus, setExactStatus] = useState<TaskStatus | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | null>(null);
  const [tagFilter, setTagFilter] = useState<TagRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showUnblocked, setShowUnblocked] = useState(false);
  const [showDetails, setShowDetails] = useState(readShowDetails);
  const [sortField, setSortField] = useState(readSortField);
  const [sortDirection, setSortDirection] = useState(readSortDirection);
  const [categoryFilter, setCategoryFilter] = useState<CategoryRecord | null>(null);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [priorityMenuOpen, setPriorityMenuOpen] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [activeTaskIndex, setActiveTaskIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [themesOpen, setThemesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themes, setThemes] = useState<ThemeRecord[]>([]);
  const [selectedTheme, setSelectedTheme] = useState("");
  const [picker, setPicker] = useState<{ mode: TaskPickerMode; subject: TaskRecord } | null>(null);
  const [statusUndo, setStatusUndo] = useState<StatusUndoEntry | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const querySequence = useRef(0);
  const statusUndoRef = useRef<StatusUndoEntry | null>(null);
  const toastTimer = useRef<number | null>(null);
  const statusPresetRef = useRef<StatusPreset>("active");
  const exactStatusRef = useRef<TaskStatus | null>(null);
  const priorityFilterRef = useRef<TaskPriority | null>(null);
  const tagFilterRef = useRef<string[]>([]);
  const searchQueryRef = useRef("");
  const showUnblockedRef = useRef(false);
  const sortFieldRef = useRef<SortField>("updated");
  const sortDirectionRef = useRef<SortDirection>("desc");
  const categoryFilterRef = useRef<string | null>(null);
  const composerRef = useRef<ComposerState | null>(null);
  composerRef.current = composer;

  const nav = useFocusNavigation(["list"]);
  const focusStack = useFocusStack();

  const refreshTasks = useCallback(async (offset = 0): Promise<void> => {
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
        },
      );
      if (sequence !== querySequence.current) return;
      setTasks((previous) => offset ? [...previous, ...result.tasks.filter((task) => !previous.some((existing) => existing.id === task.id))] : result.tasks);
      setTotal(result.total);
    } catch (caught) {
      if (sequence === querySequence.current) setLoadError(caught instanceof Error ? caught.message : String(caught));
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
    void refreshTasks();
  }, [statusPreset, exactStatus, priorityFilter, tagFilter, searchQuery, showUnblocked, sortField, sortDirection, categoryFilter, refreshTasks]);

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

  function openCreate(parentId?: string): void {
    if (composerRef.current) return;
    const fromPalette = helpOpen ? focusStack.restore("help") : undefined;
    focusStack.push("composer", fromPalette ?? undefined);
    setHelpOpen(false);
    setComposer(parentId ? { mode: "create", parentId } : { mode: "create" });
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
  }, [helpOpen, themesOpen]);

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
    } else {
      setStatusPreset((previous) => (previous === "active" ? "inactive" : "active"));
    }
    setActiveTaskIndex(0);
  }

  function chooseSortField(field: SortField): void {
    if (field === sortField) return;
    setSortField(field);
    setActiveTaskIndex(0);
    writeStored(SORT_FIELD_KEY, field);
    setAnnouncement(`Sorted ${sortSummary(field, sortDirection)}`);
  }

  function reverseSort(): void {
    const next = sortDirection === "desc" ? "asc" : "desc";
    setSortDirection(next);
    setActiveTaskIndex(0);
    writeStored(SORT_DIRECTION_KEY, next);
    setAnnouncement(`Sorted ${sortSummary(sortField, next)}`);
  }

  function toggleDetails(): void {
    const next = !showDetails;
    setShowDetails(next);
    writeStored(SHOW_DETAILS_KEY, String(next));
    setAnnouncement(next ? "Showing task details" : "Hiding task details");
  }

  function chooseExactStatus(status: TaskStatus | null): void {
    setStatusMenuOpen(false);
    setExactStatus(status);
    setActiveTaskIndex(0);
  }

  function choosePriority(priority: TaskPriority | null): void {
    setPriorityMenuOpen(false);
    setPriorityFilter(priority);
    setActiveTaskIndex(0);
  }

  function chooseTags(tags: TagRecord[]): void {
    setTagFilter(tags);
    setActiveTaskIndex(0);
  }

  function chooseSearch(query: string): void {
    setSearchOpen(false);
    setSearchQuery(query.trim());
    setActiveTaskIndex(0);
  }

  function clearAllFilters(): void {
    setExactStatus(null);
    setStatusPreset("active");
    setPriorityFilter(null);
    setTagFilter([]);
    setSearchQuery("");
    setCategoryFilter(null);
    setShowUnblocked(false);
    setActiveTaskIndex(0);
    setAnnouncement("Cleared all filters");
  }

  const hasActiveFilters = exactStatus !== null
    || statusPreset !== "active"
    || priorityFilter !== null
    || tagFilter.length > 0
    || searchQuery.trim() !== ""
    || categoryFilter !== null
    || showUnblocked;

  function clearCategoryFilter(): void {
    setCategoryFilter(null);
    setActiveTaskIndex(0);
  }

  function chooseCategory(category: CategoryRecord): void {
    setCategoryPickerOpen(false);
    setCategoryFilter(category);
    setActiveTaskIndex(0);
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
      updateVisibleTask(result.task);
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
      updateVisibleTask(result.task);
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
    const wasActive = tasks[activeTaskIndex]?.id === current.id;
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
      if (result.changed !== false) handleStatusChanged(current, result.task, wasActive);
      setAnnouncement(`${current.title}: ${result.task.status === "paused" ? "Paused" : "In progress"}`);
    } catch (caught) {
      setAnnouncement(caught instanceof BackendCommandError && caught.code === "STALE_TASK_VERSION"
        ? `${current.title} changed elsewhere. Refresh and try again.`
        : caught instanceof Error ? caught.message : String(caught));
      void refreshTasks();
    }
  }

  function recordStatusUndo(previous: TaskRecord, current: TaskRecord, wasActive: boolean): void {
    if (previous.status === current.status) return;
    if (toastTimer.current !== null) {
      window.clearTimeout(toastTimer.current);
      toastTimer.current = null;
    }
    setToast(null);
    const entry: StatusUndoEntry = {
      kind: "status",
      taskId: current.id,
      title: current.title,
      from: previous.status,
      to: current.status,
      version: current.version,
      key: crypto.randomUUID(),
      wasActive,
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
      const result = await undoStatusChange(entry.taskId, entry.version, { idempotencyKey: entry.key });
      const restored = result.task;
      const visible = taskIsVisible(
        restored,
        exactStatus,
        statusPreset,
        showUnblocked,
        categoryFilter?.slug ?? null,
        priorityFilter,
        tagFilter.map((tag) => tag.slug),
        searchQuery,
      );
      if (visible) {
        const alreadyPresent = tasks.some((existing) => existing.id === restored.id);
        const nextTasks = alreadyPresent
          ? tasks.map((existing) => existing.id === restored.id ? restored : existing)
          : [...tasks, restored].sort((a, b) => compareTasksForSort(a, b, sortField, sortDirection));
        setTasks(nextTasks);
        if (!alreadyPresent) setTotal((previous) => previous + 1);
        if (entry.wasActive) {
          const index = nextTasks.findIndex((existing) => existing.id === restored.id);
          if (index >= 0) setActiveTaskIndex(index);
        }
      } else {
        setTasks((previous) => previous.map((existing) => existing.id === restored.id ? restored : existing));
      }
      retireStatusUndo();
      const label = taskStatusMeta[restored.status]?.label ?? restored.status;
      setAnnouncement(`${restored.title}: ${label}`);
      showToast({ message: `Undo status change to ${label}` });
    } catch (caught) {
      if (caught instanceof BackendCommandError && (caught.code === "STALE_TASK_VERSION" || caught.code === "UNDO_UNAVAILABLE" || caught.code === "TASK_NOT_FOUND")) {
        retireStatusUndo();
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

  function taskSaved(task: TaskRecord): void {
    const creating = composerRef.current?.mode === "create";
    const visible = taskIsVisible(
      task,
      exactStatus,
      statusPreset,
      showUnblocked,
      categoryFilter?.slug ?? null,
      priorityFilter,
      tagFilter.map((tag) => tag.slug),
      searchQuery,
    );
    if (visible) {
      setTasks((previous) => creating
        ? [task, ...previous.filter((existing) => existing.id !== task.id)]
        : previous.map((existing) => existing.id === task.id ? task : existing));
    } else {
      setTasks((previous) => previous.filter((existing) => existing.id !== task.id));
    }
    setActiveTaskIndex(0);
    setAnnouncement(`${creating ? "Added" : "Saved"}: ${task.title}`);
    // Create stays open for rapid capture; edit closes back to the list.
    if (!creating) setComposer(null);
    void refreshTasks();
  }

  function updateVisibleTask(task: TaskRecord): void {
    const wasVisible = tasks.some((existing) => existing.id === task.id);
    const visible = taskIsVisible(
      task,
      exactStatus,
      statusPreset,
      showUnblocked,
      categoryFilter?.slug ?? null,
      priorityFilter,
      tagFilter.map((tag) => tag.slug),
      searchQuery,
    );
    if (!visible) {
      if (!wasVisible) return;
      setTasks((previous) => previous.filter((existing) => existing.id !== task.id));
      setTotal((previous) => Math.max(previous - 1, 0));
      return;
    }
    if (!wasVisible) {
      setTasks((previous) => {
        const next = [...previous, task];
        next.sort((a, b) => compareTasksForSort(a, b, sortField, sortDirection));
        return next;
      });
      setTotal((previous) => previous + 1);
      return;
    }
    setTasks((previous) => previous.map((existing) => existing.id === task.id ? task : existing));
  }

  function handleStatusChanged(previous: TaskRecord, current: TaskRecord, wasActive: boolean): void {
    recordStatusUndo(previous, current, wasActive);
    const message = STATUS_CHANGE_TOASTS[current.status];
    if (message) showToast({ message, Icon: taskStatusMeta[current.status].Icon });
  }

  const ToastIcon = toast?.Icon;

  return (
    <main className="min-h-svh bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 p-4 md:p-8">
        <header className="flex items-center justify-between gap-4">
          <h1 className="flex items-center gap-1 font-semibold">
            <AppIcon className="size-8 shrink-0" />
            <span className="text-[32px] leading-none">Tasks</span>
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
                    aria-keyshortcuts="Control+k Meta+k"
                    onClick={openHelp}
                  />
                }
              >
                <CircleHelp aria-hidden="true" />
                <span className="sr-only">Help</span>
              </TooltipTrigger>
              <TooltipContent>Help <Kbd>Ctrl/⌘ K</Kbd></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={<Button variant="ghost" size="icon-sm" tabIndex={-1} aria-keyshortcuts="Alt+t" onClick={openThemes} />}
              >
                <Palette aria-hidden="true" />
                <span className="sr-only">Themes</span>
              </TooltipTrigger>
              <TooltipContent>Themes <Kbd>Alt T</Kbd></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={<Button variant="ghost" size="icon-sm" tabIndex={-1} onClick={openSettings} />}
              >
                <Settings2 aria-hidden="true" />
                <span className="sr-only">Settings</span>
              </TooltipTrigger>
              <TooltipContent>Settings</TooltipContent>
            </Tooltip>
          </ButtonGroup>
        </header>

        <TaskList
          tasks={tasks}
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
            setActiveTaskIndex(0);
          }}
          sortField={sortField}
          sortDirection={sortDirection}
          onSortFieldChange={chooseSortField}
          onReverseSort={reverseSort}
          showDetails={showDetails}
          onToggleDetails={toggleDetails}
          categoryFilter={categoryFilter}
          onCategoryFilterChange={clearCategoryFilter}
          onOpenCategoryPicker={openCategoryPicker}
          tagFilter={tagFilter}
          onTagFilterChange={chooseTags}
          onOpenTagPicker={openTagPicker}
          searchQuery={searchQuery}
          onSearchChange={chooseSearch}
          onOpenSearch={openSearch}
          hasActiveFilters={hasActiveFilters}
          onClearAllFilters={clearAllFilters}
          activeTaskIndex={activeTaskIndex}
          loading={loading}
          error={loadError}
          nav={nav}
          onCreate={openCreate}
          onRefresh={refreshTasks}
          onActiveTaskIndexChange={setActiveTaskIndex}
          onAnnounce={setAnnouncement}
          onEdit={openEdit}
          onTaskUpdated={updateVisibleTask}
          onStatusChanged={handleStatusChanged}
          canUndoStatus={statusUndo !== null}
          onUndoStatus={() => void handleUndoStatus()}
          onCanceled={(task) => {
            ++querySequence.current;
            updateVisibleTask(task);
            setAnnouncement(`Canceled: ${task.title}`);
          }}
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
        activeTask={tasks[activeTaskIndex]}
        onAddBlocker={(task) => openPicker("blocker", task)}
        onMoveUnder={(task) => openPicker("move", task)}
        onPauseTask={(task) => void pauseTaskFromPalette(task)}
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
        onSelect={(preset, exact) => {
          setStatusMenuOpen(false);
          if (exact !== undefined) setExactStatus(exact);
          if (preset !== undefined) {
            setStatusPreset(preset);
            if (exact === undefined) setExactStatus(null);
          }
          setActiveTaskIndex(0);
        }}
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
      />
    </main>
  );
}
