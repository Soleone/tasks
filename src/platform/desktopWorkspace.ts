import { invoke } from "@tauri-apps/api/core";
import { homeDir, join } from "@tauri-apps/api/path";
import { randomUUID } from "@/lib/randomUUID";
import { parseResponse, type Response } from "@/backend/protocol";
import { EDITOR_COMMANDS } from "@/backend/editorCommands";
import { androidBackend } from "./androidBackend";
import { JsonLineSession } from "./backendSession";
import type { EditorSelection } from "./editorClient";
import { isAndroid } from "./runtime";
import { sidecarArgs } from "./workspaceReader";

// Android's own document folders are app storage that Syncthing can't reach.
const ANDROID_SHARED_STORAGE = "/storage/emulated/0";
const CHOOSE_HOME_KEY = "tasks.chooseHome";

/** A new home goes in the user folder: on Windows, Documents is often inside OneDrive. */
export async function suggestedHome(): Promise<string> {
  return join(isAndroid() ? ANDROID_SHARED_STORAGE : await homeDir(), "Tasks");
}

/** The Tasks home this app opened last, or null on a first launch. */
export function rememberedHome(): Promise<string | null> {
  return invoke<string | null>("home_pointer_read");
}

export function rememberHome(home: string): Promise<void> {
  return invoke("home_pointer_write", { home });
}

/** Shows the remembered home in the file manager (desktop only). */
export function revealHome(): Promise<void> {
  return invoke("home_reveal", { exports: false });
}

/** Shows the home's exports folder, where deleting done tasks saves its zip (desktop only). */
export function revealExports(): Promise<void> {
  return invoke("home_reveal", { exports: true });
}

/** Settings' "Open another home" shows setup on the next start without forgetting this home. */
export function chooseHomeOnNextStart(): void {
  try {
    sessionStorage.setItem(CHOOSE_HOME_KEY, "1");
  } catch {
    // Without session storage the remembered home opens again.
  }
}

/** Whether this start should show setup instead of opening the remembered home; asks only once. */
export function takeHomeChoice(): boolean {
  try {
    const requested = sessionStorage.getItem(CHOOSE_HOME_KEY) === "1";
    sessionStorage.removeItem(CHOOSE_HOME_KEY);
    return requested;
  } catch {
    return false;
  }
}

async function homeSelection(home: string): Promise<EditorSelection> {
  return {
    version: 2,
    rootPath: await join(home, "sync"),
    databasePath: await join(home, "local", "app.db"),
    profilePath: home,
    selectionToken: randomUUID(),
    readOnly: false,
    writeCommands: EDITOR_COMMANDS,
  };
}

function homeSession(home: string): JsonLineSession<Response> {
  return new JsonLineSession(async () => {
    const args = sidecarArgs(home); // Validates the home on both routes.
    if (isAndroid()) return androidBackend(home);
    const { Command } = await import("@tauri-apps/plugin-shell");
    return Command.sidecar("binaries/tasks-backend", args);
  }, parseResponse);
}

export type HomeState = "ready" | "empty" | "incomplete" | "unsupported" | "recovery_pending";

/** A refusal from the backend, with its code so setup can offer the matching choice. */
export class HomeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * One backend conversation about a Tasks home that isn't open in the app yet. When the home
 * opens, the app takes over the session, so launch starts the backend only once.
 */
export class HomeSetup {
  private constructor(
    readonly selection: EditorSelection,
    readonly session: JsonLineSession<Response>,
  ) {}

  static async open(home: string): Promise<HomeSetup> {
    return new HomeSetup(await homeSelection(home), homeSession(home));
  }

  get home(): string {
    return this.selection.profilePath;
  }

  async info(): Promise<{ state: HomeState; schemaVersion: number | null; writeContext: string }> {
    const response = await this.send("workspace.info", {}, { readOnly: true });
    return {
      state: response.result.state as HomeState,
      schemaVersion: response.result.schemaVersion as number | null,
      writeContext: response.writeContext,
    };
  }

  /** Creates the home's folders, or finishes an interrupted creation; returns its real path. */
  async create(): Promise<string> {
    return (await this.send("home.create", {})).result.homePath as string;
  }

  /** Turns the home's empty sync folder into a new task workspace. */
  async init(): Promise<void> {
    const { writeContext } = await this.info();
    await this.send("workspace.init", {}, { writeContext, idempotencyKey: randomUUID() });
  }

  /** The home moved with its cache: keep its history at the new path. */
  async keepHistory(): Promise<void> {
    await this.send("workspace.rebind", {});
  }

  /** The home's cache came with a copy: set it aside and start a new history here. */
  async startNewHistory(): Promise<void> {
    await this.send("workspace.newHistory", {});
  }

  close(): Promise<void> {
    return this.session.close();
  }

  private async send(
    command: string,
    args: Record<string, unknown>,
    options: { readOnly?: boolean; writeContext?: string; idempotencyKey?: string } = {},
  ): Promise<Extract<Response, { ok: true }>> {
    const request = {
      version: 2 as const,
      requestId: randomUUID(),
      command,
      args,
      actor: { kind: "human" as const, label: "Tasks setup" },
      readOnly: options.readOnly ?? false,
      dryRun: false,
      ...(options.writeContext ? { writeContext: options.writeContext } : {}),
      ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    };
    const response = await this.session.request(request);
    if (!response.ok) throw new HomeError(response.error.code, response.error.message);
    return response;
  }
}
