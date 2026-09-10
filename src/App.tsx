import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { CircleHelp, Palette, Settings2 } from "lucide-react";
import { AppIcon } from "@/components/AppIcon";
import type { CategoryRecord, TagRecord, TaskPriority, TaskRecord, TaskStatus, ThemeRecord } from "@/backend/protocol";
import { ACTIVE_TASK_STATUSES, INACTIVE_TASK_STATUSES, presetStatuses, type StatusPreset } from "@/components/taskFilters";
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
import { BackendCommandError, addDependency, closeBackendSession, listTasks, listThemes, moveTask, removeDependency, setTheme } from "@/platform/backendClient";
import { taskTitleDisplay } from "@/components/TaskRow";
import { applyTheme } from "@/theme";

const ACTIVE_TASK_STATUS_SET = new Set<TaskStatus>(ACTIVE_TASK_STATUSES);
const INACTIVE_TASK_STATUS_SET = new Set<TaskStatus>(INACTIVE_TASK_STATUSES);

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

// The list is the default surface. Create and edit share one dialog opened
// by the New task button, the N key, or the palette. Tab does not leave the
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
  const querySequence = useRef(0);
  const statusPresetRef = useRef<StatusPreset>("active");
  const exactStatusRef = useRef<TaskStatus | null>(null);
  const priorityFilterRef = useRef<TaskPriority | null>(null);
  const tagFilterRef = useRef<string[]>([]);
  const searchQueryRef = useRef("");
  const showUnblockedRef = useRef(false);
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
    categoryFilterRef.current = categoryFilter?.slug ?? null;
    void refreshTasks();
  }, [statusPreset, exactStatus, priorityFilter, tagFilter, searchQuery, showUnblocked, categoryFilter, refreshTasks]);

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
    setTasks((previous) => previous.map((existing) => existing.id === task.id ? task : existing));
  }

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
          focusStack={focusStack}
          onCreate={openCreate}
          onRefresh={refreshTasks}
          onActiveTaskIndexChange={setActiveTaskIndex}
          onAnnounce={setAnnouncement}
          onEdit={openEdit}
          onTaskUpdated={updateVisibleTask}
          onCanceled={(task) => {
            ++querySequence.current;
            updateVisibleTask(task);
            setAnnouncement(`Cancelled: ${task.title}`);
          }}
          onAddBlocker={(task) => openPicker("blocker", task)}
          onMoveUnder={(task) => openPicker("move", task)}
        />
        <p role="status" className="sr-only">{announcement}</p>
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
