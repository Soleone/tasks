import { randomUUID } from "node:crypto";
import { lstatSync, readdirSync, renameSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CommandError } from "./errors.js";
import { readCanonicalRoot, readPhysicalRoot, readRegularFile, readRootDescriptor } from "./canonicalReader.js";
import type { CanonicalSnapshot } from "./canonicalReader.js";
import { directoryIdentity } from "./copyFiles.js";
import { buildCreatedTask, parseCreate } from "./createInputs.js";
import { applyCreateJournal, guardCreateIntent } from "./createJournal.js";
import type { CreateIntent } from "./createJournal.js";
import { syncDirectory, withRootWriterLock, writeDurableFile } from "./localDomain.js";
import { readPending } from "./pending.js";
import { projectTasks } from "./queries.js";
import type { Request } from "./protocol.js";
import { synchronizeAuthority, withCacheTransaction } from "./queryCache.js";
import { findReceipt, requireWriteContext, storeReceipt } from "./receipts.js";
import { compareTasks } from "./taskModel.js";
import { exactHash } from "./updateJournal.js";

function requireCreateBudget(database: DatabaseSync, taskCount: number): number {
  const budget = database.prepare("SELECT counter, revision FROM v2_query_state WHERE singleton = 1").get()!;
  if (!Number.isSafeInteger((budget.counter as number) + taskCount * 3 + 7) || !Number.isSafeInteger((budget.revision as number) + 3)) {
    throw new CommandError("UNSUPPORTED_COMMAND", "explicit fresh-cache authority is required before capture");
  }
  return (budget.counter as number) + 1;
}

/** Explicit recovery only: old pending-create evidence retains its original ownership contract. */
export function commitLegacyCreate(database: DatabaseSync, intent: CreateIntent): Record<string, unknown> {
  const before = guardCreateIntent(intent);
  requireCreateBudget(database, before.tasks.length);
  const snapshot = applyCreateJournal(intent);
  const authority = synchronizeAuthority(database, intent.root, snapshot);
  const task = projectTasks(snapshot.tasks, authority).find(task => task.id === intent.taskId)!;
  database.prepare("INSERT INTO v2_operations VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(intent.operationId, authority.writeContext, intent.taskId, "task.create", JSON.stringify(intent.request.actor), intent.at, "null", JSON.stringify(snapshot.tasks.find(task => task.id === intent.taskId)));
  const result = { task, changed: true, operationId: intent.operationId };
  if (authority.writeContext === intent.request.writeContext) storeReceipt(database, intent.request, result);
  return result;
}

function guardCreateDestination(snapshot: CanonicalSnapshot, taskDirectoryIdentity: string, taskId: string, parentId: string | null): void {
  const root = readPhysicalRoot(snapshot.rootPath);
  const taskDirectory = path.join(root.rootPath, "tasks");
  if (root.rootPath !== snapshot.rootPath || root.rootIdentity !== snapshot.rootIdentity || directoryIdentity(taskDirectory) !== taskDirectoryIdentity) {
    throw new CommandError("STALE_SCOPE", "capture physical root or task directory changed");
  }
  if (parentId !== null) {
    const parentPath = `tasks/${parentId}.json`;
    const expected = snapshot.files.find(file => file.relativePath === parentPath)!;
    if (!lstatSync(path.join(root.rootPath, parentPath), { throwIfNoEntry: false })
      || exactHash(readRegularFile(path.join(root.rootPath, parentPath))) !== expected.sha256) {
      throw new CommandError("STALE_FILE", "selected capture parent changed");
    }
  }
  if (readdirSync(taskDirectory).some(name => name.split(".")[0].toLowerCase() === taskId)) {
    throw new CommandError("STALE_SCOPE", "capture destination already exists");
  }
}

export function executeCreate(request: Request, rootPath: string, cachePath: string) {
  const root = readRootDescriptor(rootPath);
  return withRootWriterLock(root, () => withCacheTransaction(cachePath, root, database => {
    let authority = synchronizeAuthority(database, root);
    requireWriteContext(request, authority);
    const input = parseCreate(request.args);
    const receipt = findReceipt(database, request);
    if (receipt) return { writeContext: authority.writeContext, result: receipt };
    if (readPending(root)) throw new CommandError("RECOVERY_PENDING", "root has an unfinished intent");
    const taskDirectory = path.join(root.rootPath, "tasks");
    const taskDirectoryIdentity = directoryIdentity(taskDirectory);
    const snapshot = readCanonicalRoot(root.rootPath);
    if (snapshot.rootIdentity !== root.rootIdentity) throw new CommandError("STALE_WRITE_CONTEXT", "physical root changed during observation");
    if (readdirSync(root.rootPath).some(name => /^workspace\.sync-conflict-.+\.json$/.test(name))) {
      throw new CommandError("INVALID_CANONICAL", "descriptor conflict copies require explicit inspection before staging");
    }
    authority = synchronizeAuthority(database, root, snapshot);
    requireWriteContext(request, authority);
    const previewVersion = requireCreateBudget(database, snapshot.tasks.length);
    const taskId = randomUUID();
    if (snapshot.files.some(file => file.relativePath.startsWith("tasks/") && path.basename(file.relativePath).split(".")[0].toLowerCase() === taskId)) {
      throw new CommandError("STALE_SCOPE", "capture ID collides with an observed canonical or conflict filename");
    }
    const at = new Date().toISOString();
    const task = buildCreatedTask(input, { id: taskId, at }, snapshot.tasks);
    if (request.readOnly || request.dryRun) {
      // Preview tokens are hypothetical, not allocated/reserved authority for a future execution.
      const previewAuthority = { ...authority, versions: new Map([...authority.versions, [taskId, previewVersion]]) };
      return { writeContext: authority.writeContext, result: { task: projectTasks([task, ...snapshot.tasks], previewAuthority)[0], changed: true, readOnly: request.readOnly, dryRun: request.dryRun } };
    }
    const operationId = randomUUID();
    const bytes = Buffer.from(`${JSON.stringify(task)}\n`);
    const stage = path.join(taskDirectory, `.syncthing.taskdb-create-${operationId}.tmp`);
    const target = path.join(taskDirectory, `${taskId}.json`);
    writeDurableFile(stage, bytes);
    guardCreateDestination(snapshot, taskDirectoryIdentity, taskId, task.parentId);
    // Native rename is not a no-clobber CAS. A post-check arrival is a platform-specific race.
    // Interrupted stages stay orphaned; publication before SQLite commit can duplicate on retry.
    renameSync(stage, target);
    syncDirectory(taskDirectory);
    const published = {
      ...snapshot,
      tasks: [...snapshot.tasks, task].sort((left, right) => {
        const leftParent = left.parentId ?? "", rightParent = right.parentId ?? "";
        return leftParent === rightParent ? compareTasks(left, right) : leftParent < rightParent ? -1 : 1;
      }),
      files: [snapshot.files[0], ...[...snapshot.files.slice(1), { relativePath: `tasks/${taskId}.json`, sha256: exactHash(bytes) }]
        .sort((left, right) => left.relativePath < right.relativePath ? -1 : 1)],
    };
    authority = synchronizeAuthority(database, root, published);
    const result = { task: projectTasks(published.tasks, authority).find(task => task.id === taskId)!, changed: true, operationId };
    database.prepare("INSERT INTO v2_operations VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(operationId, authority.writeContext, taskId, "task.create", JSON.stringify(request.actor), at, "null", JSON.stringify(task));
    storeReceipt(database, request, result);
    return { writeContext: authority.writeContext, result };
  }));
}
