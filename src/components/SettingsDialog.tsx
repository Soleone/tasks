import { useEffect, useRef, useState, type ReactElement } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { exportTasks, getWorkspaceInfo, type TasksExportResult } from "@/platform/backendClient";
import { APP_NAME } from "@/backend/branding";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Failure = { title: string; detail: string };

type SettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus: () => HTMLElement | undefined;
  onPrepareReceive: () => void;
  globalShortcut: string;
  onGlobalShortcutChange: (shortcut: string) => Promise<void>;
  helpMode: boolean;
  onHelpModeChange: (enabled: boolean) => void;
};

// Storage is read every time the dialog opens: the workspace can differ
// between launches, and a stale path would misreport where data lives.
export function SettingsDialog({ open, onOpenChange, finalFocus, onPrepareReceive, globalShortcut, onGlobalShortcutChange, helpMode, onHelpModeChange }: SettingsDialogProps): ReactElement {
  const exportButton = useRef<HTMLButtonElement>(null);
  const exporting = useRef(false);
  const [databasePath, setDatabasePath] = useState<string | null>(null);
  const [exported, setExported] = useState<TasksExportResult | null>(null);
  const [pending, setPending] = useState(false);
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
    setExported(null);
    setCopied(false);
    setCopiedShortcut(false);
    setFailure(null);
    setConfirmReceive(false);
    setShortcutDraft(globalShortcut);
    setIsLinux(navigator.platform.toLowerCase().includes("linux"));
    getWorkspaceInfo()
      .then((info) => { if (!stale) setDatabasePath(info.databasePath); })
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

  function omarchyBinding(shortcut: string): string {
    const parts = shortcut.split("+").map((part) => part.trim()).filter(Boolean);
    const key = parts.pop()?.toUpperCase() ?? "SPACE";
    const keys = [...parts.map((part) => part.toUpperCase()), key].join(" + ");
    return `o.bind("${keys}", "Tasks", { launch = "tasks", focus = "^com\\\\.soleone\\\\.tasks$" })`;
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
        className="overflow-y-auto sm:max-w-md"
        initialFocus={exportButton}
        finalFocus={finalFocus}
      >
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Storage and export for this workspace.</DialogDescription>
        </DialogHeader>

        <section aria-labelledby="settings-data" className="flex flex-col gap-3">
          <h2 id="settings-data" className="text-sm font-medium">Data</h2>

          {databasePath
            ? <div className="flex flex-col gap-1">
                <p className="text-sm text-muted-foreground">Your tasks live in one SQLite file.</p>
                <p className="wrap-anywhere font-mono text-xs text-muted-foreground">{databasePath}</p>
              </div>
            : <p className="text-sm text-muted-foreground">Reading the workspace…</p>}

          <div className="flex flex-col gap-2">
            <Button
              ref={exportButton}
              variant="outline"
              className="w-fit"
              focusableWhenDisabled
              disabled={pending}
              onClick={() => void exportNow()}
            >{pending ? "Exporting…" : "Export tasks as JSON"}</Button>
            <p className="text-sm text-muted-foreground">
              Writes a readable copy into the exports folder beside the database, for another app to import.
            </p>
          </div>

          <div className="flex flex-col gap-2 border-t pt-3">
            <h2 id="settings-help" className="text-sm font-medium">Keyboard help</h2>
            <label className="flex items-start gap-3 rounded-md border p-3">
              <Checkbox
                checked={helpMode}
                onCheckedChange={(checked) => onHelpModeChange(checked === true)}
                aria-labelledby="settings-help-label"
              />
              <span className="flex flex-col gap-1">
                <span id="settings-help-label" className="text-sm font-medium">Show context-sensitive help</span>
                <span className="text-sm text-muted-foreground">Show keyboard guidance beside dialogs based on the focused control.</span>
              </span>
            </label>
          </div>

          <div className="flex flex-col gap-2 border-t pt-3">
            <h2 id="settings-shortcut" className="text-sm font-medium">Global shortcut</h2>
            <p className="text-sm text-muted-foreground">Focuses the {APP_NAME} window even when another app is active. Use modifiers plus a key, for example <code>Ctrl+Alt+Space</code>.</p>
            <div className="flex items-center gap-2">
              <Input
                aria-labelledby="settings-shortcut"
                value={shortcutDraft}
                onChange={(event) => setShortcutDraft(event.target.value)}
                placeholder="Ctrl+Alt+Space"
                className="max-w-xs"
              />
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
          </div>

          <div className="flex flex-col gap-2 border-t pt-3">
            {!confirmReceive ? <Button variant="outline" className="w-fit" onClick={() => setConfirmReceive(true)}>Sync with another device…</Button> : <Alert tone="confirmation" layout="stacked">
              <AlertTitle tone="destructive">Replace this device’s workspace?</AlertTitle>
              <AlertDescription>Your current tasks will be backed up, then the local sync folder will be emptied. {APP_NAME} will stay locked until an existing workspace arrives through Syncthing.</AlertDescription>
              <AlertAction layout="stacked">
                <Button variant="outline" size="xs" onClick={() => setConfirmReceive(false)}>Cancel</Button>
                <Button variant="destructive" size="xs" onClick={onPrepareReceive}>Back up and continue</Button>
              </AlertAction>
            </Alert>}
            <p className="text-sm text-muted-foreground">Backs up this workspace and prepares this device to receive an existing workspace through Syncthing.</p>
          </div>

          {failure ? <Alert variant="destructive">
            <AlertTitle>{failure.title}</AlertTitle>
            <AlertDescription className="wrap-anywhere">{failure.detail}</AlertDescription>
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
        </section>
      </DialogContent>
    </Dialog>
  );
}
