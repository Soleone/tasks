import { randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CommandError } from "./errors.js";
import { readCanonicalRoot, readPhysicalRoot, readRootDescriptor } from "./canonicalReader.js";
import { guardCopySource } from "./copyFiles.js";
import { applyInitJournal, inspectInitRoot, parseInitIntent, retireInit } from "./initJournal.js";
import type { InitIntent } from "./initJournal.js";
import { persistPending, withRootWriterLock } from "./localDomain.js";
import { readPending } from "./pending.js";
import { assertArgs } from "./protocol.js";
import type { Request } from "./protocol.js";
import { localPathOutsideRoot, rebuildQueryAuthority, synchronizeAuthority, withCacheTransaction } from "./queryCache.js";
import { findReceipt, requireWriteContext, storeReceipt } from "./receipts.js";

function requireInitAuthorityBudget(database: DatabaseSync): void {
  const state = database.prepare("SELECT counter, revision FROM v2_query_state WHERE singleton = 1").get()!;
  if (!Number.isSafeInteger((state.counter as number) + 2) || !Number.isSafeInteger((state.revision as number) + 2)) {
    throw new CommandError("UNSUPPORTED_COMMAND", "explicit fresh-cache authority is required before initialization");
  }
}

export function commitInit(database: DatabaseSync, intent: InitIntent): Record<string, unknown> {
  requireInitAuthorityBudget(database);
  const snapshot = applyInitJournal(intent);
  const authority = synchronizeAuthority(database, intent.root, snapshot);
  const result = { schemaVersion: 2, changed: true };
  if (authority.writeContext === intent.request.writeContext) storeReceipt(database, intent.request, result);
  return result;
}

export function executeLifecycle(request: Request, rootPath: string, cachePath: string) {
  const initializing = request.command === "workspace.init";
  const root = initializing ? readPhysicalRoot(rootPath) : readRootDescriptor(rootPath);
  // Init permits absence, not a foreign/malformed/replaced descriptor or a schema upgrade.
  if (initializing && lstatSync(path.join(root.rootPath, "workspace.json"), { throwIfNoEntry: false })) readRootDescriptor(root.rootPath);
  return withRootWriterLock(root, () => {
    let completed: InitIntent | undefined;
    const outcome = withCacheTransaction(cachePath, root, database => {
      const authority = synchronizeAuthority(database, root);
      requireWriteContext(request, authority);
      assertArgs(request.args, []);
      const receipt = findReceipt(database, request);
      if (receipt) return { writeContext: authority.writeContext, result: receipt };
      if (readPending(root)) throw new CommandError("RECOVERY_PENDING", "selected root has an unfinished intent");
      if (initializing) {
        const baseline = inspectInitRoot(root);
        if (request.readOnly || request.dryRun) return { writeContext: authority.writeContext, result: { schemaVersion: 2, changed: true, readOnly: request.readOnly, dryRun: request.dryRun } };
        const intent = parseInitIntent({
          format: "taskdb.pending-init", version: 1, root, cachePath: localPathOutsideRoot(cachePath, root.rootPath),
          request, operationId: randomUUID(), baseline,
        }, root);
        if (JSON.stringify(inspectInitRoot(root)) !== JSON.stringify(baseline)) throw new CommandError("STALE_SCOPE", "empty root changed before initialization");
        requireInitAuthorityBudget(database);
        persistPending(root, intent);
        const result = commitInit(database, intent);
        completed = intent;
        return { writeContext: authority.writeContext, result };
      }
      const snapshot = readCanonicalRoot(root.rootPath);
      if (snapshot.rootIdentity !== root.rootIdentity) throw new CommandError("STALE_WRITE_CONTEXT", "selected root changed during observation");
      guardCopySource(snapshot);
      if (request.readOnly || request.dryRun) return { writeContext: authority.writeContext, result: { taskCount: snapshot.tasks.length, changed: true, workspaceRevision: authority.workspaceRevision, readOnly: request.readOnly, dryRun: request.dryRun } };
      const rebuilt = rebuildQueryAuthority(database, root, snapshot);
      guardCopySource(snapshot);
      const result = { taskCount: snapshot.tasks.length, changed: true, workspaceRevision: rebuilt.workspaceRevision };
      storeReceipt(database, request, result);
      return { writeContext: rebuilt.writeContext, result };
    });
    if (completed) retireInit(completed);
    return outcome;
  });
}
