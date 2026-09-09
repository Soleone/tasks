import { useEffect, useRef, useState, type ReactElement } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { exportTasks, getWorkspaceInfo, type TasksExportResult } from "@/platform/backendClient";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Failure = { title: string; detail: string };

type SettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus: () => HTMLElement | undefined;
};

// Storage is read every time the dialog opens: the workspace can differ
// between launches, and a stale path would misreport where data lives.
export function SettingsDialog({ open, onOpenChange, returnFocus }: SettingsDialogProps): ReactElement {
  const exportButton = useRef<HTMLButtonElement>(null);
  const exporting = useRef(false);
  const [databasePath, setDatabasePath] = useState<string | null>(null);
  const [exported, setExported] = useState<TasksExportResult | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  useEffect(() => {
    if (!open) return;
    let stale = false;
    setDatabasePath(null);
    setExported(null);
    setCopied(false);
    setFailure(null);
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
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md"
        initialFocus={exportButton}
        finalFocus={returnFocus}
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
