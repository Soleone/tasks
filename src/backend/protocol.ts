export const PROTOCOL_VERSION = 1 as const;

export type RuntimeProbeRequest = {
  version: typeof PROTOCOL_VERSION;
  requestId: string;
  command: "runtime.probe";
  args?: Record<string, never>;
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
  result: RuntimeProbeResult;
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

export function parseRequest(value: unknown): RuntimeProbeRequest {
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

  if (value.command !== "runtime.probe") {
    throw new ProtocolError("UNKNOWN_COMMAND", "command must be runtime.probe");
  }

  if (value.args !== undefined && (!isRecord(value.args) || Object.keys(value.args).length > 0)) {
    throw new ProtocolError("INVALID_REQUEST", "runtime.probe does not accept arguments");
  }

  return {
    version: PROTOCOL_VERSION,
    requestId,
    command: "runtime.probe",
  };
}

export function parseLine(line: string): RuntimeProbeRequest {
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
    return {
      version: PROTOCOL_VERSION,
      requestId,
      ok: true,
      result: {
        databasePath: responseString(value.result.databasePath, "result.databasePath"),
        nodeVersion: responseString(value.result.nodeVersion, "result.nodeVersion"),
        sqliteVersion: responseString(value.result.sqliteVersion, "result.sqliteVersion"),
        journalMode: responseString(value.result.journalMode, "result.journalMode"),
        fts5Enabled: responseBoolean(value.result.fts5Enabled, "result.fts5Enabled"),
        searchMatches: responseNumber(value.result.searchMatches, "result.searchMatches"),
        probeValue: responseString(value.result.probeValue, "result.probeValue"),
      },
    };
  }

  throw new ProtocolError("INVALID_RESPONSE", "response must contain a valid result or error");
}

export function successResponse(requestId: string, result: RuntimeProbeResult): SuccessResponse {
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
  return {
    version: PROTOCOL_VERSION,
    requestId,
    ok: false,
    error: { code: "INTERNAL_ERROR", message },
  };
}
