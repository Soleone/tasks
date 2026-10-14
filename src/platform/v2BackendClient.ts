import { randomUUID } from "../lib/randomUUID";
import type { Command } from "@tauri-apps/plugin-shell";
import { isV2Record, parseV2Response, V2_QUERY_COMMANDS, type V2Request, type V2Response } from "../backend/v2Protocol";
import { parseV2TaskProjection } from "../backend/v2TaskResults";
import type { V2TaskProjection } from "../backend/v2Queries";
import { JsonLineSession } from "./backendSession";
import { runtimeKind } from "./runtime";
import { V2_NATIVE_COMMANDS } from "./v2NativeSelection";

export type V2Selection = { rootPath: string; databasePath: string };
export type V2DevConnection = V2Selection & { version: 2; selectionToken: string; readOnly: boolean };
export type V2DevSelection = V2DevConnection & { readOnly: true };
export type V2WorkspaceState = "ready" | "empty" | "incomplete" | "unsupported" | "recovery_pending";
export type V2WorkspaceInfo = {
  state: V2WorkspaceState;
  schemaVersion: number | null;
  commands: string[];
  issues: { code: string; message: string }[];
  pendingOperationId: string | null;
  workspaceRevision: number;
};
export type V2TaskPage = {
  tasks: V2TaskProjection[];
  contextTasks: V2TaskProjection[];
  total: number;
  limit: number;
  offset: number;
  workspaceRevision: number;
};
type V2Query = (typeof V2_QUERY_COMMANDS)[number];
type V2ClientRequest = V2Request & { requestId: string };

function invalidReply(): never {
  throw new Error("v2 backend returned invalid query data; no v1 fallback");
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function validateV2Selection(selection: V2Selection): void {
  for (const filename of [selection.rootPath, selection.databasePath]) {
    if (!/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(filename) || ["\u0000", "\r", "\n"].some(character => filename.includes(character))) {
      throw new Error("Select explicit absolute root and outside-root cache paths.");
    }
  }
}

export function v2SidecarArgs(selection: V2Selection): string[] {
  validateV2Selection(selection);
  return ["--stdio", "--v2-root", selection.rootPath, "--database", selection.databasePath];
}

export function parseV2WorkspaceInfo(result: Record<string, unknown>): V2WorkspaceInfo {
  if (!["ready", "empty", "incomplete", "unsupported", "recovery_pending"].includes(result.state as string)
    || (result.schemaVersion !== null && !nonnegativeInteger(result.schemaVersion))
    || !Array.isArray(result.commands) || !result.commands.every(command => typeof command === "string")
    || !Array.isArray(result.issues) || !result.issues.every(issue => isV2Record(issue) && typeof issue.code === "string" && typeof issue.message === "string")
    || (result.pendingOperationId !== null && typeof result.pendingOperationId !== "string")
    || !nonnegativeInteger(result.workspaceRevision)) invalidReply();
  return result as V2WorkspaceInfo;
}

export function parseV2TaskPage(result: Record<string, unknown>): V2TaskPage {
  if (!Array.isArray(result.tasks) || !Array.isArray(result.contextTasks)
    || !nonnegativeInteger(result.total) || !nonnegativeInteger(result.limit) || result.limit < 1 || result.limit > 100
    || !nonnegativeInteger(result.offset) || !nonnegativeInteger(result.workspaceRevision)) invalidReply();
  const tasks = result.tasks.map(parseV2TaskProjection);
  const contextTasks = result.contextTasks.map(parseV2TaskProjection);
  if (tasks.length > result.limit || tasks.length > result.total
    || new Set([...tasks, ...contextTasks].map(task => task.id)).size !== tasks.length + contextTasks.length) invalidReply();
  return { tasks, contextTasks, total: result.total, limit: result.limit, offset: result.offset, workspaceRevision: result.workspaceRevision };
}

export function v2DevBackendUrl(): string {
  return ((import.meta.env.VITE_DEV_BACKEND_URL as string | undefined) ?? "http://127.0.0.1:5174").replace(/\/+$/, "");
}

export async function readV2DevSelection(url: string): Promise<V2DevSelection> {
  const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Dev backend answered ${response.status}.`);
  const selection: unknown = await response.json();
  if (!isV2Record(selection) || selection.ok !== true || selection.version !== 2 || selection.readOnly !== true
    || typeof selection.rootPath !== "string" || typeof selection.databasePath !== "string"
    || typeof selection.selectionToken !== "string" || selection.selectionToken === "") {
    throw new Error("This UI requires an explicitly selected v2 dev backend. No v1 fallback.");
  }
  const selected = selection as V2DevSelection;
  validateV2Selection(selected);
  return selected;
}

export async function postV2DevRequest(url: string, selection: V2DevConnection, request: V2ClientRequest): Promise<V2Response> {
  const response = await fetch(`${url}/command`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-taskdb-selection": selection.selectionToken },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Dev backend answered ${response.status}.`);
  return parseV2Response(await response.json() as unknown);
}

export class V2WorkspaceReader {
  readonly selection: Readonly<V2Selection>;
  private readonly dev: { url: string; selection: V2DevConnection } | undefined;
  private readonly session: JsonLineSession<V2Response> | null;
  private readonly windowsProof: boolean;

  constructor(
    selection: V2Selection,
    dev?: { url: string; selection: V2DevConnection },
    native?: (() => Promise<Command<string>>) | JsonLineSession<V2Response>,
  ) {
    validateV2Selection(selection);
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
    this.session = dev || !native ? null : native instanceof JsonLineSession ? native : new JsonLineSession(native, parseV2Response);
  }

  async query(command: V2Query, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (!(V2_QUERY_COMMANDS as readonly string[]).includes(command)) throw new Error("v2 app reader has no mutation capability");
    if (runtimeKind() === "android") throw new Error("The v2 app reader is not available on Android.");
    const request: V2ClientRequest = {
      version: 2, requestId: randomUUID(), command, args,
      actor: { kind: "human", label: "Tasks v2 reader" }, readOnly: true, dryRun: false,
    };
    const response = this.dev
      ? await postV2DevRequest(this.dev.url, this.dev.selection, request)
      : await this.session!.request(request);
    if (response.requestId !== request.requestId) throw new Error("v2 backend returned a different request ID");
    if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
    return response.result;
  }

  async workspaceInfo(): Promise<V2WorkspaceInfo> {
    const workspace = parseV2WorkspaceInfo(await this.query("workspace.info"));
    if (this.windowsProof && JSON.stringify(workspace.commands) !== JSON.stringify(V2_NATIVE_COMMANDS)) {
      throw new Error("The selected native backend does not advertise the proven Windows command set; no fallback or task query was performed.");
    }
    return workspace;
  }

  async tasks(args: Record<string, unknown> = {}): Promise<V2TaskPage> {
    return parseV2TaskPage(await this.query("task.list", { ...args, includeAncestors: true }));
  }

  async close(): Promise<void> {
    await this.session?.close();
  }
}
