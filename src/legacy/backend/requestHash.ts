import { createHash } from "node:crypto";
import type { ProtocolRequest } from "./protocol.js";
import { canonicalJson } from "../../backend/canonicalJson.js";

export { canonicalJson } from "../../backend/canonicalJson.js";

export function requestHash(request: ProtocolRequest): string {
  const payload = {
    actor: request.actor,
    args: request.args,
    command: request.command,
    dryRun: Boolean(request.dryRun),
    readOnly: Boolean(request.readOnly),
  };
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

export function contentHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
