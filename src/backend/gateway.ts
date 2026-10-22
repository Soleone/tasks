import { CommandError } from "./errors.js";
import { listActivity } from "./activity.js";
import { inspectCanonicalRoot } from "./canonicalReader.js";
import { observeQueryAuthority, synchronizeAuthority, withCacheTransaction } from "./queryCache.js";
import { executeUpdate } from "./updateWriter.js";
import { executeAttachmentWrite, readAttachment } from "./attachments.js";
import { isTaskEditRequest } from "./taskEditRequest.js";
import { executeCreate } from "./createWriter.js";
import { STATUS_COMMANDS } from "./taskStatus.js";
import { executeUndo } from "./undoWriter.js";
import { executePurge } from "./purgeWriter.js";
import { executeDoctorApply } from "./doctorApply.js";
import { executeDoctorInspect, executeDoctorPlan } from "./doctorWriter.js";
import { PurgeReferencedError } from "./purgePlan.js";
import { UNDO_COMMANDS } from "./undoPlan.js";
import { executeOrder } from "./orderWriter.js";
import { ORDER_COMMANDS } from "./taskOrdering.js";
import { RELATIONSHIP_COMMANDS } from "./taskRelationships.js";
import { executeMigration } from "../migration/writer.js";
import { executeLifecycle } from "./lifecycleWriter.js";
import { Schema1MigrationSourceError } from "../migration/schema1Source.js";
import { resumeOperation } from "./recovery.js";
import { executeHistoryChoice } from "./historyChoice.js";
import { readPending } from "./pending.js";
import { selectOtherRootsDirectory } from "./localDomain.js";
import { executeQuery, projectTasks } from "./queries.js";
import { assertArgs, decodeEnvelope, isRecord, parseRequest, QUERY_COMMANDS } from "./protocol.js";
import type { Response } from "./protocol.js";

const writeCommands = [
  "task.update",
  "task.create",
  "attachment.write",
  ...STATUS_COMMANDS,
  ...RELATIONSHIP_COMMANDS,
  ...ORDER_COMMANDS,
  ...UNDO_COMMANDS,
  "task.purgeCanceled",
  "workspace.recovery.resume",
  "workspace.migrate",
  "workspace.init",
  "workspace.rebuild",
  "workspace.doctor.plan",
  "workspace.doctor.apply",
];

export function executeLine(bytes: Uint8Array, rootPath: string, cachePath: string): Response {
  let requestId: string | null = null;
  try {
    selectOtherRootsDirectory(cachePath);
    const envelope = decodeEnvelope(bytes);
    if (isRecord(envelope) && typeof envelope.requestId === "string")
      requestId = envelope.requestId;
    const request = parseRequest(envelope);
    if (request.command === "workspace.rebind" || request.command === "workspace.newHistory") {
      const outcome = executeHistoryChoice(request, rootPath, cachePath);
      return { version: 2, requestId: request.requestId, ok: true, ...outcome };
    }
    if (request.command === "workspace.doctor.inspect") {
      const outcome = executeDoctorInspect(request, rootPath, cachePath);
      return { version: 2, requestId: request.requestId, ok: true, ...outcome };
    }
    if (writeCommands.includes(request.command)) {
      const outcome =
        request.command === "task.create"
          ? executeCreate(request, rootPath, cachePath)
          : request.command === "attachment.write"
            ? executeAttachmentWrite(request, rootPath, cachePath)
            : request.command === "task.purgeCanceled"
              ? executePurge(request, rootPath, cachePath)
              : request.command === "workspace.doctor.plan"
                ? executeDoctorPlan(request, rootPath, cachePath)
                : request.command === "workspace.doctor.apply"
                  ? executeDoctorApply(request, rootPath, cachePath)
                  : UNDO_COMMANDS.includes(request.command)
                    ? executeUndo(request, rootPath, cachePath)
                    : ORDER_COMMANDS.includes(request.command)
                      ? executeOrder(request, rootPath, cachePath)
                      : isTaskEditRequest(request)
                        ? executeUpdate(request, rootPath, cachePath)
                        : request.command === "workspace.recovery.resume"
                          ? resumeOperation(request, rootPath, cachePath)
                          : request.command === "workspace.migrate"
                            ? executeMigration(request, rootPath, cachePath)
                            : executeLifecycle(request, rootPath, cachePath);
      return { version: 2, requestId: request.requestId, ok: true, ...outcome };
    }
    const inspection = inspectCanonicalRoot(rootPath);
    if (request.command !== "workspace.info" && inspection.state === "unsupported") {
      throw new CommandError(
        "UNSUPPORTED_SCHEMA",
        inspection.schemaVersion === 2
          ? inspection.issues[0].message.slice("UNSUPPORTED_SCHEMA: ".length)
          : "task commands require canonical schema 2",
      );
    }
    const commands = [
      ...QUERY_COMMANDS,
      ...writeCommands,
      "activity.list",
      "workspace.doctor.inspect",
    ].sort();
    if (!commands.includes(request.command)) {
      throw new CommandError("UNSUPPORTED_COMMAND", "command is unavailable in this build");
    }
    if (request.command === "workspace.info") assertArgs(request.args, []);
    let pending;
    let pendingIssue: { code: string; message: string } | undefined;
    try {
      pending = readPending(inspection);
    } catch (error) {
      if (request.command !== "workspace.info") throw error;
      pendingIssue = {
        code: "RECOVERY_CONFLICT",
        message: "local intent evidence requires manual inspection; no automatic repair",
      };
    }
    if (request.command !== "workspace.info" && pending)
      throw new CommandError("RECOVERY_PENDING", "root has an unfinished intent");
    if (request.command !== "workspace.info" && !inspection.snapshot) {
      throw new CommandError(
        inspection.issues[0]?.code ?? "INVALID_CANONICAL",
        "root is not a complete schema-2 collection",
      );
    }
    const authority = observeQueryAuthority(
      cachePath,
      inspection,
      pending || pendingIssue ? undefined : inspection.snapshot,
    );
    const result =
      request.command === "workspace.info"
        ? {
            state: pending || pendingIssue ? "recovery_pending" : inspection.state,
            schemaVersion: inspection.schemaVersion,
            commands,
            issues: [
              ...inspection.issues,
              ...(pendingIssue ? [pendingIssue] : []),
              ...(pending?.format === "taskdb.pending-copy-target"
                ? [
                    {
                      code: "RECOVERY_PENDING",
                      message: `resume copy from its original selected root: ${pending.owner.rootPath}`,
                    },
                  ]
                : []),
            ],
            pendingOperationId: pending?.operationId ?? null,
            workspaceRevision: authority.workspaceRevision,
          }
        : request.command === "attachment.read"
          ? readAttachment(inspection.rootPath, request.args)
          : request.command === "activity.list"
            ? withCacheTransaction(cachePath, inspection, (database) => {
                synchronizeAuthority(database, inspection);
                return listActivity(database, request.args, authority.writeContext);
              })
            : executeQuery(
                request.command,
                request.args,
                projectTasks(inspection.snapshot!.tasks, authority),
                authority.workspaceRevision,
              );
    if (request.command !== "workspace.info" && readPending(inspection))
      throw new CommandError("RECOVERY_PENDING", "root changed while querying");
    return {
      version: 2,
      requestId: request.requestId,
      ok: true,
      writeContext: authority.writeContext,
      result,
    };
  } catch (error) {
    return failureResponse(requestId, error);
  }
}

export function failureResponse(requestId: string | null, error: unknown): Response {
  const storageError =
    isRecord(error) &&
    typeof error.code === "string" &&
    /^(?:E[A-Z]+|ERR_SQLITE.*)$/.test(error.code);
  const code =
    error instanceof CommandError
      ? error.code
      : storageError
        ? "INVALID_STORAGE"
        : "INTERNAL_ERROR";
  const message =
    error instanceof CommandError
      ? error.message.slice(error.code.length + 2)
      : "query could not complete safely";
  return {
    version: 2,
    requestId,
    ok: false,
    error: {
      code,
      message,
      ...(error instanceof Schema1MigrationSourceError || error instanceof PurgeReferencedError
        ? { details: error.details }
        : {}),
    },
  };
}
