import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CommandError } from "./errors.js";
import type { V2CanonicalSnapshot } from "./v2CanonicalReader.js";
import { compareV2Tasks } from "./v2TaskModel.js";

export type V2RootBinding = { rootPath: string; rootIdentity: string };
export type V2QueryAuthority = { writeContext: string; workspaceRevision: number; versions: Map<string, number> };
type CacheState = { binding: string; context: string; counter: number; revision: number; fingerprint: string };
type CachedObservation = { id: string; fingerprint: string; version: number };
const applicationId = 0x54534432;

export function localPathOutsideV2Root(cachePath: string, rootPath: string): string {
  let ancestor = path.resolve(cachePath);
  const suffix: string[] = [];
  while (lstatSync(ancestor, { throwIfNoEntry: false }) === undefined) {
    suffix.unshift(path.basename(ancestor));
    ancestor = path.dirname(ancestor);
  }
  const resolved = path.join(realpathSync(ancestor), ...suffix);
  const relative = path.relative(rootPath, resolved);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new CommandError("INVALID_STORAGE", "v2 cache must be outside the canonical root");
  }
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    if (lstatSync(`${resolved}${suffix}`, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new CommandError("INVALID_STORAGE", "v2 cache sidecars must not be symbolic links");
    }
  }
  return resolved;
}

function initializeQueryCache(database: DatabaseSync): void {
  const id = database.prepare("PRAGMA application_id").get()!.application_id;
  const version = database.prepare("PRAGMA user_version").get()!.user_version;
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
  if (id === applicationId && version === 5) return;
  const upgrade = id === applicationId && (version === 1 || version === 2 || version === 3 || version === 4);
  if (!upgrade && (id !== 0 || version !== 0 || tables.length !== 0)) {
    throw new CommandError("INVALID_STORAGE", "database is not a supported v2 query cache");
  }
  if (!upgrade) database.exec(`
    PRAGMA application_id = ${applicationId};
    PRAGMA user_version = 1;
    CREATE TABLE v2_query_state (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1), binding TEXT NOT NULL, context TEXT NOT NULL,
      counter INTEGER NOT NULL, revision INTEGER NOT NULL, fingerprint TEXT NOT NULL
    );
    CREATE TABLE v2_query_tasks (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, version INTEGER NOT NULL);
  `);
  if (version !== 2 && version !== 3 && version !== 4) database.exec(`
    CREATE TABLE v2_receipts (context TEXT NOT NULL, key TEXT NOT NULL, identity TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(context, key));
    CREATE TABLE v2_operations (id TEXT PRIMARY KEY, context TEXT NOT NULL, task_id TEXT NOT NULL, command TEXT NOT NULL,
      actor TEXT NOT NULL, created_at TEXT NOT NULL, before_record TEXT NOT NULL, after_record TEXT NOT NULL);
    PRAGMA user_version = 2;
  `);
  if (version !== 3 && version !== 4) database.exec(`
    CREATE TABLE v2_operation_members (operation_id TEXT NOT NULL, task_id TEXT NOT NULL, PRIMARY KEY(operation_id, task_id));
    CREATE INDEX v2_operation_members_task ON v2_operation_members(task_id, operation_id);
    PRAGMA user_version = 3;
  `);
  if (version !== 4) database.exec(`
    CREATE TABLE v2_undo_claims (operation_id TEXT NOT NULL, task_id TEXT NOT NULL, undo_id TEXT NOT NULL, PRIMARY KEY(operation_id, task_id));
    PRAGMA user_version = 4;
  `);
  database.exec(`
    CREATE TABLE v2_doctor_plans (id TEXT PRIMARY KEY, context TEXT NOT NULL, payload TEXT NOT NULL);
    PRAGMA user_version = 5;
  `);
}

function snapshotObservations(snapshot: V2CanonicalSnapshot): Map<string, string> {
  const hashes = new Map(snapshot.files.map(file => [file.relativePath, file.sha256]));
  const scopes = new Map<string | null, typeof snapshot.tasks>();
  for (const task of snapshot.tasks) {
    const scope = scopes.get(task.parentId) ?? [];
    scope.push(task);
    scopes.set(task.parentId, scope);
  }
  const sequences = new Map([...scopes].map(([id, scope]) => [id, scope.sort(compareV2Tasks).map(task => task.id)]));
  return new Map(snapshot.tasks.map(task => [task.id, JSON.stringify([hashes.get(`tasks/${task.id}.json`), sequences.get(task.parentId)])]));
}

export function synchronizeV2Authority(database: DatabaseSync, root: V2RootBinding, snapshot?: V2CanonicalSnapshot): V2QueryAuthority {
  const main = database.prepare("PRAGMA database_list").all().find(row => row.name === "main");
  if (typeof main?.file !== "string" || main.file === "") throw new CommandError("INVALID_STORAGE", "v2 authority requires a physical cache file");
  const cacheIdentity = lstatSync(main.file, { bigint: true });
  if (!cacheIdentity.isFile() || cacheIdentity.isSymbolicLink()) throw new CommandError("INVALID_STORAGE", "v2 authority requires a regular cache file");
  const binding = JSON.stringify([root.rootPath, root.rootIdentity, main.file, `${cacheIdentity.dev}:${cacheIdentity.ino}`]);
  const previous = database.prepare("SELECT binding, context, counter, revision, fingerprint FROM v2_query_state WHERE singleton = 1").get() as CacheState | undefined;
  const state = previous ?? { binding, context: randomUUID(), counter: 0, revision: 0, fingerprint: "" };
  if (![state.counter, state.revision].every(value => Number.isSafeInteger(value) && value >= 0) || typeof state.context !== "string" || state.context === "") {
    throw new CommandError("INVALID_STORAGE", "v2 query authority is corrupt; explicit cache recovery is required");
  }
  if (state.binding !== binding || !Number.isSafeInteger(state.counter + (snapshot?.tasks.length ?? 0) + 1) || state.revision === Number.MAX_SAFE_INTEGER) {
    state.binding = binding;
    state.context = randomUUID();
    state.counter = 0;
    state.revision = 0;
    state.fingerprint = "";
    database.exec("DELETE FROM v2_query_tasks; DELETE FROM v2_receipts; DELETE FROM v2_operations; DELETE FROM v2_operation_members; DELETE FROM v2_undo_claims; DELETE FROM v2_doctor_plans");
  }
  const versions = new Map<string, number>();
  if (snapshot) {
    const cached = new Map((database.prepare("SELECT id, fingerprint, version FROM v2_query_tasks").all() as CachedObservation[]).map(row => [row.id, row]));
    const observations = snapshotObservations(snapshot);
    const upsert = database.prepare("INSERT INTO v2_query_tasks(id, fingerprint, version) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET fingerprint = excluded.fingerprint, version = excluded.version");
    for (const [id, fingerprint] of observations) {
      const old = cached.get(id);
      const version = old?.fingerprint === fingerprint ? old.version : ++state.counter;
      if (!Number.isSafeInteger(version) || version <= 0 || version > state.counter) throw new CommandError("INVALID_STORAGE", "v2 task authority is corrupt");
      upsert.run(id, fingerprint, version);
      versions.set(id, version);
    }
    const remove = database.prepare("DELETE FROM v2_query_tasks WHERE id = ?");
    for (const id of cached.keys()) if (!observations.has(id)) remove.run(id);
    const fingerprint = createHash("sha256").update(JSON.stringify(snapshot.files)).digest("hex");
    if (fingerprint !== state.fingerprint) { state.revision += 1; state.fingerprint = fingerprint; }
  }
  database.prepare("INSERT INTO v2_query_state VALUES (1, ?, ?, ?, ?, ?) ON CONFLICT(singleton) DO UPDATE SET binding = excluded.binding, context = excluded.context, counter = excluded.counter, revision = excluded.revision, fingerprint = excluded.fingerprint")
    .run(state.binding, state.context, state.counter, state.revision, state.fingerprint);
  return { writeContext: state.context, workspaceRevision: state.revision, versions };
}

/** Rebuild the projection only; retained context, receipts and grouped history remain authoritative. */
export function rebuildV2QueryAuthority(database: DatabaseSync, root: V2RootBinding, snapshot: V2CanonicalSnapshot): V2QueryAuthority {
  const state = database.prepare("SELECT counter, revision FROM v2_query_state WHERE singleton = 1").get() as Pick<CacheState, "counter" | "revision">;
  // Reserve the rebuild allocations and the following complete read, without rotating mid-command.
  if (!Number.isSafeInteger(state.counter + snapshot.tasks.length * 2 + 2) || !Number.isSafeInteger(state.revision + 2)) {
    throw new CommandError("UNSUPPORTED_COMMAND", "explicit fresh-cache authority is required before rebuild");
  }
  database.exec("DELETE FROM v2_query_tasks; UPDATE v2_query_state SET fingerprint = '' WHERE singleton = 1");
  return synchronizeV2Authority(database, root, snapshot);
}

export function withV2CacheTransaction<T>(cachePath: string, root: V2RootBinding, action: (database: DatabaseSync) => T): T {
  const resolved = localPathOutsideV2Root(cachePath, root.rootPath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  const database = new DatabaseSync(resolved);
  try {
    database.exec("PRAGMA busy_timeout = 1000; PRAGMA synchronous = FULL; BEGIN IMMEDIATE");
    initializeQueryCache(database);
    const result = action(database);
    database.exec("COMMIT");
    return result;
  } finally {
    // Closing an uncommitted SQLite connection rolls back without swallowing the original error.
    database.close();
  }
}

export function observeV2QueryAuthority(cachePath: string, root: V2RootBinding, snapshot?: V2CanonicalSnapshot): V2QueryAuthority {
  return withV2CacheTransaction(cachePath, root, database => synchronizeV2Authority(database, root, snapshot));
}
