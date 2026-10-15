import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { withTransaction } from "./database.js";
import { canonicalRootPath, localStateDirectory, syncCanonicalWorkspace } from "./canonicalWorkspace.js";
import { CommandError } from "../../backend/errors.js";

type ReceiveMarker = { backupRoot: string; startedAt: string };

function markerPath(databasePath: string): string {
  return path.join(localStateDirectory(databasePath), "receive-workspace.json");
}

function readMarker(databasePath: string): ReceiveMarker | null {
  try {
    const value = JSON.parse(readFileSync(markerPath(databasePath), "utf8")) as Partial<ReceiveMarker>;
    if (typeof value.backupRoot !== "string" || typeof value.startedAt !== "string") throw new Error("invalid marker");
    return value as ReceiveMarker;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new CommandError("INVALID_STORAGE", "receive-workspace state is invalid");
  }
}

function clearDirectoryExceptMarker(root: string): void {
  mkdirSync(root, { recursive: true });
  for (const name of readdirSync(root)) {
    if (name === ".stfolder") continue;
    rmSync(path.join(root, name), { recursive: true, force: true });
  }
}

function copyCanonicalRoot(source: string, destination: string): void {
  clearDirectoryExceptMarker(destination);
  for (const name of readdirSync(source)) {
    if (name === ".stfolder") continue;
    cpSync(path.join(source, name), path.join(destination, name), { recursive: true, errorOnExist: false, force: true });
  }
}

function clearCache(database: DatabaseSync): void {
  withTransaction(database, () => {
    database.exec("DELETE FROM task_dependencies; DELETE FROM task_tags; DELETE FROM activity; DELETE FROM command_receipts; DELETE FROM tasks; DELETE FROM categories; DELETE FROM tags; DELETE FROM sync_files; DELETE FROM sync_conflicts; DELETE FROM cache_meta WHERE key = 'workspace_id';");
  });
}

export function isReceivingWorkspace(databasePath: string): boolean {
  return readMarker(databasePath) !== null;
}

export function prepareReceiveWorkspace(database: DatabaseSync, databasePath: string): Record<string, unknown> {
  if (readMarker(databasePath)) throw new CommandError("RECEIVE_PENDING", "this device is already waiting for a workspace");
  const root = canonicalRootPath(databasePath);
  const backupRoot = path.join(path.dirname(root), `sync-backup-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`);
  mkdirSync(path.dirname(backupRoot), { recursive: true });
  if (existsSync(root)) cpSync(root, backupRoot, { recursive: true, errorOnExist: true });
  else mkdirSync(backupRoot, { recursive: true });
  clearDirectoryExceptMarker(root);
  clearCache(database);
  mkdirSync(localStateDirectory(databasePath), { recursive: true });
  writeFileSync(markerPath(databasePath), `${JSON.stringify({ backupRoot, startedAt: new Date().toISOString() })}\n`, { mode: 0o600 });
  return { backupRoot, syncRoot: root, waiting: true };
}

export function receiveWorkspaceStatus(database: DatabaseSync, databasePath: string): Record<string, unknown> {
  const marker = readMarker(databasePath);
  if (!marker) return { waiting: false };
  const root = canonicalRootPath(databasePath);
  const workspacePath = path.join(root, "workspace.json");
  if (!existsSync(workspacePath)) return { waiting: true, backupRoot: marker.backupRoot, syncRoot: root, ready: false };
  const syncResult = syncCanonicalWorkspace(database, databasePath);
  if (syncResult.conflicts > 0 || syncResult.skipped > 0) return { waiting: true, backupRoot: marker.backupRoot, syncRoot: root, ready: false, sync: syncResult };
  rmSync(markerPath(databasePath), { force: true });
  return { waiting: false, adopted: true, taskCount: syncResult.tasks, sync: syncResult };
}

export function abortReceiveWorkspace(database: DatabaseSync, databasePath: string): Record<string, unknown> {
  const marker = readMarker(databasePath);
  if (!marker) throw new CommandError("RECEIVE_NOT_PENDING", "this device is not waiting for a workspace");
  const root = canonicalRootPath(databasePath);
  copyCanonicalRoot(marker.backupRoot, root);
  clearCache(database);
  rmSync(markerPath(databasePath), { force: true });
  const syncResult = syncCanonicalWorkspace(database, databasePath);
  return { waiting: false, restored: true, taskCount: syncResult.tasks, backupRoot: marker.backupRoot };
}
