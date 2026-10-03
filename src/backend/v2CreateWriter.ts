import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CommandError } from "./errors.js";
import { readV2CanonicalRoot, readV2RootDescriptor } from "./v2CanonicalReader.js";
import { directoryIdentity, guardCopySource } from "./v2CopyFiles.js";
import { buildV2CreatedTask, parseV2Create } from "./v2CreateInputs.js";
import { applyV2CreateJournal, guardV2Create, parseV2CreateIntent, prepareV2CreateProgress, retireV2Create } from "./v2CreateJournal.js";
import type { V2CreateIntent } from "./v2CreateJournal.js";
import { persistV2Pending, syncV2Directory, withV2RootWriterLock } from "./v2LocalDomain.js";
import { readV2Pending } from "./v2Pending.js";
import { projectV2Tasks } from "./v2Queries.js";
import type { V2Request } from "./v2Protocol.js";
import { localPathOutsideV2Root, synchronizeV2Authority, withV2CacheTransaction } from "./v2QueryCache.js";
import { findV2Receipt, requireV2WriteContext, storeV2Receipt } from "./v2Receipts.js";

function requireCreateBudget(database: DatabaseSync, taskCount: number): number {
  const budget = database.prepare("SELECT counter, revision FROM v2_query_state WHERE singleton = 1").get()!;
  if (!Number.isSafeInteger((budget.counter as number) + taskCount * 3 + 7) || !Number.isSafeInteger((budget.revision as number) + 3)) {
    throw new CommandError("UNSUPPORTED_COMMAND", "explicit fresh-cache authority is required before capture");
  }
  return (budget.counter as number) + 1;
}

export function commitV2Create(database: DatabaseSync, intent: V2CreateIntent): Record<string, unknown> {
  const before = guardV2Create(intent);
  requireCreateBudget(database, before.tasks.length);
  const snapshot = applyV2CreateJournal(intent);
  const authority = synchronizeV2Authority(database, intent.root, snapshot);
  const task = projectV2Tasks(snapshot.tasks, authority).find(task => task.id === intent.taskId)!;
  database.prepare("INSERT INTO v2_operations VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(intent.operationId, authority.writeContext, intent.taskId, "task.create", JSON.stringify(intent.request.actor), intent.at, "null", JSON.stringify(snapshot.tasks.find(task => task.id === intent.taskId)));
  const result = { task, changed: true, operationId: intent.operationId };
  if (authority.writeContext === intent.request.writeContext) storeV2Receipt(database, intent.request, result);
  return result;
}

export function executeV2Create(request: V2Request, rootPath: string, cachePath: string) {
  const root = readV2RootDescriptor(rootPath);
  return withV2RootWriterLock(root, () => {
    let completed: V2CreateIntent | undefined;
    const outcome = withV2CacheTransaction(cachePath, root, database => {
      let authority = synchronizeV2Authority(database, root);
      requireV2WriteContext(request, authority);
      const input = parseV2Create(request.args);
      const receipt = findV2Receipt(database, request);
      if (receipt) return { writeContext: authority.writeContext, result: receipt };
      if (readV2Pending(root)) throw new CommandError("RECOVERY_PENDING", "root has an unfinished intent");
      const snapshot = readV2CanonicalRoot(root.rootPath);
      if (snapshot.rootIdentity !== root.rootIdentity) throw new CommandError("STALE_WRITE_CONTEXT", "physical root changed during observation");
      guardCopySource(snapshot);
      authority = synchronizeV2Authority(database, root, snapshot);
      requireV2WriteContext(request, authority);
      const previewVersion = requireCreateBudget(database, snapshot.tasks.length);
      const taskId = randomUUID();
      if (snapshot.files.some(file => file.relativePath.startsWith("tasks/") && path.basename(file.relativePath).split(".")[0].toLowerCase() === taskId)) {
        throw new CommandError("STALE_SCOPE", "capture ID collides with an observed canonical or conflict filename");
      }
      const at = new Date().toISOString();
      const task = buildV2CreatedTask(input, { id: taskId, at }, snapshot.tasks);
      if (request.readOnly || request.dryRun) {
        // Preview tokens are hypothetical, not allocated/reserved authority for a future execution.
        const previewAuthority = { ...authority, versions: new Map([...authority.versions, [taskId, previewVersion]]) };
        return { writeContext: authority.writeContext, result: { task: projectV2Tasks([task, ...snapshot.tasks], previewAuthority)[0], changed: true, readOnly: request.readOnly, dryRun: request.dryRun } };
      }
      const intent = parseV2CreateIntent({
        format: "taskdb.pending-create", version: 1, root, cachePath: localPathOutsideV2Root(cachePath, root.rootPath), request,
        operationId: randomUUID(), at, taskId, taskDirectoryIdentity: directoryIdentity(path.join(root.rootPath, "tasks")),
        nextBytes: Buffer.from(`${JSON.stringify(task)}\n`).toString("base64"), guards: snapshot.files,
      }, root);
      guardCopySource(snapshot);
      syncV2Directory(path.join(root.rootPath, "tasks"));
      prepareV2CreateProgress(intent);
      guardV2Create(intent);
      persistV2Pending(root, intent);
      const result = commitV2Create(database, intent);
      completed = intent;
      return { writeContext: authority.writeContext, result };
    });
    if (completed) retireV2Create(completed);
    return outcome;
  });
}
