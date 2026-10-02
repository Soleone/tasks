import { CommandError } from "./errors.js";
import { readV2ControlRoot } from "./v2ControlRoot.js";
import { retireV2Copy } from "./v2CopyJournal.js";
import { commitV2Copy } from "./v2CopyWriter.js";
import { retireV2Pending, withV2RootWriterLock } from "./v2LocalDomain.js";
import { readV2Pending } from "./v2Pending.js";
import type { V2PendingIntent } from "./v2Pending.js";
import { assertV2Args } from "./v2Protocol.js";
import type { V2Request } from "./v2Protocol.js";
import { localPathOutsideV2Root, synchronizeV2Authority, withV2CacheTransaction } from "./v2QueryCache.js";
import { findV2Receipt, requireV2WriteContext, storeV2Receipt } from "./v2Receipts.js";
import { applyV2Journal, guardV2Update } from "./v2UpdateJournal.js";
import { commitV2Update } from "./v2UpdateWriter.js";

export function resumeV2Operation(request: V2Request, rootPath: string, cachePath: string) {
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
          if (pending?.operationId === replay.operationId) completed = pending;
        } catch (error) { if (!(error instanceof CommandError) || error.code !== "RECOVERY_CONFLICT") throw error; }
        return { writeContext: authority.writeContext, result: replay };
      }
      const intent = readV2Pending(root);
      if (!intent || intent.operationId !== request.args.operationId) throw new CommandError("OPERATION_UNAVAILABLE", "pending operation is unavailable");
      if (intent.format === "taskdb.pending-copy-target") throw new CommandError("RECOVERY_CONFLICT", `resume copy from its original selected root: ${intent.owner.rootPath}`);
      if (request.dryRun || request.readOnly) throw new CommandError("UNSUPPORTED_COMMAND", "recovery requires explicit execution, not preview");
      if (intent.cachePath !== localPathOutsideV2Root(cachePath, root.rootPath)) throw new CommandError("RECOVERY_CONFLICT", "resume requires the original cache location, or manual reconciliation");
      const originalReceipt = authority.writeContext === intent.request.writeContext ? findV2Receipt(database, intent.request) : undefined;
      let originalResult = originalReceipt;
      if (!originalResult && intent.format === "taskdb.pending-update") {
        const guarded = guardV2Update(intent, true);
        const counter = database.prepare("SELECT counter FROM v2_query_state WHERE singleton = 1").get()!.counter as number;
        if (!Number.isSafeInteger(counter + guarded.tasks.length * 3 + 4)) throw new CommandError("UNSUPPORTED_COMMAND", "explicit fresh-cache authority is required before recovery");
        originalResult = commitV2Update(database, intent, applyV2Journal(intent));
      }
      if (!originalResult && intent.format === "taskdb.pending-copy") {
        const recover = () => commitV2Copy(database, intent);
        originalResult = intent.source.rootPath === root.rootPath ? recover() : withV2RootWriterLock(intent.source, () => {
          if (readV2Pending(intent.source)) throw new CommandError("RECOVERY_CONFLICT", "external source has unfinished work");
          return recover();
        });
      }
      const result = { operationId: intent.operationId, outcome: "complete", originalResult };
      storeV2Receipt(database, request, result);
      completed = intent;
      return { writeContext: authority.writeContext, result };
    });
    if (completed?.format === "taskdb.pending-copy") {
      try { retireV2Copy(completed); } catch (error) {
        // Historical success remains replayable; corrupt cleanup evidence stays pending for inspection.
        if (!replayed || !(error instanceof CommandError) || error.code !== "RECOVERY_CONFLICT") throw error;
      }
    }
    if (completed?.format === "taskdb.pending-update") retireV2Pending(root);
    return outcome;
  });
}
