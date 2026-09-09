import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { CircleHelp, Palette, Settings2 } from "lucide-react";
import type { TaskRecord, ThemeRecord } from "@/backend/protocol";
import { TaskComposer } from "@/components/TaskComposer";
import { HelpPalette } from "@/components/HelpPalette";
import { ThemePalette } from "@/components/ThemePalette";
import { SettingsDialog } from "@/components/SettingsDialog";
import { TaskList } from "@/components/TaskList";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useFocusNavigation, useFocusStack } from "@/navigation";
import { closeBackendSession, listTasks, listThemes, setTheme } from "@/platform/backendClient";
import { applyTheme } from "@/theme";

// Keep keyboard navigation inside the app; an empty new title skips the optional description.
// The list is one tab stop; arrows move between tasks, Enter opens one.
export default function App(): ReactElement {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [editingTask, setEditingTask] = useState<TaskRecord | null>(null);
  const [activeTaskIndex, setActiveTaskIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [themesOpen, setThemesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themes, setThemes] = useState<ThemeRecord[]>([]);
  const [selectedTheme, setSelectedTheme] = useState("");
  const querySequence = useRef(0);

  const showList = tasks.length > 0;

  // The ordered navigation table, derived from app state: while editing, the
  // editor replaces create and list; the list is a stop only once it has
  // tasks or an error to focus. The capture composer stays mounted while
  // hidden, so availability must never come from the DOM.
  const nav = useFocusNavigation(
    editingTask ? ["edit"] : showList || loadError ? ["create", "list"] : ["create"],
  );
  const focusStack = useFocusStack();

  const refreshTasks = useCallback(async (offset = 0): Promise<void> => {
    const sequence = ++querySequence.current;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await listTasks(undefined, offset);
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
    void refreshTasks();
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

  function returnToCapture(): void {
    setEditingTask(null);
    requestAnimationFrame(() => nav.go("create"));
  }

  function taskSaved(task: TaskRecord): void {
    setTasks((previous) => [task, ...previous.filter((existing) => existing.id !== task.id)]);
    setActiveTaskIndex(0);
    setAnnouncement(`${editingTask ? "Saved" : "Added"}: ${task.title}`);
    if (editingTask) returnToCapture();
    void refreshTasks();
  }

  return (
    <main className="min-h-svh bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 p-4 md:p-8">
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold">Tasks</h1>
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

        <div hidden={editingTask !== null}>
          <TaskComposer nav={nav} onSaved={taskSaved} />
        </div>
        {editingTask ? <TaskComposer key={editingTask.id} nav={nav} task={editingTask} onSaved={taskSaved} onCancel={() => {
          returnToCapture();
          void refreshTasks();
        }} /> : null}

        {editingTask ? null : <TaskList
          tasks={tasks}
          total={total}
          activeTaskIndex={activeTaskIndex}
          loading={loading}
          error={loadError}
          nav={nav}
          focusStack={focusStack}
          onRefresh={refreshTasks}
          onActiveTaskIndexChange={setActiveTaskIndex}
          onAnnounce={setAnnouncement}
          onEdit={setEditingTask}
          onTaskUpdated={(task) => {
            setTasks((previous) => previous.map((existing) => existing.id === task.id ? task : existing));
          }}
          onCanceled={(task) => {
            ++querySequence.current;
            setTasks((previous) => previous.map((existing) => existing.id === task.id ? task : existing));
            setAnnouncement(`Cancelled: ${task.title}`);
          }}
        />}
        <p role="status" className="sr-only">{announcement}</p>
      </div>
      <HelpPalette
        open={helpOpen}
        onOpenChange={setHelpOpen}
        finalFocus={() => focusStack.restore("help")}
        onOpenSettings={openSettings}
      />
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
