import { existsSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { canonicalJson } from "./canonicalJson.js";
import { CommandError } from "./errors.js";
import { parseCanonicalJson } from "./strictJson.js";
import { readCanonicalRoot, readRegularFile, exactHash } from "./canonicalReader.js";
import type { CanonicalSnapshot, FileObservation } from "./canonicalReader.js";
import { syncDirectory, localDomain, writeDurableFile } from "./localDomain.js";
import { isRecord, parseRequest } from "./protocol.js";
import type { Request } from "./protocol.js";
import { localPathOutsideRoot } from "./queryCache.js";
import type { RootBinding } from "./queryCache.js";
import { isTimestamp, validateGraph, validateTask } from "./taskModel.js";
import { parseUndo, planUndo, UNDO_COMMANDS } from "./undoPlan.js";
import type { HistorySource, UndoPlan } from "./undoPlan.js";

type BatchFile = { taskId: string; beforeBytes: string; nextBytes: string | null };
export type BatchIntent = {
  format: "taskdb.pending-batch";
  version: 1;
  root: RootBinding;
  cachePath: string;
  request: Request;
  operationId: string;
  at: string;
  sources: HistorySource[];
  files: BatchFile[];
  guards: FileObservation[];
};
function conflict(): never {
  throw new CommandError(
    "RECOVERY_CONFLICT",
    "batch has missing, divergent or invalid evidence; preserve it for inspection",
  );
}
function stagePath(intent: BatchIntent, index: number): string {
  return path.join(
    intent.root.rootPath,
    "tasks",
    `.syncthing.taskdb-batch-${intent.operationId}-${index}.tmp`,
  );
}
export function batchIntentPlan(intent: BatchIntent): UndoPlan {
  const before = intent.files.map((file) =>
    validateTask(parseCanonicalJson(Buffer.from(file.beforeBytes, "base64")), file.taskId),
  );
  validateGraph(before);
  return planUndo(
    parseUndo(intent.request.command, intent.request.args),
    before,
    intent.at,
    intent.sources,
  );
}

export function parseBatchIntent(value: unknown, root: RootBinding): BatchIntent {
  try {
    if (!isRecord(value)) conflict();
    const intent = value as unknown as BatchIntent;
    if (
      intent.format !== "taskdb.pending-batch" ||
      intent.version !== 1 ||
      intent.root.rootPath !== root.rootPath ||
      intent.root.rootIdentity !== root.rootIdentity ||
      !path.isAbsolute(intent.cachePath) ||
      !isTimestamp(intent.at) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        intent.operationId,
      )
    )
      conflict();
    const request = parseRequest(intent.request);
    if (
      !UNDO_COMMANDS.includes(request.command) ||
      request.dryRun ||
      request.readOnly ||
      !request.writeContext ||
      !request.idempotencyKey
    )
      conflict();
    if (
      !Array.isArray(intent.sources) ||
      intent.sources.some(
        (source) =>
          typeof source.id !== "string" || !source.id || typeof source.command !== "string",
      )
    )
      conflict();
    if (
      !Array.isArray(intent.files) ||
      new Set(intent.files.map((file) => file.taskId)).size !== intent.files.length ||
      !Array.isArray(intent.guards)
    )
      conflict();
    if (
      new Set(intent.guards.map((guard) => guard.relativePath)).size !== intent.guards.length ||
      !intent.guards.some((guard) => guard.relativePath === "workspace.json")
    )
      conflict();
    for (const guard of intent.guards) {
      if (
        (guard.relativePath !== "workspace.json" &&
          !/^tasks\/(?:[A-Za-z0-9_-]+|[A-Za-z0-9_-]+\.sync-conflict-[^/\\]+)\.json$/.test(
            guard.relativePath,
          )) ||
        !/^[0-9a-f]{64}$/.test(guard.sha256)
      )
        conflict();
      if (
        /^tasks\/[A-Za-z0-9_-]+\.json$/.test(guard.relativePath) &&
        !intent.files.some((file) => guard.relativePath === `tasks/${file.taskId}.json`)
      )
        conflict();
    }
    for (const file of intent.files) {
      for (const bytes of [
        file.beforeBytes,
        ...(file.nextBytes === null ? [] : [file.nextBytes]),
      ]) {
        if (typeof bytes !== "string" || Buffer.from(bytes, "base64").toString("base64") !== bytes)
          conflict();
        validateTask(parseCanonicalJson(Buffer.from(bytes, "base64")), file.taskId);
      }
      if (
        !intent.guards.some(
          (guard) =>
            guard.relativePath === `tasks/${file.taskId}.json` &&
            guard.sha256 === exactHash(Buffer.from(file.beforeBytes, "base64")),
        )
      )
        conflict();
    }
    const parsed = { ...intent, request };
    const plan = batchIntentPlan(parsed);
    if (plan.affectedIds.length === 0) conflict();
    for (const file of intent.files) {
      const next = plan.tasks.find((task) => task.id === file.taskId);
      if (!next) {
        if (
          file.nextBytes !== null ||
          !plan.removedIds.includes(file.taskId) ||
          intent.guards.some((guard) =>
            guard.relativePath.startsWith(`tasks/${file.taskId}.sync-conflict-`),
          ) ||
          !intent.sources.some(
            (source) =>
              source.command === "task.create" &&
              file.beforeBytes ===
                Buffer.from(`${JSON.stringify(source.after)}\n`).toString("base64"),
          )
        )
          conflict();
        continue;
      }
      if (
        file.nextBytes === null ||
        canonicalJson(parseCanonicalJson(Buffer.from(file.nextBytes, "base64"))) !==
          canonicalJson(next)
      )
        conflict();
      const before = parseCanonicalJson(Buffer.from(file.beforeBytes, "base64"));
      if (canonicalJson(next) === canonicalJson(before) && file.beforeBytes !== file.nextBytes)
        conflict();
    }
    localPathOutsideRoot(intent.cachePath, root.rootPath);
    localDomain(root);
    return parsed;
  } catch {
    return conflict();
  }
}

export function undoRecoveryLocation(intent: BatchIntent): string | undefined {
  return intent.files.some((file) => file.nextBytes === null)
    ? path.join(localDomain(intent.root), `undo-${intent.operationId}.recovery.json`)
    : undefined;
}
function archiveBytes(intent: BatchIntent): Buffer {
  return Buffer.from(
    `${JSON.stringify({ format: "taskdb.undo-recovery", version: 1, operationId: intent.operationId, root: intent.root, files: intent.files.filter((file) => file.nextBytes === null).map(({ taskId, beforeBytes }) => ({ taskId, beforeBytes })) })}\n`,
  );
}
export function persistUndoArchive(intent: BatchIntent): void {
  const location = undoRecoveryLocation(intent);
  if (location) {
    writeDurableFile(location, archiveBytes(intent));
    syncDirectory(path.dirname(location));
    verifyArchive(intent);
  }
}
function verifyArchive(intent: BatchIntent): void {
  const location = undoRecoveryLocation(intent);
  if (
    location &&
    (!existsSync(location) || !readRegularFile(location).equals(archiveBytes(intent)))
  )
    conflict();
}

export function guardBatch(intent: BatchIntent, recovery: boolean): CanonicalSnapshot {
  try {
    const snapshot = readCanonicalRoot(intent.root.rootPath);
    const fail = (code: string): never => {
      throw new CommandError(recovery ? "RECOVERY_CONFLICT" : code, "batch baseline changed");
    };
    if (
      snapshot.rootPath !== intent.root.rootPath ||
      snapshot.rootIdentity !== intent.root.rootIdentity
    )
      fail("STALE_SCOPE");
    const actual = new Map(snapshot.files.map((file) => [file.relativePath, file.sha256]));
    const plans = new Map(intent.files.map((file) => [`tasks/${file.taskId}.json`, file]));
    if (
      [...actual.keys()].some((name) => !intent.guards.some((guard) => guard.relativePath === name))
    )
      fail("STALE_SCOPE");
    for (const guard of intent.guards) {
      const file = plans.get(guard.relativePath),
        hash = actual.get(guard.relativePath);
      if (hash === undefined) {
        if (recovery && file?.nextBytes === null) continue;
        fail("STALE_SCOPE");
      }
      if (
        hash !== guard.sha256 &&
        !(recovery && file?.nextBytes && hash === exactHash(Buffer.from(file.nextBytes, "base64")))
      )
        fail("STALE_FILE");
    }
    for (const [index, file] of intent.files.entries()) {
      const temporary = stagePath(intent, index);
      if (
        existsSync(temporary) &&
        (file.nextBytes === null ||
          !readRegularFile(temporary).equals(Buffer.from(file.nextBytes, "base64")))
      )
        conflict();
    }
    if (recovery) verifyArchive(intent);
    return snapshot;
  } catch (error) {
    if (recovery) return conflict();
    throw error;
  }
}

/** `observed` is the caller's latest guard of this intent; each replacement is guarded again. */
export function applyBatchJournal(
  intent: BatchIntent,
  observed: CanonicalSnapshot,
): CanonicalSnapshot {
  let snapshot = observed;
  for (const [index, file] of intent.files.entries()) {
    if (file.beforeBytes === file.nextBytes) continue;
    const actual = snapshot.files.find(
      (actual) => actual.relativePath === `tasks/${file.taskId}.json`,
    );
    const target = path.join(intent.root.rootPath, "tasks", `${file.taskId}.json`);
    if (
      file.nextBytes === null
        ? !actual
        : actual?.sha256 === exactHash(Buffer.from(file.nextBytes, "base64"))
    ) {
      // Recognized effects may follow a crash before the original directory flush.
      syncDirectory(path.dirname(target));
      continue;
    }
    if (file.nextBytes === null) {
      snapshot = guardBatch(intent, true);
      unlinkSync(target);
    } else {
      const temporary = stagePath(intent, index),
        next = Buffer.from(file.nextBytes, "base64");
      if (!existsSync(temporary)) writeDurableFile(temporary, next);
      snapshot = guardBatch(intent, true);
      renameSync(temporary, target);
    }
    syncDirectory(path.dirname(target));
  }
  const verified = guardBatch(intent, true);
  for (const file of intent.files) {
    const actual = verified.files.find(
      (actual) => actual.relativePath === `tasks/${file.taskId}.json`,
    );
    if (
      file.nextBytes === null
        ? actual !== undefined
        : actual?.sha256 !== exactHash(Buffer.from(file.nextBytes, "base64"))
    )
      conflict();
  }
  return verified;
}

export function retireBatchStages(intent: BatchIntent): void {
  verifyArchive(intent);
  for (const [index, file] of intent.files.entries()) {
    const temporary = stagePath(intent, index);
    if (!existsSync(temporary)) continue;
    if (
      file.nextBytes === null ||
      !readRegularFile(temporary).equals(Buffer.from(file.nextBytes, "base64"))
    )
      conflict();
    unlinkSync(temporary);
    syncDirectory(path.dirname(temporary));
  }
}
