import { randomUUID } from "../lib/randomUUID";
import { useRef, useState, type ReactElement } from "react";
import type { MainWorkspace } from "@/platform/mainWorkspace";
import type { CopyResult } from "@/platform/editorClient";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Field, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";

type CopyChoice = { destination: string; source?: string };

/** Explicit Linux gateway paths, not browser downloads or a workspace selector. */
export function WorkspaceBackup({ workspace }: { workspace: MainWorkspace }): ReactElement {
  const [mode, setMode] = useState<"backup" | "restore" | null>(null);
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [confirmation, setConfirmation] = useState<CopyChoice | null>(null);
  const [pending, setPending] = useState(false);
  const copying = useRef(false);
  const [result, setResult] = useState<CopyResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function copyNow(choice: CopyChoice): Promise<void> {
    if (copying.current) return;
    copying.current = true;
    setPending(true);
    setFailure(null);
    setResult(null);
    try {
      setResult(await workspace.copyWorkspace(choice.destination, randomUUID(), choice.source));
      setMode(null);
      setConfirmation(null);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      setConfirmation(null);
    } finally {
      copying.current = false;
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="settings-backup"
      className="flex flex-col gap-3 rounded-lg border p-4 md:col-span-2"
    >
      <h2 id="settings-backup" className="text-sm font-medium">
        Backup and restore
      </h2>
      <p className="text-sm text-muted-foreground">
        Copy the canonical task folder, including known conflict originals. Local cache, receipts
        and undo history are not included; keep the original cache and request evidence for retries.
      </p>
      {!mode ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setMode("backup");
              setDestination("");
              setResult(null);
              setFailure(null);
            }}
          >
            Create backup…
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setMode("restore");
              setDestination("");
              setSource("");
              setResult(null);
              setFailure(null);
            }}
          >
            Restore to new folder…
          </Button>
        </div>
      ) : confirmation ? (
        <Alert tone="confirmation" layout="stacked">
          <AlertTitle>
            {mode === "restore" ? "Restore to this new folder?" : "Create this backup?"}
          </AlertTitle>
          <AlertDescription className="wrap-anywhere">
            <div className="flex flex-col gap-2">
              <span>Source: {confirmation.source ?? workspace.reader.selection.rootPath}</span>
              <span>Destination: {confirmation.destination}</span>
              <span>
                Source files stay unchanged. The destination must be absent or empty and separate
                from both the source and selected task folder. Nothing is overwritten. The selected
                workspace will not change.
              </span>
            </div>
          </AlertDescription>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={pending} onClick={() => setConfirmation(null)}>
              Back
            </Button>
            <Button disabled={pending} onClick={() => void copyNow(confirmation)}>
              {pending ? "Copying…" : mode === "restore" ? "Confirm restore" : "Confirm backup"}
            </Button>
          </div>
        </Alert>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setFailure(null);
            setConfirmation({ destination, ...(mode === "restore" ? { source } : {}) });
          }}
        >
          <p className="text-sm text-muted-foreground">
            Enter absolute paths on the selected Linux backend, not on another browser device.
            Choose a new destination folder; its parent must exist.
          </p>
          {mode === "restore" ? (
            <Field>
              <FieldLabel htmlFor="backup-source">Backup source folder</FieldLabel>
              <Input
                id="backup-source"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                required
                pattern="/.*"
              />
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="backup-destination">New destination folder</FieldLabel>
            <Input
              id="backup-destination"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              required
              pattern="/.*"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setMode(null)}>
              Cancel
            </Button>
            <Button type="submit">{mode === "restore" ? "Review restore" : "Review backup"}</Button>
          </div>
        </form>
      )}
      {failure ? (
        <Alert variant="destructive">
          <AlertTitle>Could not copy workspace</AlertTitle>
          <AlertDescription className="wrap-anywhere">{failure}</AlertDescription>
        </Alert>
      ) : null}
      {result ? (
        <Alert>
          <AlertTitle>Verified copy: {result.taskCount} tasks</AlertTitle>
          <AlertDescription className="wrap-anywhere">
            {result.destinationDirectory}. The selected workspace is unchanged. This copy has no old
            retry or undo authority. Selecting it later requires explicit confirmation and a
            separate local cache.
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}
