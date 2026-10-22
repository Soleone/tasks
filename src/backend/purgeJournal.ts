import { lstatSync, mkdirSync, readdirSync, renameSync, rmSync, unlinkSync } from "node:fs";
import path from "node:path";
import { CommandError } from "./errors.js";
import { parseCanonicalJson } from "./strictJson.js";
import {
  readCanonicalDeletionPrefix,
  readCanonicalRoot,
  readRegularFile,
  exactHash,
} from "./canonicalReader.js";
import type { CanonicalSnapshot } from "./canonicalReader.js";
import { attachmentPath } from "./attachments.js";
import { directoryIdentity } from "./copyFiles.js";
import { syncDirectory, localDomain, writeDurableFile } from "./localDomain.js";
import { isRecord, parseRequest } from "./protocol.js";
import type { Request } from "./protocol.js";
import { listedAttachments, planRemoval, remainingTasks, strippedTask } from "./purgePlan.js";
import type { RemovalPlan } from "./purgePlan.js";
import { localPathOutsideRoot } from "./queryCache.js";
import type { RootBinding } from "./queryCache.js";
import {
  attachmentName,
  isTimestamp,
  validateGraph,
  validateManifest,
  validateTask,
} from "./taskModel.js";
import type { CanonicalTask } from "./taskModel.js";

export type PurgeFile = { relativePath: string; beforeBytes: string; identity: string };
type PurgeRewrite = { taskId: string; nextBytes: string };
/**
 * One purge or clear-done: task files it deletes, task files it rewrites without attachments,
 * and attachments it moves into the recovery copy once the task files are done.
 */
export type PurgeIntent = {
  format: "taskdb.pending-purge";
  version: 1;
  root: RootBinding;
  taskDirectoryIdentity: string;
  cachePath: string;
  request: Request;
  operationId: string;
  at: string;
  purgedIds: string[];
  rewrites: PurgeRewrite[];
  attachments: string[];
  bytes: number;
  exportLocation: string | null;
  files: PurgeFile[];
};
export const REMOVAL_COMMANDS = ["task.purgeCanceled", "task.clearDone"];
function conflict(): never {
  throw new CommandError(
    "RECOVERY_CONFLICT",
    "purge has missing, divergent or unproven deletion evidence; preserve it for inspection",
  );
}
export function purgeFileIdentity(filePath: string): string {
  const stat = lstatSync(filePath, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()) conflict();
  return `${stat.dev}:${stat.ino}`;
}
function quarantinePath(intent: PurgeIntent, index: number): string {
  return path.join(
    intent.root.rootPath,
    "tasks",
    `.syncthing.taskdb-purge-${intent.operationId}-${index}.tmp`,
  );
}
function rewriteStagePath(intent: PurgeIntent, index: number): string {
  return path.join(
    intent.root.rootPath,
    "tasks",
    `.syncthing.taskdb-strip-${intent.operationId}-${index}.tmp`,
  );
}
/** The task files a plan rewrites, each without its attachments. */
export function plannedRewrites(
  tasks: readonly CanonicalTask[],
  plan: RemovalPlan,
): PurgeRewrite[] {
  return plan.strippedIds.map((taskId) => ({
    taskId,
    nextBytes: Buffer.from(
      `${JSON.stringify(strippedTask(tasks.find((task) => task.id === taskId)!))}\n`,
    ).toString("base64"),
  }));
}
export function purgeIntentTasks(intent: PurgeIntent): CanonicalTask[] {
  return intent.files
    .filter((file) => /^tasks\/[A-Za-z0-9_-]+\.json$/.test(file.relativePath))
    .map((file) =>
      validateTask(
        parseCanonicalJson(Buffer.from(file.beforeBytes, "base64")),
        path.basename(file.relativePath, ".json"),
      ),
    );
}
export function parsePurgeIntent(value: unknown, root: RootBinding): PurgeIntent {
  try {
    if (!isRecord(value)) conflict();
    const intent = value as unknown as PurgeIntent;
    if (
      intent.format !== "taskdb.pending-purge" ||
      intent.version !== 1 ||
      intent.root.rootPath !== root.rootPath ||
      intent.root.rootIdentity !== root.rootIdentity ||
      !/^\d+:\d+$/.test(intent.taskDirectoryIdentity) ||
      !path.isAbsolute(intent.cachePath) ||
      !isTimestamp(intent.at) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        intent.operationId,
      )
    )
      conflict();
    const request = parseRequest(intent.request);
    if (
      !REMOVAL_COMMANDS.includes(request.command) ||
      request.dryRun ||
      request.readOnly ||
      !request.writeContext ||
      !request.idempotencyKey
    )
      conflict();
    if (
      !Array.isArray(intent.files) ||
      new Set(intent.files.map((file) => file.relativePath)).size !== intent.files.length
    )
      conflict();
    for (const file of intent.files) {
      if (
        (file.relativePath !== "workspace.json" &&
          !/^tasks\/(?:[A-Za-z0-9_-]+|[A-Za-z0-9_-]+\.sync-conflict-[^/\\]+)\.json$/.test(
            file.relativePath,
          )) ||
        !/^\d+:\d+$/.test(file.identity) ||
        typeof file.beforeBytes !== "string" ||
        Buffer.from(file.beforeBytes, "base64").toString("base64") !== file.beforeBytes
      )
        conflict();
    }
    const descriptor = intent.files.find((file) => file.relativePath === "workspace.json");
    if (!descriptor) conflict();
    validateManifest(parseCanonicalJson(Buffer.from(descriptor.beforeBytes, "base64")));
    const tasks = purgeIntentTasks(intent);
    const plan = planRemoval(request, tasks);
    const listed = listedAttachments(remainingTasks(tasks, plan));
    if (
      JSON.stringify(plan.purgedIds) !== JSON.stringify(intent.purgedIds) ||
      !Array.isArray(intent.rewrites) ||
      JSON.stringify(intent.rewrites) !== JSON.stringify(plannedRewrites(tasks, plan)) ||
      !Array.isArray(intent.attachments) ||
      new Set(intent.attachments).size !== intent.attachments.length ||
      intent.attachments.some(
        (name) => typeof name !== "string" || !attachmentName.test(name) || listed.has(name),
      ) ||
      !Number.isSafeInteger(intent.bytes) ||
      intent.bytes < 0 ||
      (intent.exportLocation !== null && !path.isAbsolute(intent.exportLocation)) ||
      !(intent.purgedIds.length || intent.rewrites.length || intent.attachments.length)
    )
      conflict();
    localPathOutsideRoot(intent.cachePath, root.rootPath);
    localDomain(root);
    return { ...intent, request };
  } catch {
    return conflict();
  }
}

function recoveryName(intent: PurgeIntent): string {
  return `${intent.request.command === "task.clearDone" ? "clear-done" : "purge"}-${intent.operationId}`;
}
export function purgeRecoveryLocation(intent: PurgeIntent): string {
  return path.join(localDomain(intent.root), `${recoveryName(intent)}.recovery.json`);
}
/** Removed attachments sit next to the recovery copy, as files rather than base64. */
function attachmentRecoveryLocation(intent: PurgeIntent): string {
  return path.join(localDomain(intent.root), `${recoveryName(intent)}.attachments`);
}
function archiveBytes(intent: PurgeIntent): Buffer {
  return Buffer.from(
    `${JSON.stringify({ format: "taskdb.purge-recovery", version: 1, operationId: intent.operationId, root: intent.root, taskDirectoryIdentity: intent.taskDirectoryIdentity, cachePath: intent.cachePath, request: intent.request, at: intent.at, purgedIds: intent.purgedIds, rewrites: intent.rewrites, attachments: intent.attachments, files: intent.files })}\n`,
  );
}
function verifyArchive(intent: PurgeIntent): void {
  if (!readRegularFile(purgeRecoveryLocation(intent)).equals(archiveBytes(intent))) conflict();
}
export function persistPurgeArchive(intent: PurgeIntent): void {
  const location = purgeRecoveryLocation(intent);
  writeDurableFile(location, archiveBytes(intent));
  syncDirectory(path.dirname(location));
  verifyArchive(intent);
}
function verifyQuarantine(intent: PurgeIntent, index: number): void {
  const before = intent.files.find(
    (file) => file.relativePath === `tasks/${intent.purgedIds[index]}.json`,
  )!;
  const retained = quarantinePath(intent, index);
  if (
    purgeFileIdentity(retained) !== before.identity ||
    !readRegularFile(retained).equals(Buffer.from(before.beforeBytes, "base64"))
  )
    conflict();
}

export function guardPurge(intent: PurgeIntent, recovery: boolean): CanonicalSnapshot {
  try {
    const fail = (code: string): never => {
      throw new CommandError(recovery ? "RECOVERY_CONFLICT" : code, "purge baseline changed");
    };
    if (
      directoryIdentity(path.join(intent.root.rootPath, "tasks")) !==
        intent.taskDirectoryIdentity ||
      readdirSync(intent.root.rootPath).some((name) =>
        /^workspace\.sync-conflict-.+\.json$/.test(name),
      )
    )
      fail("STALE_SCOPE");
    const originals = purgeIntentTasks(intent),
      deleted: CanonicalTask[] = [];
    for (const [index, id] of intent.purgedIds.entries()) {
      const target = path.join(intent.root.rootPath, "tasks", `${id}.json`);
      const quarantined = lstatSync(quarantinePath(intent, index), { throwIfNoEntry: false });
      const present = lstatSync(target, { throwIfNoEntry: false });
      if (quarantined) {
        verifyQuarantine(intent, index);
        if (present || !recovery) conflict();
      }
      if (!present) {
        if (!recovery || !quarantined) fail("STALE_SCOPE");
        deleted.push(originals.find((task) => task.id === id)!);
      } else if (
        purgeFileIdentity(target) !==
        intent.files.find((file) => file.relativePath === `tasks/${id}.json`)!.identity
      )
        fail("STALE_FILE");
    }
    // While recovering, a rewritten task may already hold its next bytes.
    const rewritten = new Map(
      intent.rewrites.map((rewrite) => [
        `tasks/${rewrite.taskId}.json`,
        exactHash(Buffer.from(rewrite.nextBytes, "base64")),
      ]),
    );
    const snapshot = deleted.length
      ? readCanonicalDeletionPrefix(intent.root.rootPath, deleted)
      : readCanonicalRoot(intent.root.rootPath);
    if (
      snapshot.rootPath !== intent.root.rootPath ||
      snapshot.rootIdentity !== intent.root.rootIdentity
    )
      fail("STALE_SCOPE");
    const actual = new Map(snapshot.files.map((file) => [file.relativePath, file.sha256]));
    if ([...actual.keys()].some((name) => !intent.files.some((file) => file.relativePath === name)))
      fail("STALE_SCOPE");
    for (const file of intent.files) {
      const hash = actual.get(file.relativePath);
      if (
        hash === undefined &&
        deleted.some((task) => file.relativePath === `tasks/${task.id}.json`)
      )
        continue;
      if (hash === undefined) fail("STALE_SCOPE");
      if (recovery && hash === rewritten.get(file.relativePath)) continue;
      if (hash !== exactHash(Buffer.from(file.beforeBytes, "base64"))) fail("STALE_FILE");
    }
    if (recovery) verifyArchive(intent);
    return snapshot;
  } catch (error) {
    if (recovery) return conflict();
    throw error;
  }
}

export function applyPurgeJournal(intent: PurgeIntent): CanonicalSnapshot {
  guardPurge(intent, true);
  for (const [index, id] of intent.purgedIds.entries()) {
    const target = path.join(intent.root.rootPath, "tasks", `${id}.json`);
    if (!lstatSync(target, { throwIfNoEntry: false })) continue;
    if (
      purgeFileIdentity(target) !==
      intent.files.find((file) => file.relativePath === `tasks/${id}.json`)!.identity
    )
      conflict();
    // Retaining the original inode proves our atomic absence, unlike a pre-unlink marker.
    renameSync(target, quarantinePath(intent, index));
    syncDirectory(path.dirname(target));
  }
  const tasksDirectory = path.join(intent.root.rootPath, "tasks");
  for (const [index, rewrite] of intent.rewrites.entries()) {
    const target = path.join(tasksDirectory, `${rewrite.taskId}.json`);
    const next = Buffer.from(rewrite.nextBytes, "base64");
    const current = readRegularFile(target);
    if (current.equals(next)) continue;
    const before = intent.files.find(
      (file) => file.relativePath === `tasks/${rewrite.taskId}.json`,
    )!;
    if (!current.equals(Buffer.from(before.beforeBytes, "base64"))) conflict();
    const stage = rewriteStagePath(intent, index);
    if (lstatSync(stage, { throwIfNoEntry: false })) unlinkSync(stage);
    writeDurableFile(stage, next);
    renameSync(stage, target);
    syncDirectory(tasksDirectory);
  }
  const verified = guardPurge(intent, true);
  validateGraph(verified.tasks);
  const hashes = new Map(verified.files.map((file) => [file.relativePath, file.sha256]));
  if (
    verified.tasks.some((task) => intent.purgedIds.includes(task.id)) ||
    intent.rewrites.some(
      (rewrite) =>
        hashes.get(`tasks/${rewrite.taskId}.json`) !==
        exactHash(Buffer.from(rewrite.nextBytes, "base64")),
    )
  )
    conflict();
  return verified;
}

function moveFile(source: string, target: string): void {
  try {
    renameSync(source, target);
  } catch (error) {
    // A bare root's recovery folder can be on another drive.
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    rmSync(target, { force: true });
    writeDurableFile(target, readRegularFile(source));
    unlinkSync(source);
  }
}

/** Attachments go after the task files, skipping any that sync has listed again since. */
function retireAttachments(intent: PurgeIntent): void {
  if (!intent.attachments.length) return;
  const listed = listedAttachments(readCanonicalRoot(intent.root.rootPath).tasks);
  const directory = attachmentRecoveryLocation(intent);
  if (!lstatSync(directory, { throwIfNoEntry: false })) {
    mkdirSync(directory);
    syncDirectory(path.dirname(directory));
  }
  for (const name of intent.attachments) {
    const source = attachmentPath(intent.root.rootPath, name);
    if (listed.has(name) || !lstatSync(source, { throwIfNoEntry: false })) continue;
    moveFile(source, path.join(directory, name));
  }
  syncDirectory(directory);
  syncDirectory(path.join(intent.root.rootPath, "attachments"));
}

export function retirePurgeQuarantines(intent: PurgeIntent): void {
  try {
    verifyArchive(intent);
    const remaining = intent.purgedIds
      .map((_, index) => index)
      .filter((index) => lstatSync(quarantinePath(intent, index), { throwIfNoEntry: false }));
    for (const index of remaining) verifyQuarantine(intent, index);
    for (const index of remaining) {
      unlinkSync(quarantinePath(intent, index));
      syncDirectory(path.join(intent.root.rootPath, "tasks"));
    }
    retireAttachments(intent);
  } catch {
    return conflict();
  }
}
