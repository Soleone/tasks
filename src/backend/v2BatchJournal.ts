import { existsSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { canonicalJson } from "./canonicalJson.js";
import { CommandError } from "./errors.js";
import { parseV2CanonicalJson } from "./v2CanonicalJson.js";
import { readV2CanonicalRoot, readV2RegularFile } from "./v2CanonicalReader.js";
import type { V2CanonicalSnapshot, V2FileObservation } from "./v2CanonicalReader.js";
import { syncV2Directory, v2LocalDomain, writeV2DurableFile } from "./v2LocalDomain.js";
import { isV2Record, parseV2Request } from "./v2Protocol.js";
import type { V2Request } from "./v2Protocol.js";
import { localPathOutsideV2Root } from "./v2QueryCache.js";
import type { V2RootBinding } from "./v2QueryCache.js";
import { isV2Timestamp, validateV2Graph, validateV2Task } from "./v2TaskModel.js";
import { parseV2Undo, planV2Undo, V2_UNDO_COMMANDS } from "./v2UndoPlan.js";
import type { V2HistorySource, V2UndoPlan } from "./v2UndoPlan.js";
import { exactV2Hash } from "./v2UpdateJournal.js";

export type V2BatchFile = { taskId: string; beforeBytes: string; nextBytes: string | null };
export type V2BatchIntent = { format: "taskdb.pending-batch"; version: 1; root: V2RootBinding; cachePath: string; request: V2Request; operationId: string; at: string; sources: V2HistorySource[]; files: V2BatchFile[]; guards: V2FileObservation[] };
function conflict(): never { throw new CommandError("RECOVERY_CONFLICT", "batch has missing, divergent or invalid evidence; preserve it for inspection"); }
function stagePath(intent: V2BatchIntent, index: number): string { return path.join(intent.root.rootPath, "tasks", `.syncthing.taskdb-batch-${intent.operationId}-${index}.tmp`); }
export function batchIntentPlan(intent: V2BatchIntent): V2UndoPlan {
  const before = intent.files.map(file => validateV2Task(parseV2CanonicalJson(Buffer.from(file.beforeBytes, "base64")), file.taskId));
  validateV2Graph(before);
  return planV2Undo(parseV2Undo(intent.request.command, intent.request.args), before, intent.at, intent.sources);
}

export function parseV2BatchIntent(value: unknown, root: V2RootBinding): V2BatchIntent {
  try {
    if (!isV2Record(value)) conflict();
    const intent = value as unknown as V2BatchIntent;
    if (intent.format !== "taskdb.pending-batch" || intent.version !== 1 || intent.root.rootPath !== root.rootPath || intent.root.rootIdentity !== root.rootIdentity || !path.isAbsolute(intent.cachePath)
      || !isV2Timestamp(intent.at) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(intent.operationId)) conflict();
    const request = parseV2Request(intent.request);
    if (!V2_UNDO_COMMANDS.includes(request.command) || request.dryRun || request.readOnly || !request.writeContext || !request.idempotencyKey) conflict();
    if (!Array.isArray(intent.sources) || intent.sources.some(source => typeof source.id !== "string" || !source.id || typeof source.command !== "string")) conflict();
    if (!Array.isArray(intent.files) || new Set(intent.files.map(file => file.taskId)).size !== intent.files.length || !Array.isArray(intent.guards)) conflict();
    if (new Set(intent.guards.map(guard => guard.relativePath)).size !== intent.guards.length || !intent.guards.some(guard => guard.relativePath === "workspace.json")) conflict();
    for (const guard of intent.guards) {
      if ((guard.relativePath !== "workspace.json" && !/^tasks\/(?:[A-Za-z0-9_-]+|[A-Za-z0-9_-]+\.sync-conflict-[^/\\]+)\.json$/.test(guard.relativePath)) || !/^[0-9a-f]{64}$/.test(guard.sha256)) conflict();
      if (/^tasks\/[A-Za-z0-9_-]+\.json$/.test(guard.relativePath) && !intent.files.some(file => guard.relativePath === `tasks/${file.taskId}.json`)) conflict();
    }
    for (const file of intent.files) {
      for (const bytes of [file.beforeBytes, ...(file.nextBytes === null ? [] : [file.nextBytes])]) {
        if (typeof bytes !== "string" || Buffer.from(bytes, "base64").toString("base64") !== bytes) conflict();
        validateV2Task(parseV2CanonicalJson(Buffer.from(bytes, "base64")), file.taskId);
      }
      if (!intent.guards.some(guard => guard.relativePath === `tasks/${file.taskId}.json` && guard.sha256 === exactV2Hash(Buffer.from(file.beforeBytes, "base64")))) conflict();
    }
    const parsed = { ...intent, request };
    const plan = batchIntentPlan(parsed);
    if (plan.affectedIds.length === 0) conflict();
    for (const file of intent.files) {
      const next = plan.tasks.find(task => task.id === file.taskId);
      if (!next) {
        if (file.nextBytes !== null || !plan.removedIds.includes(file.taskId) || intent.guards.some(guard => guard.relativePath.startsWith(`tasks/${file.taskId}.sync-conflict-`)) || !intent.sources.some(source => source.command === "task.create" && file.beforeBytes === Buffer.from(`${JSON.stringify(source.after)}\n`).toString("base64"))) conflict();
        continue;
      }
      if (file.nextBytes === null || canonicalJson(parseV2CanonicalJson(Buffer.from(file.nextBytes, "base64"))) !== canonicalJson(next)) conflict();
      const before = parseV2CanonicalJson(Buffer.from(file.beforeBytes, "base64"));
      if (canonicalJson(next) === canonicalJson(before) && file.beforeBytes !== file.nextBytes) conflict();
    }
    localPathOutsideV2Root(intent.cachePath, root.rootPath);
    v2LocalDomain(root);
    return parsed;
  } catch { return conflict(); }
}

export function v2UndoRecoveryLocation(intent: V2BatchIntent): string | undefined {
  return intent.files.some(file => file.nextBytes === null) ? path.join(v2LocalDomain(intent.root), `undo-${intent.operationId}.recovery.json`) : undefined;
}
function archiveBytes(intent: V2BatchIntent): Buffer {
  return Buffer.from(`${JSON.stringify({ format: "taskdb.undo-recovery", version: 1, operationId: intent.operationId, root: intent.root, files: intent.files.filter(file => file.nextBytes === null).map(({ taskId, beforeBytes }) => ({ taskId, beforeBytes })) })}\n`);
}
export function persistV2UndoArchive(intent: V2BatchIntent): void {
  const location = v2UndoRecoveryLocation(intent);
  if (location) { writeV2DurableFile(location, archiveBytes(intent)); syncV2Directory(path.dirname(location)); verifyArchive(intent); }
}
function verifyArchive(intent: V2BatchIntent): void {
  const location = v2UndoRecoveryLocation(intent);
  if (location && (!existsSync(location) || !readV2RegularFile(location).equals(archiveBytes(intent)))) conflict();
}

export function guardV2Batch(intent: V2BatchIntent, recovery: boolean): V2CanonicalSnapshot {
  try {
    const snapshot = readV2CanonicalRoot(intent.root.rootPath);
    const fail = (code: string): never => { throw new CommandError(recovery ? "RECOVERY_CONFLICT" : code, "batch baseline changed"); };
    if (snapshot.rootPath !== intent.root.rootPath || snapshot.rootIdentity !== intent.root.rootIdentity) fail("STALE_SCOPE");
    const actual = new Map(snapshot.files.map(file => [file.relativePath, file.sha256]));
    const plans = new Map(intent.files.map(file => [`tasks/${file.taskId}.json`, file]));
    if ([...actual.keys()].some(name => !intent.guards.some(guard => guard.relativePath === name))) fail("STALE_SCOPE");
    for (const guard of intent.guards) {
      const file = plans.get(guard.relativePath), hash = actual.get(guard.relativePath);
      if (hash === undefined) { if (recovery && file?.nextBytes === null) continue; fail("STALE_SCOPE"); }
      if (hash !== guard.sha256 && !(recovery && file?.nextBytes && hash === exactV2Hash(Buffer.from(file.nextBytes, "base64")))) fail("STALE_FILE");
    }
    for (const [index, file] of intent.files.entries()) {
      const temporary = stagePath(intent, index);
      if (existsSync(temporary) && (file.nextBytes === null || !readV2RegularFile(temporary).equals(Buffer.from(file.nextBytes, "base64")))) conflict();
    }
    if (recovery) verifyArchive(intent);
    return snapshot;
  } catch (error) { if (recovery) return conflict(); throw error; }
}

export function applyV2BatchJournal(intent: V2BatchIntent): V2CanonicalSnapshot {
  for (const [index, file] of intent.files.entries()) {
    if (file.beforeBytes === file.nextBytes) continue;
    const snapshot = guardV2Batch(intent, true);
    const actual = snapshot.files.find(actual => actual.relativePath === `tasks/${file.taskId}.json`);
    if (file.nextBytes === null ? !actual : actual?.sha256 === exactV2Hash(Buffer.from(file.nextBytes, "base64"))) continue;
    const target = path.join(intent.root.rootPath, "tasks", `${file.taskId}.json`);
    if (file.nextBytes === null) unlinkSync(target);
    else {
      const temporary = stagePath(intent, index), next = Buffer.from(file.nextBytes, "base64");
      if (!existsSync(temporary)) writeV2DurableFile(temporary, next);
      guardV2Batch(intent, true);
      renameSync(temporary, target);
    }
    syncV2Directory(path.dirname(target));
  }
  const verified = guardV2Batch(intent, true);
  for (const file of intent.files) {
    const actual = verified.files.find(actual => actual.relativePath === `tasks/${file.taskId}.json`);
    if (file.nextBytes === null ? actual !== undefined : actual?.sha256 !== exactV2Hash(Buffer.from(file.nextBytes, "base64"))) conflict();
  }
  validateV2Graph(verified.tasks);
  return verified;
}

export function retireV2BatchStages(intent: V2BatchIntent): void {
  verifyArchive(intent);
  for (const [index, file] of intent.files.entries()) {
    const temporary = stagePath(intent, index);
    if (!existsSync(temporary)) continue;
    if (file.nextBytes === null || !readV2RegularFile(temporary).equals(Buffer.from(file.nextBytes, "base64"))) conflict();
    unlinkSync(temporary);
    syncV2Directory(path.dirname(temporary));
  }
}
