import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { CircleHelp, Palette, Settings2 } from "lucide-react";
import { AppIcon } from "@/components/AppIcon";
import type { ProjectRecord, TaskRecord, TaskStatus, ThemeRecord } from "@/backend/protocol";
import { ProjectPicker } from "@/components/ProjectPicker";
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

const ACTIVE_TASK_STATUSES: TaskStatus[] = ["open", "in_progress", "done"];
const INACTIVE_TASK_STATUSES: TaskStatus[] = ["paused", "canceled"];
const ACTIVE_TASK_STATUS_SET = new Set<TaskStatus>(ACTIVE_TASK_STATUSES);
const INACTIVE_TASK_STATUS_SET = new Set<TaskStatus>(INACTIVE_TASK_STATUSES);

function taskIsVisible(task: TaskRecord, showInactive: boolean, showUnblocked: boolean, projectSlug: string | null): boolean {
  return (showInactive ? INACTIVE_TASK_STATUS_SET : ACTIVE_TASK_STATUS_SET).has(task.status)
    && (!showUnblocked || task.blockedByIds.length === 0)
    && (projectSlug === null || task.category?.slug === projectSlug);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable
    || target.getAttribute("role") === "combobox" || target.hasAttribute("cmdk-input");
}

// The list is the default surface. Create and edit share one dialog opened
// by the New task button, the C key, or the palette. Tab does not leave the
// focused task list.
export default function App(): ReactElement {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [showInactive, setShowInactive] = useState(false);
  const [showUnblocked, setShowUnblocked] = useState(false);
  const [projectFilter, setProjectFilter] = useState<ProjectRecord | null>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
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
  const showInactiveRef = useRef(false);
  const showUnblockedRef = useRef(false);
  const projectFilterRef = useRef<string | null>(null);
  const newTaskButton = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<ComposerState | null>(null);
  composerRef.current = composer;

  const nav = useFocusNavigation(["create", "list"]);
  const focusStack = useFocusStack();

  // "create" is the New task button now that the form lives in a dialog.
  useEffect(() => nav.register("create", {
    focusFirst: () => newTaskButton.current?.focus(),
    focusLast: () => newTaskButton.current?.focus(),
  }), [nav]);

  const refreshTasks = useCallback(async (offset = 0): Promise<void> => {
    const sequence = ++querySequence.current;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await listTasks(
        showInactiveRef.current ? INACTIVE_TASK_STATUSES : ACTIVE_TASK_STATUSES,
        offset,
        showUnblockedRef.current,
        projectFilterRef.current ?? undefined,
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
    showInactiveRef.current = showInactive;
    showUnblockedRef.current = showUnblocked;
    projectFilterRef.current = projectFilter?.slug ?? null;
    void refreshTasks();
  }, [showInactive, showUnblocked, projectFilter, refreshTasks]);

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

  function openCreate(): void {
    if (composerRef.current) return;
    const fromPalette = helpOpen ? focusStack.restore("help") : undefined;
    focusStack.push("composer", fromPalette ?? undefined);
    setHelpOpen(false);
    setComposer({ mode: "create" });
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
      if (event.ctrlKey || event.metaKey) return;
      if (event.key.toLowerCase() === "c" && !isTypingTarget(event.target)) {
        const dialogOpen = helpOpen || themesOpen || settingsOpen || projectPickerOpen || picker !== null || composerRef.current !== null;
        if (dialogOpen) return;
        event.preventDefault();
        openCreate();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [helpOpen, themesOpen, settingsOpen, projectPickerOpen, picker]);

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

  function openProjectPicker(): void {
    const fromPalette = helpOpen ? focusStack.restore("help") : undefined;
    focusStack.push("project-picker", fromPalette ?? undefined);
    setHelpOpen(false);
    setProjectPickerOpen(true);
  }

  function closeProjectPicker(): void {
    setProjectPickerOpen(false);
  }

  function chooseProject(project: ProjectRecord): void {
    setProjectPickerOpen(false);
    setProjectFilter(project);
    setActiveTaskIndex(0);
    setAnnouncement(`Showing ${project.label} tasks`);
  }

  function clearProjectFilter(): void {
    setProjectFilter(null);
    setActiveTaskIndex(0);
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
    if (taskIsVisible(task, showInactive, showUnblocked, projectFilter?.slug ?? null)) {
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
    if (!taskIsVisible(task, showInactive, showUnblocked, projectFilter?.slug ?? null)) {
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
          showInactive={showInactive}
          onShowInactiveChange={(next) => {
            setShowInactive(next);
            setActiveTaskIndex(0);
          }}
          showUnblocked={showUnblocked}
          onShowUnblockedChange={(next) => {
            setShowUnblocked(next);
            setActiveTaskIndex(0);
          }}
          projectFilter={projectFilter}
          onProjectFilterChange={clearProjectFilter}
          onOpenProjectPicker={openProjectPicker}
          activeTaskIndex={activeTaskIndex}
          loading={loading}
          error={loadError}
          nav={nav}
          focusStack={focusStack}
          newTaskButtonRef={newTaskButton}
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
        onOpenProjectPicker={openProjectPicker}
        activeTask={tasks[activeTaskIndex]}
        onAddBlocker={(task) => openPicker("blocker", task)}
        onMoveUnder={(task) => openPicker("move", task)}
      />
      {projectPickerOpen ? <ProjectPicker
        open
        onClose={closeProjectPicker}
        finalFocus={() => focusStack.restore("project-picker") ?? undefined}
        onSelect={chooseProject}
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
