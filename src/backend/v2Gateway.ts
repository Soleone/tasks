import { CommandError } from "./errors.js";
import { listV2Activity } from "./v2Activity.js";
import { inspectV2CanonicalRoot } from "./v2CanonicalReader.js";
import { observeV2QueryAuthority, synchronizeV2Authority, withV2CacheTransaction } from "./v2QueryCache.js";
import { executeV2Update, resumeV2Update } from "./v2UpdateWriter.js";
import { readV2Pending } from "./v2UpdateJournal.js";
import { executeV2Query, projectV2Tasks } from "./v2Queries.js";
import { assertV2Args, decodeV2Envelope, isV2Record, parseV2Request, V2_QUERY_COMMANDS } from "./v2Protocol.js";
import type { V2Response } from "./v2Protocol.js";

export function executeV2Line(bytes: Uint8Array, rootPath: string, cachePath: string): V2Response {
  let requestId: string | null = null;
  try {
    const envelope = decodeV2Envelope(bytes);
    if (isV2Record(envelope) && typeof envelope.requestId === "string") requestId = envelope.requestId;
    const request = parseV2Request(envelope);
    const writable = process.platform === "linux";
    if (writable && (request.command === "task.update" || request.command === "workspace.recovery.resume")) {
      const outcome = request.command === "task.update" ? executeV2Update(request, rootPath, cachePath) : resumeV2Update(request, rootPath, cachePath);
      return { version: 2, requestId: request.requestId, ok: true, ...outcome };
    }
    const inspection = inspectV2CanonicalRoot(rootPath);
    if (request.command !== "workspace.info" && inspection.state === "unsupported") {
      throw new CommandError("UNSUPPORTED_SCHEMA", "task commands require canonical schema 2");
    }
    const commands = [...V2_QUERY_COMMANDS, ...(writable ? ["task.update", "workspace.recovery.resume", "activity.list"] : [])].sort();
    if (!commands.includes(request.command)) {
      throw new CommandError("UNSUPPORTED_COMMAND", "command is unavailable in this bounded v2 slice");
    }
    if (request.command === "workspace.info") assertV2Args(request.args, []);
    let pending;
    let pendingIssue: { code: string; message: string } | undefined;
    try { pending = readV2Pending(inspection); } catch (error) {
      if (request.command !== "workspace.info") throw error;
      pendingIssue = { code: "RECOVERY_CONFLICT", message: "local intent evidence requires manual inspection; no automatic repair" };
    }
    if (request.command !== "workspace.info" && pending) throw new CommandError("RECOVERY_PENDING", "root has an unfinished intent");
    if (request.command !== "workspace.info" && !inspection.snapshot) {
      throw new CommandError(inspection.issues[0]?.code ?? "INVALID_CANONICAL", "root is not a complete schema-2 collection");
    }
    const authority = observeV2QueryAuthority(cachePath, inspection, pending || pendingIssue ? undefined : inspection.snapshot);
    const result = request.command === "workspace.info" ? {
      state: pending || pendingIssue ? "recovery_pending" : inspection.state,
      schemaVersion: inspection.schemaVersion,
      commands,
      issues: [...inspection.issues, ...(pendingIssue ? [pendingIssue] : [])],
      pendingOperationId: pending?.operationId ?? null,
      workspaceRevision: authority.workspaceRevision,
    } : request.command === "activity.list" ? withV2CacheTransaction(cachePath, inspection, database => {
      synchronizeV2Authority(database, inspection);
      return listV2Activity(database, request.args, authority.writeContext);
    }) : executeV2Query(request.command, request.args, projectV2Tasks(inspection.snapshot!.tasks, authority), authority.workspaceRevision);
    if (request.command !== "workspace.info" && readV2Pending(inspection)) throw new CommandError("RECOVERY_PENDING", "root changed while querying");
    return { version: 2, requestId: request.requestId, ok: true, writeContext: authority.writeContext, result };
  } catch (error) {
    const storageError = isV2Record(error) && typeof error.code === "string" && /^(?:E[A-Z]+|ERR_SQLITE.*)$/.test(error.code);
    const code = error instanceof CommandError ? error.code : storageError ? "INVALID_STORAGE" : "INTERNAL_ERROR";
    const message = error instanceof CommandError ? error.message.slice(error.code.length + 2) : "v2 query could not complete safely";
    return { version: 2, requestId, ok: false, error: { code, message } };
  }
}
