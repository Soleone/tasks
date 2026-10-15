import { randomUUID } from "../lib/randomUUID";
import type { Command } from "@tauri-apps/plugin-shell";
import { isRecord, parseResponse, QUERY_COMMANDS, type Request, type Response } from "../backend/protocol";
import { parseTaskProjection } from "../backend/taskResults";
import type { TaskProjection } from "../backend/queries";
import { JsonLineSession } from "./backendSession";
import { runtimeKind } from "./runtime";
import { NATIVE_COMMANDS } from "./nativeSelection";

export type Selection = { rootPath: string; databasePath: string };
export type DevConnection = Selection & { version: 2; selectionToken: string; readOnly: boolean };
export type DevSelection = DevConnection & { readOnly: true };
export type WorkspaceState = "ready" | "empty" | "incomplete" | "unsupported" | "recovery_pending";
export type WorkspaceInfo = {
  state: WorkspaceState;
  schemaVersion: number | null;
  commands: string[];
  issues: { code: string; message: string }[];
  pendingOperationId: string | null;
  workspaceRevision: number;
};
export type TaskPage = {
  tasks: TaskProjection[];
  contextTasks: TaskProjection[];
  total: number;
  limit: number;
  offset: number;
  workspaceRevision: number;
};
type Query = (typeof QUERY_COMMANDS)[number];
type ClientRequest = Request & { requestId: string };

function invalidReply(): never {
  throw new Error("v2 backend returned invalid query data; no v1 fallback");
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function validateSelection(selection: Selection): void {
  for (const filename of [selection.rootPath, selection.databasePath]) {
    if (!/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(filename) || ["\u0000", "\r", "\n"].some(character => filename.includes(character))) {
      throw new Error("Select explicit absolute root and outside-root cache paths.");
    }
  }
}

export function sidecarArgs(selection: Selection): string[] {
  validateSelection(selection);
  return ["--stdio", "--v2-root", selection.rootPath, "--database", selection.databasePath];
}

export function parseWorkspaceInfo(result: Record<string, unknown>): WorkspaceInfo {
  if (!["ready", "empty", "incomplete", "unsupported", "recovery_pending"].includes(result.state as string)
    || (result.schemaVersion !== null && !nonnegativeInteger(result.schemaVersion))
    || !Array.isArray(result.commands) || !result.commands.every(command => typeof command === "string")
    || !Array.isArray(result.issues) || !result.issues.every(issue => isRecord(issue) && typeof issue.code === "string" && typeof issue.message === "string")
    || (result.pendingOperationId !== null && typeof result.pendingOperationId !== "string")
    || !nonnegativeInteger(result.workspaceRevision)) invalidReply();
  return result as WorkspaceInfo;
}

export function parseTaskPage(result: Record<string, unknown>): TaskPage {
  if (!Array.isArray(result.tasks) || !Array.isArray(result.contextTasks)
    || !nonnegativeInteger(result.total) || !nonnegativeInteger(result.limit) || result.limit < 1 || result.limit > 100
    || !nonnegativeInteger(result.offset) || !nonnegativeInteger(result.workspaceRevision)) invalidReply();
  const tasks = result.tasks.map(parseTaskProjection);
  const contextTasks = result.contextTasks.map(parseTaskProjection);
  if (tasks.length > result.limit || tasks.length > result.total
    || new Set([...tasks, ...contextTasks].map(task => task.id)).size !== tasks.length + contextTasks.length) invalidReply();
  return { tasks, contextTasks, total: result.total, limit: result.limit, offset: result.offset, workspaceRevision: result.workspaceRevision };
}

export function devBackendUrl(): string {
  return ((import.meta.env.VITE_DEV_BACKEND_URL as string | undefined) ?? "http://127.0.0.1:5174").replace(/\/+$/, "");
}

export async function readDevSelection(url: string): Promise<DevSelection> {
  const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Dev backend answered ${response.status}.`);
  const selection: unknown = await response.json();
  if (!isRecord(selection) || selection.ok !== true || selection.version !== 2 || selection.readOnly !== true
    || typeof selection.rootPath !== "string" || typeof selection.databasePath !== "string"
    || typeof selection.selectionToken !== "string" || selection.selectionToken === "") {
    throw new Error("This UI requires an explicitly selected v2 dev backend. No v1 fallback.");
  }
  const selected = selection as DevSelection;
  validateSelection(selected);
  return selected;
}

export async function postDevRequest(url: string, selection: DevConnection, request: ClientRequest): Promise<Response> {
  const response = await fetch(`${url}/command`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-taskdb-selection": selection.selectionToken },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Dev backend answered ${response.status}.`);
  return parseResponse(await response.json() as unknown);
}

export class WorkspaceReader {
  readonly selection: Readonly<Selection>;
  private readonly dev: { url: string; selection: DevConnection } | undefined;
  private readonly session: JsonLineSession<Response> | null;
  private readonly windowsProof: boolean;

  constructor(
    selection: Selection,
    dev?: { url: string; selection: DevConnection },
    native?: (() => Promise<Command<string>>) | JsonLineSession<Response>,
  ) {
    validateSelection(selection);
    if (dev && native) throw new Error("Select one backend connection; native sessions cannot fall back to HTTP.");
    this.windowsProof = native instanceof JsonLineSession;
    if (dev && (selection.rootPath !== dev.selection.rootPath || selection.databasePath !== dev.selection.databasePath)) {
      throw new Error("Dev backend does not match the selected root and cache.");
    }
    this.selection = Object.freeze({ rootPath: selection.rootPath, databasePath: selection.databasePath });
    this.dev = dev ? { url: dev.url, selection: Object.freeze({ ...dev.selection }) } : undefined;
    if (!dev && !native) {
      throw new Error("Native v2 launch is unavailable; use the explicitly selected browser reader. No v1 sidecar was launched.");
    }
    this.session = dev || !native ? null : native instanceof JsonLineSession ? native : new JsonLineSession(native, parseResponse);
  }

  async query(command: Query, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (!(QUERY_COMMANDS as readonly string[]).includes(command)) throw new Error("v2 app reader has no mutation capability");
    if (runtimeKind() === "android") throw new Error("The v2 app reader is not available on Android.");
    const request: ClientRequest = {
      version: 2, requestId: randomUUID(), command, args,
      actor: { kind: "human", label: "Tasks v2 reader" }, readOnly: true, dryRun: false,
    };
    const response = this.dev
      ? await postDevRequest(this.dev.url, this.dev.selection, request)
      : await this.session!.request(request);
    if (response.requestId !== request.requestId) throw new Error("v2 backend returned a different request ID");
    if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
    return response.result;
  }

  async workspaceInfo(): Promise<WorkspaceInfo> {
    const workspace = parseWorkspaceInfo(await this.query("workspace.info"));
    if (this.windowsProof && JSON.stringify(workspace.commands) !== JSON.stringify(NATIVE_COMMANDS)) {
      throw new Error("The selected native backend does not advertise the proven Windows command set; no fallback or task query was performed.");
    }
    return workspace;
  }

  async tasks(args: Record<string, unknown> = {}): Promise<TaskPage> {
    return parseTaskPage(await this.query("task.list", { ...args, includeAncestors: true }));
  }

  async close(): Promise<void> {
    await this.session?.close();
  }
}
