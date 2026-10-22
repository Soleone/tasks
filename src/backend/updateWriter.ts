import { randomUUID } from "node:crypto";
import { renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { CommandError } from "./errors.js";
import { exactHash, readCanonicalRoot, readRootDescriptor } from "./canonicalReader.js";
import { guardObservedRoot, refuseDescriptorConflicts } from "./copyFiles.js";
import { syncDirectory, withRootWriterLock, writeDurableFile } from "./localDomain.js";
import { projectTasks } from "./queries.js";
import { decodeTaskEdit } from "./taskEditRequest.js";
import type { TaskEditRequest } from "./taskEditRequest.js";
import type { TaskEditResult, TaskExecutionResult } from "./taskResults.js";
import type { CanonicalTask } from "./taskModel.js";
import { synchronizeAuthority, withCacheTransaction } from "./queryCache.js";
import { findTaskEditReceipt, requireWriteContext, storeReceipt } from "./receipts.js";
import { applyUpdate } from "./updateInputs.js";
import { requireAddedAttachments } from "./attachments.js";
import { applyStatus } from "./taskStatus.js";
import { applyRelationship } from "./taskRelationships.js";
import { readPending } from "./pending.js";

type WriteOutcome = { writeContext: string; result: TaskEditResult };

/**
 * One task file changes, so like capture this needs no pending journal: the new bytes are staged,
 * the folder is checked to be exactly as observed, and an atomic rename publishes them. A crash
 * after the rename but before the receipt commits leaves the edit applied without a receipt.
 */
export function executeUpdate(
  request: TaskEditRequest,
  rootPath: string,
  cachePath: string,
): WriteOutcome {
  const root = readRootDescriptor(rootPath);
  return withRootWriterLock(root, () =>
    withCacheTransaction(cachePath, root, (database): WriteOutcome => {
      let authority = synchronizeAuthority(database, root);
      requireWriteContext(request, authority);
      const edit = decodeTaskEdit(request);
      const input = edit.input;
      // A receipt is historical success, even when the live task/graph has since disappeared.
      const receipt = findTaskEditReceipt(database, request);
      if (receipt) return { writeContext: authority.writeContext, result: receipt };
      if (readPending(root))
        throw new CommandError("RECOVERY_PENDING", "root has an unfinished intent");
      const snapshot = readCanonicalRoot(rootPath);
      if (snapshot.rootIdentity !== root.rootIdentity)
        throw new CommandError("STALE_WRITE_CONTEXT", "physical root changed during observation");
      refuseDescriptorConflicts(snapshot.rootPath);
      authority = synchronizeAuthority(database, root, snapshot);
      requireWriteContext(request, authority);
      const task = snapshot.tasks.find((task) => task.id === input.id);
      if (!task) throw new CommandError("TASK_NOT_FOUND", "task was not found");
      if (authority.versions.get(task.id) !== input.expectedVersion)
        throw new CommandError("STALE_TASK_VERSION", "task version changed");
      const at = new Date().toISOString();
      let update: { task: CanonicalTask; changed: boolean };
      switch (edit.kind) {
        case "content":
          update = applyUpdate(task, edit.input, at);
          break;
        case "relationship":
          update = applyRelationship(task, edit.input, snapshot.tasks, at);
          break;
        case "status":
          update = applyStatus(task, edit.command, at);
          break;
      }
      requireAddedAttachments(root.rootPath, task.attachments, update.task.attachments);
      const projected = projectTasks(
        [update.task, ...snapshot.tasks.filter((item) => item.id !== task.id)],
        authority,
      )[0];
      if (request.readOnly || request.dryRun)
        return {
          writeContext: authority.writeContext,
          result: {
            task: projected,
            changed: update.changed,
            readOnly: request.readOnly,
            dryRun: request.dryRun,
          },
        };
      if (!update.changed) {
        const result: TaskExecutionResult = { task: projected, changed: false };
        storeReceipt(database, request, result);
        return { writeContext: authority.writeContext, result };
      }
      const budget = database
        .prepare("SELECT counter, revision FROM v2_query_state WHERE singleton = 1")
        .get()!;
      if (
        !Number.isSafeInteger((budget.counter as number) + snapshot.tasks.length * 3 + 4) ||
        !Number.isSafeInteger((budget.revision as number) + 3)
      ) {
        throw new CommandError(
          "UNSUPPORTED_COMMAND",
          "version budget is nearly exhausted; explicit fresh-cache authority is required before this write",
        );
      }
      const operationId = randomUUID();
      const bytes = Buffer.from(`${JSON.stringify(update.task)}\n`);
      const target = path.join(root.rootPath, "tasks", `${task.id}.json`);
      const stage = path.join(root.rootPath, "tasks", `.syncthing.taskdb-${operationId}.tmp`);
      writeDurableFile(stage, bytes);
      // The edit was derived from the whole graph, so every file must still be as observed.
      try {
        guardObservedRoot(snapshot);
      } catch (error) {
        unlinkSync(stage);
        throw error;
      }
      renameSync(stage, target);
      syncDirectory(path.dirname(target));
      const published = readCanonicalRoot(root.rootPath);
      if (
        published.files.find((file) => file.relativePath === `tasks/${task.id}.json`)?.sha256 !==
        exactHash(bytes)
      )
        throw new CommandError("STALE_FILE", "task changed during publication");
      authority = synchronizeAuthority(database, root, published);
      database
        .prepare("INSERT INTO v2_operations VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(
          operationId,
          authority.writeContext,
          task.id,
          request.command,
          JSON.stringify(request.actor),
          at,
          JSON.stringify(task),
          JSON.stringify(update.task),
        );
      const result: TaskExecutionResult = {
        task: projectTasks(published.tasks, authority).find((item) => item.id === task.id)!,
        changed: true,
        operationId,
      };
      storeReceipt(database, request, result);
      return { writeContext: authority.writeContext, result };
    }),
  );
}
