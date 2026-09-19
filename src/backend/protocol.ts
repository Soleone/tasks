import type { ThemeMode, ThemePalette } from "./themePalette.js";

export type { ThemeMode, ThemePalette };

export const PROTOCOL_VERSION = 1 as const;

export const COMMAND_NAMES = [
  "runtime.probe",
  "task.create",
  "task.list",
  "task.reorder",
  "task.transitionMany",
  "task.status.undoMany",
  "category.list",
  "tag.list",
  "task.get",
  "task.update",
  "task.delete",
  "task.purgeCanceled",
  "task.start",
  "task.pause",
  "task.complete",
  "task.reopen",
  "task.cancel",
  "task.status.undo",
  "task.move",
  "task.dependency.add",
  "task.dependency.remove",
  "activity.list",
  "workspace.info",
  "workspace.backup",
  "workspace.export",
  "workspace.exportTasks",
  "workspace.restore",
  "workspace.rebuild",
  "workspace.archive",
  "workspace.sync",
  "workspace.conflict.list",
  "workspace.conflict.resolve",
  "workspace.receive.prepare",
  "workspace.receive.status",
  "workspace.receive.abort",
  "theme.list",
  "theme.set",
] as const;

export type CommandName = (typeof COMMAND_NAMES)[number];
export type TaskStatus = "open" | "in_progress" | "paused" | "done" | "canceled";
export type TaskTransitionCommand = "task.start" | "task.pause" | "task.complete" | "task.reopen" | "task.cancel" | "task.delete";
export type TaskTransitionItem = { id: string; expectedVersion: number; command: TaskTransitionCommand };
export type TaskStatusUndoItem = { id: string; expectedVersion: number };
export type TaskPriority = 0 | 1 | 2 | 3 | 4;
export type ActorKind = "human" | "agent" | "system";
export type TaskListSort = "created" | "updated" | "priority" | "manual";
export type TaskReorderTask = { id: string; expectedVersion: number };
export type TaskReorderPlacement =
  | { beforeId: string }
  | { afterId: string }
  | { first: true }
  | { last: true };
export type TaskReorderArgs = {
  tasks: TaskReorderTask[];
  placement: TaskReorderPlacement;
};
export type ThemeSource = "builtin" | "workspace" | "omarchy";

/** Product-facing category entries backed by the task text's @category values. */
export type CategoryRecord = {
  slug: string;
  label: string;
  taskCount: number;
};

/** Product-facing tag entries backed by the task text's #tag values. */
export type TagRecord = {
  slug: string;
  label: string;
  taskCount: number;
};

export type Actor = {
  kind: ActorKind;
  label: string;
};

export type ProtocolRequest = {
  version: typeof PROTOCOL_VERSION;
  requestId: string;
  command: CommandName;
  args: Record<string, unknown>;
  actor: Actor;
  idempotencyKey?: string;
  readOnly?: boolean;
  dryRun?: boolean;
};

export type RuntimeProbeRequest = ProtocolRequest & { command: "runtime.probe" };

export type ClassificationToken = {
  slug: string;
  label: string;
};

export type TaskRecord = {
  id: string;
  title: string;
  descriptionMarkdown: string;
  status: TaskStatus;
  priority: TaskPriority;
  category: ClassificationToken | null;
  tags: ClassificationToken[];
  parentId: string | null;
  /** Direct dependency links, including canceled targets, for editing and history. */
  dependencyIds: string[];
  /** Direct dependencies that currently block this task. Canceled targets are omitted. */
  blockedByIds: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  canceledAt: string | null;
};

/** Identifier of the portable JSON file written by `workspace.exportTasks`. */
export const TASKS_EXPORT_FORMAT = "tasks.tasks-export" as const;
export const TASKS_EXPORT_FORMAT_VERSION = 2 as const;

/**
 * One task in the portable export. Slugs are what the user typed as
 * `@category` and `#tag`, so they travel better than display labels, and
 * internal concurrency state such as `version` is left out.
 */
export type TaskExportRecord = {
  id: string;
  /** Stable zero-based order within the task's parent sibling scope. */
  siblingOrder: number;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  category: string | null;
  tags: string[];
  parentId: string | null;
  blockedByIds: string[];
  notesMarkdown: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  canceledAt: string | null;
};

/** The readable JSON file `workspace.exportTasks` writes beside the database. */
export type TasksExportFile = {
  format: typeof TASKS_EXPORT_FORMAT;
  formatVersion: typeof TASKS_EXPORT_FORMAT_VERSION;
  exportedAt: string;
  taskCount: number;
  tasks: TaskExportRecord[];
};

export type ActivityRecord = {
  seq: number;
  taskId: string;
  requestId: string;
  action: string;
  actor: Actor;
  createdAt: string;
  details: Record<string, unknown>;
};

export type RuntimeProbeResult = {
  databasePath: string;
  nodeVersion: string;
  sqliteVersion: string;
  journalMode: string;
  fts5Enabled: boolean;
  searchMatches: number;
  probeValue: string;
};

/** A theme the workspace can select. `system` mode follows the OS appearance. */
export type ThemeRecord = {
  name: string;
  label: string;
  mode: ThemeMode;
  source: ThemeSource;
  /** Resolved palette slots to colors; empty slots fall back to the stylesheet ramp. */
  palette: ThemePalette;
  warnings: string[];
};

export type SuccessResponse = {
  version: typeof PROTOCOL_VERSION;
  requestId: string;
  ok: true;
  result: Record<string, unknown>;
};

export type ErrorResponse = {
  version: typeof PROTOCOL_VERSION;
  requestId: string;
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

export type ProtocolResponse = SuccessResponse | ErrorResponse;

export class ProtocolError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ProtocolError("INVALID_REQUEST", `${field} must be a non-empty string`);
  }

  return value;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new ProtocolError("INVALID_REQUEST", `${field} must be a boolean`);
  }
  return value;
}

function parseActor(value: unknown): Actor {
  if (value === undefined) {
    return { kind: "agent", label: "cli" };
  }
  if (!isRecord(value)) {
    throw new ProtocolError("INVALID_REQUEST", "actor must be an object");
  }

  const kind = requiredString(value.kind, "actor.kind");
  if (kind !== "human" && kind !== "agent" && kind !== "system") {
    throw new ProtocolError("INVALID_REQUEST", "actor.kind must be human, agent, or system");
  }

  return { kind, label: requiredString(value.label, "actor.label") };
}

function parseTaskReorderId(value: unknown, field: string): string {
  return requiredString(value, field);
}

export function parseTaskReorderArgs(value: unknown): TaskReorderArgs {
  if (!isRecord(value)) {
    throw new ProtocolError("INVALID_REQUEST", "task.reorder args must be an object");
  }
  if (!Array.isArray(value.tasks) || value.tasks.length === 0) {
    throw new ProtocolError("INVALID_REQUEST", "task.reorder tasks must be a non-empty array");
  }

  const seen = new Set<string>();
  const tasks = value.tasks.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new ProtocolError("INVALID_REQUEST", `task.reorder tasks[${index}] must be an object`);
    }
    const id = parseTaskReorderId(entry.id, `task.reorder tasks[${index}].id`);
    if (seen.has(id)) {
      throw new ProtocolError("INVALID_REQUEST", "task.reorder tasks must not contain duplicate ids");
    }
    seen.add(id);
    if (typeof entry.expectedVersion !== "number" || !Number.isInteger(entry.expectedVersion) || entry.expectedVersion < 1) {
      throw new ProtocolError("INVALID_REQUEST", `task.reorder tasks[${index}].expectedVersion must be a positive integer`);
    }
    return { id, expectedVersion: entry.expectedVersion };
  });

  if (!isRecord(value.placement)) {
    throw new ProtocolError("INVALID_REQUEST", "task.reorder placement must be an object");
  }
  const placementKeys = Object.keys(value.placement);
  if (placementKeys.length !== 1 || !["beforeId", "afterId", "first", "last"].includes(placementKeys[0] ?? "")) {
    throw new ProtocolError("INVALID_REQUEST", "task.reorder placement must specify exactly one of beforeId, afterId, first, or last");
  }
  const placementKey = placementKeys[0] as "beforeId" | "afterId" | "first" | "last";
  if (placementKey === "beforeId" || placementKey === "afterId") {
    const id = parseTaskReorderId(value.placement[placementKey], `task.reorder placement.${placementKey}`);
    return { tasks, placement: { [placementKey]: id } as TaskReorderPlacement };
  }
  if (value.placement[placementKey] !== true) {
    throw new ProtocolError("INVALID_REQUEST", `task.reorder placement.${placementKey} must be true`);
  }
  return { tasks, placement: { [placementKey]: true } as TaskReorderPlacement };
}

export type TaskTransitionManyArgs = { tasks: TaskTransitionItem[] };
export type TaskStatusUndoManyArgs = { tasks: TaskStatusUndoItem[] };

function parseExpectedVersion(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new ProtocolError("INVALID_REQUEST", `${field} must be a positive integer`);
  }
  return value;
}

export function parseTaskTransitionManyArgs(value: unknown): TaskTransitionManyArgs {
  if (!isRecord(value) || !Array.isArray(value.tasks) || value.tasks.length === 0) {
    throw new ProtocolError("INVALID_REQUEST", "task.transitionMany tasks must be a non-empty array");
  }
  const seen = new Set<string>();
  const tasks = value.tasks.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new ProtocolError("INVALID_REQUEST", `task.transitionMany tasks[${index}] must be an object`);
    }
    const id = requiredString(entry.id, `task.transitionMany tasks[${index}].id`);
    if (seen.has(id)) {
      throw new ProtocolError("INVALID_REQUEST", "task.transitionMany tasks must not contain duplicate ids");
    }
    seen.add(id);
    const command = entry.command;
    if (command !== "task.start" && command !== "task.pause" && command !== "task.complete" && command !== "task.reopen" && command !== "task.cancel" && command !== "task.delete") {
      throw new ProtocolError("INVALID_REQUEST", `task.transitionMany tasks[${index}].command is unsupported`);
    }
    return {
      id,
      expectedVersion: parseExpectedVersion(entry.expectedVersion, `task.transitionMany tasks[${index}].expectedVersion`),
      command: command as TaskTransitionCommand,
    };
  });
  return { tasks };
}

export function parseTaskStatusUndoManyArgs(value: unknown): TaskStatusUndoManyArgs {
  if (!isRecord(value) || !Array.isArray(value.tasks) || value.tasks.length === 0) {
    throw new ProtocolError("INVALID_REQUEST", "task.status.undoMany tasks must be a non-empty array");
  }
  const seen = new Set<string>();
  const tasks = value.tasks.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new ProtocolError("INVALID_REQUEST", `task.status.undoMany tasks[${index}] must be an object`);
    }
    const id = requiredString(entry.id, `task.status.undoMany tasks[${index}].id`);
    if (seen.has(id)) {
      throw new ProtocolError("INVALID_REQUEST", "task.status.undoMany tasks must not contain duplicate ids");
    }
    seen.add(id);
    return {
      id,
      expectedVersion: parseExpectedVersion(entry.expectedVersion, `task.status.undoMany tasks[${index}].expectedVersion`),
    };
  });
  return { tasks };
}

export function parseRequest(value: unknown): ProtocolRequest {
  if (!isRecord(value)) {
    throw new ProtocolError("INVALID_REQUEST", "request must be a JSON object");
  }

  if (value.version !== PROTOCOL_VERSION) {
    throw new ProtocolError("UNSUPPORTED_VERSION", `protocol version must be ${PROTOCOL_VERSION}`);
  }

  const requestId = requiredString(value.requestId, "requestId");
  if (requestId.length > 128) {
    throw new ProtocolError("INVALID_REQUEST", "requestId must be 128 characters or fewer");
  }

  if (typeof value.command !== "string" || !COMMAND_NAMES.includes(value.command as CommandName)) {
    throw new ProtocolError("UNKNOWN_COMMAND", "command is not supported");
  }

  const args = value.args === undefined ? {} : value.args;
  if (!isRecord(args)) {
    throw new ProtocolError("INVALID_REQUEST", "args must be a JSON object");
  }

  if (value.command === "runtime.probe" && Object.keys(args).length > 0) {
    throw new ProtocolError("INVALID_REQUEST", "runtime.probe does not accept arguments");
  }
  if (value.command === "task.list" && args.sort !== undefined
    && args.sort !== "created" && args.sort !== "updated" && args.sort !== "priority" && args.sort !== "manual") {
    throw new ProtocolError("INVALID_REQUEST", "task.list sort must be created, updated, priority, or manual");
  }
  if (value.command === "task.reorder") {
    parseTaskReorderArgs(args);
  }
  if (value.command === "task.transitionMany") {
    parseTaskTransitionManyArgs(args);
  }
  if (value.command === "task.status.undoMany") {
    parseTaskStatusUndoManyArgs(args);
  }

  const idempotencyKey = value.idempotencyKey === undefined ? undefined : requiredString(value.idempotencyKey, "idempotencyKey");
  if (idempotencyKey !== undefined && idempotencyKey.length > 128) {
    throw new ProtocolError("INVALID_REQUEST", "idempotencyKey must be 128 characters or fewer");
  }

  return {
    version: PROTOCOL_VERSION,
    requestId,
    command: value.command as CommandName,
    args,
    actor: parseActor(value.actor),
    idempotencyKey,
    readOnly: optionalBoolean(value.readOnly, "readOnly"),
    dryRun: optionalBoolean(value.dryRun, "dryRun"),
  };
}

export function parseLine(line: string): ProtocolRequest {
  try {
    return parseRequest(JSON.parse(line));
  } catch (error) {
    if (error instanceof ProtocolError) {
      throw error;
    }

    throw new ProtocolError("INVALID_JSON", "request must contain valid JSON");
  }
}

function responseString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ProtocolError("INVALID_RESPONSE", `${field} must be a non-empty string`);
  }

  return value;
}

function responseNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ProtocolError("INVALID_RESPONSE", `${field} must be a finite number`);
  }

  return value;
}

function responseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new ProtocolError("INVALID_RESPONSE", `${field} must be a boolean`);
  }

  return value;
}

export function parseResponse(value: unknown): ProtocolResponse {
  if (!isRecord(value)) {
    throw new ProtocolError("INVALID_RESPONSE", "response must be a JSON object");
  }

  if (value.version !== PROTOCOL_VERSION) {
    throw new ProtocolError("UNSUPPORTED_VERSION", `protocol version must be ${PROTOCOL_VERSION}`);
  }

  const requestId = responseString(value.requestId, "requestId");
  if (value.ok === false && isRecord(value.error)) {
    return {
      version: PROTOCOL_VERSION,
      requestId,
      ok: false,
      error: {
        code: responseString(value.error.code, "error.code"),
        message: responseString(value.error.message, "error.message"),
      },
    };
  }

  if (value.ok === true && isRecord(value.result)) {
    return { version: PROTOCOL_VERSION, requestId, ok: true, result: value.result };
  }

  throw new ProtocolError("INVALID_RESPONSE", "response must contain a valid result or error");
}

export function parseRuntimeProbeResult(value: unknown): RuntimeProbeResult {
  if (!isRecord(value)) {
    throw new ProtocolError("INVALID_RESPONSE", "runtime probe result must be an object");
  }

  return {
    databasePath: responseString(value.databasePath, "result.databasePath"),
    nodeVersion: responseString(value.nodeVersion, "result.nodeVersion"),
    sqliteVersion: responseString(value.sqliteVersion, "result.sqliteVersion"),
    journalMode: responseString(value.journalMode, "result.journalMode"),
    fts5Enabled: responseBoolean(value.fts5Enabled, "result.fts5Enabled"),
    searchMatches: responseNumber(value.searchMatches, "result.searchMatches"),
    probeValue: responseString(value.probeValue, "result.probeValue"),
  };
}

export function successResponse(requestId: string, result: Record<string, unknown>): SuccessResponse {
  return {
    version: PROTOCOL_VERSION,
    requestId,
    ok: true,
    result,
  };
}

export function errorResponse(requestId: string, error: unknown): ErrorResponse {
  if (error instanceof ProtocolError) {
    return {
      version: PROTOCOL_VERSION,
      requestId,
      ok: false,
      error: { code: error.code, message: error.message },
    };
  }

  const message = error instanceof Error ? error.message : "unexpected backend error";
  const separator = message.indexOf(":");
  const code = separator > 0 && /^[A-Z_]+$/.test(message.slice(0, separator)) ? message.slice(0, separator) : "INTERNAL_ERROR";
  return {
    version: PROTOCOL_VERSION,
    requestId,
    ok: false,
    error: { code, message: separator > 0 ? message.slice(separator + 1).trim() : message },
  };
}
