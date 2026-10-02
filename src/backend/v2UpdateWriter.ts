import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CommandError } from "./errors.js";
import { parseV2CanonicalJson } from "./v2CanonicalJson.js";
import { readV2CanonicalRoot, readV2RegularFile, readV2RootDescriptor } from "./v2CanonicalReader.js";
import type { V2CanonicalSnapshot } from "./v2CanonicalReader.js";
import { persistV2Pending, retireV2Pending, syncV2Directory, withV2RootWriterLock } from "./v2LocalDomain.js";
import { projectV2Tasks } from "./v2Queries.js";
import type { V2Request } from "./v2Protocol.js";
import { localPathOutsideV2Root, synchronizeV2Authority, withV2CacheTransaction } from "./v2QueryCache.js";
import { findV2Receipt, requireV2WriteContext, storeV2Receipt } from "./v2Receipts.js";
import { applyV2Update, parseV2Update } from "./v2UpdateInputs.js";
import { readV2Pending } from "./v2Pending.js";
import { applyV2Journal, exactV2Hash, guardV2Update } from "./v2UpdateJournal.js";
import type { V2UpdateIntent } from "./v2UpdateJournal.js";

type WriteOutcome = { writeContext: string; result: Record<string, unknown> };

export function commitV2Update(database: DatabaseSync, intent: V2UpdateIntent, snapshot: V2CanonicalSnapshot): Record<string, unknown> {
  const authority = synchronizeV2Authority(database, intent.root, snapshot);
  const task = projectV2Tasks(snapshot.tasks, authority).find(task => task.id === intent.taskId)!;
  const before = parseV2CanonicalJson(Buffer.from(intent.beforeBytes, "base64"));
  const after = parseV2CanonicalJson(Buffer.from(intent.nextBytes, "base64"));
  database.prepare("INSERT INTO v2_operations VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(intent.operationId, authority.writeContext, intent.taskId, "task.update", JSON.stringify(intent.request.actor), intent.at, JSON.stringify(before), JSON.stringify(after));
  const result = { task, changed: true, operationId: intent.operationId };
  if (authority.writeContext === intent.request.writeContext) storeV2Receipt(database, intent.request, result);
  return result;
}

export function executeV2Update(request: V2Request, rootPath: string, cachePath: string): WriteOutcome {
  const root = readV2RootDescriptor(rootPath);
  return withV2RootWriterLock(root, () => {
    let retire = false;
    const outcome = withV2CacheTransaction(cachePath, root, database => {
      let authority = synchronizeV2Authority(database, root);
      requireV2WriteContext(request, authority);
      const input = parseV2Update(request.args);
      const receipt = findV2Receipt(database, request);
      if (receipt) return { writeContext: authority.writeContext, result: receipt };
      if (readV2Pending(root)) throw new CommandError("RECOVERY_PENDING", "root has an unfinished intent");
      const snapshot = readV2CanonicalRoot(rootPath);
      if (snapshot.rootIdentity !== root.rootIdentity) throw new CommandError("STALE_WRITE_CONTEXT", "physical root changed during observation");
      authority = synchronizeV2Authority(database, root, snapshot);
      requireV2WriteContext(request, authority);
      const task = snapshot.tasks.find(task => task.id === input.id);
      if (!task) throw new CommandError("TASK_NOT_FOUND", "task was not found");
      if (authority.versions.get(task.id) !== input.expectedVersion) throw new CommandError("STALE_TASK_VERSION", "task version changed");
      const at = new Date().toISOString();
      const update = applyV2Update(task, input, at);
      const projected = projectV2Tasks([update.task, ...snapshot.tasks.filter(item => item.id !== task.id)], authority)[0];
      if (request.readOnly || request.dryRun) return { writeContext: authority.writeContext, result: { task: projected, changed: update.changed, readOnly: request.readOnly, dryRun: request.dryRun } };
      if (!update.changed) {
        const result = { task: projected, changed: false };
        storeV2Receipt(database, request, result);
        return { writeContext: authority.writeContext, result };
      }
      const counter = database.prepare("SELECT counter FROM v2_query_state WHERE singleton = 1").get()!.counter as number;
      if (!Number.isSafeInteger(counter + snapshot.tasks.length * 3 + 4)) {
        throw new CommandError("UNSUPPORTED_COMMAND", "version budget is nearly exhausted; explicit fresh-cache authority is required before this write");
      }
      const beforeBytes = readV2RegularFile(path.join(root.rootPath, "tasks", `${task.id}.json`));
      if (exactV2Hash(beforeBytes) !== snapshot.files.find(file => file.relativePath === `tasks/${task.id}.json`)!.sha256) {
        throw new CommandError("STALE_FILE", "task changed before staging");
      }
      const intent: V2UpdateIntent = {
        format: "taskdb.pending-update", version: 1, root, cachePath: localPathOutsideV2Root(cachePath, root.rootPath), request,
        operationId: randomUUID(), at, taskId: task.id,
        beforeBytes: beforeBytes.toString("base64"), nextBytes: Buffer.from(`${JSON.stringify(update.task)}\n`).toString("base64"), guards: snapshot.files,
      };
      guardV2Update(intent, false);
      syncV2Directory(path.join(root.rootPath, "tasks"));
      persistV2Pending(root, intent);
      const verified = applyV2Journal(intent);
      const result = commitV2Update(database, intent, verified);
      retire = true;
      return { writeContext: authority.writeContext, result };
    });
    if (retire) retireV2Pending(root);
    return outcome;
  });
}
