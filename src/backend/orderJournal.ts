import { existsSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { canonicalJson } from "./canonicalJson.js";
import { CommandError } from "./errors.js";
import { parseCanonicalJson } from "./strictJson.js";
import { readCanonicalRoot, readRegularFile, exactHash } from "./canonicalReader.js";
import type { CanonicalSnapshot, FileObservation } from "./canonicalReader.js";
import { parseIntentEnvelope, syncDirectory, writeDurableFile } from "./localDomain.js";
import type { Request } from "./protocol.js";
import type { RootBinding } from "./queryCache.js";
import { taskFilePath, validateTask } from "./taskModel.js";
import { parseOrder, planOrder, ORDER_COMMANDS } from "./taskOrdering.js";
import type { OrderPlan } from "./taskOrdering.js";

type OrderFile = { taskId: string; beforeBytes: string; nextBytes: string };
export type OrderIntent = {
  format: "taskdb.pending-order";
  version: 1;
  root: RootBinding;
  cachePath: string;
  request: Request;
  operationId: string;
  at: string;
  files: OrderFile[];
  guards: FileObservation[];
};
function conflict(): never {
  throw new CommandError(
    "RECOVERY_CONFLICT",
    "ordering has missing, divergent or invalid evidence; preserve it for inspection",
  );
}
function stagePath(intent: OrderIntent, index: number): string {
  return path.join(
    intent.root.rootPath,
    "tasks",
    `.syncthing.taskdb-order-${intent.operationId}-${index}.tmp`,
  );
}
function assertStageHolds(temporary: string, next: Buffer): void {
  if (!readRegularFile(temporary).equals(next)) conflict();
}

export function orderIntentPlan(intent: OrderIntent): OrderPlan {
  return planOrder(
    parseOrder(intent.request.command, intent.request.args),
    intent.files.map((file) =>
      validateTask(parseCanonicalJson(Buffer.from(file.beforeBytes, "base64")), file.taskId),
    ),
  );
}

export function parseOrderIntent(value: unknown, root: RootBinding): OrderIntent {
  try {
    const request = parseIntentEnvelope(value, root, "taskdb.pending-order", ORDER_COMMANDS);
    const intent = value as OrderIntent;
    if (
      !Array.isArray(intent.files) ||
      intent.files.length === 0 ||
      new Set(intent.files.map((file) => file.taskId)).size !== intent.files.length
    )
      conflict();
    if (
      !Array.isArray(intent.guards) ||
      !intent.guards.some((file) => file.relativePath === "workspace.json") ||
      new Set(intent.guards.map((file) => file.relativePath)).size !== intent.guards.length
    )
      conflict();
    for (const guard of intent.guards) {
      if (
        typeof guard.relativePath !== "string" ||
        (guard.relativePath !== "workspace.json" && !taskFilePath.test(guard.relativePath)) ||
        !/^[0-9a-f]{64}$/.test(guard.sha256)
      )
        conflict();
    }
    for (const file of intent.files) {
      for (const encoded of [file.beforeBytes, file.nextBytes]) {
        if (
          typeof encoded !== "string" ||
          Buffer.from(encoded, "base64").toString("base64") !== encoded
        )
          conflict();
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
    const plan = orderIntentPlan(parsed);
    if (
      !plan.changed ||
      plan.before.length !== intent.files.length ||
      plan.before.some((task, index) => task.id !== intent.files[index].taskId)
    )
      conflict();
    for (const file of intent.files) {
      const next = parseCanonicalJson(Buffer.from(file.nextBytes, "base64"));
      if (canonicalJson(next) !== canonicalJson(plan.after.find((task) => task.id === file.taskId)))
        conflict();
      if (
        !plan.writes.some((task) => task.id === file.taskId) &&
        file.nextBytes !== file.beforeBytes
      )
        conflict();
    }
    return parsed;
  } catch {
    return conflict();
  }
}

export function guardOrder(intent: OrderIntent, recovery: boolean): CanonicalSnapshot {
  try {
    const snapshot = readCanonicalRoot(intent.root.rootPath);
    const fail = (code: string): never => {
      throw new CommandError(recovery ? "RECOVERY_CONFLICT" : code, "ordering baseline changed");
    };
    if (
      snapshot.rootPath !== intent.root.rootPath ||
      snapshot.rootIdentity !== intent.root.rootIdentity
    )
      fail("STALE_SCOPE");
    const actual = new Map(snapshot.files.map((file) => [file.relativePath, file.sha256]));
    if (
      actual.size !== intent.guards.length ||
      intent.guards.some((guard) => !actual.has(guard.relativePath))
    )
      fail("STALE_SCOPE");
    const replacements = new Map(intent.files.map((file) => [`tasks/${file.taskId}.json`, file]));
    for (const guard of intent.guards) {
      const current = actual.get(guard.relativePath);
      if (current === guard.sha256) continue;
      const file = replacements.get(guard.relativePath);
      const alreadyReplaced =
        recovery && file && current === exactHash(Buffer.from(file.nextBytes, "base64"));
      if (!alreadyReplaced) fail("STALE_FILE");
    }
    const plan = orderIntentPlan(intent);
    const scope = snapshot.tasks.filter((task) => task.parentId === plan.parentId);
    if (
      scope.length !== intent.files.length ||
      scope.some((task) => !intent.files.some((file) => file.taskId === task.id))
    )
      fail("STALE_SCOPE");
    for (const [index, task] of plan.writes.entries()) {
      const temporary = stagePath(intent, index);
      const file = intent.files.find((file) => file.taskId === task.id)!;
      if (existsSync(temporary)) assertStageHolds(temporary, Buffer.from(file.nextBytes, "base64"));
    }
    return snapshot;
  } catch (error) {
    if (recovery) return conflict();
    throw error;
  }
}

/** `observed` is the caller's latest guard of this intent; each replacement is guarded again. */
export function applyOrderJournal(
  intent: OrderIntent,
  observed: CanonicalSnapshot,
): CanonicalSnapshot {
  const plan = orderIntentPlan(intent);
  let snapshot = observed;
  for (const [index, task] of plan.writes.entries()) {
    const file = intent.files.find((file) => file.taskId === task.id)!;
    if (
      snapshot.files.find((file) => file.relativePath === `tasks/${task.id}.json`)!.sha256 ===
      exactHash(Buffer.from(file.nextBytes, "base64"))
    )
      continue;
    const target = path.join(intent.root.rootPath, "tasks", `${task.id}.json`);
    const temporary = stagePath(intent, index);
    const next = Buffer.from(file.nextBytes, "base64");
    if (existsSync(temporary)) assertStageHolds(temporary, next);
    else writeDurableFile(temporary, next);
    snapshot = guardOrder(intent, true);
    renameSync(temporary, target);
    syncDirectory(path.dirname(target));
  }
  snapshot = guardOrder(intent, true);
  for (const file of intent.files)
    if (
      snapshot.files.find((actual) => actual.relativePath === `tasks/${file.taskId}.json`)!
        .sha256 !== exactHash(Buffer.from(file.nextBytes, "base64"))
    )
      conflict();
  return snapshot;
}

export function retireOrderStages(intent: OrderIntent): void {
  for (const [index, task] of orderIntentPlan(intent).writes.entries()) {
    const temporary = stagePath(intent, index);
    if (!existsSync(temporary)) continue;
    const file = intent.files.find((file) => file.taskId === task.id)!;
    assertStageHolds(temporary, Buffer.from(file.nextBytes, "base64"));
    unlinkSync(temporary);
    syncDirectory(path.dirname(temporary));
  }
}
