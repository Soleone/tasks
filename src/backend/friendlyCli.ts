import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeSync } from "node:fs";
import path from "node:path";
import { detectAttachmentType } from "./attachments.js";
import { CommandError } from "./errors.js";
import { executeLine } from "./gateway.js";
import { executeHomeLine } from "./homeGateway.js";
import { humanOptionIndex, parseHumanArgs, HumanUsageError, humanUsage } from "./friendlyArgs.js";
import type { HumanInvocation } from "./friendlyArgs.js";
import { printHumanResult } from "./friendlyOutput.js";
import type { Request, Response } from "./protocol.js";
import type { TaskProjection } from "./queries.js";
import { MAX_ATTACHMENTS } from "./taskModel.js";
import { requestIdentity } from "./receipts.js";

class HumanProtocolError extends CommandError {
  constructor(readonly failure: Extract<Response, { ok: false }>) {
    super(failure.error.code, failure.error.message);
  }
}
function dispatch(invocation: HumanInvocation, request: Request): Extract<Response, { ok: true }> {
  const bytes = Buffer.from(JSON.stringify(request));
  const { target } = invocation;
  const response =
    "homePath" in target
      ? executeHomeLine(bytes, target.homePath, "cli")
      : executeLine(bytes, target.rootPath, target.cachePath);
  if (!response.ok) throw new HumanProtocolError(response);
  return response;
}
function query(invocation: HumanInvocation, command: string, args: Record<string, unknown> = {}) {
  return dispatch(invocation, {
    version: 2,
    requestId: null,
    command,
    args,
    actor: invocation.request.actor,
    readOnly: false,
    dryRun: false,
  });
}
function preparedRequestHash(invocation: HumanInvocation, request: Request): string {
  return createHash("sha256")
    .update(JSON.stringify([requestIdentity(request), invocation.target]))
    .digest("hex");
}
function prepare(invocation: HumanInvocation): Request {
  const request = {
    ...invocation.request,
    args: { ...invocation.request.args },
    requestId: randomUUID(),
  };
  if (!invocation.mutation) return request;
  // Caller-supplied retry identity never authorizes reading replacement authority.
  if (
    (request.idempotencyKey !== undefined ||
      request.args.expectedVersion !== undefined ||
      invocation.requestHash !== undefined) &&
    request.writeContext === undefined
  ) {
    throw new CommandError(
      "WRITE_CONTEXT_REQUIRED",
      "retain and supply the original --write-context; no authority was refreshed",
    );
  }
  if (invocation.requestHash !== undefined && request.idempotencyKey === undefined)
    throw new HumanUsageError("--request-hash requires the retained --idempotency-key");
  if (
    request.idempotencyKey !== undefined &&
    invocation.versioned &&
    request.args.expectedVersion === undefined
  ) {
    throw new CommandError(
      "EXPECTED_VERSION_REQUIRED",
      "retain and supply the original --expected-version; no task was refreshed",
    );
  }
  if (request.writeContext === undefined) {
    const info = query(invocation, "workspace.info");
    if (!(info.result.commands as string[]).includes(request.command))
      throw new CommandError(
        "UNSUPPORTED_COMMAND",
        "selected platform does not advertise this command",
      );
    request.writeContext = info.writeContext;
  }
  if (invocation.versioned && request.args.expectedVersion === undefined) {
    const observed = query(invocation, "task.get", { id: request.args.id });
    if (observed.writeContext !== request.writeContext)
      throw new CommandError(
        "STALE_WRITE_CONTEXT",
        "context changed during preparation; no write was issued",
      );
    request.args.expectedVersion = (observed.result.task as { version: number }).version;
  }
  if (!request.readOnly && !request.dryRun && request.idempotencyKey === undefined)
    request.idempotencyKey = randomUUID();
  if (
    invocation.requestHash !== undefined &&
    invocation.requestHash !== preparedRequestHash(invocation, request)
  ) {
    throw new CommandError(
      "IDEMPOTENCY_KEY_REUSED",
      "retained request hash differs; preserve the original payload, actor, flags and home",
    );
  }
  return request;
}
/** Complete the metadata write before entering a gateway that can publish canonical effects. */
function reportRetry(invocation: HumanInvocation, request: Request): void {
  const bytes = Buffer.from(
    `tasks-cli retry: ${JSON.stringify({
      command: request.command,
      ...invocation.target,
      writeContext: request.writeContext,
      idempotencyKey: request.idempotencyKey,
      expectedVersion: request.args.expectedVersion,
      actor: request.actor,
      readOnly: request.readOnly,
      dryRun: request.dryRun,
      requestHash: preparedRequestHash(invocation, request),
    })}\n`,
  );
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(2, bytes, offset, bytes.length - offset);
    if (written <= 0)
      throw new CommandError(
        "INVALID_STORAGE",
        "retry metadata could not be reported; no write was issued",
      );
    offset += written;
  }
}
function targetRoot(invocation: HumanInvocation): string {
  const { target } = invocation;
  return "homePath" in target ? path.join(target.homePath, "sync") : target.rootPath;
}
/** Stores the image, then turns the invocation into the update that lists it. */
function writeAttachment(invocation: HumanInvocation, file: string): HumanInvocation {
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch {
    throw new HumanUsageError(`cannot read ${file}`);
  }
  const type = detectAttachmentType(bytes);
  if (!type) throw new HumanUsageError(`${file} is not a PNG, JPEG, WebP or GIF image`);
  const observed = query(invocation, "task.get", { id: invocation.request.args.id });
  const task = observed.result.task as TaskProjection;
  if (task.attachments.length >= MAX_ATTACHMENTS)
    throw new CommandError("INVALID_ARGUMENT", `a task holds at most ${MAX_ATTACHMENTS} images`);
  const write: Request = {
    ...invocation.request,
    command: "attachment.write",
    args: { type, data: bytes.toString("base64") },
    requestId: randomUUID(),
    writeContext: observed.writeContext,
    idempotencyKey: randomUUID(),
  };
  reportRetry(invocation, write);
  const written = dispatch(invocation, write);
  return {
    ...invocation,
    request: {
      ...invocation.request,
      writeContext: observed.writeContext,
      args: {
        ...invocation.request.args,
        expectedVersion: task.version,
        attachments: [...task.attachments, written.result.name as string],
      },
    },
  };
}
export function runHumanCli(argv: string[]): void {
  let json = false;
  try {
    let invocation = parseHumanArgs(argv);
    json = invocation.json;
    if (invocation.help) {
      process.stdout.write(humanUsage());
      return;
    }
    if (invocation.attachFile !== undefined)
      invocation = writeAttachment(invocation, invocation.attachFile);
    // A new home is created by its explicit init, before init asks the home for authority.
    if (invocation.request.command === "workspace.init" && "homePath" in invocation.target)
      query(invocation, "home.create");
    const request = prepare(invocation);
    if (invocation.mutation && !request.readOnly && !request.dryRun)
      reportRetry(invocation, request);
    const response = dispatch(invocation, request);
    printHumanResult(request.command, response, json, targetRoot(invocation));
  } catch (error) {
    const failure =
      error instanceof HumanProtocolError
        ? error.failure.error
        : {
            code: error instanceof CommandError ? error.code : "INVALID_STORAGE",
            message:
              error instanceof CommandError
                ? error.message.slice(error.code.length + 2)
                : "tasks-cli could not complete; preserve retry metadata and inspect pending work",
          };
    // JSON mode can still report a malformed argv invocation without echoing its values.
    if (!json) json = humanOptionIndex(argv, "json") !== -1;
    process.stderr.write(
      json
        ? `${JSON.stringify({ ok: false, error: failure })}\n`
        : `tasks-cli: ${failure.code}: ${failure.message}\n`,
    );
    process.exitCode =
      failure.code === "STALE_TASK_VERSION" ? 3 : error instanceof HumanUsageError ? 2 : 1;
  }
}
