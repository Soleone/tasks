import { commitV2Doctor } from "./doctorApply.js";
import { retireV2DoctorStages } from "./doctorJournal.js";
import { CommandError } from "./errors.js";
import { readV2ControlRoot } from "./controlRoot.js";
import { retireV2Copy } from "./copyJournal.js";
import { commitV2Copy } from "./copyWriter.js";
import { retireV2Create } from "./createJournal.js";
import { commitV2LegacyCreate } from "./createWriter.js";
import { retireV2Init } from "./initJournal.js";
import { commitV2Init } from "./lifecycleWriter.js";
import { retireV2BatchStages } from "./batchJournal.js";
import { commitV2Undo } from "./undoWriter.js";
import { retireV2PurgeQuarantines } from "./purgeJournal.js";
import { commitV2Purge } from "./purgeWriter.js";
import { retireV2OrderStages } from "./orderJournal.js";
import { commitV2Order } from "./orderWriter.js";
import { retireV2Pending, withV2RootWriterLock } from "./localDomain.js";
import { readV2Pending } from "./pending.js";
import type { V2PendingIntent } from "./pending.js";
import { assertV2Args } from "./protocol.js";
import type { V2Request } from "./protocol.js";
import { localPathOutsideV2Root, synchronizeV2Authority, withV2CacheTransaction } from "./queryCache.js";
import { findV2Receipt, findV2TaskEditReceipt, requireV2WriteContext, storeV2Receipt } from "./receipts.js";
import { applyV2Journal, guardV2Update } from "./updateJournal.js";
import { commitV2Update } from "./updateWriter.js";
import { isV2WindowsProofIntent } from "./windowsTaskProof.js";

export function resumeV2Operation(request: V2Request, rootPath: string, cachePath: string, windowsTaskProof = false) {
  const root = readV2ControlRoot(rootPath);
  return withV2RootWriterLock(root, () => {
    let completed: V2PendingIntent | undefined;
    let replayed = false;
    const outcome = withV2CacheTransaction(cachePath, root, database => {
      const authority = synchronizeV2Authority(database, root);
      requireV2WriteContext(request, authority);
      assertV2Args(request.args, ["operationId"]);
      if (typeof request.args.operationId !== "string" || request.args.operationId === "") throw new CommandError("INVALID_ARGUMENT", "operationId is required");
      const replay = findV2Receipt(database, request);
      if (replay) {
        replayed = true;
        // A historical receipt can retire its own intent, never unrelated or malformed work.
        try {
          const pending = readV2Pending(root);
          if (pending && pending.operationId === replay.operationId) {
            if (windowsTaskProof && !isV2WindowsProofIntent(pending)) {
              throw new CommandError("UNSUPPORTED_COMMAND", "Windows proof requires a supported intent and destination scope");
            }
            completed = pending;
          }
        } catch (error) { if (!(error instanceof CommandError) || error.code !== "RECOVERY_CONFLICT") throw error; }
        return { writeContext: authority.writeContext, result: replay };
      }
      const intent = readV2Pending(root);
      if (!intent || intent.operationId !== request.args.operationId) throw new CommandError("OPERATION_UNAVAILABLE", "pending operation is unavailable");
      if (windowsTaskProof && !isV2WindowsProofIntent(intent)) {
        throw new CommandError("UNSUPPORTED_COMMAND", "Windows proof requires a supported intent and destination scope");
      }
      if (intent.format === "taskdb.pending-copy-target") throw new CommandError("RECOVERY_CONFLICT", `resume copy from its original selected root: ${intent.owner.rootPath}`);
      if (request.dryRun || request.readOnly) throw new CommandError("UNSUPPORTED_COMMAND", "recovery requires explicit execution, not preview");
      if (intent.cachePath !== localPathOutsideV2Root(cachePath, root.rootPath)) throw new CommandError("RECOVERY_CONFLICT", "resume requires the original cache location, or manual reconciliation");
      const originalReceipt = authority.writeContext !== intent.request.writeContext ? undefined
        : intent.format === "taskdb.pending-update" ? findV2TaskEditReceipt(database, intent.request)
        : findV2Receipt(database, intent.request);
      let originalResult = originalReceipt;
      if (!originalResult && intent.format === "taskdb.pending-update") {
        const guarded = guardV2Update(intent, true);
        const budget = database.prepare("SELECT counter, revision FROM v2_query_state WHERE singleton = 1").get()!;
        if (!Number.isSafeInteger((budget.counter as number) + guarded.tasks.length * 3 + 4) || !Number.isSafeInteger((budget.revision as number) + 3)) throw new CommandError("UNSUPPORTED_COMMAND", "explicit fresh-cache authority is required before recovery");
        const verified = applyV2Journal(intent);
        originalResult = commitV2Update(database, intent, verified);
      }
      if (!originalResult && intent.format === "taskdb.pending-copy") {
        const recover = () => commitV2Copy(database, intent);
        originalResult = intent.source.rootPath === root.rootPath ? recover() : withV2RootWriterLock(intent.source, () => {
          if (readV2Pending(intent.source)) throw new CommandError("RECOVERY_CONFLICT", "external source has unfinished work");
          return recover();
        });
      }
      if (!originalResult && intent.format === "taskdb.pending-init") originalResult = commitV2Init(database, intent);
      if (!originalResult && intent.format === "taskdb.pending-create") originalResult = commitV2LegacyCreate(database, intent);
      if (!originalResult && intent.format === "taskdb.pending-order") originalResult = commitV2Order(database, intent);
      if (!originalResult && intent.format === "taskdb.pending-batch") originalResult = commitV2Undo(database, intent);
      if (!originalResult && intent.format === "taskdb.pending-purge") originalResult = commitV2Purge(database, intent);
      if (!originalResult && intent.format === "taskdb.pending-doctor") originalResult = commitV2Doctor(database, intent);
      const result = { operationId: intent.operationId, outcome: "complete", originalResult };
      // The recovery acknowledgment and original effect/receipt commit together before cleanup.
      storeV2Receipt(database, request, result);
      completed = intent;
      return { writeContext: authority.writeContext, result };
    });
    if (completed) {
      try {
        switch (completed.format) {
          case "taskdb.pending-copy": retireV2Copy(completed); break;
          case "taskdb.pending-init": retireV2Init(completed); break;
          case "taskdb.pending-create": retireV2Create(completed); break;
          case "taskdb.pending-update": retireV2Pending(root); break;
          case "taskdb.pending-order": retireV2OrderStages(completed); retireV2Pending(root); break;
          case "taskdb.pending-batch": retireV2BatchStages(completed); retireV2Pending(root); break;
          case "taskdb.pending-purge": retireV2PurgeQuarantines(completed); retireV2Pending(root); break;
          case "taskdb.pending-doctor": retireV2DoctorStages(completed); retireV2Pending(root); break;
          case "taskdb.pending-copy-target": throw new CommandError("RECOVERY_CONFLICT", "copy target must be retired by its original owner");
        }
      } catch (error) {
        // Historical success remains replayable; corrupt cleanup evidence stays pending for inspection.
        if (!replayed || !(error instanceof CommandError) || error.code !== "RECOVERY_CONFLICT") throw error;
      }
    }
    return outcome;
  });
}
