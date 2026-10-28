import { commitDoctor } from "./doctorApply.js";
import { retireDoctorStages } from "./doctorJournal.js";
import { CommandError } from "./errors.js";
import { retireBatchStages } from "./batchJournal.js";
import { commitUndo } from "./undoWriter.js";
import { retirePurgeQuarantines } from "./purgeJournal.js";
import { commitPurge } from "./purgeWriter.js";
import { retireOrderStages } from "./orderJournal.js";
import { commitOrder } from "./orderWriter.js";
import { readRootDescriptor } from "./canonicalReader.js";
import { retirePending, withRootWriterLock } from "./localDomain.js";
import { readPending } from "./pending.js";
import type { PendingIntent } from "./pending.js";
import { assertArgs } from "./protocol.js";
import type { Request } from "./protocol.js";
import { localPathOutsideRoot, synchronizeAuthority, withCacheTransaction } from "./queryCache.js";
import { findReceipt, requireWriteContext, storeReceipt } from "./receipts.js";

export function resumeOperation(request: Request, rootPath: string, cachePath: string) {
  const root = readRootDescriptor(rootPath);
  return withRootWriterLock(root, () => {
    let completed: PendingIntent | undefined;
    let replayed = false;
    const outcome = withCacheTransaction(cachePath, root, (database) => {
      const authority = synchronizeAuthority(database, root);
      requireWriteContext(request, authority);
      assertArgs(request.args, ["operationId"]);
      if (typeof request.args.operationId !== "string" || request.args.operationId === "")
        throw new CommandError("INVALID_ARGUMENT", "operationId is required");
      const replay = findReceipt(database, request);
      if (replay) {
        replayed = true;
        // A historical receipt can retire its own intent, never unrelated or malformed work.
        try {
          const pending = readPending(root);
          if (pending && pending.operationId === replay.operationId) completed = pending;
        } catch (error) {
          if (!(error instanceof CommandError) || error.code !== "RECOVERY_CONFLICT") throw error;
        }
        return { writeContext: authority.writeContext, result: replay };
      }
      const intent = readPending(root);
      if (!intent || intent.operationId !== request.args.operationId)
        throw new CommandError("OPERATION_UNAVAILABLE", "pending operation is unavailable");
      if (request.dryRun || request.readOnly)
        throw new CommandError(
          "UNSUPPORTED_COMMAND",
          "recovery requires explicit execution, not preview",
        );
      if (intent.cachePath !== localPathOutsideRoot(cachePath, root.rootPath))
        throw new CommandError(
          "RECOVERY_CONFLICT",
          "resume requires the original cache location, or manual reconciliation",
        );
      let originalResult =
        authority.writeContext !== intent.request.writeContext
          ? undefined
          : findReceipt(database, intent.request);
      if (!originalResult && intent.format === "taskdb.pending-order")
        originalResult = commitOrder(database, intent);
      if (!originalResult && intent.format === "taskdb.pending-batch")
        originalResult = commitUndo(database, intent);
      if (!originalResult && intent.format === "taskdb.pending-purge")
        originalResult = commitPurge(database, intent);
      if (!originalResult && intent.format === "taskdb.pending-doctor")
        originalResult = commitDoctor(database, intent);
      const result = { operationId: intent.operationId, outcome: "complete", originalResult };
      // The recovery acknowledgment and original effect/receipt commit together before cleanup.
      storeReceipt(database, request, result);
      completed = intent;
      return { writeContext: authority.writeContext, result };
    });
    if (completed) {
      try {
        switch (completed.format) {
          case "taskdb.pending-order":
            retireOrderStages(completed);
            retirePending(root);
            break;
          case "taskdb.pending-batch":
            retireBatchStages(completed);
            retirePending(root);
            break;
          case "taskdb.pending-purge":
            retirePurgeQuarantines(completed);
            retirePending(root);
            break;
          case "taskdb.pending-doctor":
            retireDoctorStages(completed);
            retirePending(root);
            break;
        }
      } catch (error) {
        // Historical success remains replayable; corrupt cleanup evidence stays pending for inspection.
        if (!replayed || !(error instanceof CommandError) || error.code !== "RECOVERY_CONFLICT")
          throw error;
      }
    }
    return outcome;
  });
}
