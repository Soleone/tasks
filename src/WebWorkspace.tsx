import { useEffect, useState, type ReactElement } from "react";
import App from "./App";
import { EDITOR_COMMANDS } from "./backend/editorCommands";
import { parseResponse } from "./backend/protocol";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Button } from "./components/variants/button";
import { randomUUID } from "./lib/randomUUID";
import { selectMainWorkspace } from "./platform/backendClient";
import { JsonLineSession } from "./platform/backendSession";
import type { EditorSelection } from "./platform/editorClient";
import { EditorClient } from "./platform/editorClient";
import { openHomeWorkspace } from "./platform/homeWorkspace";
import type { MainWorkspace } from "./platform/mainWorkspace";
import { WEB_HOME, workerBackend } from "./platform/workerBackend";
import { WorkspaceReader } from "./platform/workspaceReader";

async function openWebHome(): Promise<MainWorkspace> {
  const selection: EditorSelection = {
    version: 2,
    rootPath: `${WEB_HOME}/sync`,
    databasePath: `${WEB_HOME}/local/app.db`,
    profilePath: WEB_HOME,
    selectionToken: randomUUID(),
    readOnly: false,
    writeCommands: EDITOR_COMMANDS,
  };
  const session = new JsonLineSession(() => Promise.resolve(workerBackend()), parseResponse);
  const workspace = await openHomeWorkspace(
    new WorkspaceReader(selection, undefined, session),
    new EditorClient(session, selection),
  );
  selectMainWorkspace(workspace);
  return workspace;
}

// One home per page: StrictMode's second effect run must reuse the first opening.
let opening: Promise<MainWorkspace> | null = null;

/** The web build: a Tasks home kept in this browser, with sample tasks on the first visit. */
export default function WebWorkspace(): ReactElement | null {
  const [workspace, setWorkspace] = useState<MainWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    opening ??= openWebHome();
    opening.then(
      (opened) => {
        if (!cancelled) setWorkspace(opened);
      },
      (reason: unknown) => {
        opening = null;
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (workspace) return <App workspace={workspace} />;
  if (!error) return null;
  return (
    <main className="app-shell mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6">
      <Alert variant="destructive">
        <AlertTitle>Tasks couldn't open in this browser</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
        <Button
          variant="outline"
          className="mt-3 w-fit"
          onClick={() => {
            setError(null);
            setAttempt((value) => value + 1);
          }}
        >
          Retry
        </Button>
      </Alert>
    </main>
  );
}
