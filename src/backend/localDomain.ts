import { createHash } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CommandError } from "./errors.js";
import { homeOfRoot } from "./home.js";
import { beginImmediate, localPathOutsideRoot } from "./queryCache.js";
import type { RootBinding } from "./queryCache.js";

let otherRoots: string | undefined;

/**
 * Where recovery evidence for roots that aren't a home's `sync/` lives: old folders being
 * converted into a home. It sits beside the selected cache, inside the
 * selected home's `local/` for the app and CLI. Every gateway call selects it first.
 */
export function selectOtherRootsDirectory(cachePath: string): void {
  otherRoots = path.join(path.dirname(path.resolve(cachePath)), "roots");
}

/**
 * A home's lock and recovery files sit next to its `sync/`, so every spelling of the path and
 * every cache shares them.
 */
export function localDomain(root: RootBinding): string {
  const home = homeOfRoot(root.rootPath);
  if (home) return path.join(home, "local");
  if (!otherRoots) throw new CommandError("INVALID_STORAGE", "no cache was selected for this root");
  const key = createHash("sha256")
    .update(JSON.stringify([root.rootPath, root.rootIdentity]))
    .digest("hex");
  return localPathOutsideRoot(path.join(otherRoots, key), root.rootPath);
}

export function pendingIntentPath(root: RootBinding): string {
  return path.join(localDomain(root), "pending.json");
}

export function syncDirectory(directory: string): void {
  // Windows FlushFileBuffers requires GENERIC_WRITE, including for directory handles.
  const descriptor = openSync(directory, process.platform === "win32" ? "r+" : "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function writeDurableFile(filePath: string, bytes: Uint8Array): void {
  const descriptor = openSync(filePath, "wx", 0o600);
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function withRootWriterLock<T>(root: RootBinding, action: () => T): T {
  const domain = localDomain(root);
  const firstCreated = mkdirSync(domain, { recursive: true });
  if (firstCreated) {
    const retainedParent = path.dirname(firstCreated);
    for (let directory = domain; ; directory = path.dirname(directory)) {
      syncDirectory(directory);
      // Recursive mkdir can return \\?\-prefixed Windows paths; compare the same spelling.
      if (path.toNamespacedPath(directory) === path.toNamespacedPath(retainedParent)) break;
    }
  }
  const lockPath = localPathOutsideRoot(path.join(domain, "lock.db"), root.rootPath);
  const lock = new DatabaseSync(lockPath);
  try {
    // SQLite releases this cross-cache, root-scoped lock even if its process is killed.
    beginImmediate(lock);
    return action();
  } finally {
    lock.close();
  }
}

export function persistPending(root: RootBinding, intent: unknown): void {
  const pending = pendingIntentPath(root);
  if (lstatSync(pending, { throwIfNoEntry: false }))
    throw new CommandError("RECOVERY_PENDING", "root has an unfinished intent");
  const bytes = Buffer.from(`${JSON.stringify(intent)}\n`);
  const temporary = `${pending}.preparing`;
  // A crashed pre-publication stage had no canonical effects; preserve it for diagnosis.
  if (lstatSync(temporary, { throwIfNoEntry: false }))
    throw new CommandError(
      "RECOVERY_CONFLICT",
      "unpublished intent stage requires explicit inspection",
    );
  writeDurableFile(temporary, bytes);
  renameSync(temporary, pending);
  syncDirectory(path.dirname(pending));
  if (!readFileSync(pending).equals(bytes))
    throw new CommandError("RECOVERY_CONFLICT", "pending intent failed verification");
}

export function retirePending(root: RootBinding): void {
  unlinkSync(pendingIntentPath(root));
  syncDirectory(localDomain(root));
}
