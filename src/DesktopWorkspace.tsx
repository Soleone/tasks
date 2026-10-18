import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import App from "./App";
import { APP_NAME } from "./backend/branding";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./components/ui/field";
import { Input } from "./components/ui/input";
import { selectMainWorkspace } from "./platform/backendClient";
import {
  createFolder,
  desktopPaths,
  folderSession,
  FolderSetup,
  pathExists,
  rememberedFolder,
  rememberFolder,
  type DesktopPaths,
} from "./platform/desktopWorkspace";
import { EditorClient, type EditorSelection } from "./platform/editorClient";
import { MainWorkspace } from "./platform/mainWorkspace";
import { WorkspaceReader } from "./platform/workspaceReader";

function openWorkspace(selection: EditorSelection): MainWorkspace {
  const session = folderSession(selection);
  const workspace = new MainWorkspace(
    new WorkspaceReader(selection, undefined, session),
    new EditorClient(session, selection),
  );
  selectMainWorkspace(workspace);
  return workspace;
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Checks a folder with the backend, then closes that conversation before the app opens its own. */
async function inspect(appData: string, folder: string) {
  const setup = await FolderSetup.open(appData, folder);
  try {
    return { selection: setup.selection, ...(await setup.info()) };
  } finally {
    await setup.close();
  }
}

/** The desktop app opens the remembered task folder. On first launch it asks for one. */
export default function DesktopWorkspace(): ReactElement | null {
  const [paths, setPaths] = useState<DesktopPaths | null>(null);
  const [folder, setFolder] = useState("");
  const [workspace, setWorkspace] = useState<MainWorkspace | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const found = await desktopPaths();
        const remembered = rememberedFolder();
        if (remembered && (await pathExists(remembered))) {
          const opened = await inspect(found.appData, remembered);
          if (cancelled) return;
          if (opened.state === "ready" || opened.state === "recovery_pending") {
            setWorkspace(openWorkspace(opened.selection));
            return;
          }
          setError(`${remembered} isn't a task folder anymore (${opened.state}).`);
        }
        if (cancelled) return;
        setPaths(found);
        setFolder(remembered ?? found.suggestedFolder);
      } catch (reason) {
        if (!cancelled) setError(message(reason));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (paths && !busy) folderRef.current?.focus();
  }, [paths, busy]);

  async function run(label: string, action: () => Promise<EditorSelection>): Promise<void> {
    setBusy(label);
    setError(null);
    try {
      const selection = await action();
      rememberFolder(selection.rootPath);
      setWorkspace(openWorkspace(selection));
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(null);
    }
  }

  function openFolder(event: FormEvent): void {
    event.preventDefault();
    if (!paths || !folder.trim()) return;
    const target = folder.trim();
    void run("Opening the folder...", async () => {
      if (!(await pathExists(target))) await createFolder(target);
      const found = await inspect(paths.appData, target);
      if (found.state === "ready" || found.state === "recovery_pending") return found.selection;
      if (found.state === "empty") {
        const setup = await FolderSetup.open(paths.appData, target);
        try {
          await setup.init();
        } finally {
          await setup.close();
        }
        return found.selection;
      }
      throw new Error(
        found.state === "unsupported"
          ? "This folder holds tasks from the old version. Convert it with pnpm migrate first."
          : "This folder has files that aren't a complete task workspace. Pick an empty or new folder.",
      );
    });
  }

  if (workspace) return <App workspace={workspace} />;
  // Opening the remembered folder shows nothing, so setup appears only when it is needed.
  if (!paths && !error) return null;

  return (
    <main className="app-shell mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-xl font-semibold">Set up {APP_NAME}</h1>
        <p className="text-sm text-muted-foreground">
          Tasks keeps each task as a file in a folder you choose.
        </p>
      </header>
      {busy && <p role="status">{busy}</p>}
      {paths && (
        <form onSubmit={openFolder} className="flex flex-col gap-6">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="task-folder">Task folder</FieldLabel>
              <Input
                ref={folderRef}
                id="task-folder"
                value={folder}
                onChange={(event) => setFolder(event.target.value)}
                required
                autoComplete="off"
                spellCheck={false}
                disabled={busy !== null}
              />
              <FieldDescription>
                A new folder starts an empty list. An existing task folder opens as it is.
              </FieldDescription>
            </Field>
          </FieldGroup>
          <Button type="submit" className="w-fit" disabled={busy !== null}>
            Open
          </Button>
        </form>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>That didn't work</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </main>
  );
}
