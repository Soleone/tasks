import { CommandError } from "./errors.js";
import { inspectV2CanonicalRoot } from "./v2CanonicalReader.js";
import { observeV2QueryAuthority } from "./v2QueryCache.js";
import { executeV2Query, projectV2Tasks } from "./v2Queries.js";
import { assertV2Args, decodeV2Envelope, isV2Record, parseV2Request, V2_QUERY_COMMANDS } from "./v2Protocol.js";
import type { V2Response } from "./v2Protocol.js";

export function executeV2Line(bytes: Uint8Array, rootPath: string, cachePath: string): V2Response {
  let requestId: string | null = null;
  try {
    const envelope = decodeV2Envelope(bytes);
    if (isV2Record(envelope) && typeof envelope.requestId === "string") requestId = envelope.requestId;
    const request = parseV2Request(envelope);
    const inspection = inspectV2CanonicalRoot(rootPath);
    if (request.command !== "workspace.info" && inspection.state === "unsupported") {
      throw new CommandError("UNSUPPORTED_SCHEMA", "task commands require canonical schema 2");
    }
    if (!(V2_QUERY_COMMANDS as readonly string[]).includes(request.command)) {
      throw new CommandError("UNSUPPORTED_COMMAND", "command is unavailable in the read-only v2 slice");
    }
    if (request.command === "workspace.info") assertV2Args(request.args, []);
    if (request.command !== "workspace.info" && !inspection.snapshot) {
      throw new CommandError(inspection.issues[0]?.code ?? "INVALID_CANONICAL", "root is not a complete schema-2 collection");
    }
    const authority = observeV2QueryAuthority(cachePath, inspection, inspection.snapshot);
    const result = request.command === "workspace.info" ? {
      state: inspection.state,
      schemaVersion: inspection.schemaVersion,
      commands: [...V2_QUERY_COMMANDS],
      issues: inspection.issues,
      pendingOperationId: null,
      workspaceRevision: authority.workspaceRevision,
    } : executeV2Query(request.command, request.args, projectV2Tasks(inspection.snapshot!.tasks, authority), authority.workspaceRevision);
    return { version: 2, requestId: request.requestId, ok: true, writeContext: authority.writeContext, result };
  } catch (error) {
    const storageError = isV2Record(error) && typeof error.code === "string" && /^(?:E[A-Z]+|ERR_SQLITE.*)$/.test(error.code);
    const code = error instanceof CommandError ? error.code : storageError ? "INVALID_STORAGE" : "INTERNAL_ERROR";
    const message = error instanceof CommandError ? error.message.slice(error.code.length + 2) : "v2 query could not complete safely";
    return { version: 2, requestId, ok: false, error: { code, message } };
  }
}
