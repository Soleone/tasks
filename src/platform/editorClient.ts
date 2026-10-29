import { randomUUID } from "../lib/randomUUID";
import {
  isRecord,
  type TaskReorderPlacement,
  type Request,
  type Response,
} from "../backend/protocol";
import type { TaskProjection } from "../backend/queries";
import { attachmentName } from "../backend/taskModel";
import { STATUS_COMMANDS } from "../backend/taskStatus";
import { EDITOR_COMMANDS } from "../backend/editorCommands";
import { RELATIONSHIP_COMMANDS } from "../backend/taskRelationships";
import {
  parseTaskEditResult,
  parseTaskProjection,
  type TaskExecutionResult,
  type TaskPreviewResult,
} from "../backend/taskResults";
import {
  parseWorkspaceInfo,
  postDevRequest,
  validateSelection,
  type DevConnection,
} from "./workspaceReader";
import { runtimeKind } from "./runtime";
import { JsonLineSession } from "./backendSession";

const statusActions = [...STATUS_COMMANDS, "task.status.undo"] as const;
export type EditorMode = "content" | "status" | "relationship" | "order" | "operation" | "batch";
export type StatusAction = (typeof statusActions)[number];
export type RelationshipAction = (typeof RELATIONSHIP_COMMANDS)[number];

export type EditorSelection = DevConnection & {
  readOnly: false;
  profilePath: string;
  writeCommands: readonly string[];
};
export type EditBaseline = { writeContext: string; task: TaskProjection | null };
export type LiteralContent = Pick<
  TaskProjection,
  "title" | "description" | "priority" | "category" | "tags"
>;
/** A one-key change from the list: a new priority or a new effort. */
export type LevelChange = Pick<TaskProjection, "priority"> | Pick<TaskProjection, "effort">;
export type InlineDraft = Pick<TaskProjection, "description" | "priority" | "attachments"> & {
  text: string;
};
export type EditResult = TaskExecutionResult | Pick<TaskPreviewResult, "task" | "changed">;
export type OrderResult = { tasks: TaskProjection[]; changed: boolean; operationId?: string };
export type UndoResult = OrderResult & { removedIds: string[] };
type GroupResult = EditResult | OrderResult | UndoResult;

export class EditorError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(`${code}: ${message}`);
  }
}

/** A validated, correlated backend refusal, not a local or transport failure. */
export class AnsweredRefusal extends EditorError {}

function validateEditorSelection(value: unknown): asserts value is EditorSelection {
  const commands: readonly string[] = EDITOR_COMMANDS;
  if (
    !isRecord(value) ||
    value.version !== 2 ||
    value.readOnly !== false ||
    typeof value.rootPath !== "string" ||
    typeof value.databasePath !== "string" ||
    typeof value.profilePath !== "string" ||
    typeof value.selectionToken !== "string" ||
    !value.selectionToken ||
    !Array.isArray(value.writeCommands) ||
    value.writeCommands.length !== commands.length ||
    value.writeCommands.some((command, index) => command !== commands[index])
  ) {
    throw new Error("This editor requires a dev bridge started with --home.");
  }
  validateSelection(value as EditorSelection);
  validateSelection({ rootPath: value.profilePath, databasePath: value.databasePath });
}

export async function readEditorSelection(url: string): Promise<EditorSelection> {
  const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Dev backend answered ${response.status}.`);
  const value: unknown = await response.json();
  if (!isRecord(value) || value.ok !== true)
    throw new Error("The selected editor backend is unavailable.");
  validateEditorSelection(value);
  return value;
}

/** Manual reorder and status batches return the selected tasks in request order. */
function groupResult(
  value: Record<string, unknown>,
  request: Request,
  preview: boolean,
): OrderResult {
  const ids = (request.args.tasks as { id: string }[]).map((task) => task.id);
  if (
    !Array.isArray(value.tasks) ||
    typeof value.changed !== "boolean" ||
    (preview
      ? value.dryRun !== true || value.readOnly !== false || value.operationId !== undefined
      : value.readOnly !== undefined ||
        value.dryRun !== undefined ||
        (value.changed
          ? typeof value.operationId !== "string" || !value.operationId
          : value.operationId !== undefined))
  ) {
    throw new Error("The editor returned an invalid group result; retain the original request.");
  }
  const tasks = value.tasks.map(parseTaskProjection);
  if (tasks.length !== ids.length || tasks.some((task, index) => task.id !== ids[index]))
    throw new Error("The editor returned other tasks; retain the original request.");
  return {
    tasks,
    changed: value.changed,
    ...(!preview && value.changed ? { operationId: value.operationId as string } : {}),
  };
}

function undoResult(value: Record<string, unknown>, preview: boolean): UndoResult {
  const removedIds = value.removedIds ?? [];
  if (
    !Array.isArray(value.tasks) ||
    typeof value.changed !== "boolean" ||
    (preview
      ? value.dryRun !== true || value.readOnly !== false || value.operationId !== undefined
      : value.dryRun !== undefined ||
        value.readOnly !== undefined ||
        (value.changed
          ? typeof value.operationId !== "string" || !value.operationId
          : value.operationId !== undefined)) ||
    !Array.isArray(removedIds) ||
    removedIds.some((id) => typeof id !== "string" || !id) ||
    (value.recoveryLocation !== undefined && typeof value.recoveryLocation !== "string")
  ) {
    throw new Error("The editor returned an invalid undo result; retain the original request.");
  }
  return {
    tasks: value.tasks.map(parseTaskProjection),
    changed: value.changed,
    removedIds,
    ...(!preview && value.changed ? { operationId: value.operationId as string } : {}),
  };
}

function editorResult(result: Record<string, unknown>, preview: boolean): EditResult {
  if (!preview) return parseTaskEditResult(result, "execution");
  const decoded = parseTaskEditResult(result, "preview");
  if (!decoded.dryRun || decoded.readOnly)
    throw new Error("The editor returned invalid preview flags; retain the original request.");
  return { task: decoded.task, changed: decoded.changed };
}

function hasExpectedVersions(request: Request): boolean {
  const positive = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 1;
  if (request.command === "task.create") return true;
  if (request.command === "operation.undo" || request.command === "operation.redo")
    return typeof request.args.operationId === "string" && request.args.operationId !== "";
  if (request.command !== "task.reorder" && request.command !== "task.transitionMany")
    return positive(request.args.expectedVersion);
  return (
    Array.isArray(request.args.tasks) &&
    request.args.tasks.length > 0 &&
    request.args.tasks.every(
      (task) => isRecord(task) && typeof task.id === "string" && positive(task.expectedVersion),
    )
  );
}

/** Keeps the original executing envelope immutable across previews and retries. */
export class PreparedEdit<R extends GroupResult = EditResult> {
  private readonly serialized: string;
  private readonly selection: EditorSelection;
  private attempted = false;
  private inFlight = false;

  constructor(
    private readonly connection: string | JsonLineSession<Response>,
    selection: EditorSelection,
    request: Request & { requestId: string },
  ) {
    validateEditorSelection(selection);
    if (
      !selection.writeCommands.includes(request.command) ||
      !request.writeContext ||
      !request.idempotencyKey ||
      typeof request.requestId !== "string" ||
      !request.requestId ||
      request.readOnly !== false ||
      request.dryRun !== false ||
      !hasExpectedVersions(request)
    ) {
      throw new Error(
        "Original executing context/key/correlation and valid operation inputs are required.",
      );
    }
    this.serialized = JSON.stringify(request);
    this.selection = Object.freeze({
      ...selection,
      writeCommands: Object.freeze([...selection.writeCommands]),
    });
  }

  get originalRequest(): string {
    return this.serialized;
  }
  get hasExecuted(): boolean {
    return this.attempted;
  }
  get retryMetadata(): string {
    const { command, writeContext, idempotencyKey, actor, readOnly, dryRun, args } = JSON.parse(
      this.serialized,
    ) as Request;
    return JSON.stringify({
      command,
      rootPath: this.selection.rootPath,
      databasePath: this.selection.databasePath,
      profilePath: this.selection.profilePath,
      writeContext,
      idempotencyKey,
      expectedVersion: args.expectedVersion,
      tasks: args.tasks,
      operationId: args.operationId,
      sourceDirectory: args.sourceDirectory,
      destinationDirectory: args.destinationDirectory,
      actor,
      readOnly,
      dryRun,
    });
  }

  async preview(): Promise<R> {
    if (this.attempted)
      throw new Error(
        "An executing request has already been sent; preview cannot renew uncertain authority.",
      );
    return this.send(true);
  }

  async execute(): Promise<R> {
    return this.send(false);
  }

  private async send(preview: boolean): Promise<R> {
    if (runtimeKind() !== "browser" && !(this.connection instanceof JsonLineSession))
      throw new Error(
        "Native editing requires the explicitly selected desktop session; no fallback was launched.",
      );
    if (this.inFlight) throw new Error("The original request is already in flight.");
    this.inFlight = true;
    if (!preview) this.attempted = true;
    try {
      const request = JSON.parse(this.serialized) as Request & { requestId: string };
      if (preview) {
        delete request.idempotencyKey;
        request.dryRun = true;
        request.requestId = randomUUID();
      }
      const response =
        this.connection instanceof JsonLineSession
          ? await this.connection.request(request)
          : await postDevRequest(this.connection, this.selection, request);
      if (response.requestId !== request.requestId)
        throw new Error("The editor returned a different request ID; retain the original request.");
      if (!response.ok) throw new AnsweredRefusal(response.error.code, response.error.message);
      if (response.writeContext !== request.writeContext)
        throw new Error("The editor returned different authority; retain the original request.");
      if (request.command === "task.reorder" || request.command === "task.transitionMany")
        return groupResult(response.result, request, preview) as R;
      if (request.command === "operation.undo" || request.command === "operation.redo")
        return undoResult(response.result, preview) as R;
      const result = editorResult(response.result, preview);
      if (request.command !== "task.create" && result.task.id !== request.args.id)
        throw new Error("The editor returned another task; retain the original request.");
      return result as R;
    } finally {
      this.inFlight = false;
    }
  }
}

export class EditorClient {
  readonly selection: EditorSelection;
  constructor(
    private readonly connection: string | JsonLineSession<Response>,
    selection: EditorSelection,
  ) {
    if (runtimeKind() !== "browser" && !(connection instanceof JsonLineSession))
      throw new Error("App editing is browser-only; no native sidecar was launched.");
    validateEditorSelection(selection);
    this.selection = Object.freeze({
      ...selection,
      writeCommands: Object.freeze([...selection.writeCommands]),
    });
  }

  async begin(taskId?: string, mode: EditorMode = "content"): Promise<EditBaseline> {
    if (
      mode !== "content" &&
      mode !== "status" &&
      mode !== "relationship" &&
      mode !== "order" &&
      mode !== "operation" &&
      mode !== "batch"
    )
      throw new Error("Unsupported editor mode; no query was sent.");
    const grouped = mode === "operation" || mode === "batch";
    if (grouped ? taskId !== undefined : mode !== "content" && taskId === undefined)
      throw new Error(
        grouped
          ? "This workspace operation has no single task baseline; no query was sent."
          : "Select an existing task for this operation; no query was sent.",
      );
    if (taskId !== undefined) {
      // One round trip per edit: task.get already refuses a root that isn't ready.
      const response = await this.query("task.get", { id: taskId });
      const task = parseTaskProjection(response.result.task);
      if (task.id !== taskId)
        throw new Error("The editor returned another task; no mutation was sent.");
      for (const values of [task.tags, task.dependencyIds, task.blockedByIds])
        Object.freeze(values);
      return Object.freeze({ writeContext: response.writeContext, task: Object.freeze(task) });
    }
    const commands =
      mode === "operation"
        ? ["operation.undo"]
        : mode === "batch"
          ? ["task.transitionMany"]
          : ["task.create"];
    const info = await this.query("workspace.info", {});
    const workspace = parseWorkspaceInfo(info.result);
    if (workspace.state !== "ready")
      throw new EditorError(
        workspace.state === "recovery_pending" ? "RECOVERY_PENDING" : "UNSUPPORTED_SCHEMA",
        "A complete ready schema-2 collection is required; no initialization or recovery was performed.",
      );
    if (commands.some((command) => !workspace.commands.includes(command)))
      throw new EditorError(
        "UNSUPPORTED_COMMAND",
        "This platform does not advertise the selected task operation.",
      );
    return Object.freeze({ writeContext: info.writeContext, task: null });
  }

  prepare(baseline: EditBaseline, content: LiteralContent): PreparedEdit {
    const args: Record<string, unknown> = { title: content.title };
    for (const field of ["description", "priority", "category", "tags"] as const) {
      if (!baseline.task || JSON.stringify(content[field]) !== JSON.stringify(baseline.task[field]))
        args[field] = content[field];
    }
    if (baseline.task) {
      args.id = baseline.task.id;
      args.expectedVersion = baseline.task.version;
    }
    return this.prepareTaskRequest(baseline, baseline.task ? "task.update" : "task.create", args);
  }

  /** The editor's draft; `attachments` is sent only when it changes the task's list. */
  prepareInline(
    baseline: EditBaseline,
    draft: InlineDraft,
    key: string,
    parentId?: string,
  ): PreparedEdit {
    const { text, description, priority, attachments } = draft;
    const args: Record<string, unknown> = { text, description, priority };
    if (JSON.stringify(attachments) !== JSON.stringify(baseline.task?.attachments ?? []))
      args.attachments = attachments;
    if (baseline.task) {
      args.id = baseline.task.id;
      args.expectedVersion = baseline.task.version;
    }
    if (parentId !== undefined) {
      if (baseline.task)
        throw new Error(
          "A parent can only be chosen when capturing a new task; use move for existing tasks.",
        );
      args.parentId = parentId;
    }
    return this.prepareTaskRequest(
      baseline,
      baseline.task ? "task.update" : "task.create",
      args,
      key,
    );
  }

  prepareLevel(baseline: EditBaseline, change: LevelChange, key: string): PreparedEdit {
    if (!baseline.task) throw new Error("Select an existing task to change it.");
    return this.prepareTaskRequest(
      baseline,
      "task.update",
      { id: baseline.task.id, expectedVersion: baseline.task.version, ...change },
      key,
    );
  }

  prepareStatus(
    baseline: EditBaseline,
    command: StatusAction,
    key: string = randomUUID(),
  ): PreparedEdit {
    if (!baseline.task || !statusActions.some((allowed) => allowed === command))
      throw new Error("An existing task and supported status command are required.");
    return this.prepareTaskRequest(
      baseline,
      command,
      { id: baseline.task.id, expectedVersion: baseline.task.version },
      key,
    );
  }

  /** `target` is the new parent (null for top level) for moves, or the dependency for add/remove. */
  prepareRelationship(
    baseline: EditBaseline,
    command: RelationshipAction,
    target: string | null,
    key: string,
  ): PreparedEdit {
    if (
      !baseline.task ||
      !RELATIONSHIP_COMMANDS.some((allowed) => allowed === command) ||
      (target === null && command !== "task.move")
    ) {
      throw new Error("An existing task and supported relationship command are required.");
    }
    const relation = command === "task.move" ? { parentId: target } : { dependsOnId: target };
    return this.prepareTaskRequest(
      baseline,
      command,
      { id: baseline.task.id, expectedVersion: baseline.task.version, ...relation },
      key,
    );
  }

  /** `tasks` are the selected siblings in current order; the baseline is the first of them. */
  prepareReorder(
    baseline: EditBaseline,
    tasks: readonly { id: string; expectedVersion: number }[],
    placement: TaskReorderPlacement,
    key: string,
  ): PreparedEdit<OrderResult> {
    if (
      !baseline.task ||
      tasks[0]?.id !== baseline.task.id ||
      tasks[0].expectedVersion !== baseline.task.version
    ) {
      throw new Error("The selected tasks must start with the prepared task.");
    }
    return this.prepareTaskRequest(
      baseline,
      "task.reorder",
      {
        tasks: tasks.map(({ id, expectedVersion }) => ({ id, expectedVersion })),
        placement: { ...placement },
      },
      key,
    );
  }

  /** One all-or-refuse status batch; the gateway owns transition eligibility and full-batch validation. */
  prepareTransitionMany(
    baseline: EditBaseline,
    tasks: readonly { id: string; expectedVersion: number; command: string }[],
    key: string,
  ): PreparedEdit<OrderResult> {
    if (baseline.task || tasks.length === 0)
      throw new Error("A nonempty status batch without a single task baseline is required.");
    return this.prepareTaskRequest(
      baseline,
      "task.transitionMany",
      {
        tasks: tasks.map(({ id, expectedVersion, command }) => ({ id, expectedVersion, command })),
      },
      key,
    );
  }

  /** Undo of one recorded local operation; the gateway owns history eligibility and conflict checks. */
  prepareOperationUndo(
    baseline: EditBaseline,
    operationId: string,
    key: string,
  ): PreparedEdit<UndoResult> {
    if (baseline.task || !operationId)
      throw new Error("An operation ID without a task baseline is required.");
    return this.prepareTaskRequest(baseline, "operation.undo", { operationId }, key);
  }

  prepareOperationRedo(
    baseline: EditBaseline,
    operationId: string,
    key: string,
  ): PreparedEdit<UndoResult> {
    if (baseline.task || !operationId)
      throw new Error("An operation ID without a task baseline is required.");
    return this.prepareTaskRequest(baseline, "operation.redo", { operationId }, key);
  }

  private prepareTaskRequest<R extends GroupResult = EditResult>(
    baseline: EditBaseline,
    command: string,
    args: Record<string, unknown>,
    key: string = randomUUID(),
  ): PreparedEdit<R> {
    return new PreparedEdit<R>(this.connection, this.selection, {
      version: 2,
      requestId: randomUUID(),
      command,
      args,
      writeContext: baseline.writeContext,
      idempotencyKey: key,
      actor: { kind: "human", label: "Tasks editor" },
      readOnly: false,
      dryRun: false,
    });
  }

  /** Reads or saves one of the home's own documents; these need no write authority. */
  async homeCommand(
    command: "home.document.read" | "home.document.write",
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return (await this.query(command, args)).result;
  }

  /** One image's bytes as base64; `ATTACHMENT_NOT_FOUND` when the file isn't on this device. */
  async readAttachment(name: string): Promise<{ type: string; data: string }> {
    const { result } = await this.query("attachment.read", { name });
    if (typeof result.type !== "string" || typeof result.data !== "string")
      throw new Error("The editor returned an invalid image.");
    return { type: result.type, data: result.data };
  }

  /**
   * Stores one image and returns its name. A lost reply leaves at most a file no task lists, which
   * cleanup removes, so this is never reconciled like a task write.
   */
  async writeAttachment(type: string, data: string): Promise<string> {
    const { writeContext } = await this.begin();
    const { result } = await this.query(
      "attachment.write",
      { type, data },
      { writeContext, idempotencyKey: randomUUID(), readOnly: false },
    );
    if (typeof result.name !== "string" || !attachmentName.test(result.name))
      throw new Error("The editor returned an invalid image name.");
    return result.name;
  }

  /**
   * Purges canceled tasks or clears done ones, or previews that. Like an image write it sends one
   * request with a fresh key: repeating it after a lost reply finds less to remove, never more.
   */
  async remove(
    command: "task.purgeCanceled" | "task.clearDone",
    args: Record<string, unknown>,
    preview: boolean,
  ): Promise<Record<string, unknown>> {
    const { writeContext } = await this.begin();
    const { result } = await this.query(command, args, {
      writeContext,
      idempotencyKey: randomUUID(),
      readOnly: false,
      dryRun: preview,
    });
    return result;
  }

  private async query(
    command: string,
    args: Record<string, unknown>,
    write?: { writeContext: string; idempotencyKey: string; readOnly: false; dryRun?: boolean },
  ) {
    const request = {
      version: 2 as const,
      requestId: randomUUID(),
      command,
      args,
      actor: { kind: "human" as const, label: "Tasks editor" },
      readOnly: true,
      dryRun: false,
      ...write,
    };
    const response =
      this.connection instanceof JsonLineSession
        ? await this.connection.request(request)
        : await postDevRequest(this.connection, this.selection, request);
    if (response.requestId !== request.requestId)
      throw new Error("The editor returned a different request ID.");
    if (!response.ok)
      throw new EditorError(response.error.code, response.error.message, response.error.details);
    return response;
  }
}
