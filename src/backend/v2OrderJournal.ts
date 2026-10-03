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
import { isV2Timestamp, validateV2Task } from "./v2TaskModel.js";
import { parseV2Order, planV2Order, V2_ORDER_COMMANDS } from "./v2TaskOrdering.js";
import type { V2OrderPlan } from "./v2TaskOrdering.js";
import { exactV2Hash } from "./v2UpdateJournal.js";

export type V2OrderFile = { taskId: string; beforeBytes: string; nextBytes: string };
export type V2OrderIntent = { format: "taskdb.pending-order"; version: 1; root: V2RootBinding; cachePath: string; request: V2Request; operationId: string; at: string; files: V2OrderFile[]; guards: V2FileObservation[] };
function conflict(): never { throw new CommandError("RECOVERY_CONFLICT", "ordering has missing, divergent or invalid evidence; preserve it for inspection"); }
function stagePath(intent: V2OrderIntent, index: number): string {
  return path.join(intent.root.rootPath, "tasks", `.syncthing.taskdb-order-${intent.operationId}-${index}.tmp`);
}

export function orderIntentPlan(intent: V2OrderIntent): V2OrderPlan {
  return planV2Order(parseV2Order(intent.request.command, intent.request.args), intent.files.map(file => validateV2Task(parseV2CanonicalJson(Buffer.from(file.beforeBytes, "base64")), file.taskId)));
}

export function parseV2OrderIntent(value: unknown, root: V2RootBinding): V2OrderIntent {
  try {
    if (!isV2Record(value)) conflict();
    const intent = value as unknown as V2OrderIntent;
    if (intent.format !== "taskdb.pending-order" || intent.version !== 1 || intent.root.rootPath !== root.rootPath || intent.root.rootIdentity !== root.rootIdentity
      || !path.isAbsolute(intent.cachePath) || !isV2Timestamp(intent.at) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(intent.operationId)) conflict();
    const request = parseV2Request(intent.request);
    if (!V2_ORDER_COMMANDS.includes(request.command) || request.readOnly || request.dryRun || !request.writeContext || !request.idempotencyKey) conflict();
    if (!Array.isArray(intent.files) || intent.files.length === 0 || new Set(intent.files.map(file => file.taskId)).size !== intent.files.length) conflict();
    if (!Array.isArray(intent.guards) || !intent.guards.some(file => file.relativePath === "workspace.json") || new Set(intent.guards.map(file => file.relativePath)).size !== intent.guards.length) conflict();
    for (const guard of intent.guards) {
      if (typeof guard.relativePath !== "string" || (guard.relativePath !== "workspace.json" && !/^tasks\/(?:[A-Za-z0-9_-]+|[A-Za-z0-9_-]+\.sync-conflict-[^/\\]+)\.json$/.test(guard.relativePath)) || !/^[0-9a-f]{64}$/.test(guard.sha256)) conflict();
    }
    for (const file of intent.files) {
      for (const encoded of [file.beforeBytes, file.nextBytes]) {
        if (typeof encoded !== "string" || Buffer.from(encoded, "base64").toString("base64") !== encoded) conflict();
        validateV2Task(parseV2CanonicalJson(Buffer.from(encoded, "base64")), file.taskId);
      }
      if (!intent.guards.some(guard => guard.relativePath === `tasks/${file.taskId}.json` && guard.sha256 === exactV2Hash(Buffer.from(file.beforeBytes, "base64")))) conflict();
    }
    const parsed = { ...intent, request };
    const plan = orderIntentPlan(parsed);
    if (!plan.changed || plan.before.length !== intent.files.length || plan.before.some((task, index) => task.id !== intent.files[index].taskId)) conflict();
    for (const file of intent.files) {
      const next = parseV2CanonicalJson(Buffer.from(file.nextBytes, "base64"));
      if (canonicalJson(next) !== canonicalJson(plan.after.find(task => task.id === file.taskId))) conflict();
      if (!plan.writes.some(task => task.id === file.taskId) && file.nextBytes !== file.beforeBytes) conflict();
    }
    localPathOutsideV2Root(intent.cachePath, root.rootPath);
    v2LocalDomain(root);
    return parsed;
  } catch { return conflict(); }
}

export function guardV2Order(intent: V2OrderIntent, recovery: boolean): V2CanonicalSnapshot {
  try {
    const snapshot = readV2CanonicalRoot(intent.root.rootPath);
    const fail = (code: string): never => { throw new CommandError(recovery ? "RECOVERY_CONFLICT" : code, "ordering baseline changed"); };
    if (snapshot.rootPath !== intent.root.rootPath || snapshot.rootIdentity !== intent.root.rootIdentity) fail("STALE_SCOPE");
    const actual = new Map(snapshot.files.map(file => [file.relativePath, file.sha256]));
    if (actual.size !== intent.guards.length || intent.guards.some(guard => !actual.has(guard.relativePath))) fail("STALE_SCOPE");
    const replacements = new Map(intent.files.map(file => [`tasks/${file.taskId}.json`, file]));
    for (const guard of intent.guards) {
      const file = replacements.get(guard.relativePath);
      if (actual.get(guard.relativePath) !== guard.sha256 && !(recovery && file && actual.get(guard.relativePath) === exactV2Hash(Buffer.from(file.nextBytes, "base64")))) fail("STALE_FILE");
    }
    const plan = orderIntentPlan(intent);
    const scope = snapshot.tasks.filter(task => task.parentId === plan.parentId);
    if (scope.length !== intent.files.length || scope.some(task => !intent.files.some(file => file.taskId === task.id))) fail("STALE_SCOPE");
    for (const [index, task] of plan.writes.entries()) {
      const temporary = stagePath(intent, index);
      const file = intent.files.find(file => file.taskId === task.id)!;
      if (existsSync(temporary) && !readV2RegularFile(temporary).equals(Buffer.from(file.nextBytes, "base64"))) conflict();
    }
    return snapshot;
  } catch (error) { if (recovery) return conflict(); throw error; }
}

export function applyV2OrderJournal(intent: V2OrderIntent): V2CanonicalSnapshot {
  const plan = orderIntentPlan(intent);
  for (const [index, task] of plan.writes.entries()) {
    const snapshot = guardV2Order(intent, true);
    const file = intent.files.find(file => file.taskId === task.id)!;
    if (snapshot.files.find(file => file.relativePath === `tasks/${task.id}.json`)!.sha256 === exactV2Hash(Buffer.from(file.nextBytes, "base64"))) continue;
    const target = path.join(intent.root.rootPath, "tasks", `${task.id}.json`);
    const temporary = stagePath(intent, index);
    const next = Buffer.from(file.nextBytes, "base64");
    if (existsSync(temporary)) { if (!readV2RegularFile(temporary).equals(next)) conflict(); }
    else writeV2DurableFile(temporary, next);
    guardV2Order(intent, true);
    renameSync(temporary, target);
    syncV2Directory(path.dirname(target));
  }
  const snapshot = guardV2Order(intent, true);
  for (const file of intent.files) if (snapshot.files.find(actual => actual.relativePath === `tasks/${file.taskId}.json`)!.sha256 !== exactV2Hash(Buffer.from(file.nextBytes, "base64"))) conflict();
  return snapshot;
}

export function retireV2OrderStages(intent: V2OrderIntent): void {
  for (const [index, task] of orderIntentPlan(intent).writes.entries()) {
    const temporary = stagePath(intent, index);
    if (!existsSync(temporary)) continue;
    const file = intent.files.find(file => file.taskId === task.id)!;
    if (!readV2RegularFile(temporary).equals(Buffer.from(file.nextBytes, "base64"))) conflict();
    unlinkSync(temporary);
    syncV2Directory(path.dirname(temporary));
  }
}
