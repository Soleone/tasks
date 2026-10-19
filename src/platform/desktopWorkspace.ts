import { invoke } from "@tauri-apps/api/core";
import { appDataDir, documentDir, join } from "@tauri-apps/api/path";
import { randomUUID } from "@/lib/randomUUID";
import { parseResponse, type Response } from "@/backend/protocol";
import { EDITOR_COMMANDS } from "@/backend/editorCommands";
import { androidBackend } from "./androidBackend";
import { JsonLineSession } from "./backendSession";
import type { EditorSelection } from "./editorClient";
import { isAndroid } from "./runtime";
import { sidecarArgs } from "./workspaceReader";

const FOLDER_KEY = "tasks.workspaceFolder";

/** Where the desktop app keeps its own files, and where a first task folder is suggested. */
export type DesktopPaths = { appData: string; suggestedFolder: string };

// Android's document folder API points at the app's own storage, which Syncthing can't reach.
const ANDROID_DOCUMENTS = "/storage/emulated/0/Documents";

export async function desktopPaths(): Promise<DesktopPaths> {
  const documents = isAndroid() ? ANDROID_DOCUMENTS : await documentDir();
  return { appData: await appDataDir(), suggestedFolder: await join(documents, "Tasks") };
}

export function rememberedFolder(): string | null {
  try {
    return localStorage.getItem(FOLDER_KEY);
  } catch {
    return null;
  }
}

export function rememberFolder(folder: string | null): void {
  try {
    if (folder === null) localStorage.removeItem(FOLDER_KEY);
    else localStorage.setItem(FOLDER_KEY, folder);
  } catch {
    // Without storage the app asks for the folder on the next launch.
  }
}

export function pathExists(path: string): Promise<boolean> {
  return invoke<boolean>("path_exists", { path });
}

export function createFolder(path: string): Promise<void> {
  return invoke("create_folder", { path });
}

/** Each task folder gets its own cache in the app data folder, named after the folder's path. */
async function cachePath(appData: string, folder: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(folder));
  const name = Array.from(new Uint8Array(digest).slice(0, 12), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return join(appData, "caches", `${name}.db`);
}

async function folderSelection(appData: string, folder: string): Promise<EditorSelection> {
  return {
    version: 2,
    rootPath: folder,
    databasePath: await cachePath(appData, folder),
    profilePath: appData,
    selectionToken: randomUUID(),
    readOnly: false,
    writeCommands: EDITOR_COMMANDS,
  };
}

function folderSession(selection: EditorSelection): JsonLineSession<Response> {
  return new JsonLineSession(async () => {
    const args = sidecarArgs(selection); // Validates the selection on both routes.
    if (isAndroid()) return androidBackend(selection.rootPath, selection.databasePath);
    const { Command } = await import("@tauri-apps/plugin-shell");
    return Command.sidecar("binaries/tasks-backend", args);
  }, parseResponse);
}

export type FolderState = "ready" | "empty" | "incomplete" | "unsupported" | "recovery_pending";

/**
 * One backend conversation about a folder that isn't open in the app yet. When the folder
 * opens, the app takes over the session, so launch starts the backend only once.
 */
export class FolderSetup {
  private constructor(
    readonly selection: EditorSelection,
    readonly session: JsonLineSession<Response>,
  ) {}

  static async open(appData: string, folder: string): Promise<FolderSetup> {
    const selection = await folderSelection(appData, folder);
    return new FolderSetup(selection, folderSession(selection));
  }

  async info(): Promise<{
    state: FolderState;
    schemaVersion: number | null;
    writeContext: string;
  }> {
    const response = await this.send("workspace.info", {}, { readOnly: true });
    const result = response.result as { state: FolderState; schemaVersion: number | null };
    return {
      state: result.state,
      schemaVersion: result.schemaVersion,
      writeContext: response.writeContext,
    };
  }

  /** Turns an empty folder into a new task workspace. */
  async init(): Promise<void> {
    const { writeContext } = await this.info();
    await this.send("workspace.init", {}, { writeContext, idempotencyKey: randomUUID() });
  }

  close(): Promise<void> {
    return this.session.close();
  }

  private async send(
    command: string,
    args: Record<string, unknown>,
    options: {
      readOnly?: boolean;
      writeContext?: string;
      idempotencyKey?: string;
    },
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
    if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
    return response;
  }
}
