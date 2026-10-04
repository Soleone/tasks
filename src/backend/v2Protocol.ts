import { CommandError } from "./errors.js";
import { COMMAND_NAMES } from "./protocol.js";
import type { Actor } from "./protocol.js";
import { parseV2CanonicalJson } from "./v2CanonicalJson.js";

export type V2Request = {
  version: 2;
  requestId: string | null;
  command: string;
  args: Record<string, unknown>;
  actor: Actor;
  idempotencyKey?: string;
  writeContext?: string;
  readOnly: boolean;
  dryRun: boolean;
};
export type V2Response =
  | { version: 2; requestId: string | null; ok: true; writeContext: string; result: Record<string, unknown> }
  | { version: 2; requestId: string | null; ok: false; error: { code: string; message: string; details?: Record<string, unknown> } };

export function parseV2Response(value: unknown): V2Response {
  if (!isV2Record(value) || value.version !== 2
    || (value.requestId !== null && typeof value.requestId !== "string")) {
    throw new Error("backend did not return a protocol-2 response");
  }
  const fields = value.ok === true
    ? ["version", "requestId", "ok", "writeContext", "result"]
    : ["version", "requestId", "ok", "error"];
  if (Object.keys(value).some(field => !fields.includes(field))) {
    throw new Error("backend returned unexpected protocol-2 response fields");
  }
  if (value.ok === true && typeof value.writeContext === "string" && value.writeContext.trim() !== "" && isV2Record(value.result)) {
    return value as V2Response;
  }
  if (value.ok === false && isV2Record(value.error)
    && typeof value.error.code === "string" && value.error.code !== ""
    && typeof value.error.message === "string"
    && (value.error.details === undefined || isV2Record(value.error.details))
    && Object.keys(value.error).every(field => ["code", "message", "details"].includes(field))) {
    return value as V2Response;
  }
  throw new Error("backend returned an invalid protocol-2 response");
}

export const V2_QUERY_COMMANDS = ["category.list", "tag.list", "task.get", "task.list", "workspace.info"] as const;
const knownCommands = new Set<string>([...COMMAND_NAMES, "task.order.normalize", "workspace.init", "workspace.migrateV1", "workspace.recovery.resume", "workspace.doctor.inspect", "workspace.doctor.plan", "workspace.doctor.apply"]);
const envelopeFields = new Set(["version", "requestId", "command", "args", "actor", "idempotencyKey", "writeContext", "readOnly", "dryRun"]);

export function isV2Record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidEnvelope(field: string): never {
  throw new CommandError("INVALID_REQUEST", `invalid request ${field}`);
}

export function decodeV2Envelope(bytes: Uint8Array): unknown {
  try {
    return parseV2CanonicalJson(bytes);
  } catch {
    throw new CommandError("INVALID_REQUEST", "request must contain strict UTF-8 JSON");
  }
}

export function parseV2Request(value: unknown): V2Request {
  if (!isV2Record(value)) invalidEnvelope("object");
  if (Object.keys(value).some(field => !envelopeFields.has(field))) invalidEnvelope("fields");
  if (value.version !== 2) throw new CommandError("UNSUPPORTED_VERSION", "protocol version must be 2");
  if (value.requestId !== undefined && value.requestId !== null && typeof value.requestId !== "string") invalidEnvelope("requestId");
  if (typeof value.command !== "string" || value.command === "") invalidEnvelope("command");
  if (!knownCommands.has(value.command)) throw new CommandError("UNKNOWN_COMMAND", "command is not known");
  const args = value.args ?? {};
  if (value.args === null || !isV2Record(args)) invalidEnvelope("args");
  const actor = value.actor === undefined ? { kind: "agent", label: "cli" } : value.actor;
  if (!isV2Record(actor) || Object.keys(actor).some(field => field !== "kind" && field !== "label")
    || !["human", "agent", "system"].includes(actor.kind as string)
    || typeof actor.label !== "string" || actor.label.trim() === "") invalidEnvelope("actor");
  for (const field of ["readOnly", "dryRun"]) {
    if (value[field] !== undefined && typeof value[field] !== "boolean") invalidEnvelope(field);
  }
  for (const field of ["writeContext", "idempotencyKey"]) {
    if (value[field] !== undefined && (typeof value[field] !== "string" || (value[field] as string).trim() === "")) invalidEnvelope(field);
  }
  return {
    version: 2,
    requestId: value.requestId as string | null | undefined ?? null,
    command: value.command,
    args,
    actor: { kind: actor.kind as Actor["kind"], label: actor.label.trim() },
    idempotencyKey: value.idempotencyKey as string | undefined,
    writeContext: value.writeContext as string | undefined,
    readOnly: value.readOnly as boolean | undefined ?? false,
    dryRun: value.dryRun as boolean | undefined ?? false,
  };
}

export function assertV2Args(args: Record<string, unknown>, fields: readonly string[]): void {
  if (Object.keys(args).some(field => !fields.includes(field))) throw new CommandError("INVALID_ARGUMENT", "command has unknown arguments");
}
