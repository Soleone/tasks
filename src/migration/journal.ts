import { existsSync, renameSync } from "node:fs";
import path from "node:path";
import { CommandError } from "../backend/errors.js";
import { readRegularFile } from "../backend/canonicalReader.js";
import type { CanonicalSnapshot } from "../backend/canonicalReader.js";
import type { CopyFile, CopyIntent } from "../backend/copyJournal.js";
import { syncDirectory, localDomain, writeDurableFile } from "../backend/localDomain.js";
import { isRecord } from "../backend/protocol.js";
import type { RootBinding } from "../backend/queryCache.js";
import { compareTasks } from "../backend/taskModel.js";
import { exactHash } from "../backend/updateJournal.js";
import { planSchema1Conversion } from "./conversion.js";

export type MigrationEvidence = {
  directories: { relativePath: string; identity: string }[];
  files: CopyFile[];
};
export const SCHEMA1_ROLLBACK_WARNING =
  "Rollback selects the preserved pre-migration schema 1 folder with the old client. Later edits are not reverse-converted; keep the migrated folder separately.";

function invalidEvidence(): never {
  throw new CommandError(
    "RECOVERY_CONFLICT",
    "migration has missing, divergent or invalid source evidence",
  );
}

export function parseMigrationEvidence(
  value: unknown,
  root: RootBinding,
  target: CopyFile[],
): MigrationEvidence {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    !Array.isArray(value.directories) ||
    !Array.isArray(value.files)
  )
    invalidEvidence();
  const evidence = value as unknown as MigrationEvidence;
  if (
    ![2, 3].includes(evidence.directories.length) ||
    evidence.directories.some(
      (directory, index) =>
        directory.relativePath !== [".", "tasks", "order"][index] ||
        !/^\d+:\d+$/.test(directory.identity),
    ) ||
    evidence.directories[0].identity !== root.rootIdentity
  )
    invalidEvidence();
  if (
    new Set(evidence.files.map((file) => file.relativePath)).size !== evidence.files.length ||
    !evidence.files.some((file) => file.relativePath === "workspace.json") ||
    (evidence.directories.length === 2 &&
      evidence.files.some((file) => file.relativePath.startsWith("order/")))
  )
    invalidEvidence();
  for (const file of evidence.files) {
    if (
      file.relativePath !== "workspace.json" &&
      !/^(?:tasks|order)\/[A-Za-z0-9_-]+\.json$/.test(file.relativePath)
    )
      invalidEvidence();
    if (
      typeof file.bytes !== "string" ||
      Buffer.from(file.bytes, "base64").toString("base64") !== file.bytes ||
      file.sha256 !== exactHash(Buffer.from(file.bytes, "base64"))
    )
      invalidEvidence();
  }
  const taskPaths = (files: CopyFile[]) =>
    files
      .filter((file) => file.relativePath.startsWith("tasks/"))
      .map((file) => file.relativePath)
      .sort();
  if (JSON.stringify(taskPaths(evidence.files)) !== JSON.stringify(taskPaths(target)))
    invalidEvidence();
  if (target.some((file) => file.relativePath.includes(".sync-conflict-"))) invalidEvidence();
  return evidence;
}

/** Recomputing checks the fixed mapping, never chooses new output bytes or ownership. */
export function guardMigrationSource(intent: CopyIntent): CanonicalSnapshot {
  try {
    const expected = intent.migration;
    if (!expected) invalidEvidence();
    const current = planSchema1Conversion(intent.source.rootPath);
    if (
      current.source.rootPath !== intent.root.rootPath ||
      current.source.rootIdentity !== intent.root.rootIdentity ||
      JSON.stringify(current.source.directories) !== JSON.stringify(expected.directories) ||
      JSON.stringify(current.source.files) !==
        JSON.stringify(expected.files.map(({ relativePath, sha256 }) => ({ relativePath, sha256 })))
    )
      invalidEvidence();
    const planned = new Map(
      current.files.map((file) => [file.relativePath, exactHash(file.bytes)]),
    );
    if (
      planned.size !== intent.files.length ||
      intent.files.some((file) => planned.get(file.relativePath) !== file.sha256)
    )
      invalidEvidence();
    const tasks = [...current.tasks];
    tasks.sort((left, right) =>
      left.parentId === right.parentId
        ? compareTasks(left, right)
        : (left.parentId ?? "") < (right.parentId ?? "")
          ? -1
          : 1,
    );
    return {
      ...intent.root,
      tasks,
      files: intent.files.map(({ relativePath, sha256 }) => ({ relativePath, sha256 })),
      conflictFiles: [],
    };
  } catch {
    throw new CommandError(
      "MIGRATION_CONFLICT",
      "v1 source inventory, bindings or fixed mapping changed; preserve source and stage for inspection",
    );
  }
}

export function migrationRecoveryLocation(intent: CopyIntent): string {
  return path.join(localDomain(intent.root), `migration-${intent.operationId}.v1.json`);
}

function migrationRecoveryBytes(intent: CopyIntent): Buffer {
  if (!intent.migration) invalidEvidence();
  return Buffer.from(
    `${JSON.stringify({ format: "taskdb.v1-migration-recovery", version: 1, sourceDirectory: intent.source.rootPath, files: intent.migration.files })}\n`,
  );
}

export function verifyMigrationRecovery(intent: CopyIntent): void {
  const file = migrationRecoveryLocation(intent);
  if (
    existsSync(`${file}.preparing`) ||
    !readRegularFile(file).equals(migrationRecoveryBytes(intent))
  )
    invalidEvidence();
}

/** Raw originals are an independent recovery artifact, not a receipt or completed-request ledger. */
export function persistMigrationRecovery(intent: CopyIntent): void {
  const file = migrationRecoveryLocation(intent);
  const bytes = migrationRecoveryBytes(intent);
  if (existsSync(`${file}.preparing`)) invalidEvidence();
  if (existsSync(file)) {
    if (!readRegularFile(file).equals(bytes)) invalidEvidence();
  } else {
    writeDurableFile(`${file}.preparing`, bytes);
    renameSync(`${file}.preparing`, file);
    syncDirectory(path.dirname(file));
  }
  if (!readRegularFile(file).equals(bytes)) invalidEvidence();
}

export function migrationCompletion(intent: CopyIntent): Record<string, unknown> {
  return {
    sourceDirectory: intent.source.rootPath,
    destinationDirectory: intent.destination.directory,
    transformedIds: intent.files
      .filter((file) => file.relativePath.startsWith("tasks/"))
      .map((file) => path.basename(file.relativePath, ".json")),
    recoveryLocation: migrationRecoveryLocation(intent),
    preservedSchema1Directory: intent.source.rootPath,
    rollbackWarning: SCHEMA1_ROLLBACK_WARNING,
    selectionChanged: false,
  };
}
