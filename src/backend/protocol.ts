import { CommandError } from "./errors.js";
import { parseCanonicalJson } from "./strictJson.js";

type ActorKind = "human" | "agent" | "system";
type Actor = { kind: ActorKind; label: string };
export type TaskTransitionCommand =
  | "task.start"
  | "task.pause"
  | "task.complete"
  | "task.reopen"
  | "task.cancel"
  | "task.delete";
export type TaskTransitionItem = {
  id: string;
  expectedVersion: number;
  command: TaskTransitionCommand;
};
export type TaskReorderTask = { id: string; expectedVersion: number };
export type TaskReorderPlacement =
  | { beforeId: string }
  | { afterId: string }
  | { first: true }
  | { last: true };

// Commands this protocol knows by name. Names not offered by the current build fail
// UNSUPPORTED_COMMAND rather than UNKNOWN_COMMAND, including retired workspace commands.
const KNOWN_COMMANDS = [
  "activity.list",
  "category.list",
  "operation.undo",
  "operation.redo",
  "runtime.probe",
  "source.list",
  "tag.list",
  "task.cancel",
  "task.complete",
  "task.create",
  "task.delete",
  "task.dependency.add",
  "task.dependency.remove",
  "task.get",
  "task.list",
  "task.move",
  "task.order.normalize",
  "task.pause",
  "task.purgeCanceled",
  "task.reopen",
  "task.reorder",
  "task.start",
  "task.status.undo",
  "task.status.undoMany",
  "task.transitionMany",
  "task.update",
  "workspace.archive",
  "workspace.backup",
  "workspace.conflict.list",
  "workspace.conflict.resolve",
  "workspace.doctor.apply",
  "workspace.doctor.inspect",
  "workspace.doctor.plan",
  "workspace.export",
  "workspace.exportTasks",
  "workspace.info",
  "workspace.init",
  "workspace.migrate",
  "workspace.rebuild",
  "workspace.receive.abort",
  "workspace.receive.prepare",
  "workspace.receive.status",
  "workspace.recovery.resume",
  "workspace.restore",
  "workspace.sync",
] as const;

export type Request = {
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
export type Response =
  | {
      version: 2;
      requestId: string | null;
      ok: true;
      writeContext: string;
      result: Record<string, unknown>;
    }
  | {
      version: 2;
      requestId: string | null;
      ok: false;
      error: { code: string; message: string; details?: Record<string, unknown> };
    };

export function parseResponse(value: unknown): Response {
  if (
    !isRecord(value) ||
    value.version !== 2 ||
    (value.requestId !== null && typeof value.requestId !== "string")
  ) {
    throw new Error("backend did not return a protocol-2 response");
  }
  const fields =
    value.ok === true
      ? ["version", "requestId", "ok", "writeContext", "result"]
      : ["version", "requestId", "ok", "error"];
  if (Object.keys(value).some((field) => !fields.includes(field))) {
    throw new Error("backend returned unexpected protocol-2 response fields");
  }
  if (
    value.ok === true &&
    typeof value.writeContext === "string" &&
    value.writeContext.trim() !== "" &&
    isRecord(value.result)
  ) {
    return value as Response;
  }
  if (
    value.ok === false &&
    isRecord(value.error) &&
    typeof value.error.code === "string" &&
    value.error.code !== "" &&
    typeof value.error.message === "string" &&
    (value.error.details === undefined || isRecord(value.error.details)) &&
    Object.keys(value.error).every((field) => ["code", "message", "details"].includes(field))
  ) {
    return value as Response;
  }
  throw new Error("backend returned an invalid protocol-2 response");
}

export const QUERY_COMMANDS = [
  "category.list",
  "tag.list",
  "task.get",
  "task.list",
  "workspace.info",
] as const;
const knownCommands = new Set<string>(KNOWN_COMMANDS);
const envelopeFields = new Set([
  "version",
  "requestId",
  "command",
  "args",
  "actor",
  "idempotencyKey",
  "writeContext",
  "readOnly",
  "dryRun",
]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidEnvelope(field: string): never {
  throw new CommandError("INVALID_REQUEST", `invalid request ${field}`);
}

export function decodeEnvelope(bytes: Uint8Array): unknown {
  try {
    return parseCanonicalJson(bytes);
  } catch {
    throw new CommandError("INVALID_REQUEST", "request must contain strict UTF-8 JSON");
  }
}

export function parseRequest(value: unknown): Request {
  if (!isRecord(value)) invalidEnvelope("object");
  if (Object.keys(value).some((field) => !envelopeFields.has(field))) invalidEnvelope("fields");
  if (value.version !== 2)
    throw new CommandError("UNSUPPORTED_VERSION", "protocol version must be 2");
  if (
    value.requestId !== undefined &&
    value.requestId !== null &&
    typeof value.requestId !== "string"
  )
    invalidEnvelope("requestId");
  if (typeof value.command !== "string" || value.command === "") invalidEnvelope("command");
  if (!knownCommands.has(value.command))
    throw new CommandError("UNKNOWN_COMMAND", "command is not known");
  const args = value.args ?? {};
  if (value.args === null || !isRecord(args)) invalidEnvelope("args");
  const actor = value.actor === undefined ? { kind: "agent", label: "cli" } : value.actor;
  if (
    !isRecord(actor) ||
    Object.keys(actor).some((field) => field !== "kind" && field !== "label") ||
    !["human", "agent", "system"].includes(actor.kind as string) ||
    typeof actor.label !== "string" ||
    actor.label.trim() === ""
  )
    invalidEnvelope("actor");
  for (const field of ["readOnly", "dryRun"]) {
    if (value[field] !== undefined && typeof value[field] !== "boolean") invalidEnvelope(field);
  }
  for (const field of ["writeContext", "idempotencyKey"]) {
    if (
      value[field] !== undefined &&
      (typeof value[field] !== "string" || (value[field] as string).trim() === "")
    )
      invalidEnvelope(field);
  }
  return {
    version: 2,
    requestId: (value.requestId as string | null | undefined) ?? null,
    command: value.command,
    args,
    actor: { kind: actor.kind as Actor["kind"], label: actor.label.trim() },
    idempotencyKey: value.idempotencyKey as string | undefined,
    writeContext: value.writeContext as string | undefined,
    readOnly: (value.readOnly as boolean | undefined) ?? false,
    dryRun: (value.dryRun as boolean | undefined) ?? false,
  };
}

export function assertArgs(args: Record<string, unknown>, fields: readonly string[]): void {
  if (Object.keys(args).some((field) => !fields.includes(field)))
    throw new CommandError("INVALID_ARGUMENT", "command has unknown arguments");
}
