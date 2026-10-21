import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import App from "./App";
import { APP_NAME } from "./backend/branding";
import { useTheme } from "./components/soleone/theme";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./components/ui/field";
import { Input } from "./components/ui/input";
import { applyStoredFontSizeIncrease } from "./fontSize";
import { selectMainWorkspace } from "./platform/backendClient";
import {
  HomeError,
  HomeSetup,
  previousTaskFolder,
  rememberedHome,
  rememberHome,
  suggestedHome,
  takeHomeChoice,
} from "./platform/desktopWorkspace";
import { EditorClient } from "./platform/editorClient";
import { openHomeWorkspace } from "./platform/homeWorkspace";
import type { MainWorkspace } from "./platform/mainWorkspace";
import { DamagedSettingsError, readPreference } from "./platform/preferences";
import { WorkspaceReader } from "./platform/workspaceReader";
import { THEME_STORAGE_KEY } from "./theme/config";

// Read once per page load, so React's development double effects can't consume it.
const homeChoiceRequested = takeHomeChoice();

type Mode = "create" | "adopt" | "open" | "launch";
/** What setup can offer after a refusal, beyond choosing a home again. */
type Choice = "retry" | "keepHistory" | "newHistory" | "resetSettings";
type Problem = { home: string; mode: Mode; title: string; message: string; choice?: Choice };

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Explains a refusal and the one choice that resolves it, if there is one. */
function problemFor(home: string, mode: Mode, reason: unknown): Problem {
  const problem = { home, mode, title: "That didn't work", message: message(reason) };
  if (reason instanceof DamagedSettingsError)
    return {
      ...problem,
      title: "Settings can't be read",
      message: `${reason.message} Resetting keeps the damaged file next to the new one.`,
      choice: "resetSettings",
    };
  if (!(reason instanceof HomeError)) return problem;
  if (reason.code === "HOME_MISSING" || reason.code === "EMPTY_SYNC_FOLDER")
    return { ...problem, title: "Tasks home not found", message: reason.message, choice: "retry" };
  if (reason.code === "FOLDER_IN_USE") return { ...problem, choice: "retry" };
  if (reason.code === "HOME_MOVED")
    return {
      ...problem,
      title: "This Tasks home moved",
      message: `${home} has the same files as before at a new place. Continue here to keep its undo and activity history.`,
      choice: "keepHistory",
    };
  if (reason.code === "CACHE_FROM_ELSEWHERE")
    return {
      ...problem,
      title: "This Tasks home is a copy",
      message: `${home} was copied or restored from another place. Its tasks are fine. Start a new history here; the old history is kept aside, unchanged.`,
      choice: "newHistory",
    };
  return problem;
}

/**
 * Opens a home: creates it or brings the previous task folder into it first when asked,
 * initializes an empty sync folder only on an explicit choice, and loads its settings before the
 * list renders.
 */
async function openHome(
  requested: string,
  mode: Mode,
  choice?: Choice,
): Promise<{ workspace: MainWorkspace; theme: string | null }> {
  let setup = await HomeSetup.open(requested);
  try {
    if (mode === "create" || mode === "adopt") {
      const previous = mode === "adopt" ? previousTaskFolder() : null;
      const home = previous ? await setup.adopt(previous) : await setup.create();
      if (home !== setup.home) {
        await setup.close();
        setup = await HomeSetup.open(home);
      }
    }
    if (choice === "keepHistory") await setup.keepHistory();
    if (choice === "newHistory") await setup.startNewHistory();
    const { state } = await setup.info();
    if (state === "empty" && mode === "launch")
      throw new HomeError(
        "EMPTY_SYNC_FOLDER",
        `The sync folder of ${setup.home} is empty. If Syncthing is still bringing your tasks, retry later. Open the home again to start an empty list.`,
      );
    if (state === "empty") await setup.init();
    else if (state === "unsupported")
      throw new Error(
        "This home holds tasks from the old version. Convert them with pnpm migrate.",
      );
    else if (state !== "ready" && state !== "recovery_pending")
      throw new Error(
        `${setup.home} has files that aren't a complete task workspace in its sync folder.`,
      );
    const workspace = await openHomeWorkspace(
      new WorkspaceReader(setup.selection, undefined, setup.session),
      new EditorClient(setup.session, setup.selection),
      choice === "resetSettings",
    );
    await rememberHome(setup.home);
    selectMainWorkspace(workspace);
    return { workspace, theme: readPreference(THEME_STORAGE_KEY) };
  } catch (reason) {
    await setup.close();
    throw reason;
  }
}

/** The app opens the remembered Tasks home. On first launch it asks for one. */
export default function DesktopWorkspace(): ReactElement | null {
  const [home, setHome] = useState("");
  // The remembered home while setup was asked for from Settings, so setup can go back to it.
  const [current, setCurrent] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [workspace, setWorkspace] = useState<MainWorkspace | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const homeRef = useRef<HTMLInputElement>(null);
  const { setTheme } = useTheme();
  const previousFolder = previousTaskFolder();

  async function run(label: string, requested: string, mode: Mode, choice?: Choice) {
    setBusy(label);
    setProblem(null);
    try {
      const opened = await openHome(requested, mode, choice);
      if (opened.theme) setTheme(opened.theme);
      applyStoredFontSizeIncrease();
      setWorkspace(opened.workspace);
    } catch (reason) {
      setProblem(problemFor(requested, mode, reason));
      setHome(requested);
      setShowForm(true);
    } finally {
      setBusy(null);
    }
  }

  const launch = useEffectEvent((remembered: string | null, suggested: string) => {
    if (remembered && !homeChoiceRequested) void run("Opening Tasks...", remembered, "launch");
    else {
      setCurrent(remembered);
      setHome(suggested);
      setShowForm(true);
    }
  });
  const launchFailed = useEffectEvent((reason: unknown) => {
    setProblem({ home: "", mode: "launch", title: "That didn't work", message: message(reason) });
    setShowForm(true);
  });

  useEffect(() => {
    let cancelled = false;
    void Promise.all([rememberedHome(), suggestedHome()]).then(
      ([remembered, suggested]) => {
        if (!cancelled) launch(remembered, suggested);
      },
      (reason: unknown) => {
        if (!cancelled) launchFailed(reason);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (showForm && !busy) homeRef.current?.focus();
  }, [showForm, busy]);

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (home.trim()) void run("Creating the Tasks home...", home.trim(), "create");
  }

  if (workspace) return <App workspace={workspace} />;
  // Opening the remembered home shows nothing, so setup appears only when it is needed.
  if (!showForm && !problem) return null;

  const separator = home.includes("\\") ? "\\" : "/";
  return (
    <main className="app-shell mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-xl font-semibold">Choose a Tasks home</h1>
        <p className="text-sm text-muted-foreground">
          {APP_NAME} keeps everything for this device in one folder you choose. Your tasks are files
          in its sync folder.
        </p>
      </header>
      {busy && <p role="status">{busy}</p>}
      {problem && (
        <Alert variant="destructive">
          <AlertTitle>{problem.title}</AlertTitle>
          <AlertDescription>{problem.message}</AlertDescription>
          {problem.choice && (
            <Button
              variant="outline"
              className="mt-3 w-fit"
              disabled={busy !== null}
              onClick={() =>
                void run("Opening Tasks...", problem.home, problem.mode, problem.choice)
              }
            >
              {problem.choice === "retry"
                ? "Retry"
                : problem.choice === "keepHistory"
                  ? "Continue here"
                  : problem.choice === "newHistory"
                    ? "Start a new history here"
                    : "Reset settings"}
            </Button>
          )}
        </Alert>
      )}
      {showForm && (
        <form onSubmit={submit} className="flex flex-col gap-6">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="tasks-home">Tasks home</FieldLabel>
              <Input
                ref={homeRef}
                id="tasks-home"
                value={home}
                onChange={(event) => setHome(event.target.value)}
                required
                autoComplete="off"
                spellCheck={false}
                disabled={busy !== null}
              />
              <FieldDescription>
                Add only its sync folder to Syncthing, never the home itself:{" "}
                <code className="wrap-anywhere">
                  {home.trim().replace(/[\\/]+$/, "")}
                  {separator}sync
                </code>
              </FieldDescription>
            </Field>
          </FieldGroup>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy !== null}>
              Create home
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null || !home.trim()}
              onClick={() => void run("Opening the Tasks home...", home.trim(), "open")}
            >
              Open existing home
            </Button>
            {current && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => void run("Opening Tasks...", current, "launch")}
              >
                Back to current home
              </Button>
            )}
          </div>
          {previousFolder && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Your tasks from before are in {previousFolder}. Bring them into this new home with
                their history; the old folder stays as it is. Close the CLI and pause Syncthing
                first, then point Syncthing at the new sync folder.
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-fit"
                disabled={busy !== null || !home.trim()}
                onClick={() => void run("Bringing your tasks over...", home.trim(), "adopt")}
              >
                Bring my tasks into this home
              </Button>
            </div>
          )}
        </form>
      )}
    </main>
  );
}
