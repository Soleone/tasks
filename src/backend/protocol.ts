export const PROTOCOL_VERSION = 1 as const;

export const COMMAND_NAMES = [
  "runtime.probe",
  "task.create",
  "task.list",
  "task.get",
  "task.update",
  "task.start",
  "task.complete",
  "task.reopen",
  "task.cancel",
  "activity.list",
  "workspace.backup",
  "workspace.export",
  "workspace.restore",
] as const;

export type CommandName = (typeof COMMAND_NAMES)[number];
export type TaskStatus = "open" | "in_progress" | "done" | "canceled";
export type ActorKind = "human" | "agent" | "system";

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
  category: ClassificationToken | null;
  tags: ClassificationToken[];
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  canceledAt: string | null;
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
