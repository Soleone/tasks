import { randomUUID } from "./lib/randomUUID";
import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { APP_NAME } from "./backend/branding";
import App from "./App";
import { MainWorkspace } from "./platform/mainWorkspace";
import { selectMainWorkspace } from "./platform/backendClient";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Field, FieldGroup, FieldLabel } from "./components/ui/field";
import { parseResponse, type Response } from "./backend/protocol";
import { JsonLineSession } from "./platform/backendSession";
import { parseNativeSelection, nativeSidecarArgs } from "./platform/nativeSelection";
import { runtimeKind } from "./platform/runtime";
import { devBackendUrl, WorkspaceReader } from "./platform/workspaceReader";
import { EDITOR_COMMANDS } from "./backend/editorCommands";
import { readEditorSelection, EditorClient, type EditorSelection } from "./platform/editorClient";

function nativeSession(selection: EditorSelection): JsonLineSession<Response> {
  const selected = parseNativeSelection({ rootPath: selection.rootPath, databasePath: selection.databasePath, profilePath: selection.profilePath });
  return new JsonLineSession(async () => {
    const { Command } = await import("@tauri-apps/plugin-shell");
    return Command.sidecar("binaries/tasks-backend", nativeSidecarArgs(selected));
  }, parseResponse);
}

/** Shows the selected folder, cache and profile, and opens Tasks only after explicit confirmation. */
export default function WorkspaceSelection(): ReactElement {
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [workspace, setWorkspace] = useState<MainWorkspace | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const kind = runtimeKind();
  const nativeSelection = import.meta.env.VITE_TASKS_NATIVE_SELECTION as string | undefined;
  const native = kind === "desktop" && /\bWindows\b/i.test(navigator.userAgent) && !!nativeSelection;

  useEffect(() => {
    if (nativeSelection) {
      setError(null);
      setSelection(null);
      try {
        if (!native) throw new Error("This native launch requires Windows desktop; no HTTP or legacy fallback was launched.");
        const selected = parseNativeSelection(JSON.parse(nativeSelection) as unknown);
        setSelection({ ...selected, version: 2, readOnly: false, selectionToken: randomUUID(), writeCommands: EDITOR_COMMANDS });
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Invalid native selection; no backend was launched."); }
      return;
    }
    if (kind !== "browser") return;
    let cancelled = false;
    setError(null);
    setSelection(null);
    void readEditorSelection(devBackendUrl()).then(selected => {
      if (!cancelled) setSelection(selected);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not inspect the selected dev backend.");
    });
    return () => { cancelled = true; };
  }, [kind, attempt, native, nativeSelection]);

  useEffect(() => {
    if (workspace) return;
    if (error) retryRef.current?.focus();
    else if (selection) confirmRef.current?.focus();
  }, [error, selection, workspace]);

  function confirm(event: FormEvent): void {
    event.preventDefault();
    if (!selection) return;
    try {
      const connection = native ? nativeSession(selection) : devBackendUrl();
      const editor = new EditorClient(connection, selection);
      const reader = typeof connection === "string"
        ? new WorkspaceReader(selection, { url: connection, selection })
        : new WorkspaceReader(selection, undefined, connection);
      const selected = new MainWorkspace(reader, editor);
      selectMainWorkspace(selected);
      setWorkspace(selected);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not select this folder.");
    }
  }

  if (workspace) return <App workspace={workspace} />;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header><h1 className="font-heading text-xl font-semibold">{APP_NAME}: select a folder</h1></header>
      <p className="text-sm text-muted-foreground">Confirm this workspace before opening Tasks. Nothing is read until you confirm.</p>
      {kind !== "browser" && !native ? (
        <Alert><AlertTitle>This desktop launch has no selected workspace</AlertTitle><AlertDescription>Start Tasks with an explicit workspace folder, cache and profile. No legacy backend or directory picker was used.</AlertDescription></Alert>
      ) : (
        <form onSubmit={confirm} className="flex flex-col gap-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="workspace-root">Task folder</FieldLabel>
              <Input id="workspace-root" value={selection?.rootPath ?? ""} readOnly required autoComplete="off" placeholder="Absolute path to the selected folder" />
            </Field>
            <Field>
              <FieldLabel htmlFor="workspace-cache">Local cache outside the task folder</FieldLabel>
              <Input id="workspace-cache" value={selection?.databasePath ?? ""} readOnly required autoComplete="off" placeholder="Absolute path to the selected SQLite cache" />
            </Field>
            <Field>
              <FieldLabel htmlFor="workspace-profile">Dedicated local profile</FieldLabel>
              <Input id="workspace-profile" value={selection?.profilePath ?? ""} readOnly required autoComplete="off" />
            </Field>
          </FieldGroup>
          {!native && <p className="text-sm text-muted-foreground">After migration, select the verified output with a fresh cache. Rollback means opening the preserved schema 1 folder with the old app; later edits stay separate.</p>}
          <div><Button ref={confirmRef} type="submit" disabled={!selection}>Open Tasks</Button></div>
        </form>
      )}
      {error && <Alert variant="destructive"><AlertTitle>Workspace selection is unavailable</AlertTitle><AlertDescription>{error}</AlertDescription><Button ref={retryRef} variant="outline" className="mt-3" onClick={() => setAttempt(value => value + 1)}>Retry selection</Button></Alert>}
      {!native && <p className="text-sm text-muted-foreground">Keep this profile, folder and cache during pending or uncertain work. Retry state lives only in this page. No selection is saved across reloads.</p>}
    </main>
  );
}
