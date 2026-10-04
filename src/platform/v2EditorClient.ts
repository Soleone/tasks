import { isV2Record, type V2Request } from "../backend/v2Protocol";
import type { V2TaskProjection } from "../backend/v2Queries";
import { parseV2TaskProjection, parseV2WorkspaceInfo, postV2DevRequest, validateV2Selection, type V2DevConnection } from "./v2BackendClient";
import { runtimeKind } from "./runtime";

export type V2EditorSelection = V2DevConnection & { readOnly: false; profilePath: string; writeCommands: readonly string[] };
export type V2EditBaseline = { writeContext: string; task: V2TaskProjection | null };
export type V2LiteralContent = Pick<V2TaskProjection, "title" | "description" | "priority" | "category" | "tags">;
export type V2EditResult = { task: V2TaskProjection; changed: boolean; operationId?: string };

export class V2EditorError extends Error {
  constructor(readonly code: string, message: string) { super(`${code}: ${message}`); }
}

function validateEditorSelection(value: unknown): asserts value is V2EditorSelection {
  if (!isV2Record(value) || value.version !== 2 || value.readOnly !== false
    || typeof value.rootPath !== "string" || typeof value.databasePath !== "string" || typeof value.profilePath !== "string"
    || typeof value.selectionToken !== "string" || !value.selectionToken
    || !Array.isArray(value.writeCommands) || value.writeCommands.length !== 2
    || value.writeCommands[0] !== "task.create" || value.writeCommands[1] !== "task.update") {
    throw new Error("This editor requires an explicitly enabled --v2-edit backend. No read-only or v1 fallback.");
  }
  validateV2Selection(value as V2EditorSelection);
  validateV2Selection({ rootPath: value.profilePath, databasePath: value.databasePath });
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
  if (typeof result.changed !== "boolean"
    || (result.operationId !== undefined && (typeof result.operationId !== "string" || !result.operationId))
    || (!preview && !result.changed && result.operationId !== undefined)
    || (preview ? result.dryRun !== true || result.readOnly !== false || result.operationId !== undefined
      : result.dryRun !== undefined || result.readOnly !== undefined || (result.changed && (typeof result.operationId !== "string" || !result.operationId)))) {
    throw new Error("v2 editor returned invalid mutation data; retain the original request.");
  }
  return { task: parseV2TaskProjection(result.task), changed: result.changed,
    ...(typeof result.operationId === "string" ? { operationId: result.operationId } : {}) };
}

export class V2PreparedEdit {
  private readonly serialized: string;
  private readonly selection: V2EditorSelection;
  private attempted = false;
  private inFlight = false;

  constructor(private readonly url: string, selection: V2EditorSelection, request: V2Request & { requestId: string }) {
    validateEditorSelection(selection);
    if (!["task.create", "task.update"].includes(request.command) || !request.writeContext || !request.idempotencyKey
      || typeof request.requestId !== "string" || !request.requestId
      || request.readOnly !== false || request.dryRun !== false || (request.command === "task.update"
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
    if (runtimeKind() !== "browser") throw new Error("V2 app editing is browser-only; no native sidecar was launched.");
    if (this.inFlight) throw new Error("The original request is already in flight.");
    this.inFlight = true;
    if (!preview) this.attempted = true;
    try {
      const request = JSON.parse(this.serialized) as V2Request & { requestId: string };
      if (preview) { delete request.idempotencyKey; request.dryRun = true; request.requestId = crypto.randomUUID(); }
      const response = await postV2DevRequest(this.url, this.selection, request);
      if (response.requestId !== request.requestId) throw new Error("v2 editor returned a different request ID; retain the original request.");
      if (!response.ok) throw new V2EditorError(response.error.code, response.error.message);
      if (response.writeContext !== request.writeContext) throw new Error("v2 editor returned different authority; retain the original request.");
      const result = editorResult(response.result, preview);
      if (request.command === "task.update" && result.task.id !== request.args?.id) throw new Error("v2 editor returned another task; retain the original request.");
      return result;
    } finally { this.inFlight = false; }
  }
}

export class V2EditorClient {
  readonly selection: V2EditorSelection;
  constructor(private readonly url: string, selection: V2EditorSelection) {
    if (runtimeKind() !== "browser") throw new Error("V2 app editing is browser-only; no native sidecar was launched.");
    validateEditorSelection(selection);
    this.selection = Object.freeze({ ...selection, writeCommands: Object.freeze([...selection.writeCommands]) });
  }

  async begin(taskId?: string): Promise<V2EditBaseline> {
    const info = await this.query("workspace.info", {});
    const workspace = parseV2WorkspaceInfo(info.result);
    const command = taskId === undefined ? "task.create" : "task.update";
    if (workspace.state !== "ready") throw new V2EditorError(workspace.state === "recovery_pending" ? "RECOVERY_PENDING" : "UNSUPPORTED_SCHEMA", "A complete ready schema-2 collection is required; no initialization or recovery was performed.");
    if (!workspace.commands.includes(command)) throw new V2EditorError("UNSUPPORTED_COMMAND", "This platform does not advertise the selected content operation.");
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
    return new V2PreparedEdit(this.url, this.selection, { version: 2, requestId: crypto.randomUUID(),
      command: baseline.task ? "task.update" : "task.create", args, writeContext: baseline.writeContext,
      idempotencyKey: crypto.randomUUID(), actor: { kind: "human", label: "Tasks v2 editor" }, readOnly: false, dryRun: false });
  }

  private async query(command: string, args: Record<string, unknown>) {
    const request = { version: 2 as const, requestId: crypto.randomUUID(), command, args,
      actor: { kind: "human" as const, label: "Tasks v2 editor" }, readOnly: true, dryRun: false };
    const response = await postV2DevRequest(this.url, this.selection, request);
    if (response.requestId !== request.requestId) throw new Error("v2 editor returned a different request ID.");
    if (!response.ok) throw new V2EditorError(response.error.code, response.error.message);
    return response;
  }
}
