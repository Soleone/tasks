import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "./canonicalJson.js";
import { CommandError } from "./errors.js";
import type { Request } from "./protocol.js";
import type { QueryAuthority } from "./queryCache.js";
import type { TaskEditRequest } from "./taskEditRequest.js";
import { parseTaskEditResult } from "./taskResults.js";
import type { TaskExecutionResult } from "./taskResults.js";

export function requestIdentity(request: Request): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        version: request.version,
        command: request.command,
        args: request.args,
        actor: request.actor,
        writeContext: request.writeContext,
        readOnly: request.readOnly,
        dryRun: request.dryRun,
      }),
    )
    .digest("hex");
}

export function requireWriteContext(request: Request, authority: QueryAuthority): void {
  if (request.writeContext === undefined)
    throw new CommandError("WRITE_CONTEXT_REQUIRED", "current writeContext is required");
  if (request.writeContext !== authority.writeContext)
    throw new CommandError(
      "STALE_WRITE_CONTEXT",
      "writeContext no longer identifies this root/cache lifetime",
    );
  if (!request.readOnly && !request.dryRun && request.idempotencyKey === undefined) {
    throw new CommandError("IDEMPOTENCY_REQUIRED", "executing mutation requires an idempotencyKey");
  }
}

export function findReceipt(
  database: DatabaseSync,
  request: Request,
): Record<string, unknown> | undefined {
  if (request.idempotencyKey === undefined) return undefined;
  const row = database
    .prepare("SELECT identity, result FROM v2_receipts WHERE context = ? AND key = ?")
    .get(request.writeContext!, request.idempotencyKey) as
    | { identity: string; result: string }
    | undefined;
  if (!row) return undefined;
  if (row.identity !== requestIdentity(request))
    throw new CommandError("IDEMPOTENCY_KEY_REUSED", "key already identifies a different request");
  return JSON.parse(row.result) as Record<string, unknown>;
}

export function findTaskEditReceipt(
  database: DatabaseSync,
  request: TaskEditRequest,
): TaskExecutionResult | undefined {
  const result = findReceipt(database, request);
  if (!result) return undefined;
  try {
    return parseTaskEditResult(result, "execution");
  } catch {
    throw new CommandError(
      "INVALID_STORAGE",
      "retained task-edit receipt has an invalid result; evidence retained",
    );
  }
}

export function storeReceipt(
  database: DatabaseSync,
  request: Request,
  result: Record<string, unknown>,
): void {
  database
    .prepare("INSERT INTO v2_receipts(context, key, identity, result) VALUES (?, ?, ?, ?)")
    .run(
      request.writeContext!,
      request.idempotencyKey!,
      requestIdentity(request),
      JSON.stringify(result),
    );
}
