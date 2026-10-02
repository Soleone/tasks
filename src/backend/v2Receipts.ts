import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "./canonicalJson.js";
import { CommandError } from "./errors.js";
import type { V2Request } from "./v2Protocol.js";
import type { V2QueryAuthority } from "./v2QueryCache.js";

export function v2RequestIdentity(request: V2Request): string {
  return createHash("sha256").update(canonicalJson({
    version: request.version, command: request.command, args: request.args,
    actor: request.actor, writeContext: request.writeContext,
    readOnly: request.readOnly, dryRun: request.dryRun,
  })).digest("hex");
}

export function requireV2WriteContext(request: V2Request, authority: V2QueryAuthority): void {
  if (request.writeContext === undefined) throw new CommandError("WRITE_CONTEXT_REQUIRED", "current writeContext is required");
  if (request.writeContext !== authority.writeContext) throw new CommandError("STALE_WRITE_CONTEXT", "writeContext no longer identifies this root/cache lifetime");
  if (!request.readOnly && !request.dryRun && request.idempotencyKey === undefined) {
    throw new CommandError("IDEMPOTENCY_REQUIRED", "executing mutation requires an idempotencyKey");
  }
}

export function findV2Receipt(database: DatabaseSync, request: V2Request): Record<string, unknown> | undefined {
  if (request.idempotencyKey === undefined) return undefined;
  const row = database.prepare("SELECT identity, result FROM v2_receipts WHERE context = ? AND key = ?")
    .get(request.writeContext!, request.idempotencyKey) as { identity: string; result: string } | undefined;
  if (!row) return undefined;
  if (row.identity !== v2RequestIdentity(request)) throw new CommandError("IDEMPOTENCY_KEY_REUSED", "key already identifies a different request");
  return JSON.parse(row.result) as Record<string, unknown>;
}

export function storeV2Receipt(database: DatabaseSync, request: V2Request, result: Record<string, unknown>): void {
  database.prepare("INSERT INTO v2_receipts(context, key, identity, result) VALUES (?, ?, ?, ?)")
    .run(request.writeContext!, request.idempotencyKey!, v2RequestIdentity(request), JSON.stringify(result));
}
