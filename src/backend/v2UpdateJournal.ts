import { createHash } from "node:crypto";
import { existsSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { CommandError } from "./errors.js";
import { canonicalJson } from "./canonicalJson.js";
import { applyV2Update, parseV2Update } from "./v2UpdateInputs.js";
import { applyV2Status, parseV2StatusInput, V2_STATUS_COMMANDS } from "./v2TaskStatus.js";
import { applyV2Relationship, matchesV2RelationshipEffect, parseV2Relationship, V2_RELATIONSHIP_COMMANDS } from "./v2TaskRelationships.js";
import { parseV2CanonicalJson } from "./v2CanonicalJson.js";
import { readV2CanonicalRoot, readV2RegularFile } from "./v2CanonicalReader.js";
import type { V2CanonicalSnapshot, V2FileObservation } from "./v2CanonicalReader.js";
import { pendingV2Path, syncV2Directory, writeV2DurableFile } from "./v2LocalDomain.js";
import { parseV2Request } from "./v2Protocol.js";
import type { V2Request } from "./v2Protocol.js";
import type { V2RootBinding } from "./v2QueryCache.js";
import { isV2Timestamp, validateV2Graph, validateV2Task } from "./v2TaskModel.js";

export type V2UpdateIntent = {
  format: "taskdb.pending-update"; version: 1; root: V2RootBinding; cachePath: string;
  request: V2Request; operationId: string; at: string; taskId: string;
  beforeBytes: string; nextBytes: string; guards: V2FileObservation[];
};

function recoveryConflict(): never {
  throw new CommandError("RECOVERY_CONFLICT", "pending update has missing, divergent or invalid evidence");
}

export function exactV2Hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function readV2Pending(root: V2RootBinding): V2UpdateIntent | undefined {
  const filePath = pendingV2Path(root);
  if (!existsSync(filePath)) {
    if (existsSync(`${filePath}.preparing`)) recoveryConflict();
    return undefined;
  }
  try {
    const intent = parseV2CanonicalJson(readV2RegularFile(filePath)) as V2UpdateIntent;
    if (intent.format !== "taskdb.pending-update" || intent.version !== 1
      || intent.root.rootPath !== root.rootPath || intent.root.rootIdentity !== root.rootIdentity
      || typeof intent.cachePath !== "string" || !/^[A-Za-z0-9_-]+$/.test(intent.taskId)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(intent.operationId)) recoveryConflict();
    for (const encoded of [intent.beforeBytes, intent.nextBytes]) {
      if (typeof encoded !== "string" || Buffer.from(encoded, "base64").toString("base64") !== encoded) recoveryConflict();
      validateV2Task(parseV2CanonicalJson(Buffer.from(encoded, "base64")), intent.taskId);
    }
    const request = parseV2Request(intent.request);
    if (!["task.update", ...V2_STATUS_COMMANDS, ...V2_RELATIONSHIP_COMMANDS].includes(request.command) || request.args.id !== intent.taskId || request.readOnly || request.dryRun || !request.writeContext || !request.idempotencyKey) recoveryConflict();
    if (!Array.isArray(intent.guards) || intent.guards.length === 0 || new Set(intent.guards.map(file => file.relativePath)).size !== intent.guards.length) recoveryConflict();
    for (const file of intent.guards) {
      if (typeof file.relativePath !== "string" || typeof file.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(file.sha256)) recoveryConflict();
    }
    if (!intent.guards.some(file => file.relativePath === `tasks/${intent.taskId}.json` && file.sha256 === exactV2Hash(Buffer.from(intent.beforeBytes, "base64")))) recoveryConflict();
    const next = validateV2Task(parseV2CanonicalJson(Buffer.from(intent.nextBytes, "base64")), intent.taskId);
    if (!isV2Timestamp(intent.at)) recoveryConflict();
    const before = validateV2Task(parseV2CanonicalJson(Buffer.from(intent.beforeBytes, "base64")), intent.taskId);
    if (V2_RELATIONSHIP_COMMANDS.includes(request.command)) {
      if (!matchesV2RelationshipEffect(before, next, parseV2Relationship(request.command, request.args), intent.at)) recoveryConflict();
    } else {
      if (request.command !== "task.update") parseV2StatusInput(request.args);
      const expected = request.command === "task.update" ? applyV2Update(before, parseV2Update(request.args), intent.at) : applyV2Status(before, request.command, intent.at);
      if (!expected.changed || canonicalJson(expected.task) !== canonicalJson(next)) recoveryConflict();
    }
    return { ...intent, request };
  } catch {
    return recoveryConflict();
  }
}

export function guardV2Update(intent: V2UpdateIntent, recovery: boolean): V2CanonicalSnapshot {
  const fail = (code: string): never => { throw new CommandError(recovery ? "RECOVERY_CONFLICT" : code, "canonical update baseline changed"); };
  let snapshot: V2CanonicalSnapshot;
  try { snapshot = readV2CanonicalRoot(intent.root.rootPath); } catch (error) {
    if (recovery) return recoveryConflict();
    throw error;
  }
  if (snapshot.rootPath !== intent.root.rootPath || snapshot.rootIdentity !== intent.root.rootIdentity) fail("STALE_SCOPE");
  const observed = new Map(snapshot.files.map(file => [file.relativePath, file.sha256]));
  if (observed.size !== intent.guards.length || intent.guards.some(file => !observed.has(file.relativePath))) fail("STALE_SCOPE");
  const nextHash = exactV2Hash(Buffer.from(intent.nextBytes, "base64"));
  for (const file of intent.guards) {
    const actual = observed.get(file.relativePath);
    const alreadyApplied = recovery && file.relativePath === `tasks/${intent.taskId}.json` && actual === nextHash;
    if (actual !== file.sha256 && !alreadyApplied) fail("STALE_FILE");
  }
  if (V2_RELATIONSHIP_COMMANDS.includes(intent.request.command)) {
    try {
      const before = validateV2Task(parseV2CanonicalJson(Buffer.from(intent.beforeBytes, "base64")), intent.taskId);
      // All other exact bytes passed the guards; substitute the fixed preimage if the target was already applied.
      const original = snapshot.tasks.map(task => task.id === intent.taskId ? before : task);
      validateV2Graph(original);
      const expected = applyV2Relationship(before, parseV2Relationship(intent.request.command, intent.request.args), original, intent.at);
      if (!expected.changed || canonicalJson(expected.task) !== canonicalJson(parseV2CanonicalJson(Buffer.from(intent.nextBytes, "base64")))) fail("STALE_SCOPE");
    } catch (error) {
      if (recovery) return recoveryConflict();
      throw error;
    }
  }
  return snapshot;
}

export function applyV2Journal(intent: V2UpdateIntent): V2CanonicalSnapshot {
  let snapshot: V2CanonicalSnapshot;
  try { snapshot = guardV2Update(intent, true); } catch { return recoveryConflict(); }
  const bytes = Buffer.from(intent.nextBytes, "base64");
  const target = path.join(intent.root.rootPath, "tasks", `${intent.taskId}.json`);
  if (snapshot.files.find(file => file.relativePath === `tasks/${intent.taskId}.json`)!.sha256 !== exactV2Hash(bytes)) {
    const temporary = path.join(intent.root.rootPath, "tasks", `.syncthing.taskdb-${intent.operationId}.tmp`);
    if (existsSync(temporary)) {
      if (!readV2RegularFile(temporary).equals(bytes)) recoveryConflict();
      unlinkSync(temporary);
    }
    writeV2DurableFile(temporary, bytes);
    guardV2Update(intent, true);
    renameSync(temporary, target);
    syncV2Directory(path.dirname(target));
  }
  snapshot = guardV2Update(intent, true);
  if (snapshot.files.find(file => file.relativePath === `tasks/${intent.taskId}.json`)!.sha256 !== exactV2Hash(bytes)) recoveryConflict();
  return snapshot;
}
