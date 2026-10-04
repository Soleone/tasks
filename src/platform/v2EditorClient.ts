import { isV2Record, type V2Request } from "../backend/v2Protocol";
import type { V2TaskProjection } from "../backend/v2Queries";
import { V2_STATUS_COMMANDS } from "../backend/v2TaskStatus";
import { parseV2TaskEditResult, parseV2TaskProjection, type V2TaskExecutionResult, type V2TaskPreviewResult } from "../backend/v2TaskResults";
import { parseV2TaskPage, parseV2WorkspaceInfo, postV2DevRequest, validateV2Selection, type V2DevConnection } from "./v2BackendClient";
import { runtimeKind } from "./runtime";

const statusActions = [...V2_STATUS_COMMANDS, "task.status.undo"] as const;
const editorCommands = ["task.create", "task.update", ...statusActions, "task.move"];
export type V2EditorMode = "content" | "status" | "parent";
export type V2StatusAction = typeof statusActions[number];

export type V2EditorSelection = V2DevConnection & { readOnly: false; profilePath: string; writeCommands: readonly string[] };
export type V2EditBaseline = { writeContext: string; task: V2TaskProjection | null };
export type V2LiteralContent = Pick<V2TaskProjection, "title" | "description" | "priority" | "category" | "tags">;
export type V2EditResult = V2TaskExecutionResult | Pick<V2TaskPreviewResult, "task" | "changed">;

export class V2EditorError extends Error {
  constructor(readonly code: string, message: string) { super(`${code}: ${message}`); }
}

function validateEditorSelection(value: unknown): asserts value is V2EditorSelection {
  if (!isV2Record(value) || value.version !== 2 || value.readOnly !== false
    || typeof value.rootPath !== "string" || typeof value.databasePath !== "string" || typeof value.profilePath !== "string"
    || typeof value.selectionToken !== "string" || !value.selectionToken
    || !Array.isArray(value.writeCommands) || value.writeCommands.length !== editorCommands.length
    || value.writeCommands.some((command, index) => command !== editorCommands[index])) {
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

  constructor(private readonly url: string, selection: V2EditorSelection, request: V2Request & { requestId: string }) {
    validateEditorSelection(selection);
    if (!editorCommands.includes(request.command) || !request.writeContext || !request.idempotencyKey
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
      if (request.command !== "task.create" && result.task.id !== request.args.id) throw new Error("v2 editor returned another task; retain the original request.");
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

  async begin(taskId?: string, mode: V2EditorMode = "content"): Promise<V2EditBaseline> {
    if (mode !== "content" && taskId === undefined) throw new Error("Select an existing task for this operation; no query was sent.");
    const info = await this.query("workspace.info", {});
    const workspace = parseV2WorkspaceInfo(info.result);
    const commands = mode === "status" ? statusActions : [mode === "parent" ? "task.move" : taskId === undefined ? "task.create" : "task.update"];
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

  prepareStatus(baseline: V2EditBaseline, command: V2StatusAction): V2PreparedEdit {
    if (!baseline.task || !statusActions.some(allowed => allowed === command)) throw new Error("An existing task and supported status command are required.");
    return this.prepareTaskRequest(baseline, command, { id: baseline.task.id, expectedVersion: baseline.task.version });
  }

  prepareParent(baseline: V2EditBaseline, parentId: string | null): V2PreparedEdit {
    if (!baseline.task || (parentId !== null && (typeof parentId !== "string" || !/^[A-Za-z0-9_-]+$/.test(parentId)))) throw new Error("An existing task and safe parent ID or explicit root are required.");
    return this.prepareTaskRequest(baseline, "task.move", { id: baseline.task.id, expectedVersion: baseline.task.version, parentId });
  }

  async parentCandidates(baseline: V2EditBaseline, search = "", offset = 0) {
    if (!baseline.task || typeof search !== "string" || !Number.isSafeInteger(offset) || offset < 0) throw new Error("An existing task and valid parent search/page are required; no query was sent.");
    const response = await this.query("task.list", { ...(search.trim() ? { search } : {}), offset, limit: 50, sort: "manual", includeAncestors: false, status: ["open", "in_progress", "paused", "done"] });
    if (response.writeContext !== baseline.writeContext) throw new V2EditorError("STALE_WRITE_CONTEXT", "Context changed during parent search; original authority was not refreshed.");
    const page = parseV2TaskPage({ ...response.result, contextTasks: response.result.contextTasks === undefined ? [] : response.result.contextTasks });
    if (page.offset !== offset || page.limit !== 50 || page.tasks.some(task => task.status === "canceled")) throw new Error("v2 backend returned invalid parent candidates; no fallback.");
    return page;
  }

  private prepareTaskRequest(baseline: V2EditBaseline, command: string, args: Record<string, unknown>): V2PreparedEdit {
    return new V2PreparedEdit(this.url, this.selection, { version: 2, requestId: crypto.randomUUID(), command, args,
      writeContext: baseline.writeContext, idempotencyKey: crypto.randomUUID(),
      actor: { kind: "human", label: "Tasks v2 editor" }, readOnly: false, dryRun: false });
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
