import { createHash } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CommandError } from "./errors.js";
import { getDataDirectory } from "./paths.js";
import { localPathOutsideV2Root } from "./queryCache.js";
import type { V2RootBinding } from "./queryCache.js";

export function v2LocalDomain(root: V2RootBinding): string {
  const key = createHash("sha256").update(JSON.stringify([root.rootPath, root.rootIdentity])).digest("hex");
  return localPathOutsideV2Root(path.join(getDataDirectory(), "taskdb-v2", "roots", key), root.rootPath);
}

export function pendingV2Path(root: V2RootBinding): string {
  return path.join(v2LocalDomain(root), "pending.json");
}

export function syncV2Directory(directory: string): void {
  // Windows FlushFileBuffers requires GENERIC_WRITE, including for directory handles.
  const descriptor = openSync(directory, process.platform === "win32" ? "r+" : "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

export function writeV2DurableFile(filePath: string, bytes: Uint8Array): void {
  const descriptor = openSync(filePath, "wx", 0o600);
  try { writeFileSync(descriptor, bytes); fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

export function withV2RootWriterLock<T>(root: V2RootBinding, action: () => T): T {
  const domain = v2LocalDomain(root);
  const firstCreated = mkdirSync(domain, { recursive: true });
  if (firstCreated) {
    const retainedParent = path.dirname(firstCreated);
    for (let directory = domain; ; directory = path.dirname(directory)) {
      syncV2Directory(directory);
      // Recursive mkdir can return \\?\-prefixed Windows paths; compare the same spelling.
      if (path.toNamespacedPath(directory) === path.toNamespacedPath(retainedParent)) break;
    }
  }
  const lockPath = localPathOutsideV2Root(path.join(domain, "lock.db"), root.rootPath);
  const lock = new DatabaseSync(lockPath);
  try {
    // SQLite releases this cross-cache, root-scoped lock even if its process is killed.
    lock.exec("PRAGMA busy_timeout = 1000; BEGIN IMMEDIATE");
    return action();
  } finally {
    lock.close();
  }
}

export function persistV2Pending(root: V2RootBinding, intent: unknown): void {
  const pending = pendingV2Path(root);
  if (lstatSync(pending, { throwIfNoEntry: false })) throw new CommandError("RECOVERY_PENDING", "root has an unfinished intent");
  const bytes = Buffer.from(`${JSON.stringify(intent)}\n`);
  const temporary = `${pending}.preparing`;
  // A crashed pre-publication stage had no canonical effects; preserve it for diagnosis.
  if (lstatSync(temporary, { throwIfNoEntry: false })) throw new CommandError("RECOVERY_CONFLICT", "unpublished intent stage requires explicit inspection");
  writeV2DurableFile(temporary, bytes);
  renameSync(temporary, pending);
  syncV2Directory(path.dirname(pending));
  if (!readFileSync(pending).equals(bytes)) throw new CommandError("RECOVERY_CONFLICT", "pending intent failed verification");
}

export function retireV2Pending(root: V2RootBinding): void {
  unlinkSync(pendingV2Path(root));
  syncV2Directory(v2LocalDomain(root));
}
