import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { attachmentPath } from "./attachments.js";
import { CommandError } from "./errors.js";
import {
  readCanonicalRoot,
  readRegularFile,
  readRootDescriptor,
  exactHash,
} from "./canonicalReader.js";
import { directoryIdentity, guardObservedRoot } from "./rootGuards.js";
import { writeExport } from "./exportArchive.js";
import { homeOfRoot } from "./home.js";
import { persistPending, retirePending, withRootWriterLock } from "./localDomain.js";
import { readPending } from "./pending.js";
import { assertArgs } from "./protocol.js";
import type { Request } from "./protocol.js";
import {
  applyPurgeJournal,
  guardPurge,
  parsePurgeIntent,
  persistPurgeArchive,
  plannedRewrites,
  purgeIntentTasks,
  retirePurgeQuarantines,
  purgeFileIdentity,
  purgeRecoveryLocation,
} from "./purgeJournal.js";
import type { PurgeIntent } from "./purgeJournal.js";
import { listedAttachments, parseClearDone, planRemoval, remainingTasks } from "./purgePlan.js";
import type { RemovalPlan } from "./purgePlan.js";
import { localPathOutsideRoot, synchronizeAuthority, withCacheTransaction } from "./queryCache.js";
import { findReceipt, requireWriteContext, storeReceipt } from "./receipts.js";
import { attachmentName } from "./taskModel.js";
import type { CanonicalTask } from "./taskModel.js";
import { invalidatePurgeUndo } from "./undoHistory.js";

// An image pasted on another device can arrive before the task that lists it.
const UNLISTED_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

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

/** When an attachment was added, read from its `YYYY-MM-DD-HHMMSS` name. */
function addedAt(name: string): number {
  return Date.parse(
    `${name.slice(0, 10)}T${name.slice(11, 13)}:${name.slice(13, 15)}:${name.slice(15, 17)}Z`,
  );
}

/** Attachments no task lists that are old enough by name. */
function unlistedAttachments(
  rootPath: string,
  tasks: readonly CanonicalTask[],
  at: string,
): string[] {
  const directory = path.join(rootPath, "attachments");
  if (!existsSync(directory)) return [];
  const listed = listedAttachments(tasks);
  const cutoff = Date.parse(at) - UNLISTED_GRACE_MS;
  return readdirSync(directory).filter(
    (name) => attachmentName.test(name) && !listed.has(name) && addedAt(name) < cutoff,
  );
}

function fileSize(filePath: string): number | undefined {
  const stat = lstatSync(filePath, { throwIfNoEntry: false });
  return stat?.isFile() ? stat.size : undefined;
}

function removalSummary(request: Request, plan: RemovalPlan, attachments: string[], bytes: number) {
  if (request.command !== "task.clearDone")
    return { purgedIds: plan.purgedIds, removedAttachments: attachments };
  return {
    clearedIds: request.args.scope === "tasks" ? plan.purgedIds : plan.strippedIds,
    keptIds: plan.keptIds,
    removedAttachments: attachments,
    bytes,
  };
}

export function commitPurge(database: DatabaseSync, intent: PurgeIntent): Record<string, unknown> {
  guardPurge(intent, true);
  requirePurgeBudget(database, purgeIntentTasks(intent).length);
  const snapshot = applyPurgeJournal(intent);
  const authority = synchronizeAuthority(database, intent.root, snapshot);
  const changedIds = [...intent.purgedIds, ...intent.rewrites.map((rewrite) => rewrite.taskId)];
  invalidatePurgeUndo(database, authority.writeContext, changedIds, intent.operationId);
  const tasks = purgeIntentTasks(intent);
  const plan = planRemoval(intent.request, tasks);
  if (changedIds.length) {
    database.prepare("INSERT INTO v2_operations VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      intent.operationId,
      authority.writeContext,
      changedIds[0],
      intent.request.command,
      JSON.stringify(intent.request.actor),
      intent.at,
      JSON.stringify({ tasks: tasks.filter((task) => changedIds.includes(task.id)) }),
      JSON.stringify({
        tasks: remainingTasks(tasks, plan).filter((task) => changedIds.includes(task.id)),
      }),
    );
    const member = database.prepare("INSERT INTO v2_operation_members VALUES (?, ?)");
    for (const id of changedIds) member.run(intent.operationId, id);
  }
  const result = {
    ...removalSummary(intent.request, plan, intent.attachments, intent.bytes),
    changed: true,
    operationId: intent.operationId,
    recoveryLocation: purgeRecoveryLocation(intent),
    ...(intent.exportLocation === null ? {} : { exportLocation: intent.exportLocation }),
  };
  if (authority.writeContext === intent.request.writeContext)
    storeReceipt(database, intent.request, result);
  return result;
}

/** `task.purgeCanceled` and `task.clearDone`: both delete or rewrite task files, then attachments. */
export function executeRemoval(request: Request, rootPath: string, cachePath: string) {
  const root = readRootDescriptor(rootPath);
  return withRootWriterLock(root, () => {
    let completed: PurgeIntent | undefined;
    const outcome = withCacheTransaction(cachePath, root, (database) => {
      let authority = synchronizeAuthority(database, root);
      requireWriteContext(request, authority);
      const clearing = request.command === "task.clearDone";
      const home = homeOfRoot(root.rootPath);
      if (!clearing) assertArgs(request.args, []);
      else if (parseClearDone(request.args).export && !home)
        throw new CommandError("INVALID_ARGUMENT", "export needs a Tasks home");
      const receipt = findReceipt(database, request);
      if (receipt) return { writeContext: authority.writeContext, result: receipt };
      if (readPending(root))
        throw new CommandError("RECOVERY_PENDING", "root has an unfinished intent");
      const snapshot = readCanonicalRoot(root.rootPath);
      if (snapshot.rootIdentity !== root.rootIdentity)
        throw new CommandError("STALE_WRITE_CONTEXT", "physical root changed during observation");
      guardObservedRoot(snapshot);
      const plan = planRemoval(request, snapshot.tasks);
      const at = new Date().toISOString();
      const changedTasks = snapshot.tasks.filter(
        (task) => plan.purgedIds.includes(task.id) || plan.strippedIds.includes(task.id),
      );
      const stillListed = listedAttachments(remainingTasks(snapshot.tasks, plan));
      const released = [...listedAttachments(changedTasks)].filter(
        (name) => !stillListed.has(name),
      );
      const sizes = new Map<string, number>();
      for (const name of clearing
        ? released
        : [...released, ...unlistedAttachments(root.rootPath, snapshot.tasks, at)]) {
        const size = fileSize(attachmentPath(root.rootPath, name));
        if (size !== undefined) sizes.set(name, size);
      }
      const attachments = [...sizes.keys()].sort();
      const taskBytes = plan.purgedIds.reduce(
        (sum, id) => sum + fileSize(path.join(root.rootPath, "tasks", `${id}.json`))!,
        0,
      );
      const bytes = [...sizes.values()].reduce((sum, size) => sum + size, taskBytes);
      const changed = plan.purgedIds.length + plan.strippedIds.length + attachments.length > 0;
      if (changed && !request.readOnly && !request.dryRun)
        requirePurgeBudget(database, snapshot.tasks.length);
      authority = synchronizeAuthority(database, root, snapshot);
      requireWriteContext(request, authority);
      const result = { ...removalSummary(request, plan, attachments, bytes), changed };
      if (request.dryRun || request.readOnly)
        return {
          writeContext: authority.writeContext,
          result: { ...result, dryRun: request.dryRun, readOnly: request.readOnly },
        };
      if (!changed) {
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
      // The export is a keepsake of exactly what goes, written before anything does.
      const exportLocation =
        clearing && request.args.export === true
          ? writeExport(
              home!,
              at,
              Buffer.from(
                `[\n${changedTasks.map((task) => JSON.stringify(task)).join(",\n")}\n]\n`,
              ),
              attachments.map((name) => ({ name, filePath: attachmentPath(root.rootPath, name) })),
            )
          : null;
      const intent = parsePurgeIntent(
        {
          format: "taskdb.pending-purge",
          version: 1,
          root,
          taskDirectoryIdentity: directoryIdentity(path.join(root.rootPath, "tasks")),
          cachePath: localPathOutsideRoot(cachePath, root.rootPath),
          request,
          operationId: randomUUID(),
          at,
          purgedIds: plan.purgedIds,
          rewrites: plannedRewrites(snapshot.tasks, plan),
          attachments,
          bytes,
          exportLocation,
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
