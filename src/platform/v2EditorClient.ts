import { isV2Record, type V2Request, type V2Response } from "../backend/v2Protocol";
import type { V2TaskProjection } from "../backend/v2Queries";
import { V2_STATUS_COMMANDS } from "../backend/v2TaskStatus";
import { parseV2TaskEditResult, parseV2TaskProjection, type V2TaskExecutionResult, type V2TaskPreviewResult } from "../backend/v2TaskResults";
import { parseV2WorkspaceInfo, postV2DevRequest, validateV2Selection, type V2DevConnection } from "./v2BackendClient";
import { runtimeKind } from "./runtime";
import { JsonLineSession } from "./backendSession";
import { validateV2NativeSelection, V2_NATIVE_COMMANDS } from "./v2NativeSelection";

const statusActions = [...V2_STATUS_COMMANDS, "task.status.undo"] as const;
export const V2_NATIVE_EDITOR_COMMANDS = ["task.create", "task.update", ...statusActions] as const;
const V2_BROWSER_EDITOR_COMMANDS = ["task.create", "task.update", ...V2_STATUS_COMMANDS] as const;
export type V2EditorMode = "content" | "status";
export type V2StatusAction = typeof statusActions[number];

export type V2EditorSelection = V2DevConnection & { readOnly: false; profilePath: string; writeCommands: readonly string[] };
export type V2EditBaseline = { writeContext: string; task: V2TaskProjection | null };
export type V2LiteralContent = Pick<V2TaskProjection, "title" | "description" | "priority" | "category" | "tags">;
export type V2EditResult = V2TaskExecutionResult | Pick<V2TaskPreviewResult, "task" | "changed">;

export class V2EditorError extends Error {
  constructor(readonly code: string, message: string) { super(`${code}: ${message}`); }
}

function validateEditorSelection(value: unknown, native = false): asserts value is V2EditorSelection {
  const allowed = native ? V2_NATIVE_EDITOR_COMMANDS : V2_BROWSER_EDITOR_COMMANDS;
  if (!isV2Record(value) || value.version !== 2 || value.readOnly !== false
    || typeof value.rootPath !== "string" || typeof value.databasePath !== "string" || typeof value.profilePath !== "string"
    || typeof value.selectionToken !== "string" || !value.selectionToken
    || !Array.isArray(value.writeCommands) || value.writeCommands.length !== allowed.length
    || value.writeCommands.some((command, index) => command !== allowed[index])) {
    throw new Error("This editor requires an explicitly enabled --v2-edit backend. No read-only or v1 fallback.");
  }
  validateV2Selection(value as V2EditorSelection);
  validateV2Selection({ rootPath: value.profilePath, databasePath: value.databasePath });
  if (native) validateV2NativeSelection(value as V2EditorSelection);
}

export async function readV2EditorSelection(url: string): Promise<V2EditorSelection> {
  const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Dev backend answered ${response.status}.`);
  const value: unknown = await response.json();
  if (!isV2Record(value) || value.ok !== true) throw new Error("The selected editor backend is unavailable.");
  validateEditorSelection(value);
  return value;
}

function editorResult(result: Record<string, unknown>, preview: boolean): V2EditResult {
  if (!preview) return parseV2TaskEditResult(result, "execution");
  const decoded = parseV2TaskEditResult(result, "preview");
  if (!decoded.dryRun || decoded.readOnly) throw new Error("v2 editor returned invalid preview flags; retain the original request.");
  return { task: decoded.task, changed: decoded.changed };
}

export class V2PreparedEdit {
  private readonly serialized: string;
  private readonly selection: V2EditorSelection;
  private attempted = false;
  private inFlight = false;

  constructor(private readonly connection: string | JsonLineSession<V2Response>, selection: V2EditorSelection, request: V2Request & { requestId: string }) {
    validateEditorSelection(selection, connection instanceof JsonLineSession);
    if (!selection.writeCommands.includes(request.command) || !request.writeContext || !request.idempotencyKey
      || typeof request.requestId !== "string" || !request.requestId
      || request.readOnly !== false || request.dryRun !== false || (request.command !== "task.create"
        && (!Number.isSafeInteger(request.args.expectedVersion) || (request.args.expectedVersion as number) < 1))) {
      throw new Error("Original executing context/key/correlation and positive existing-task version are required.");
    }
    this.serialized = JSON.stringify(request);
    this.selection = Object.freeze({ ...selection, writeCommands: Object.freeze([...selection.writeCommands]) });
  }

  get originalRequest(): string { return this.serialized; }
  get hasExecuted(): boolean { return this.attempted; }
  get retryMetadata(): string {
    const { command, writeContext, idempotencyKey, actor, readOnly, dryRun, args } = JSON.parse(this.serialized) as V2Request;
    return JSON.stringify({ command, rootPath: this.selection.rootPath, databasePath: this.selection.databasePath,
      profilePath: this.selection.profilePath, writeContext, idempotencyKey, expectedVersion: args.expectedVersion,
      actor, readOnly, dryRun });
  }

  async preview(): Promise<V2EditResult> {
    if (this.attempted) throw new Error("An executing request has already been sent; preview cannot renew uncertain authority.");
    return this.send(true);
  }

  async execute(): Promise<V2EditResult> { return this.send(false); }

  private async send(preview: boolean): Promise<V2EditResult> {
    if (runtimeKind() === "android" || (runtimeKind() !== "browser" && !(this.connection instanceof JsonLineSession))) throw new Error("Native editing requires the explicitly selected desktop session; no fallback was launched.");
    if (this.inFlight) throw new Error("The original request is already in flight.");
    this.inFlight = true;
    if (!preview) this.attempted = true;
    try {
      const request = JSON.parse(this.serialized) as V2Request & { requestId: string };
      if (preview) { delete request.idempotencyKey; request.dryRun = true; request.requestId = crypto.randomUUID(); }
      const response = this.connection instanceof JsonLineSession ? await this.connection.request(request) : await postV2DevRequest(this.connection, this.selection, request);
      if (response.requestId !== request.requestId) throw new Error("v2 editor returned a different request ID; retain the original request.");
      if (!response.ok) throw new V2EditorError(response.error.code, response.error.message);
      if (response.writeContext !== request.writeContext) throw new Error("v2 editor returned different authority; retain the original request.");
      const result = editorResult(response.result, preview);
      if (request.command !== "task.create" && result.task.id !== request.args.id) throw new Error("v2 editor returned another task; retain the original request.");
      return result;
    } finally { this.inFlight = false; }
  }
}

export class V2EditorClient {
  readonly selection: V2EditorSelection;
  constructor(private readonly connection: string | JsonLineSession<V2Response>, selection: V2EditorSelection) {
    if (runtimeKind() !== "browser" && !(connection instanceof JsonLineSession)) throw new Error("V2 app editing is browser-only; no native sidecar was launched.");
    if (runtimeKind() === "android") throw new Error("The native task editor is unavailable on Android.");
    validateEditorSelection(selection, connection instanceof JsonLineSession);
    this.selection = Object.freeze({ ...selection, writeCommands: Object.freeze([...selection.writeCommands]) });
  }

  async begin(taskId?: string, mode: V2EditorMode = "content"): Promise<V2EditBaseline> {
    if (mode !== "content" && mode !== "status") throw new Error("Unsupported editor mode; no query was sent.");
    if (mode === "status" && taskId === undefined) throw new Error("Select an existing task for this operation; no query was sent.");
    const info = await this.query("workspace.info", {});
    const workspace = parseV2WorkspaceInfo(info.result);
    if (this.connection instanceof JsonLineSession && JSON.stringify(workspace.commands) !== JSON.stringify(V2_NATIVE_COMMANDS)) throw new V2EditorError("UNSUPPORTED_COMMAND", "The selected native backend does not advertise the proven Windows command set; no mutation was sent.");
    const availableStatusCommands = this.connection instanceof JsonLineSession ? statusActions : V2_STATUS_COMMANDS;
    const commands = mode === "status" ? availableStatusCommands : [taskId === undefined ? "task.create" : "task.update"];
    if (workspace.state !== "ready") throw new V2EditorError(workspace.state === "recovery_pending" ? "RECOVERY_PENDING" : "UNSUPPORTED_SCHEMA", "A complete ready schema-2 collection is required; no initialization or recovery was performed.");
    if (commands.some(command => !workspace.commands.includes(command))) throw new V2EditorError("UNSUPPORTED_COMMAND", "This platform does not advertise the selected task operation.");
    if (taskId === undefined) return Object.freeze({ writeContext: info.writeContext, task: null });
    const response = await this.query("task.get", { id: taskId });
    if (response.writeContext !== info.writeContext) throw new V2EditorError("STALE_WRITE_CONTEXT", "Context changed during preparation; no mutation was sent.");
    const task = parseV2TaskProjection(response.result.task);
    if (task.id !== taskId) throw new Error("v2 editor returned another task; no mutation was sent.");
    for (const values of [task.tags, task.dependencyIds, task.blockedByIds]) Object.freeze(values);
    return Object.freeze({ writeContext: response.writeContext, task: Object.freeze(task) });
  }

  prepare(baseline: V2EditBaseline, content: V2LiteralContent): V2PreparedEdit {
    const args: Record<string, unknown> = { title: content.title };
    for (const field of ["description", "priority", "category", "tags"] as const) {
      if (!baseline.task || JSON.stringify(content[field]) !== JSON.stringify(baseline.task[field])) args[field] = content[field];
    }
    if (baseline.task) { args.id = baseline.task.id; args.expectedVersion = baseline.task.version; }
    return this.prepareTaskRequest(baseline, baseline.task ? "task.update" : "task.create", args);
  }

  prepareInline(baseline: V2EditBaseline, text: string, description: string, priority: V2TaskProjection["priority"], key: string): V2PreparedEdit {
    const args: Record<string, unknown> = { text, description, priority };
    if (baseline.task) { args.id = baseline.task.id; args.expectedVersion = baseline.task.version; }
    return this.prepareTaskRequest(baseline, baseline.task ? "task.update" : "task.create", args, key);
  }

  preparePriority(baseline: V2EditBaseline, priority: V2TaskProjection["priority"], key: string): V2PreparedEdit {
    if (!baseline.task) throw new Error("Select an existing task to change its priority.");
    return this.prepareTaskRequest(baseline, "task.update", { id: baseline.task.id, expectedVersion: baseline.task.version, priority }, key);
  }

  prepareStatus(baseline: V2EditBaseline, command: V2StatusAction, key: string = crypto.randomUUID()): V2PreparedEdit {
    if (!baseline.task || !statusActions.some(allowed => allowed === command)) throw new Error("An existing task and supported status command are required.");
    return this.prepareTaskRequest(baseline, command, { id: baseline.task.id, expectedVersion: baseline.task.version }, key);
  }

  private prepareTaskRequest(baseline: V2EditBaseline, command: string, args: Record<string, unknown>, key: string = crypto.randomUUID()): V2PreparedEdit {
    return new V2PreparedEdit(this.connection, this.selection, { version: 2, requestId: crypto.randomUUID(), command, args,
      writeContext: baseline.writeContext, idempotencyKey: key,
      actor: { kind: "human", label: "Tasks v2 editor" }, readOnly: false, dryRun: false });
  }

  private async query(command: string, args: Record<string, unknown>) {
    const request = { version: 2 as const, requestId: crypto.randomUUID(), command, args,
      actor: { kind: "human" as const, label: "Tasks v2 editor" }, readOnly: true, dryRun: false };
    const response = this.connection instanceof JsonLineSession ? await this.connection.request(request) : await postV2DevRequest(this.connection, this.selection, request);
    if (response.requestId !== request.requestId) throw new Error("v2 editor returned a different request ID.");
    if (!response.ok) throw new V2EditorError(response.error.code, response.error.message);
    return response;
  }
}
