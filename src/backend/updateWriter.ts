import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CommandError } from "./errors.js";
import { parseCanonicalJson } from "./strictJson.js";
import { readCanonicalRoot, readRegularFile, readRootDescriptor } from "./canonicalReader.js";
import type { CanonicalSnapshot } from "./canonicalReader.js";
import { guardCopySource } from "./copyFiles.js";
import { persistPending, retirePending, syncDirectory, withRootWriterLock } from "./localDomain.js";
import { projectTasks } from "./queries.js";
import { decodeTaskEdit } from "./taskEditRequest.js";
import type { TaskEditRequest } from "./taskEditRequest.js";
import type { TaskEditResult, TaskExecutionResult } from "./taskResults.js";
import type { CanonicalTask } from "./taskModel.js";
import { localPathOutsideRoot, synchronizeAuthority, withCacheTransaction } from "./queryCache.js";
import { findTaskEditReceipt, requireWriteContext, storeReceipt } from "./receipts.js";
import { applyUpdate } from "./updateInputs.js";
import { applyStatus } from "./taskStatus.js";
import { applyRelationship } from "./taskRelationships.js";
import { readPending } from "./pending.js";
import { applyJournal, exactHash, guardUpdate } from "./updateJournal.js";
import type { UpdateIntent } from "./updateJournal.js";

type WriteOutcome = { writeContext: string; result: TaskEditResult };

export function commitUpdate(
  database: DatabaseSync,
  intent: UpdateIntent,
  snapshot: CanonicalSnapshot,
): TaskExecutionResult {
  const authority = synchronizeAuthority(database, intent.root, snapshot);
  const task = projectTasks(snapshot.tasks, authority).find((task) => task.id === intent.taskId)!;
  const before = parseCanonicalJson(Buffer.from(intent.beforeBytes, "base64"));
  const after = parseCanonicalJson(Buffer.from(intent.nextBytes, "base64"));
  database
    .prepare("INSERT INTO v2_operations VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(
      intent.operationId,
      authority.writeContext,
      intent.taskId,
      intent.request.command,
      JSON.stringify(intent.request.actor),
      intent.at,
      JSON.stringify(before),
      JSON.stringify(after),
    );
  const result: TaskExecutionResult = { task, changed: true, operationId: intent.operationId };
  // Cache-loss recovery may acknowledge the fixed effect, but must never restore old-context authority.
  if (authority.writeContext === intent.request.writeContext)
    storeReceipt(database, intent.request, result);
  return result;
}

export function executeUpdate(
  request: TaskEditRequest,
  rootPath: string,
  cachePath: string,
): WriteOutcome {
  const root = readRootDescriptor(rootPath);
  return withRootWriterLock(root, () => {
    let retire = false;
    const outcome = withCacheTransaction(cachePath, root, (database): WriteOutcome => {
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
      guardCopySource(snapshot);
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
      const beforeBytes = readRegularFile(path.join(root.rootPath, "tasks", `${task.id}.json`));
      if (
        exactHash(beforeBytes) !==
        snapshot.files.find((file) => file.relativePath === `tasks/${task.id}.json`)!.sha256
      ) {
        throw new CommandError("STALE_FILE", "task changed before staging");
      }
      const intent: UpdateIntent = {
        format: "taskdb.pending-update",
        version: 1,
        root,
        cachePath: localPathOutsideRoot(cachePath, root.rootPath),
        request,
        operationId: randomUUID(),
        at,
        taskId: task.id,
        beforeBytes: beforeBytes.toString("base64"),
        nextBytes: Buffer.from(`${JSON.stringify(update.task)}\n`).toString("base64"),
        guards: snapshot.files,
      };
      guardUpdate(intent, false);
      syncDirectory(path.join(root.rootPath, "tasks"));
      // Publish fixed request/bytes/time before any canonical replacement; failures leave this intent intact.
      persistPending(root, intent);
      const verified = applyJournal(intent);
      const result = commitUpdate(database, intent, verified);
      retire = true;
      return { writeContext: authority.writeContext, result };
    });
    // The transaction's COMMIT has completed. Never retire evidence from inside that transaction.
    if (retire) retirePending(root);
    return outcome;
  });
}
