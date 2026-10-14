import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { APP_NAME } from "./backend/branding";
import App from "./App";
import { MainWorkspace } from "./platform/mainWorkspace";
import { selectMainWorkspace } from "./platform/backendClient";
import { V2ReaderView } from "./components/V2ReaderView";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Field, FieldGroup, FieldLabel } from "./components/ui/field";
import { parseV2Response, type V2Response } from "./backend/v2Protocol";
import { JsonLineSession } from "./platform/backendSession";
import { parseV2NativeSelection, v2NativeSidecarArgs } from "./platform/v2NativeSelection";
import { runtimeKind } from "./platform/runtime";
import { readV2DevSelection, v2DevBackendUrl, V2WorkspaceReader, type V2DevSelection } from "./platform/v2BackendClient";
import { readV2EditorSelection, V2EditorClient, V2_EDITOR_COMMANDS, type V2EditorSelection } from "./platform/v2EditorClient";

function nativeSession(selection: V2EditorSelection): JsonLineSession<V2Response> {
  const selected = parseV2NativeSelection({ rootPath: selection.rootPath, databasePath: selection.databasePath, profilePath: selection.profilePath });
  return new JsonLineSession(async () => {
    const { Command } = await import("@tauri-apps/plugin-shell");
    return Command.sidecar("binaries/tasks-backend", v2NativeSidecarArgs(selected));
  }, parseV2Response);
}

export default function V2App(): ReactElement {
  const [devSelection, setDevSelection] = useState<V2DevSelection | V2EditorSelection | null>(null);
  const editing = import.meta.env.VITE_TASKDB_V2_EDIT === "1";
  const [reader, setReader] = useState<V2WorkspaceReader | null>(null);
  const [workspace, setWorkspace] = useState<MainWorkspace | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const kind = runtimeKind();
  const nativeSelection = import.meta.env.VITE_TASKDB_V2_NATIVE_SELECTION as string | undefined;
  const native = kind === "desktop" && /\bWindows\b/i.test(navigator.userAgent) && !!nativeSelection;
  const opensTasks = native || editing;

  useEffect(() => {
    if (nativeSelection) {
      setError(null);
      setDevSelection(null);
      try {
        if (!native || !editing) throw new Error("This explicit native pilot requires Windows desktop; no HTTP or v1 fallback was launched.");
        const selection = parseV2NativeSelection(JSON.parse(nativeSelection) as unknown);
        setDevSelection({ ...selection, version: 2, readOnly: false, selectionToken: crypto.randomUUID(), writeCommands: V2_EDITOR_COMMANDS });
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Invalid native selection; no backend was launched."); }
      return;
    }
    if (kind !== "browser") return;
    let cancelled = false;
    setError(null);
    setDevSelection(null);
    void (editing ? readV2EditorSelection(v2DevBackendUrl()) : readV2DevSelection(v2DevBackendUrl())).then(selection => {
      if (cancelled) return;
      setDevSelection(selection);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not inspect the selected dev backend.");
    });
    return () => { cancelled = true; };
  }, [kind, attempt, editing, native, nativeSelection]);

  useEffect(() => {
    if (reader) return;
    if (error) retryRef.current?.focus();
    else if (devSelection) confirmRef.current?.focus();
  }, [error, devSelection, reader]);

  useEffect(() => {
    return () => { void reader?.close(); };
  }, [reader]);

  function confirm(event: FormEvent): void {
    event.preventDefault();
    if (!devSelection) return;
    try {
      if (devSelection.readOnly === false) {
        const connection = native ? nativeSession(devSelection) : v2DevBackendUrl();
        const selectedEditor = new V2EditorClient(connection, devSelection);
        const selectedReader = typeof connection === "string"
          ? new V2WorkspaceReader(devSelection, { url: connection, selection: devSelection })
          : new V2WorkspaceReader(devSelection, undefined, connection);
        const selectedWorkspace = new MainWorkspace(selectedReader, selectedEditor);
        selectMainWorkspace(selectedWorkspace);
        setWorkspace(selectedWorkspace);
        setReader(selectedReader);
      } else {
        setReader(new V2WorkspaceReader(devSelection, { url: v2DevBackendUrl(), selection: devSelection }));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not select this folder.");
    }
  }

  if (reader && workspace) return <App workspace={workspace} />;
  if (reader) return <V2ReaderView reader={reader} onLeave={() => setReader(null)} />;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header><h1 className="font-heading text-xl font-semibold">{APP_NAME}: select a folder</h1></header>
      {opensTasks ? <p className="text-sm text-muted-foreground">Confirm this disposable workspace before opening Tasks. Your personal tasks will not be selected.</p> : <p className="text-sm text-muted-foreground">This opt-in reader is separate from your v1 app. Confirm the selected folder and local cache before browsing. It never upgrades, initializes, repairs, or changes sharing. This mode is read-only.</p>}
      {kind !== "browser" && !native ? (
        <Alert><AlertTitle>The native v2 reader is unavailable</AlertTitle><AlertDescription>Use the explicitly selected browser reader for this milestone. Android and desktop sidecar launch remain withheld; the v1 sidecar and directory selection have not been used.</AlertDescription></Alert>
      ) : (
        <form onSubmit={confirm} className="flex flex-col gap-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="v2-root">{opensTasks ? "Task folder" : "Schema-2 task folder"}</FieldLabel>
              <Input id="v2-root" value={devSelection?.rootPath ?? ""} readOnly required autoComplete="off" placeholder="Absolute path to the selected folder" />
            </Field>
            <Field>
              <FieldLabel htmlFor="v2-cache">Local cache outside the task folder</FieldLabel>
              <Input id="v2-cache" value={devSelection?.databasePath ?? ""} readOnly required autoComplete="off" placeholder="Absolute path to the selected SQLite cache" />
            </Field>
            {opensTasks && <Field>
              <FieldLabel htmlFor="v2-profile">Dedicated local profile</FieldLabel>
              <Input id="v2-profile" value={devSelection?.readOnly === false ? devSelection.profilePath : ""} readOnly required autoComplete="off" />
            </Field>}
          </FieldGroup>
          {!native && <p className="text-sm text-muted-foreground">After migration, select its verified v2 output with a separate v2 cache. Do not reuse v1 authority. Rollback uses the preserved v1 folder with the v1 app; later v2 edits remain separate.</p>}
          <div><Button ref={confirmRef} type="submit" disabled={!devSelection}>{opensTasks ? "Open Tasks" : "Browse this v2 folder"}</Button></div>
        </form>
      )}
      {error && <Alert variant="destructive"><AlertTitle>V2 selection is unavailable</AlertTitle><AlertDescription>{error}</AlertDescription><Button ref={retryRef} variant="outline" className="mt-3" onClick={() => setAttempt(value => value + 1)}>Retry selection</Button></Alert>}
      {!native && <p className="text-sm text-muted-foreground">{opensTasks ? "Keep this profile, root and cache during pending or uncertain work. Retry state lives only in this page." : "Read-only milestone: capture and editing are unavailable."} No selection is saved across reloads.</p>}
    </main>
  );
}
