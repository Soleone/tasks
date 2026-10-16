import { existsSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { canonicalJson } from "./canonicalJson.js";
import { CommandError } from "./errors.js";
import { parseCanonicalJson } from "./strictJson.js";
import { readCanonicalRoot, readRegularFile } from "./canonicalReader.js";
import type { CanonicalSnapshot, FileObservation } from "./canonicalReader.js";
import { syncDirectory, localDomain, writeDurableFile } from "./localDomain.js";
import { isRecord, parseRequest } from "./protocol.js";
import type { Request } from "./protocol.js";
import { localPathOutsideRoot } from "./queryCache.js";
import type { RootBinding } from "./queryCache.js";
import { isTimestamp, validateTask } from "./taskModel.js";
import { parseOrder, planOrder, ORDER_COMMANDS } from "./taskOrdering.js";
import type { OrderPlan } from "./taskOrdering.js";
import { exactHash } from "./updateJournal.js";

type OrderFile = { taskId: string; beforeBytes: string; nextBytes: string };
export type OrderIntent = { format: "taskdb.pending-order"; version: 1; root: RootBinding; cachePath: string; request: Request; operationId: string; at: string; files: OrderFile[]; guards: FileObservation[] };
function conflict(): never { throw new CommandError("RECOVERY_CONFLICT", "ordering has missing, divergent or invalid evidence; preserve it for inspection"); }
function stagePath(intent: OrderIntent, index: number): string {
  return path.join(intent.root.rootPath, "tasks", `.syncthing.taskdb-order-${intent.operationId}-${index}.tmp`);
}

export function orderIntentPlan(intent: OrderIntent): OrderPlan {
  return planOrder(parseOrder(intent.request.command, intent.request.args), intent.files.map(file => validateTask(parseCanonicalJson(Buffer.from(file.beforeBytes, "base64")), file.taskId)));
}

export function parseOrderIntent(value: unknown, root: RootBinding): OrderIntent {
  try {
    if (!isRecord(value)) conflict();
    const intent = value as unknown as OrderIntent;
    if (intent.format !== "taskdb.pending-order" || intent.version !== 1 || intent.root.rootPath !== root.rootPath || intent.root.rootIdentity !== root.rootIdentity
      || !path.isAbsolute(intent.cachePath) || !isTimestamp(intent.at) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(intent.operationId)) conflict();
    const request = parseRequest(intent.request);
    if (!ORDER_COMMANDS.includes(request.command) || request.readOnly || request.dryRun || !request.writeContext || !request.idempotencyKey) conflict();
    if (!Array.isArray(intent.files) || intent.files.length === 0 || new Set(intent.files.map(file => file.taskId)).size !== intent.files.length) conflict();
    if (!Array.isArray(intent.guards) || !intent.guards.some(file => file.relativePath === "workspace.json") || new Set(intent.guards.map(file => file.relativePath)).size !== intent.guards.length) conflict();
    for (const guard of intent.guards) {
      if (typeof guard.relativePath !== "string" || (guard.relativePath !== "workspace.json" && !/^tasks\/(?:[A-Za-z0-9_-]+|[A-Za-z0-9_-]+\.sync-conflict-[^/\\]+)\.json$/.test(guard.relativePath)) || !/^[0-9a-f]{64}$/.test(guard.sha256)) conflict();
    }
    for (const file of intent.files) {
      for (const encoded of [file.beforeBytes, file.nextBytes]) {
        if (typeof encoded !== "string" || Buffer.from(encoded, "base64").toString("base64") !== encoded) conflict();
        validateTask(parseCanonicalJson(Buffer.from(encoded, "base64")), file.taskId);
      }
      if (!intent.guards.some(guard => guard.relativePath === `tasks/${file.taskId}.json` && guard.sha256 === exactHash(Buffer.from(file.beforeBytes, "base64")))) conflict();
    }
    const parsed = { ...intent, request };
    const plan = orderIntentPlan(parsed);
    if (!plan.changed || plan.before.length !== intent.files.length || plan.before.some((task, index) => task.id !== intent.files[index].taskId)) conflict();
    for (const file of intent.files) {
      const next = parseCanonicalJson(Buffer.from(file.nextBytes, "base64"));
      if (canonicalJson(next) !== canonicalJson(plan.after.find(task => task.id === file.taskId))) conflict();
      if (!plan.writes.some(task => task.id === file.taskId) && file.nextBytes !== file.beforeBytes) conflict();
    }
    localPathOutsideRoot(intent.cachePath, root.rootPath);
    localDomain(root);
    return parsed;
  } catch { return conflict(); }
}

export function guardOrder(intent: OrderIntent, recovery: boolean): CanonicalSnapshot {
  try {
    const snapshot = readCanonicalRoot(intent.root.rootPath);
    const fail = (code: string): never => { throw new CommandError(recovery ? "RECOVERY_CONFLICT" : code, "ordering baseline changed"); };
    if (snapshot.rootPath !== intent.root.rootPath || snapshot.rootIdentity !== intent.root.rootIdentity) fail("STALE_SCOPE");
    const actual = new Map(snapshot.files.map(file => [file.relativePath, file.sha256]));
    if (actual.size !== intent.guards.length || intent.guards.some(guard => !actual.has(guard.relativePath))) fail("STALE_SCOPE");
    const replacements = new Map(intent.files.map(file => [`tasks/${file.taskId}.json`, file]));
    for (const guard of intent.guards) {
      const file = replacements.get(guard.relativePath);
      if (actual.get(guard.relativePath) !== guard.sha256 && !(recovery && file && actual.get(guard.relativePath) === exactHash(Buffer.from(file.nextBytes, "base64")))) fail("STALE_FILE");
    }
    const plan = orderIntentPlan(intent);
    const scope = snapshot.tasks.filter(task => task.parentId === plan.parentId);
    if (scope.length !== intent.files.length || scope.some(task => !intent.files.some(file => file.taskId === task.id))) fail("STALE_SCOPE");
    for (const [index, task] of plan.writes.entries()) {
      const temporary = stagePath(intent, index);
      const file = intent.files.find(file => file.taskId === task.id)!;
      if (existsSync(temporary) && !readRegularFile(temporary).equals(Buffer.from(file.nextBytes, "base64"))) conflict();
    }
    return snapshot;
  } catch (error) { if (recovery) return conflict(); throw error; }
}

export function applyOrderJournal(intent: OrderIntent): CanonicalSnapshot {
  const plan = orderIntentPlan(intent);
  for (const [index, task] of plan.writes.entries()) {
    const snapshot = guardOrder(intent, true);
    const file = intent.files.find(file => file.taskId === task.id)!;
    if (snapshot.files.find(file => file.relativePath === `tasks/${task.id}.json`)!.sha256 === exactHash(Buffer.from(file.nextBytes, "base64"))) continue;
    const target = path.join(intent.root.rootPath, "tasks", `${task.id}.json`);
    const temporary = stagePath(intent, index);
    const next = Buffer.from(file.nextBytes, "base64");
    if (existsSync(temporary)) { if (!readRegularFile(temporary).equals(next)) conflict(); }
    else writeDurableFile(temporary, next);
    guardOrder(intent, true);
    renameSync(temporary, target);
    syncDirectory(path.dirname(target));
  }
  const snapshot = guardOrder(intent, true);
  for (const file of intent.files) if (snapshot.files.find(actual => actual.relativePath === `tasks/${file.taskId}.json`)!.sha256 !== exactHash(Buffer.from(file.nextBytes, "base64"))) conflict();
  return snapshot;
}

export function retireOrderStages(intent: OrderIntent): void {
  for (const [index, task] of orderIntentPlan(intent).writes.entries()) {
    const temporary = stagePath(intent, index);
    if (!existsSync(temporary)) continue;
    const file = intent.files.find(file => file.taskId === task.id)!;
    if (!readRegularFile(temporary).equals(Buffer.from(file.nextBytes, "base64"))) conflict();
    unlinkSync(temporary);
    syncDirectory(path.dirname(temporary));
  }
}
