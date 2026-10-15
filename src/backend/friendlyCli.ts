import { createHash, randomUUID } from "node:crypto";
import { writeSync } from "node:fs";
import path from "node:path";
import { CommandError } from "./errors.js";
import { executeV2Line } from "./gateway.js";
import { getDataDirectory } from "./paths.js";
import { hasV2HumanOption, parseV2HumanArgs, V2HumanUsageError, v2HumanUsage } from "./friendlyArgs.js";
import type { V2HumanInvocation } from "./friendlyArgs.js";
import { printV2HumanResult } from "./friendlyOutput.js";
import type { V2Request, V2Response } from "./protocol.js";
import { v2RequestIdentity } from "./receipts.js";

class V2HumanProtocolError extends CommandError {
  constructor(readonly failure: Extract<V2Response, { ok: false }>) { super(failure.error.code, failure.error.message); }
}
function dispatch(invocation: V2HumanInvocation, request: V2Request): Extract<V2Response, { ok: true }> {
  const response = executeV2Line(Buffer.from(JSON.stringify(request)), invocation.rootPath, invocation.cachePath);
  if (!response.ok) throw new V2HumanProtocolError(response);
  return response;
}
function query(invocation: V2HumanInvocation, command: string, args: Record<string, unknown> = {}) {
  return dispatch(invocation, { version: 2, requestId: null, command, args, actor: invocation.request.actor, readOnly: false, dryRun: false });
}
function preparedRequestHash(invocation: V2HumanInvocation, request: V2Request): string {
  return createHash("sha256").update(JSON.stringify([
    v2RequestIdentity(request), invocation.rootPath, invocation.cachePath, path.resolve(getDataDirectory()),
  ])).digest("hex");
}
function prepare(invocation: V2HumanInvocation): V2Request {
  const request = { ...invocation.request, args: { ...invocation.request.args }, requestId: randomUUID() };
  if (!invocation.mutation) return request;
  // Caller-supplied retry identity never authorizes reading replacement authority.
  if ((request.idempotencyKey !== undefined || request.args.expectedVersion !== undefined || invocation.requestHash !== undefined) && request.writeContext === undefined) {
    throw new CommandError("WRITE_CONTEXT_REQUIRED", "retain and supply the original --write-context; no authority was refreshed");
  }
  if (invocation.requestHash !== undefined && request.idempotencyKey === undefined) throw new V2HumanUsageError("--request-hash requires the retained --idempotency-key");
  if (request.idempotencyKey !== undefined && invocation.versioned && request.args.expectedVersion === undefined) {
    throw new CommandError("EXPECTED_VERSION_REQUIRED", "retain and supply the original --expected-version; no task was refreshed");
  }
  if (request.writeContext === undefined) {
    const info = query(invocation, "workspace.info");
    if (!(info.result.commands as string[]).includes(request.command)) throw new CommandError("UNSUPPORTED_COMMAND", "selected platform does not advertise this command");
    request.writeContext = info.writeContext;
  }
  if (invocation.versioned && request.args.expectedVersion === undefined) {
    const observed = query(invocation, "task.get", { id: request.args.id });
    if (observed.writeContext !== request.writeContext) throw new CommandError("STALE_WRITE_CONTEXT", "context changed during preparation; no write was issued");
    request.args.expectedVersion = (observed.result.task as { version: number }).version;
  }
  if (!request.readOnly && !request.dryRun && request.idempotencyKey === undefined) request.idempotencyKey = randomUUID();
  if (invocation.requestHash !== undefined && invocation.requestHash !== preparedRequestHash(invocation, request)) {
    throw new CommandError("IDEMPOTENCY_KEY_REUSED", "retained request hash differs; preserve the original payload, actor, flags and root/cache/profile paths");
  }
  return request;
}
/** Complete the metadata write before entering a gateway that can publish canonical effects. */
function reportRetry(invocation: V2HumanInvocation, request: V2Request): void {
  const bytes = Buffer.from(`tasks-cli retry: ${JSON.stringify({
    command: request.command, rootPath: invocation.rootPath, cachePath: invocation.cachePath,
    profileDirectory: path.resolve(getDataDirectory()), writeContext: request.writeContext,
    idempotencyKey: request.idempotencyKey, expectedVersion: request.args.expectedVersion,
    actor: request.actor, readOnly: request.readOnly, dryRun: request.dryRun,
    requestHash: preparedRequestHash(invocation, request),
  })}\n`);
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(2, bytes, offset, bytes.length - offset);
    if (written <= 0) throw new CommandError("INVALID_STORAGE", "retry metadata could not be reported; no write was issued");
    offset += written;
  }
}
export function runV2HumanCli(argv: string[]): void {
  let json = false;
  try {
    const invocation = parseV2HumanArgs(argv);json = invocation.json;
    if (invocation.help) { process.stdout.write(v2HumanUsage());return; }
    const request = prepare(invocation);
    if (invocation.mutation && !request.readOnly && !request.dryRun) reportRetry(invocation, request);
    const response = dispatch(invocation, request);
    printV2HumanResult(request.command, response, json);
  } catch (error) {
    const failure = error instanceof V2HumanProtocolError ? error.failure.error : {
      code: error instanceof CommandError ? error.code : "INVALID_STORAGE",
      message: error instanceof CommandError ? error.message.slice(error.code.length + 2) : "v2 CLI could not complete; preserve retry metadata and inspect pending work",
    };
    // JSON mode can still report a malformed argv invocation without echoing its values.
    if (!json) json = hasV2HumanOption(argv, "json");
    process.stderr.write(json ? `${JSON.stringify({ ok: false, error: failure })}\n` : `tasks-cli: ${failure.code}: ${failure.message}\n`);
    process.exitCode = failure.code === "STALE_TASK_VERSION" ? 3 : error instanceof V2HumanUsageError ? 2 : 1;
  }
}
