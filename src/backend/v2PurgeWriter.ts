import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CommandError } from "./errors.js";
import { readV2CanonicalRoot, readV2RegularFile, readV2RootDescriptor } from "./v2CanonicalReader.js";
import { directoryIdentity, guardCopySource } from "./v2CopyFiles.js";
import { persistV2Pending, retireV2Pending, withV2RootWriterLock } from "./v2LocalDomain.js";
import { readV2Pending } from "./v2Pending.js";
import { assertV2Args } from "./v2Protocol.js";
import type { V2Request } from "./v2Protocol.js";
import { applyV2PurgeJournal, guardV2Purge, parseV2PurgeIntent, persistV2PurgeArchive, purgeIntentTasks, retireV2PurgeQuarantines, v2PurgeFileIdentity, v2PurgeRecoveryLocation } from "./v2PurgeJournal.js";
import type { V2PurgeIntent } from "./v2PurgeJournal.js";
import { planV2Purge } from "./v2PurgePlan.js";
import { localPathOutsideV2Root, synchronizeV2Authority, withV2CacheTransaction } from "./v2QueryCache.js";
import { findV2Receipt, requireV2WriteContext, storeV2Receipt } from "./v2Receipts.js";
import { invalidateV2PurgeUndo } from "./v2UndoHistory.js";
import { exactV2Hash } from "./v2UpdateJournal.js";

function requirePurgeBudget(database: DatabaseSync, count: number): void {
  const state = database.prepare("SELECT counter, revision FROM v2_query_state WHERE singleton = 1").get()!;
  if (!Number.isSafeInteger((state.counter as number) + count * 3 + 8) || !Number.isSafeInteger((state.revision as number) + 3)) throw new CommandError("UNSUPPORTED_COMMAND", "explicit fresh-cache authority is required before purge");
}
export function commitV2Purge(database: DatabaseSync, intent: V2PurgeIntent): Record<string, unknown> {
  guardV2Purge(intent, true);
  requirePurgeBudget(database, purgeIntentTasks(intent).length);
  const snapshot = applyV2PurgeJournal(intent);
  const authority = synchronizeV2Authority(database, intent.root, snapshot);
  invalidateV2PurgeUndo(database, authority.writeContext, intent.purgedIds, intent.operationId);
  const before = purgeIntentTasks(intent).filter(task => intent.purgedIds.includes(task.id));
  database.prepare("INSERT INTO v2_operations VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(intent.operationId, authority.writeContext, intent.purgedIds[0], intent.request.command, JSON.stringify(intent.request.actor), intent.at, JSON.stringify({ tasks: before }), JSON.stringify({ tasks: [] }));
  const member = database.prepare("INSERT INTO v2_operation_members VALUES (?, ?)");
  for (const id of intent.purgedIds) member.run(intent.operationId, id);
  const result = { purgedIds: intent.purgedIds, changed: true, operationId: intent.operationId, recoveryLocation: v2PurgeRecoveryLocation(intent) };
  if (authority.writeContext === intent.request.writeContext) storeV2Receipt(database, intent.request, result);
  return result;
}
export function executeV2Purge(request: V2Request, rootPath: string, cachePath: string) {
  const root = readV2RootDescriptor(rootPath);
  return withV2RootWriterLock(root, () => {
    let completed: V2PurgeIntent | undefined;
    const outcome = withV2CacheTransaction(cachePath, root, database => {
      let authority = synchronizeV2Authority(database, root);
      requireV2WriteContext(request, authority);
      assertV2Args(request.args, []);
      const receipt = findV2Receipt(database, request);
      if (receipt) return { writeContext: authority.writeContext, result: receipt };
      if (readV2Pending(root)) throw new CommandError("RECOVERY_PENDING", "root has an unfinished intent");
      const snapshot = readV2CanonicalRoot(root.rootPath);
      if (snapshot.rootIdentity !== root.rootIdentity) throw new CommandError("STALE_WRITE_CONTEXT", "physical root changed during observation");
      guardCopySource(snapshot);
      const purgedIds = planV2Purge(snapshot.tasks);
      if (purgedIds.length && !request.readOnly && !request.dryRun) requirePurgeBudget(database, snapshot.tasks.length);
      authority = synchronizeV2Authority(database, root, snapshot);
      requireV2WriteContext(request, authority);
      const result = { purgedIds, changed: purgedIds.length !== 0 };
      if (request.dryRun || request.readOnly) return { writeContext: authority.writeContext, result: { ...result, dryRun: request.dryRun, readOnly: request.readOnly } };
      if (!purgedIds.length) { storeV2Receipt(database, request, result); return { writeContext: authority.writeContext, result }; }
      const files = snapshot.files.map(file => {
        const target = path.join(root.rootPath, file.relativePath), identity = v2PurgeFileIdentity(target);
        const before = readV2RegularFile(target);
        if (exactV2Hash(before) !== file.sha256 || v2PurgeFileIdentity(target) !== identity) throw new CommandError("STALE_FILE", "purge source changed before staging");
        return { relativePath: file.relativePath, beforeBytes: before.toString("base64"), identity };
      });
      const intent = parseV2PurgeIntent({ format: "taskdb.pending-purge", version: 1, root, taskDirectoryIdentity: directoryIdentity(path.join(root.rootPath, "tasks")), cachePath: localPathOutsideV2Root(cachePath, root.rootPath), request, operationId: randomUUID(), at: new Date().toISOString(), purgedIds, files }, root);
      guardV2Purge(intent, false);
      persistV2PurgeArchive(intent);
      guardV2Purge(intent, false);
      persistV2Pending(root, intent);
      const committed = commitV2Purge(database, intent);
      completed = intent;
      return { writeContext: authority.writeContext, result: committed };
    });
    if (completed) { retireV2PurgeQuarantines(completed); retireV2Pending(root); }
    return outcome;
  });
}
