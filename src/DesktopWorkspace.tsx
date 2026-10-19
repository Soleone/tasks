import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import App from "./App";
import { APP_NAME } from "./backend/branding";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./components/ui/field";
import { Input } from "./components/ui/input";
import { markBackendReady, startLaunchTiming } from "./launchTiming";
import { selectMainWorkspace } from "./platform/backendClient";
import {
  createFolder,
  desktopPaths,
  FolderSetup,
  type FolderState,
  pathExists,
  rememberedFolder,
  rememberFolder,
  type DesktopPaths,
} from "./platform/desktopWorkspace";
import { EditorClient } from "./platform/editorClient";
import { MainWorkspace } from "./platform/mainWorkspace";
import { WorkspaceReader } from "./platform/workspaceReader";

/** The app keeps talking to the backend that checked the folder. */
function openWorkspace({ selection, session }: FolderSetup): MainWorkspace {
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

function opens(state: FolderState): boolean {
  return state === "ready" || state === "recovery_pending";
}

/** Checks a folder with the backend. The caller opens the app on the setup or closes it. */
async function inspect(appData: string, folder: string) {
  const setup = await FolderSetup.open(appData, folder);
  try {
    return { setup, state: (await setup.info()).state };
  } catch (reason) {
    await setup.close();
    throw reason;
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
        if (remembered) void startLaunchTiming();
        if (remembered && (await pathExists(remembered))) {
          const { setup, state } = await inspect(found.appData, remembered);
          if (!cancelled && opens(state)) {
            markBackendReady();
            setWorkspace(openWorkspace(setup));
            return;
          }
          await setup.close();
          if (cancelled) return;
          setError(`${remembered} isn't a task folder anymore (${state}).`);
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

  async function run(label: string, action: () => Promise<FolderSetup>): Promise<void> {
    setBusy(label);
    setError(null);
    try {
      const setup = await action();
      rememberFolder(setup.selection.rootPath);
      setWorkspace(openWorkspace(setup));
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
      const { setup, state } = await inspect(paths.appData, target);
      try {
        if (state === "empty") await setup.init();
        else if (!opens(state))
          throw new Error(
            state === "unsupported"
              ? "This folder holds tasks from the old version. Convert it with pnpm migrate first."
              : "This folder has files that aren't a complete task workspace. Pick an empty or new folder.",
          );
        return setup;
      } catch (reason) {
        await setup.close();
        throw reason;
      }
    });
  }

  if (workspace) return <App workspace={workspace} />;
  // Opening the remembered folder shows nothing, so setup appears only when it is needed.
  if (!paths && !error) return null;

  return (
    <main className="app-shell mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6">
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
