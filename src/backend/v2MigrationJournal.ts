import { existsSync, renameSync } from "node:fs";
import path from "node:path";
import { CommandError } from "./errors.js";
import { readV2RegularFile } from "./v2CanonicalReader.js";
import { parseV2CanonicalJson } from "./v2CanonicalJson.js";
import type { V2CanonicalSnapshot } from "./v2CanonicalReader.js";
import type { CopyFile, V2CopyIntent } from "./v2CopyJournal.js";
import { syncV2Directory, v2LocalDomain, writeV2DurableFile } from "./v2LocalDomain.js";
import { isV2Record } from "./v2Protocol.js";
import type { V2RootBinding } from "./v2QueryCache.js";
import { compareV2Tasks, validateV2Task } from "./v2TaskModel.js";
import { exactV2Hash } from "./v2UpdateJournal.js";
import { planV1ToV2Conversion } from "./v2V1Conversion.js";

export type V2MigrationEvidence = { directories: { relativePath: string; identity: string }[]; files: CopyFile[] };
export const V1_ROLLBACK_WARNING = "Rollback selects preserved pre-migration v1 state with a v1 client. Later v2 edits are not reverse-converted; retain the v2 folder separately.";

function invalidEvidence(): never { throw new CommandError("RECOVERY_CONFLICT", "migration has missing, divergent or invalid source evidence"); }

export function parseV2MigrationEvidence(value: unknown, root: V2RootBinding, target: CopyFile[]): V2MigrationEvidence {
  if (!isV2Record(value) || Object.keys(value).length !== 2 || !Array.isArray(value.directories) || !Array.isArray(value.files)) invalidEvidence();
  const evidence = value as unknown as V2MigrationEvidence;
  if (evidence.directories.length !== 3 || evidence.directories.some((directory, index) => directory.relativePath !== [".", "tasks", "order"][index] || !/^\d+:\d+$/.test(directory.identity))
    || evidence.directories[0].identity !== root.rootIdentity) invalidEvidence();
  if (new Set(evidence.files.map(file => file.relativePath)).size !== evidence.files.length
    || !evidence.files.some(file => file.relativePath === "workspace.json") || !evidence.files.some(file => file.relativePath === "order/root.json")) invalidEvidence();
  for (const file of evidence.files) {
    if (file.relativePath !== "workspace.json" && !/^(?:tasks|order)\/[A-Za-z0-9_-]+\.json$/.test(file.relativePath)) invalidEvidence();
    if (typeof file.bytes !== "string" || Buffer.from(file.bytes, "base64").toString("base64") !== file.bytes || file.sha256 !== exactV2Hash(Buffer.from(file.bytes, "base64"))) invalidEvidence();
  }
  const taskPaths = (files: CopyFile[]) => files.filter(file => file.relativePath.startsWith("tasks/")).map(file => file.relativePath).sort();
  if (JSON.stringify(taskPaths(evidence.files)) !== JSON.stringify(taskPaths(target))) invalidEvidence();
  if (target.some(file => file.relativePath.includes(".sync-conflict-"))) invalidEvidence();
  return evidence;
}

/** Recomputing checks the fixed mapping, never chooses new output bytes or ownership. */
export function guardV2MigrationSource(intent: V2CopyIntent): V2CanonicalSnapshot {
  try {
    const expected = intent.migration;
    if (!expected) invalidEvidence();
    const current = planV1ToV2Conversion(intent.source.rootPath);
    if (current.source.rootPath !== intent.root.rootPath || current.source.rootIdentity !== intent.root.rootIdentity
      || JSON.stringify(current.source.directories) !== JSON.stringify(expected.directories)
      || JSON.stringify(current.source.files) !== JSON.stringify(expected.files.map(({ relativePath, sha256 }) => ({ relativePath, sha256 })))) invalidEvidence();
    const planned = new Map(current.files.map(file => [file.relativePath, exactV2Hash(file.bytes)]));
    if (planned.size !== intent.files.length || intent.files.some(file => planned.get(file.relativePath) !== file.sha256)) invalidEvidence();
    const tasks = intent.files.filter(file => file.relativePath.startsWith("tasks/")).map(file => validateV2Task(parseV2CanonicalJson(Buffer.from(file.bytes, "base64")), path.basename(file.relativePath, ".json")));
    tasks.sort((left, right) => left.parentId === right.parentId ? compareV2Tasks(left, right) : (left.parentId ?? "") < (right.parentId ?? "") ? -1 : 1);
    return { ...intent.root, tasks, files: intent.files.map(({ relativePath, sha256 }) => ({ relativePath, sha256 })), conflictFiles: [] };
  } catch {
    throw new CommandError("MIGRATION_CONFLICT", "v1 source inventory, bindings or fixed mapping changed; preserve source and stage for inspection");
  }
}

export function migrationRecoveryLocation(intent: V2CopyIntent): string {
  return path.join(v2LocalDomain(intent.root), `migration-${intent.operationId}.v1.json`);
}

function migrationRecoveryBytes(intent: V2CopyIntent): Buffer {
  if (!intent.migration) invalidEvidence();
  return Buffer.from(`${JSON.stringify({ format: "taskdb.v1-migration-recovery", version: 1, sourceDirectory: intent.source.rootPath, files: intent.migration.files })}\n`);
}

export function verifyV2MigrationRecovery(intent: V2CopyIntent): void {
  const file = migrationRecoveryLocation(intent);
  if (existsSync(`${file}.preparing`) || !readV2RegularFile(file).equals(migrationRecoveryBytes(intent))) invalidEvidence();
}

/** Raw originals are an independent recovery artifact, not a receipt or completed-request ledger. */
export function persistV2MigrationRecovery(intent: V2CopyIntent): void {
  const file = migrationRecoveryLocation(intent);
  const bytes = migrationRecoveryBytes(intent);
  if (existsSync(`${file}.preparing`)) invalidEvidence();
  if (existsSync(file)) {
    if (!readV2RegularFile(file).equals(bytes)) invalidEvidence();
  } else {
    writeV2DurableFile(`${file}.preparing`, bytes);
    renameSync(`${file}.preparing`, file);
    syncV2Directory(path.dirname(file));
  }
  if (!readV2RegularFile(file).equals(bytes)) invalidEvidence();
}

export function migrationCompletion(intent: V2CopyIntent): Record<string, unknown> {
  return {
    sourceDirectory: intent.source.rootPath,
    destinationDirectory: intent.destination.directory,
    transformedIds: intent.files.filter(file => file.relativePath.startsWith("tasks/")).map(file => path.basename(file.relativePath, ".json")),
    recoveryLocation: migrationRecoveryLocation(intent),
    preservedV1Directory: intent.source.rootPath,
    rollbackWarning: V1_ROLLBACK_WARNING,
    selectionChanged: false,
  };
}
