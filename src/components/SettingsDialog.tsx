import { useEffect, useRef, useState, type ReactElement } from "react";
import { CheckIcon, CopyIcon, XIcon } from "lucide-react";
import { exportTasks, getWorkspaceInfo, type TasksExportResult } from "@/platform/backendClient";
import { APP_NAME } from "@/backend/branding";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isKeyboardHelpMode, type KeyboardHelpMode } from "@/keyboardHelp";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FONT_SIZE_INCREASES, type FontSizeIncrease } from "@/fontSize";

type Failure = { title: string; detail: string };

type SettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus: () => HTMLElement | undefined;
  onPrepareReceive: () => void;
  onPurgeCanceled: () => Promise<number>;
  globalShortcut: string;
  onGlobalShortcutChange: (shortcut: string) => Promise<void>;
  helpMode: KeyboardHelpMode;
  onHelpModeChange: (mode: KeyboardHelpMode) => void;
  fontSizeIncrease: FontSizeIncrease;
  onFontSizeIncreaseChange: (increase: FontSizeIncrease) => void;
};

function fontSizeLabel(increase: FontSizeIncrease): string {
  return increase === 0 ? "Default" : `+${increase}%`;
}

const settingsTabStopSelector = 'button, input, textarea, select, a[href], [contenteditable="true"], [role="checkbox"], [role="tab"], [tabindex="0"]';

function settingsTabStops(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(settingsTabStopSelector)].filter((element) => {
    if (element.tabIndex < 0 || element.hasAttribute("hidden") || element.closest("[hidden]") !== null) return false;
    if (element.hasAttribute("data-base-ui-focus-guard") || element.getAttribute("aria-disabled") === "true") return false;
    const bounds = element.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0;
  });
}

// Storage is read every time the dialog opens: the workspace can differ
// between launches, and a stale path would misreport where data lives.
export function SettingsDialog({ open, onOpenChange, finalFocus, onPrepareReceive, onPurgeCanceled, globalShortcut, onGlobalShortcutChange, helpMode, onHelpModeChange, fontSizeIncrease, onFontSizeIncreaseChange }: SettingsDialogProps): ReactElement {
  const settingsTab = useRef<HTMLButtonElement>(null);
  const exporting = useRef(false);
  const purging = useRef(false);
  const [databasePath, setDatabasePath] = useState<string | null>(null);
  const [canceledTaskCount, setCanceledTaskCount] = useState<number | null>(null);
  const [exported, setExported] = useState<TasksExportResult | null>(null);
  const [purgedCount, setPurgedCount] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [purgingPending, setPurgingPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedShortcut, setCopiedShortcut] = useState(false);
  const [isLinux, setIsLinux] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [confirmReceive, setConfirmReceive] = useState(false);
  const [shortcutDraft, setShortcutDraft] = useState(globalShortcut);

  useEffect(() => {
    if (!open) return;
    let stale = false;
    setDatabasePath(null);
    setCanceledTaskCount(null);
    setExported(null);
    setPurgedCount(null);
    setCopied(false);
    setCopiedShortcut(false);
    setFailure(null);
    setConfirmReceive(false);
    setShortcutDraft(globalShortcut);
    setIsLinux(navigator.platform.toLowerCase().includes("linux"));
    getWorkspaceInfo()
      .then((info) => {
        if (stale) return;
        setDatabasePath(info.databasePath);
        setCanceledTaskCount(info.canceledTaskCount);
      })
      .catch((caught: unknown) => { if (!stale) setFailure({ title: "Could not read the workspace", detail: caught instanceof Error ? caught.message : String(caught) }); });
    return () => { stale = true; };
  }, [open]);

  async function exportNow(): Promise<void> {
    if (exporting.current) return;
    exporting.current = true;
    setPending(true);
    setExported(null);
    setCopied(false);
    setFailure(null);
    try {
      setExported(await exportTasks());
    } catch (caught) {
      setFailure({ title: "Could not export tasks", detail: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      exporting.current = false;
      setPending(false);
    }
  }

  async function saveShortcut(): Promise<void> {
    setFailure(null);
    try {
      await onGlobalShortcutChange(shortcutDraft);
    } catch (caught) {
      setFailure({ title: "Could not register the global shortcut", detail: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  async function purgeCanceledNow(): Promise<void> {
    if (purging.current) return;
    purging.current = true;
    setPurgingPending(true);
    setPurgedCount(null);
    setFailure(null);
    try {
      const deletedCount = await onPurgeCanceled();
      setCanceledTaskCount(0);
      setPurgedCount(deletedCount);
    } catch (caught) {
      setFailure({ title: "Could not delete canceled tasks", detail: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      purging.current = false;
      setPurgingPending(false);
    }
  }

  function omarchyBinding(shortcut: string): string {
    const parts = shortcut.split("+").map((part) => part.trim()).filter(Boolean);
    const key = parts.pop()?.toUpperCase() ?? "SPACE";
    const keys = [...parts.map((part) => part.toUpperCase()), key].join(" + ");
    // Tauri exposes the executable name as the Linux WM_CLASS. It is not the
    // reverse-DNS application identifier used by the desktop bundle.
    return `o.bind("${keys}", "Tasks", { launch = "tasks", focus = "^tasks$" })`;
  }

  async function copyShortcutBinding(): Promise<void> {
    const binding = omarchyBinding(shortcutDraft);
    try {
      await navigator.clipboard.writeText(binding);
      setCopiedShortcut(true);
    } catch {
      setFailure({ title: "Could not copy the Hyprland binding", detail: binding });
    }
  }

  async function copyPath(path: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
    } catch {
      setCopied(false);
      setFailure({ title: "Could not copy the path", detail: "Select the path and copy it yourself." });
    }
  }

  const exportedPath = exported?.destinationPath ?? null;
  const exportedCount = exported?.taskCount ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="h-[calc(100svh-6rem)] max-h-[40rem] content-start overflow-y-auto sm:max-w-3xl md:max-h-[40rem]"
        initialFocus={settingsTab}
        finalFocus={finalFocus}
        onKeyDownCapture={(event) => {
          if (event.key !== "Tab" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;
          const stops = settingsTabStops(event.currentTarget);
          if (stops.at(-1) !== target) return;
          const activeTab = event.currentTarget.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
          if (!activeTab) return;
          event.preventDefault();
          activeTab.focus();
        }}
      >
        <div className="pr-8">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>Adjust appearance, shortcuts, and workspace data.</DialogDescription>
          </DialogHeader>
        </div>

        <Tabs defaultValue="general" className="min-h-0">
          <div className="flex items-center justify-between gap-3">
            <TabsList
              aria-label="Settings sections"
              aria-describedby="settings-tabs-help"
              activateOnFocus
            >
              <TabsTrigger ref={settingsTab} value="general">General</TabsTrigger>
              <TabsTrigger value="shortcuts">Shortcuts</TabsTrigger>
              <TabsTrigger value="workspace">Data</TabsTrigger>
            </TabsList>
            <span id="settings-tabs-help" className="sr-only">Use the Left and Right Arrow keys to switch sections. Press Tab to enter the selected section.</span>
            <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline" aria-hidden="true">← → switch · Tab enter</span>
          </div>

          <TabsContent value="general" tabIndex={-1}>
            <div className="grid gap-4 md:grid-cols-2">
              <section aria-labelledby="settings-appearance" className="flex flex-col gap-4 rounded-lg border p-4">
              <div className="flex flex-col gap-1">
                <h2 id="settings-appearance" className="text-sm font-medium">Appearance</h2>
                <p className="text-sm text-muted-foreground">Tune the interface for comfortable reading.</p>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="settings-font-size" className="text-sm font-medium">Font size</label>
                  <output htmlFor="settings-font-size" className="text-sm text-muted-foreground" aria-live="polite">{fontSizeLabel(fontSizeIncrease)}</output>
                </div>
                <input
                  id="settings-font-size"
                  data-font-size-control
                  type="range"
                  min={0}
                  max={FONT_SIZE_INCREASES.length - 1}
                  step={1}
                  value={FONT_SIZE_INCREASES.indexOf(fontSizeIncrease)}
                  aria-valuetext={fontSizeIncrease === 0 ? "Default font size" : `Font size increased by ${fontSizeIncrease}%`}
                  aria-describedby="settings-font-size-description"
                  className="w-full accent-primary"
                  onChange={(event) => {
                    const increase = FONT_SIZE_INCREASES[Number(event.target.value)];
                    if (increase !== undefined) onFontSizeIncreaseChange(increase);
                  }}
                />
                <div className="flex justify-between gap-2 text-xs text-muted-foreground" aria-hidden="true">
                  {FONT_SIZE_INCREASES.map((increase) => <span key={increase}>{fontSizeLabel(increase)}</span>)}
                </div>
                <p id="settings-font-size-description" className="text-sm text-muted-foreground">Increase text and interface size. Changes apply immediately and are saved for future launches.</p>
              </div>
            </section>

            <section aria-labelledby="settings-help" className="flex flex-col gap-4 rounded-lg border p-4">
              <div className="flex flex-col gap-1">
                <h2 id="settings-help" className="text-sm font-medium">Keyboard help</h2>
                <p className="text-sm text-muted-foreground">Choose how much keyboard guidance to show.</p>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <span id="settings-help-mode-label" className="text-sm font-medium">Display</span>
                  <Select
                    value={helpMode}
                    onValueChange={(value) => {
                      if (isKeyboardHelpMode(value)) onHelpModeChange(value);
                    }}
                  >
                    <SelectTrigger
                      id="settings-help-mode"
                      size="sm"
                      data-help-mode={helpMode}
                      aria-labelledby="settings-help-mode-label"
                      aria-describedby="settings-help-mode-description"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="full">Full</SelectItem>
                      <SelectItem value="basic">Basic</SelectItem>
                      <SelectItem value="none">None</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p id="settings-help-mode-description" className="text-sm text-muted-foreground">Full shows all keyboard help. Basic shows only the filter and sort shortcuts. None hides automatic keyboard help.</p>
              </div>
              </section>
            </div>
          </TabsContent>

          <TabsContent value="shortcuts" tabIndex={-1}>
            <section aria-labelledby="settings-shortcut" className="flex flex-col gap-4 rounded-lg border p-4">
              <div className="flex flex-col gap-1">
                <h2 id="settings-shortcut" className="text-sm font-medium">Global shortcut</h2>
                <p id="settings-shortcut-description" className="text-sm text-muted-foreground">Focuses the {APP_NAME} window even when another app is active. Use modifiers plus a key, for example <code>Ctrl+Alt+Space</code>.</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <label htmlFor="settings-shortcut-input" className="text-xs font-medium text-muted-foreground">Shortcut</label>
                  <Input
                    id="settings-shortcut-input"
                    aria-describedby="settings-shortcut-description"
                    value={shortcutDraft}
                    onChange={(event) => setShortcutDraft(event.target.value)}
                    placeholder="Ctrl+Alt+Space"
                  />
                </div>
                <Button variant="outline" onClick={() => void saveShortcut()}>Save</Button>
              </div>
              <p className="text-xs text-muted-foreground">This applies to the native desktop app. Wayland may require a compositor binding.</p>
              {isLinux ? <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3">
                <p className="text-sm font-medium">Omarchy / Hyprland</p>
                <p className="text-sm text-muted-foreground">Wayland keeps global shortcuts in Hyprland rather than allowing applications to register them. Add this Lua binding to <code>~/.config/hypr/bindings.lua</code>, then reload Hyprland:</p>
                <code className="wrap-anywhere rounded bg-muted p-2 text-xs">{omarchyBinding(shortcutDraft)}</code>
                <Button variant="outline" size="sm" className="w-fit" onClick={() => void copyShortcutBinding()}>
                  {copiedShortcut ? "Copied binding" : "Copy Omarchy binding"}
                </Button>
                <p className="text-xs text-muted-foreground">This focuses the existing {APP_NAME} window and launches {APP_NAME} only when no matching window exists. It does not change your Hyprland files automatically.</p>
              </div> : null}
            </section>
          </TabsContent>

          <TabsContent value="workspace" tabIndex={-1}>
            <div className="grid gap-4 md:grid-cols-2">
              <section aria-labelledby="settings-sync" className="flex flex-col gap-3 rounded-lg border p-4 md:col-span-2">
              <div className="flex flex-col gap-1">
                <h2 id="settings-sync" className="text-sm font-medium">Workspace sync</h2>
                <p className="text-sm text-muted-foreground">Move an existing workspace to this device through Syncthing.</p>
              </div>
              {!confirmReceive ? <Button variant="outline" className="w-fit" onClick={() => setConfirmReceive(true)}>Sync with another device…</Button> : <Alert tone="confirmation" layout="stacked">
                <AlertTitle tone="destructive">Replace this device’s workspace?</AlertTitle>
                <AlertDescription>Your current tasks will be backed up, then the local sync folder will be emptied. {APP_NAME} will stay locked until an existing workspace arrives through Syncthing.</AlertDescription>
                <AlertAction layout="stacked">
                  <Button variant="outline" size="xs" onClick={() => setConfirmReceive(false)}>Cancel</Button>
                  <Button variant="destructive" size="xs" onClick={onPrepareReceive}>Back up and continue</Button>
                </AlertAction>
              </Alert>}
            </section>

            <section aria-labelledby="settings-data" className="flex flex-col gap-4 rounded-lg border p-4">
              <div className="flex flex-col gap-1">
                <h2 id="settings-data" className="text-sm font-medium">Local</h2>
                <p className="text-sm text-muted-foreground">Inspect the local workspace or create a portable export.</p>
              </div>
              {databasePath
                ? <div className="flex flex-col gap-1 rounded-md border bg-muted/20 p-3">
                    <p className="text-xs font-medium text-muted-foreground">SQLite workspace</p>
                    <p className="wrap-anywhere font-mono text-xs text-muted-foreground">{databasePath}</p>
                  </div>
                : <p className="text-sm text-muted-foreground">Reading the workspace…</p>}
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  className="w-fit"
                  focusableWhenDisabled
                  disabled={pending}
                  onClick={() => void exportNow()}
                >{pending ? "Exporting…" : "Export tasks as JSON"}</Button>
                <p className="text-sm text-muted-foreground">Writes a readable copy into the exports folder beside the database, for another app to import.</p>
              </div>
            </section>

            <section aria-labelledby="settings-cleanup" className="flex flex-col gap-4 rounded-lg border p-4">
              <div className="flex flex-col gap-1">
                <h2 id="settings-cleanup" className="text-sm font-medium">Cleanup</h2>
                <p className="text-sm text-muted-foreground">Permanently remove canceled tasks from this workspace.</p>
              </div>
              <Button
                variant="destructive"
                className="w-fit"
                disabled={purgingPending || canceledTaskCount === null || canceledTaskCount === 0}
                onClick={() => void purgeCanceledNow()}
              >{purgingPending ? "Deleting canceled tasks…" : "Permanently delete canceled tasks"}</Button>
              <p className="text-sm text-muted-foreground">
                {canceledTaskCount === null
                  ? "Reading canceled tasks…"
                  : canceledTaskCount === 0
                    ? "There are no canceled tasks to delete."
                    : `${canceledTaskCount} canceled ${canceledTaskCount === 1 ? "task" : "tasks"} will be permanently deleted.`}
              </p>
              </section>
            </div>
          </TabsContent>
        </Tabs>

        <DialogClose
          render={<Button variant="ghost" className="absolute top-2 right-2" size="icon-sm" tabIndex={-1} />}
        >
          <XIcon aria-hidden="true" />
          <span className="sr-only">Close</span>
        </DialogClose>

        {failure ? <Alert variant="destructive">
          <AlertTitle>{failure.title}</AlertTitle>
          <AlertDescription className="wrap-anywhere">{failure.detail}</AlertDescription>
        </Alert> : null}

        {purgedCount !== null ? <Alert>
          <AlertTitle>
            Permanently deleted {purgedCount} canceled {purgedCount === 1 ? "task" : "tasks"}
          </AlertTitle>
          <AlertDescription>This cannot be undone.</AlertDescription>
        </Alert> : null}

        {exportedPath ? <Alert>
          <AlertTitle>
            Exported {exportedCount} {exportedCount === 1 ? "task" : "tasks"}
          </AlertTitle>
          <AlertDescription className="wrap-anywhere">{exportedPath}</AlertDescription>
          <AlertAction>
            <Button variant="outline" size="xs" onClick={() => void copyPath(exportedPath)}>
              {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
              {copied ? "Copied" : "Copy path"}
            </Button>
          </AlertAction>
        </Alert> : null}
      </DialogContent>
    </Dialog>
  );
}
