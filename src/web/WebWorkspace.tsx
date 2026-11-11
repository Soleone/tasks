import { useEffect, useState, type ReactElement } from "react";
import App from "@/App";
import { EDITOR_COMMANDS } from "@/backend/editorCommands";
import { parseResponse, type Response } from "@/backend/protocol";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/variants/button";
import { randomUUID } from "@/lib/randomUUID";
import { selectMainWorkspace } from "@/platform/backendClient";
import { JsonLineSession } from "@/platform/backendSession";
import type { EditorSelection } from "@/platform/editorClient";
import { EditorClient } from "@/platform/editorClient";
import { openHomeWorkspace } from "@/platform/homeWorkspace";
import type { MainWorkspace } from "@/platform/mainWorkspace";
import { WEB_HOME, workerBackend } from "./workerBackend";
import { WorkspaceReader } from "@/platform/workspaceReader";
import { HomeSection } from "./HomeSection";
import { HostedActions } from "./HostedActions";
import { addSampleTasks, removeSampleTasks } from "./sampleTasks";
import "./demo.css";

type WebHome = { workspace: MainWorkspace; session: JsonLineSession<Response> };

async function openWebHome(): Promise<WebHome> {
  const selection: EditorSelection = {
    version: 2,
    rootPath: `${WEB_HOME}/sync`,
    databasePath: `${WEB_HOME}/local/app.db`,
    profilePath: WEB_HOME,
    selectionToken: randomUUID(),
    readOnly: false,
    writeCommands: EDITOR_COMMANDS,
  };
  const session = new JsonLineSession(
    () =>
      Promise.resolve(
        workerBackend(
          () => new Worker(new URL("./backendWorker.ts", import.meta.url), { type: "module" }),
        ),
      ),
    parseResponse,
  );
  const workspace = await openHomeWorkspace(
    new WorkspaceReader(selection, undefined, session),
    new EditorClient(session, selection),
  );
  selectMainWorkspace(workspace);
  return { workspace, session };
}

// One home per page: StrictMode's second effect run must reuse the first opening.
let opening: Promise<WebHome> | null = null;

/** The web build: a Tasks home kept in this browser, with example tasks a toggle away. */
export default function WebWorkspace(): ReactElement | null {
  const [home, setHome] = useState<WebHome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    opening ??= openWebHome();
    opening.then(
      (opened) => {
        if (!cancelled) setHome(opened);
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

  if (home)
    return (
      <>
        <App workspace={home.workspace} homeSection={<HomeSection />} />
        <HostedActions
          addSamples={() => addSampleTasks(home.session)}
          removeSamples={(ids) => removeSampleTasks(home.session, ids)}
        />
      </>
    );
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
