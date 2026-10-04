import { commitV2Doctor } from "./v2DoctorApply.js";
import { retireV2DoctorStages } from "./v2DoctorJournal.js";
import { CommandError } from "./errors.js";
import { readV2ControlRoot } from "./v2ControlRoot.js";
import { retireV2Copy } from "./v2CopyJournal.js";
import { commitV2Copy } from "./v2CopyWriter.js";
import { retireV2Create } from "./v2CreateJournal.js";
import { commitV2Create } from "./v2CreateWriter.js";
import { retireV2Init } from "./v2InitJournal.js";
import { commitV2Init } from "./v2LifecycleWriter.js";
import { retireV2BatchStages } from "./v2BatchJournal.js";
import { commitV2Undo } from "./v2UndoWriter.js";
import { retireV2PurgeQuarantines } from "./v2PurgeJournal.js";
import { commitV2Purge } from "./v2PurgeWriter.js";
import { retireV2OrderStages } from "./v2OrderJournal.js";
import { commitV2Order } from "./v2OrderWriter.js";
import { retireV2Pending, withV2RootWriterLock } from "./v2LocalDomain.js";
import { readV2Pending } from "./v2Pending.js";
import type { V2PendingIntent } from "./v2Pending.js";
import { assertV2Args } from "./v2Protocol.js";
import type { V2Request } from "./v2Protocol.js";
import { localPathOutsideV2Root, synchronizeV2Authority, withV2CacheTransaction } from "./v2QueryCache.js";
import { findV2Receipt, findV2TaskEditReceipt, requireV2WriteContext, storeV2Receipt } from "./v2Receipts.js";
import { applyV2Journal, guardV2Update } from "./v2UpdateJournal.js";
import { commitV2Update } from "./v2UpdateWriter.js";

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
            if (windowsTaskProof && !((pending.format === "taskdb.pending-update" && pending.request.command === "task.update")
              || (pending.format === "taskdb.pending-create" && pending.request.command === "task.create"))) {
              throw new CommandError("UNSUPPORTED_COMMAND", "Windows proof can recover only task.create/task.update intents");
            }
            completed = pending;
          }
        } catch (error) { if (!(error instanceof CommandError) || error.code !== "RECOVERY_CONFLICT") throw error; }
        return { writeContext: authority.writeContext, result: replay };
      }
      const intent = readV2Pending(root);
      if (!intent || intent.operationId !== request.args.operationId) throw new CommandError("OPERATION_UNAVAILABLE", "pending operation is unavailable");
      if (windowsTaskProof && !((intent.format === "taskdb.pending-update" && intent.request.command === "task.update")
        || (intent.format === "taskdb.pending-create" && intent.request.command === "task.create"))) {
        throw new CommandError("UNSUPPORTED_COMMAND", "Windows proof can recover only task.create/task.update intents");
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
      if (!originalResult && intent.format === "taskdb.pending-create") originalResult = commitV2Create(database, intent);
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
