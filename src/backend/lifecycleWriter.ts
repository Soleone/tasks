import { randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CommandError } from "./errors.js";
import { readV2CanonicalRoot, readV2PhysicalRoot, readV2RootDescriptor } from "./canonicalReader.js";
import { guardCopySource } from "./copyFiles.js";
import { applyV2InitJournal, inspectV2InitRoot, parseV2InitIntent, retireV2Init } from "./initJournal.js";
import type { V2InitIntent } from "./initJournal.js";
import { persistV2Pending, withV2RootWriterLock } from "./localDomain.js";
import { readV2Pending } from "./pending.js";
import { assertV2Args } from "./protocol.js";
import type { V2Request } from "./protocol.js";
import { localPathOutsideV2Root, rebuildV2QueryAuthority, synchronizeV2Authority, withV2CacheTransaction } from "./queryCache.js";
import { findV2Receipt, requireV2WriteContext, storeV2Receipt } from "./receipts.js";

function requireInitAuthorityBudget(database: DatabaseSync): void {
  const state = database.prepare("SELECT counter, revision FROM v2_query_state WHERE singleton = 1").get()!;
  if (!Number.isSafeInteger((state.counter as number) + 2) || !Number.isSafeInteger((state.revision as number) + 2)) {
    throw new CommandError("UNSUPPORTED_COMMAND", "explicit fresh-cache authority is required before initialization");
  }
}

export function commitV2Init(database: DatabaseSync, intent: V2InitIntent): Record<string, unknown> {
  requireInitAuthorityBudget(database);
  const snapshot = applyV2InitJournal(intent);
  const authority = synchronizeV2Authority(database, intent.root, snapshot);
  const result = { schemaVersion: 2, changed: true };
  if (authority.writeContext === intent.request.writeContext) storeV2Receipt(database, intent.request, result);
  return result;
}

export function executeV2Lifecycle(request: V2Request, rootPath: string, cachePath: string) {
  const initializing = request.command === "workspace.init";
  const root = initializing ? readV2PhysicalRoot(rootPath) : readV2RootDescriptor(rootPath);
  // Init permits absence, not a foreign/malformed/replaced descriptor or a schema upgrade.
  if (initializing && lstatSync(path.join(root.rootPath, "workspace.json"), { throwIfNoEntry: false })) readV2RootDescriptor(root.rootPath);
  return withV2RootWriterLock(root, () => {
    let completed: V2InitIntent | undefined;
    const outcome = withV2CacheTransaction(cachePath, root, database => {
      const authority = synchronizeV2Authority(database, root);
      requireV2WriteContext(request, authority);
      assertV2Args(request.args, []);
      const receipt = findV2Receipt(database, request);
      if (receipt) return { writeContext: authority.writeContext, result: receipt };
      if (readV2Pending(root)) throw new CommandError("RECOVERY_PENDING", "selected root has an unfinished intent");
      if (initializing) {
        const baseline = inspectV2InitRoot(root);
        if (request.readOnly || request.dryRun) return { writeContext: authority.writeContext, result: { schemaVersion: 2, changed: true, readOnly: request.readOnly, dryRun: request.dryRun } };
        const intent = parseV2InitIntent({
          format: "taskdb.pending-init", version: 1, root, cachePath: localPathOutsideV2Root(cachePath, root.rootPath),
          request, operationId: randomUUID(), baseline,
        }, root);
        if (JSON.stringify(inspectV2InitRoot(root)) !== JSON.stringify(baseline)) throw new CommandError("STALE_SCOPE", "empty root changed before initialization");
        requireInitAuthorityBudget(database);
        persistV2Pending(root, intent);
        const result = commitV2Init(database, intent);
        completed = intent;
        return { writeContext: authority.writeContext, result };
      }
      const snapshot = readV2CanonicalRoot(root.rootPath);
      if (snapshot.rootIdentity !== root.rootIdentity) throw new CommandError("STALE_WRITE_CONTEXT", "selected root changed during observation");
      guardCopySource(snapshot);
      if (request.readOnly || request.dryRun) return { writeContext: authority.writeContext, result: { taskCount: snapshot.tasks.length, changed: true, workspaceRevision: authority.workspaceRevision, readOnly: request.readOnly, dryRun: request.dryRun } };
      const rebuilt = rebuildV2QueryAuthority(database, root, snapshot);
      guardCopySource(snapshot);
      const result = { taskCount: snapshot.tasks.length, changed: true, workspaceRevision: rebuilt.workspaceRevision };
      storeV2Receipt(database, request, result);
      return { writeContext: rebuilt.writeContext, result };
    });
    if (completed) retireV2Init(completed);
    return outcome;
  });
}
