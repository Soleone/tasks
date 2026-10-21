import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { APP_NAME } from "./backend/branding";
import App from "./App";
import type { MainWorkspace } from "./platform/mainWorkspace";
import { openHomeWorkspace } from "./platform/homeWorkspace";
import { selectMainWorkspace } from "./platform/backendClient";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Field, FieldGroup, FieldLabel } from "./components/ui/field";
import { devBackendUrl, WorkspaceReader } from "./platform/workspaceReader";
import { readEditorSelection, EditorClient, type EditorSelection } from "./platform/editorClient";

// dev:web sets this when it made the home itself (the fixture or the kept copy of the real tasks).
const openCopyDirectly = import.meta.env.VITE_DEV_WORKSPACE_COPY === "1";

async function openWorkspace(selection: EditorSelection): Promise<MainWorkspace> {
  const url = devBackendUrl();
  const workspace = await openHomeWorkspace(
    new WorkspaceReader(selection, { url, selection }),
    new EditorClient(url, selection),
  );
  selectMainWorkspace(workspace);
  return workspace;
}

function message(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

/** Opens the dev bridge's home: a copy directly, a home picked by hand after confirmation. */
export default function WorkspaceSelection(): ReactElement {
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [workspace, setWorkspace] = useState<MainWorkspace | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    void readEditorSelection(devBackendUrl())
      .then(async (selected) => {
        if (cancelled) return;
        setSelection(selected);
        if (!openCopyDirectly) return;
        const opened = await openWorkspace(selected);
        if (!cancelled) setWorkspace(opened);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(message(reason, "Could not inspect the selected dev backend."));
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  function retry(): void {
    setError(null);
    setSelection(null);
    setAttempt((value) => value + 1);
  }

  useEffect(() => {
    if (workspace) return;
    if (error) retryRef.current?.focus();
    else if (selection) confirmRef.current?.focus();
  }, [error, selection, workspace]);

  function confirm(event: FormEvent): void {
    event.preventDefault();
    if (!selection) return;
    openWorkspace(selection).then(setWorkspace, (reason: unknown) =>
      setError(message(reason, "Could not open this home.")),
    );
  }

  if (workspace) return <App workspace={workspace} />;
  if (openCopyDirectly && !error) return <p role="status">Loading Tasks...</p>;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header>
        <h1 className="font-heading text-xl font-semibold">Open this Tasks home?</h1>
      </header>
      <p className="text-sm text-muted-foreground">{APP_NAME} reads nothing until you open it.</p>
      <form onSubmit={confirm} className="flex flex-col gap-4">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="workspace-root">Tasks home</FieldLabel>
            <Input
              id="workspace-root"
              value={selection?.profilePath ?? ""}
              readOnly
              required
              autoComplete="off"
              placeholder="Absolute path to the selected home"
            />
          </Field>
        </FieldGroup>
        {selection && (
          <p className="text-sm break-all text-muted-foreground">
            Tasks: {selection.rootPath}. Local data, never synced: {selection.databasePath}
          </p>
        )}
        <div>
          <Button ref={confirmRef} type="submit" disabled={!selection}>
            Open Tasks
          </Button>
        </div>
      </form>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Workspace selection is unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          <Button ref={retryRef} variant="outline" className="mt-3" onClick={retry}>
            Retry selection
          </Button>
        </Alert>
      )}
    </main>
  );
}
