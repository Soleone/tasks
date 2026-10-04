import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { APP_NAME } from "./backend/branding";
import { V2ReaderView } from "./components/V2ReaderView";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { runtimeKind } from "./platform/runtime";
import { readV2DevSelection, v2DevBackendUrl, V2WorkspaceReader, type V2DevSelection } from "./platform/v2BackendClient";

export default function V2App(): ReactElement {
  const [devSelection, setDevSelection] = useState<V2DevSelection | null>(null);
  const [reader, setReader] = useState<V2WorkspaceReader | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const kind = runtimeKind();

  useEffect(() => {
    if (kind !== "browser") return;
    let cancelled = false;
    setError(null);
    setDevSelection(null);
    void readV2DevSelection(v2DevBackendUrl()).then(selection => {
      if (cancelled) return;
      setDevSelection(selection);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not inspect the selected dev backend.");
    });
    return () => { cancelled = true; };
  }, [kind, attempt]);

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
      setReader(new V2WorkspaceReader(devSelection, { url: v2DevBackendUrl(), selection: devSelection }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not select this folder.");
    }
  }

  if (reader) return <V2ReaderView reader={reader} onLeave={() => setReader(null)} />;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header><h1 className="font-heading text-xl font-semibold">{APP_NAME}: select a v2 folder</h1></header>
      <p className="text-sm text-muted-foreground">This opt-in reader is separate from your v1 app. Confirm the selected folder and local cache before browsing. It never upgrades, initializes, repairs, or changes sharing.</p>
      {kind !== "browser" ? (
        <Alert><AlertTitle>The native v2 reader is unavailable</AlertTitle><AlertDescription>Use the explicitly selected browser reader for this milestone. Android and desktop sidecar launch remain withheld; the v1 sidecar and directory selection have not been used.</AlertDescription></Alert>
      ) : (
        <form onSubmit={confirm} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="v2-root">Schema-2 task folder</Label>
            <Input id="v2-root" value={devSelection?.rootPath ?? ""} readOnly required autoComplete="off" placeholder="Absolute path to the selected folder" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="v2-cache">Local cache outside the task folder</Label>
            <Input id="v2-cache" value={devSelection?.databasePath ?? ""} readOnly required autoComplete="off" placeholder="Absolute path to the selected SQLite cache" />
          </div>
          <p className="text-sm text-muted-foreground">After migration, select its verified v2 output with a separate v2 cache. Do not reuse v1 authority. Rollback uses the preserved v1 folder with the v1 app; later v2 edits remain separate.</p>
          <div><Button ref={confirmRef} type="submit" disabled={!devSelection}>Browse this v2 folder</Button></div>
        </form>
      )}
      {error && <Alert variant="destructive"><AlertTitle>V2 selection is unavailable</AlertTitle><AlertDescription>{error}</AlertDescription><Button ref={retryRef} variant="outline" className="mt-3" onClick={() => setAttempt(value => value + 1)}>Retry selection</Button></Alert>}
      <p className="text-sm text-muted-foreground">Read-only milestone: capture, editing, ordering, migration, rollback and recovery controls are not connected to this UI. Use the explicitly selected CLI for supported operations. No selection is saved across reloads.</p>
    </main>
  );
}
