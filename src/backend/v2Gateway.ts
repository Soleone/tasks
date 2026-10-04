import { CommandError } from "./errors.js";
import { listV2Activity } from "./v2Activity.js";
import { inspectV2CanonicalRoot } from "./v2CanonicalReader.js";
import { observeV2QueryAuthority, synchronizeV2Authority, withV2CacheTransaction } from "./v2QueryCache.js";
import { executeV2Update } from "./v2UpdateWriter.js";
import { isV2TaskEditRequest } from "./v2TaskEditRequest.js";
import { executeV2Create } from "./v2CreateWriter.js";
import { V2_STATUS_COMMANDS } from "./v2TaskStatus.js";
import { executeV2Undo } from "./v2UndoWriter.js";
import { executeV2Purge } from "./v2PurgeWriter.js";
import { executeV2DoctorApply } from "./v2DoctorApply.js";
import { executeV2DoctorInspect, executeV2DoctorPlan } from "./v2DoctorWriter.js";
import { V2PurgeReferencedError } from "./v2PurgePlan.js";
import { V2_UNDO_COMMANDS } from "./v2UndoPlan.js";
import { executeV2Order } from "./v2OrderWriter.js";
import { V2_ORDER_COMMANDS } from "./v2TaskOrdering.js";
import { V2_RELATIONSHIP_COMMANDS } from "./v2TaskRelationships.js";
import { executeV2Copy } from "./v2CopyWriter.js";
import { executeV2Migration } from "./v2MigrationWriter.js";
import { executeV2Lifecycle } from "./v2LifecycleWriter.js";
import { V1MigrationSourceError } from "./v2MigrationSource.js";
import { resumeV2Operation } from "./v2Recovery.js";
import { readV2Pending } from "./v2Pending.js";
import { executeV2Query, projectV2Tasks } from "./v2Queries.js";
import { assertV2Args, decodeV2Envelope, isV2Record, parseV2Request, V2_QUERY_COMMANDS } from "./v2Protocol.js";
import type { V2Response } from "./v2Protocol.js";

const writeCommands = ["task.update", "task.create", ...V2_STATUS_COMMANDS, ...V2_RELATIONSHIP_COMMANDS, ...V2_ORDER_COMMANDS, ...V2_UNDO_COMMANDS, "task.purgeCanceled", "workspace.recovery.resume", "workspace.archive", "workspace.restore", "workspace.migrateV1", "workspace.init", "workspace.rebuild", "workspace.doctor.plan", "workspace.doctor.apply"];

export function executeV2Line(bytes: Uint8Array, rootPath: string, cachePath: string, writerProfile?: "windows-update-proof"): V2Response {
  let requestId: string | null = null;
  try {
    const envelope = decodeV2Envelope(bytes);
    if (isV2Record(envelope) && typeof envelope.requestId === "string") requestId = envelope.requestId;
    const request = parseV2Request(envelope);
    const writable = process.platform === "linux";
    const windowsUpdateProof = process.platform === "win32" && writerProfile === "windows-update-proof";
    const allowedWrites = windowsUpdateProof ? ["task.update", "workspace.recovery.resume"] : writable ? writeCommands : [];
    if (writable && request.command === "workspace.doctor.inspect") {
      const outcome = executeV2DoctorInspect(request, rootPath, cachePath);
      return { version: 2, requestId: request.requestId, ok: true, ...outcome };
    }
    if (allowedWrites.includes(request.command)) {
      const outcome = request.command === "task.create" ? executeV2Create(request, rootPath, cachePath)
        : request.command === "task.purgeCanceled" ? executeV2Purge(request, rootPath, cachePath)
        : request.command === "workspace.doctor.plan" ? executeV2DoctorPlan(request, rootPath, cachePath)
        : request.command === "workspace.doctor.apply" ? executeV2DoctorApply(request, rootPath, cachePath)
        : V2_UNDO_COMMANDS.includes(request.command) ? executeV2Undo(request, rootPath, cachePath)
        : V2_ORDER_COMMANDS.includes(request.command) ? executeV2Order(request, rootPath, cachePath)
        : isV2TaskEditRequest(request) ? executeV2Update(request, rootPath, cachePath)
        : request.command === "workspace.recovery.resume" ? resumeV2Operation(request, rootPath, cachePath, windowsUpdateProof)
        : request.command === "workspace.migrateV1" ? executeV2Migration(request, rootPath, cachePath)
        : ["workspace.init", "workspace.rebuild"].includes(request.command) ? executeV2Lifecycle(request, rootPath, cachePath)
        : executeV2Copy(request, rootPath, cachePath);
      return { version: 2, requestId: request.requestId, ok: true, ...outcome };
    }
    if (writeCommands.includes(request.command)) throw new CommandError("UNSUPPORTED_COMMAND", "write is unavailable in this platform/profile");
    const inspection = inspectV2CanonicalRoot(rootPath);
    if (request.command !== "workspace.info" && inspection.state === "unsupported") {
      throw new CommandError("UNSUPPORTED_SCHEMA", "task commands require canonical schema 2");
    }
    const commands = [...V2_QUERY_COMMANDS, ...allowedWrites, ...(writable ? ["activity.list", "workspace.doctor.inspect"] : windowsUpdateProof ? ["activity.list"] : [])].sort();
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
      issues: [...inspection.issues, ...(pendingIssue ? [pendingIssue] : []), ...(pending?.format === "taskdb.pending-copy-target" ? [{ code: "RECOVERY_PENDING", message: `resume copy from its original selected root: ${pending.owner.rootPath}` }] : [])],
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
    return { version: 2, requestId, ok: false, error: { code, message, ...(error instanceof V1MigrationSourceError || error instanceof V2PurgeReferencedError ? { details: error.details } : {}) } };
  }
}
