import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CommandError } from "./errors.js";
import { readCanonicalRoot, readRegularFile, readRootDescriptor } from "./canonicalReader.js";
import { directoryIdentity, guardCopySource } from "./copyFiles.js";
import { persistPending, retirePending, withRootWriterLock } from "./localDomain.js";
import { readPending } from "./pending.js";
import { assertArgs } from "./protocol.js";
import type { Request } from "./protocol.js";
import {
  applyPurgeJournal,
  guardPurge,
  parsePurgeIntent,
  persistPurgeArchive,
  purgeIntentTasks,
  retirePurgeQuarantines,
  purgeFileIdentity,
  purgeRecoveryLocation,
} from "./purgeJournal.js";
import type { PurgeIntent } from "./purgeJournal.js";
import { planPurge } from "./purgePlan.js";
import { localPathOutsideRoot, synchronizeAuthority, withCacheTransaction } from "./queryCache.js";
import { findReceipt, requireWriteContext, storeReceipt } from "./receipts.js";
import { invalidatePurgeUndo } from "./undoHistory.js";
import { exactHash } from "./updateJournal.js";

function requirePurgeBudget(database: DatabaseSync, count: number): void {
  const state = database
    .prepare("SELECT counter, revision FROM v2_query_state WHERE singleton = 1")
    .get()!;
  if (
    !Number.isSafeInteger((state.counter as number) + count * 3 + 8) ||
    !Number.isSafeInteger((state.revision as number) + 3)
  )
    throw new CommandError(
      "UNSUPPORTED_COMMAND",
      "explicit fresh-cache authority is required before purge",
    );
}
export function commitPurge(database: DatabaseSync, intent: PurgeIntent): Record<string, unknown> {
  guardPurge(intent, true);
  requirePurgeBudget(database, purgeIntentTasks(intent).length);
  const snapshot = applyPurgeJournal(intent);
  const authority = synchronizeAuthority(database, intent.root, snapshot);
  invalidatePurgeUndo(database, authority.writeContext, intent.purgedIds, intent.operationId);
  const before = purgeIntentTasks(intent).filter((task) => intent.purgedIds.includes(task.id));
  database
    .prepare("INSERT INTO v2_operations VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(
      intent.operationId,
      authority.writeContext,
      intent.purgedIds[0],
      intent.request.command,
      JSON.stringify(intent.request.actor),
      intent.at,
      JSON.stringify({ tasks: before }),
      JSON.stringify({ tasks: [] }),
    );
  const member = database.prepare("INSERT INTO v2_operation_members VALUES (?, ?)");
  for (const id of intent.purgedIds) member.run(intent.operationId, id);
  const result = {
    purgedIds: intent.purgedIds,
    changed: true,
    operationId: intent.operationId,
    recoveryLocation: purgeRecoveryLocation(intent),
  };
  if (authority.writeContext === intent.request.writeContext)
    storeReceipt(database, intent.request, result);
  return result;
}
export function executePurge(request: Request, rootPath: string, cachePath: string) {
  const root = readRootDescriptor(rootPath);
  return withRootWriterLock(root, () => {
    let completed: PurgeIntent | undefined;
    const outcome = withCacheTransaction(cachePath, root, (database) => {
      let authority = synchronizeAuthority(database, root);
      requireWriteContext(request, authority);
      assertArgs(request.args, []);
      const receipt = findReceipt(database, request);
      if (receipt) return { writeContext: authority.writeContext, result: receipt };
      if (readPending(root))
        throw new CommandError("RECOVERY_PENDING", "root has an unfinished intent");
      const snapshot = readCanonicalRoot(root.rootPath);
      if (snapshot.rootIdentity !== root.rootIdentity)
        throw new CommandError("STALE_WRITE_CONTEXT", "physical root changed during observation");
      guardCopySource(snapshot);
      const purgedIds = planPurge(snapshot.tasks);
      if (purgedIds.length && !request.readOnly && !request.dryRun)
        requirePurgeBudget(database, snapshot.tasks.length);
      authority = synchronizeAuthority(database, root, snapshot);
      requireWriteContext(request, authority);
      const result = { purgedIds, changed: purgedIds.length !== 0 };
      if (request.dryRun || request.readOnly)
        return {
          writeContext: authority.writeContext,
          result: { ...result, dryRun: request.dryRun, readOnly: request.readOnly },
        };
      if (!purgedIds.length) {
        storeReceipt(database, request, result);
        return { writeContext: authority.writeContext, result };
      }
      const files = snapshot.files.map((file) => {
        const target = path.join(root.rootPath, file.relativePath),
          identity = purgeFileIdentity(target);
        const before = readRegularFile(target);
        if (exactHash(before) !== file.sha256 || purgeFileIdentity(target) !== identity)
          throw new CommandError("STALE_FILE", "purge source changed before staging");
        return {
          relativePath: file.relativePath,
          beforeBytes: before.toString("base64"),
          identity,
        };
      });
      const intent = parsePurgeIntent(
        {
          format: "taskdb.pending-purge",
          version: 1,
          root,
          taskDirectoryIdentity: directoryIdentity(path.join(root.rootPath, "tasks")),
          cachePath: localPathOutsideRoot(cachePath, root.rootPath),
          request,
          operationId: randomUUID(),
          at: new Date().toISOString(),
          purgedIds,
          files,
        },
        root,
      );
      guardPurge(intent, false);
      persistPurgeArchive(intent);
      guardPurge(intent, false);
      persistPending(root, intent);
      const committed = commitPurge(database, intent);
      completed = intent;
      return { writeContext: authority.writeContext, result: committed };
    });
    if (completed) {
      retirePurgeQuarantines(completed);
      retirePending(root);
    }
    return outcome;
  });
}
