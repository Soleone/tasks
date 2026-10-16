import { commitDoctor } from "./doctorApply.js";
import { retireDoctorStages } from "./doctorJournal.js";
import { CommandError } from "./errors.js";
import { readControlRoot } from "./controlRoot.js";
import { retireCopy } from "./copyJournal.js";
import { commitCopy } from "./copyWriter.js";
import { retireInit } from "./initJournal.js";
import { commitInit } from "./lifecycleWriter.js";
import { retireBatchStages } from "./batchJournal.js";
import { commitUndo } from "./undoWriter.js";
import { retirePurgeQuarantines } from "./purgeJournal.js";
import { commitPurge } from "./purgeWriter.js";
import { retireOrderStages } from "./orderJournal.js";
import { commitOrder } from "./orderWriter.js";
import { retirePending, withRootWriterLock } from "./localDomain.js";
import { readPending } from "./pending.js";
import type { PendingIntent } from "./pending.js";
import { assertArgs } from "./protocol.js";
import type { Request } from "./protocol.js";
import { localPathOutsideRoot, synchronizeAuthority, withCacheTransaction } from "./queryCache.js";
import { findReceipt, findTaskEditReceipt, requireWriteContext, storeReceipt } from "./receipts.js";
import { applyJournal, guardUpdate } from "./updateJournal.js";
import { commitUpdate } from "./updateWriter.js";

export function resumeOperation(request: Request, rootPath: string, cachePath: string) {
  const root = readControlRoot(rootPath);
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
      if (intent.format === "taskdb.pending-copy-target")
        throw new CommandError(
          "RECOVERY_CONFLICT",
          `resume copy from its original selected root: ${intent.owner.rootPath}`,
        );
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
      const originalReceipt =
        authority.writeContext !== intent.request.writeContext
          ? undefined
          : intent.format === "taskdb.pending-update"
            ? findTaskEditReceipt(database, intent.request)
            : findReceipt(database, intent.request);
      let originalResult = originalReceipt;
      if (!originalResult && intent.format === "taskdb.pending-update") {
        const guarded = guardUpdate(intent, true);
        const budget = database
          .prepare("SELECT counter, revision FROM v2_query_state WHERE singleton = 1")
          .get()!;
        if (
          !Number.isSafeInteger((budget.counter as number) + guarded.tasks.length * 3 + 4) ||
          !Number.isSafeInteger((budget.revision as number) + 3)
        )
          throw new CommandError(
            "UNSUPPORTED_COMMAND",
            "explicit fresh-cache authority is required before recovery",
          );
        const verified = applyJournal(intent);
        originalResult = commitUpdate(database, intent, verified);
      }
      if (!originalResult && intent.format === "taskdb.pending-copy") {
        const recover = () => commitCopy(database, intent);
        originalResult =
          intent.source.rootPath === root.rootPath
            ? recover()
            : withRootWriterLock(intent.source, () => {
                if (readPending(intent.source))
                  throw new CommandError(
                    "RECOVERY_CONFLICT",
                    "external source has unfinished work",
                  );
                return recover();
              });
      }
      if (!originalResult && intent.format === "taskdb.pending-init")
        originalResult = commitInit(database, intent);
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
          case "taskdb.pending-copy":
            retireCopy(completed);
            break;
          case "taskdb.pending-init":
            retireInit(completed);
            break;
          case "taskdb.pending-update":
            retirePending(root);
            break;
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
          case "taskdb.pending-copy-target":
            throw new CommandError(
              "RECOVERY_CONFLICT",
              "copy target must be retired by its original owner",
            );
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
