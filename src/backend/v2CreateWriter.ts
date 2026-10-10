import { randomUUID } from "node:crypto";
import { lstatSync, readdirSync, renameSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CommandError } from "./errors.js";
import { readV2CanonicalRoot, readV2PhysicalRoot, readV2RegularFile, readV2RootDescriptor } from "./v2CanonicalReader.js";
import type { V2CanonicalSnapshot } from "./v2CanonicalReader.js";
import { directoryIdentity } from "./v2CopyFiles.js";
import { buildV2CreatedTask, parseV2Create } from "./v2CreateInputs.js";
import { applyV2CreateJournal, guardV2Create } from "./v2CreateJournal.js";
import type { V2CreateIntent } from "./v2CreateJournal.js";
import { syncV2Directory, withV2RootWriterLock, writeV2DurableFile } from "./v2LocalDomain.js";
import { readV2Pending } from "./v2Pending.js";
import { projectV2Tasks } from "./v2Queries.js";
import type { V2Request } from "./v2Protocol.js";
import { synchronizeV2Authority, withV2CacheTransaction } from "./v2QueryCache.js";
import { findV2Receipt, requireV2WriteContext, storeV2Receipt } from "./v2Receipts.js";
import { compareV2Tasks } from "./v2TaskModel.js";
import { exactV2Hash } from "./v2UpdateJournal.js";

function requireCreateBudget(database: DatabaseSync, taskCount: number): number {
  const budget = database.prepare("SELECT counter, revision FROM v2_query_state WHERE singleton = 1").get()!;
  if (!Number.isSafeInteger((budget.counter as number) + taskCount * 3 + 7) || !Number.isSafeInteger((budget.revision as number) + 3)) {
    throw new CommandError("UNSUPPORTED_COMMAND", "explicit fresh-cache authority is required before capture");
  }
  return (budget.counter as number) + 1;
}

/** Explicit recovery only: old pending-create evidence retains its original ownership contract. */
export function commitV2LegacyCreate(database: DatabaseSync, intent: V2CreateIntent): Record<string, unknown> {
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

function guardCreateDestination(snapshot: V2CanonicalSnapshot, taskDirectoryIdentity: string, taskId: string, parentId: string | null): void {
  const root = readV2PhysicalRoot(snapshot.rootPath);
  const taskDirectory = path.join(root.rootPath, "tasks");
  if (root.rootPath !== snapshot.rootPath || root.rootIdentity !== snapshot.rootIdentity || directoryIdentity(taskDirectory) !== taskDirectoryIdentity) {
    throw new CommandError("STALE_SCOPE", "capture physical root or task directory changed");
  }
  if (parentId !== null) {
    const parentPath = `tasks/${parentId}.json`;
    const expected = snapshot.files.find(file => file.relativePath === parentPath)!;
    if (!lstatSync(path.join(root.rootPath, parentPath), { throwIfNoEntry: false })
      || exactV2Hash(readV2RegularFile(path.join(root.rootPath, parentPath))) !== expected.sha256) {
      throw new CommandError("STALE_FILE", "selected capture parent changed");
    }
  }
  if (readdirSync(taskDirectory).some(name => name.split(".")[0].toLowerCase() === taskId)) {
    throw new CommandError("STALE_SCOPE", "capture destination already exists");
  }
}

export function executeV2Create(request: V2Request, rootPath: string, cachePath: string) {
  const root = readV2RootDescriptor(rootPath);
  return withV2RootWriterLock(root, () => withV2CacheTransaction(cachePath, root, database => {
    let authority = synchronizeV2Authority(database, root);
    requireV2WriteContext(request, authority);
    const input = parseV2Create(request.args);
    const receipt = findV2Receipt(database, request);
    if (receipt) return { writeContext: authority.writeContext, result: receipt };
    if (readV2Pending(root)) throw new CommandError("RECOVERY_PENDING", "root has an unfinished intent");
    const taskDirectory = path.join(root.rootPath, "tasks");
    const taskDirectoryIdentity = directoryIdentity(taskDirectory);
    const snapshot = readV2CanonicalRoot(root.rootPath);
    if (snapshot.rootIdentity !== root.rootIdentity) throw new CommandError("STALE_WRITE_CONTEXT", "physical root changed during observation");
    if (readdirSync(root.rootPath).some(name => /^workspace\.sync-conflict-.+\.json$/.test(name))) {
      throw new CommandError("INVALID_CANONICAL", "descriptor conflict copies require explicit inspection before staging");
    }
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
    const operationId = randomUUID();
    const bytes = Buffer.from(`${JSON.stringify(task)}\n`);
    const stage = path.join(taskDirectory, `.syncthing.taskdb-create-${operationId}.tmp`);
    const target = path.join(taskDirectory, `${taskId}.json`);
    writeV2DurableFile(stage, bytes);
    guardCreateDestination(snapshot, taskDirectoryIdentity, taskId, task.parentId);
    // Native rename is not a no-clobber CAS. A post-check arrival is a platform-specific race.
    // Interrupted stages stay orphaned; publication before SQLite commit can duplicate on retry.
    renameSync(stage, target);
    syncV2Directory(taskDirectory);
    const published = {
      ...snapshot,
      tasks: [...snapshot.tasks, task].sort((left, right) => {
        const leftParent = left.parentId ?? "", rightParent = right.parentId ?? "";
        return leftParent === rightParent ? compareV2Tasks(left, right) : leftParent < rightParent ? -1 : 1;
      }),
      files: [snapshot.files[0], ...[...snapshot.files.slice(1), { relativePath: `tasks/${taskId}.json`, sha256: exactV2Hash(bytes) }]
        .sort((left, right) => left.relativePath < right.relativePath ? -1 : 1)],
    };
    authority = synchronizeV2Authority(database, root, published);
    const result = { task: projectV2Tasks(published.tasks, authority).find(task => task.id === taskId)!, changed: true, operationId };
    database.prepare("INSERT INTO v2_operations VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(operationId, authority.writeContext, taskId, "task.create", JSON.stringify(request.actor), at, "null", JSON.stringify(task));
    storeV2Receipt(database, request, result);
    return { writeContext: authority.writeContext, result };
  }));
}
