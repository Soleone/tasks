import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { APP_NAME } from "./backend/branding";
import App from "./App";
import { MainWorkspace } from "./platform/mainWorkspace";
import { selectMainWorkspace } from "./platform/backendClient";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Field, FieldGroup, FieldLabel } from "./components/ui/field";
import { devBackendUrl, WorkspaceReader } from "./platform/workspaceReader";
import { readEditorSelection, EditorClient, type EditorSelection } from "./platform/editorClient";

/** Shows the dev bridge's folder, cache and profile, and opens Tasks only after explicit confirmation. */
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
      .then((selected) => {
        if (!cancelled) setSelection(selected);
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not inspect the selected dev backend.",
          );
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
    try {
      const url = devBackendUrl();
      const selected = new MainWorkspace(
        new WorkspaceReader(selection, { url, selection }),
        new EditorClient(url, selection),
      );
      selectMainWorkspace(selected);
      setWorkspace(selected);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not select this folder.");
    }
  }

  if (workspace) return <App workspace={workspace} />;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header>
        <h1 className="font-heading text-xl font-semibold">{APP_NAME}: select a folder</h1>
      </header>
      <p className="text-sm text-muted-foreground">
        Confirm this workspace before opening Tasks. Nothing is read until you confirm.
      </p>
      <form onSubmit={confirm} className="flex flex-col gap-4">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="workspace-root">Task folder</FieldLabel>
            <Input
              id="workspace-root"
              value={selection?.rootPath ?? ""}
              readOnly
              required
              autoComplete="off"
              placeholder="Absolute path to the selected folder"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="workspace-cache">Local cache outside the task folder</FieldLabel>
            <Input
              id="workspace-cache"
              value={selection?.databasePath ?? ""}
              readOnly
              required
              autoComplete="off"
              placeholder="Absolute path to the selected SQLite cache"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="workspace-profile">Dedicated local profile</FieldLabel>
            <Input
              id="workspace-profile"
              value={selection?.profilePath ?? ""}
              readOnly
              required
              autoComplete="off"
            />
          </Field>
        </FieldGroup>
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
      <p className="text-sm text-muted-foreground">
        Keep this profile, folder and cache during pending or uncertain work. Retry state lives only
        in this page. No selection is saved across reloads.
      </p>
    </main>
  );
}
