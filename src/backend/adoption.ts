import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readCanonicalRoot, readRegularFile } from "./canonicalReader.js";
import { directoryIdentity } from "./copyFiles.js";
import { CommandError } from "./errors.js";
import { homeAt, homeCache, isWithin, newHomePath, openHome } from "./home.js";
import type { Home } from "./home.js";
import { syncDirectory, writeDurableFile } from "./localDomain.js";
import { bindStagedCache, cacheOrigin } from "./queryCache.js";
import type { RootBinding } from "./queryCache.js";

/**
 * Where the app kept a task folder's cache and recovery files before Tasks homes: `profile` is
 * the folder holding `taskdb-v2/`.
 */
export type OldInstallation = { root: string; cache: string; profile: string };

// Left in the home's `local/` as evidence, and to recognize an adoption that already finished.
const MARKER = "adoption.json";

function refuse(code: string, message: string): never {
  throw new CommandError(code, message);
}

function copyVerified(from: string, to: string): void {
  const bytes = readRegularFile(from);
  writeDurableFile(to, bytes);
  if (!readFileSync(to).equals(bytes)) refuse("INVALID_STORAGE", `${to} didn't copy correctly.`);
}

function flushFile(file: string): void {
  const descriptor = openSync(file, "r+");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/** The old app named a folder's recovery directory after the path as `realpathSync` spells it. */
function oldDomain(old: OldInstallation, root: RootBinding): string {
  const key = createHash("sha256")
    .update(JSON.stringify([root.rootPath, root.rootIdentity]))
    .digest("hex");
  return path.join(old.profile, "taskdb-v2", "roots", key);
}

/** Holds the old folder's writer lock, so an old writer still running can't change it meanwhile. */
function withOldWriterLock<T>(domain: string, action: () => T): T {
  const lockPath = path.join(domain, "lock.db");
  // A folder that was never written to has no lock, and nothing is created in the old place.
  if (!existsSync(lockPath)) return action();
  const lock = new DatabaseSync(lockPath);
  try {
    try {
      lock.exec("PRAGMA busy_timeout = 1000; BEGIN IMMEDIATE");
    } catch {
      refuse(
        "FOLDER_IN_USE",
        "The old task folder is in use. Close Tasks and the CLI, then retry.",
      );
    }
    return action();
  } finally {
    lock.close();
  }
}

/** The old recovery files to keep in the home; an unfinished operation stops the adoption. */
function oldRecoveryFiles(domain: string): string[] {
  if (!existsSync(domain)) return [];
  const names = readdirSync(domain).filter((name) => !name.startsWith("lock.db"));
  for (const name of names) {
    if (name === "pending.json" || name.endsWith(".preparing"))
      refuse(
        "RECOVERY_PENDING",
        "The old task folder has an unfinished operation. Finish it with the previous version of Tasks first.",
      );
    if (!lstatSync(path.join(domain, name)).isFile())
      refuse("INVALID_STORAGE", `${path.join(domain, name)} isn't a file Tasks wrote.`);
  }
  return names;
}

/** A stage is never published, so one left by an interrupted adoption can go; anything else stays. */
function clearStage(stage: string): void {
  if (!lstatSync(stage, { throwIfNoEntry: false })) return;
  const local = path.join(stage, "local");
  const ours =
    existsSync(path.join(local, MARKER)) ||
    readdirSync(stage).every((name) => name === "local" && readdirSync(local).length === 0);
  if (!ours) refuse("HOME_CONFLICT", `${stage} is in the way. Move it elsewhere and retry.`);
  rmSync(stage, { recursive: true, force: true });
}

/** The home this folder was already adopted into, when an earlier run finished. */
function adoptedHome(homePath: string, rootIdentity: string): Home | undefined {
  const marker = path.join(homePath, "local", MARKER);
  if (!existsSync(marker)) return undefined;
  const recorded = JSON.parse(readFileSync(marker, "utf8")) as { rootIdentity?: unknown };
  return recorded.rootIdentity === rootIdentity ? openHome(homePath) : undefined;
}

/**
 * Copies the old cache as one consistent snapshot and binds it to the home, so the write context,
 * receipts, activity and undo claims carry on there. The old cache is only read.
 */
function copyCache(
  oldCache: string,
  oldRoot: RootBinding,
  staged: string,
  published: { root: RootBinding; cache: string },
): void {
  const source = new DatabaseSync(oldCache, { readOnly: true });
  try {
    const origin = cacheOrigin(source, oldRoot);
    if (origin === "new") return;
    if (origin === "copied")
      refuse(
        "CACHE_FROM_ELSEWHERE",
        "The old cache belongs to another copy of the task folder, so its history can't come along.",
      );
    source.prepare("VACUUM INTO ?").run(staged);
  } finally {
    source.close();
  }
  flushFile(staged);
  const database = new DatabaseSync(staged);
  try {
    database.exec("PRAGMA synchronous = FULL");
    const check = database.prepare("PRAGMA integrity_check").get();
    if (check?.integrity_check !== "ok") refuse("INVALID_STORAGE", "The cache copy is damaged.");
    bindStagedCache(database, published.root, published.cache);
  } finally {
    database.close();
  }
}

/**
 * Brings a task folder from before Tasks homes, with its cache and recovery files, into a new
 * home for the owner's one-time move. The old installation is only read. The home is staged
 * beside its final place and published by one rename, so an interruption leaves either no home
 * or a complete one. Remove this once the owner's devices have moved.
 */
export function adoptTaskFolder(selected: string, old: OldInstallation): Home {
  let rootPath: string;
  try {
    rootPath = realpathSync(old.root);
  } catch {
    refuse("HOME_MISSING", `No task folder at ${old.root}.`);
  }
  const oldRoot = { rootPath, rootIdentity: directoryIdentity(rootPath) };
  const homePath = newHomePath(selected);
  const finished = adoptedHome(homePath, oldRoot.rootIdentity);
  if (finished) return finished;
  const nativeRoot = realpathSync.native(rootPath);
  if (isWithin(homePath, nativeRoot) || isWithin(nativeRoot, homePath))
    refuse("HOME_CONFLICT", "The Tasks home and the old task folder can't be inside each other.");
  if (existsSync(homePath) && readdirSync(homePath).length > 0)
    refuse("HOME_CONFLICT", `${homePath} isn't empty. Choose an empty or new folder.`);
  const domain = oldDomain(old, oldRoot);
  withOldWriterLock(domain, () => {
    const recoveryFiles = oldRecoveryFiles(domain);
    const snapshot = readCanonicalRoot(rootPath);
    const stagePath = path.join(path.dirname(homePath), `.${path.basename(homePath)}.adopting`);
    clearStage(stagePath);
    const stage = homeAt(stagePath);
    mkdirSync(stagePath, { mode: 0o700 });
    mkdirSync(stage.localPath, { mode: 0o700 });
    const marker = { format: "tasks.adoption", ...old, rootIdentity: oldRoot.rootIdentity };
    writeDurableFile(
      path.join(stage.localPath, MARKER),
      Buffer.from(`${JSON.stringify(marker)}\n`),
    );

    mkdirSync(path.join(stage.rootPath, "tasks"), { recursive: true, mode: 0o700 });
    for (const file of snapshot.files)
      copyVerified(
        path.join(rootPath, file.relativePath),
        path.join(stage.rootPath, file.relativePath),
      );
    if (existsSync(path.join(rootPath, ".stignore")))
      copyVerified(path.join(rootPath, ".stignore"), path.join(stage.rootPath, ".stignore"));
    syncDirectory(path.join(stage.rootPath, "tasks"));
    syncDirectory(stage.rootPath);
    if (JSON.stringify(readCanonicalRoot(stage.rootPath).files) !== JSON.stringify(snapshot.files))
      refuse(
        "STALE_FILE",
        "The old task folder changed during the copy. Pause Syncthing and retry.",
      );

    for (const name of recoveryFiles)
      copyVerified(path.join(domain, name), path.join(stage.localPath, name));
    const home = homeAt(homePath);
    const publishedRoot = {
      rootPath: home.rootPath,
      rootIdentity: directoryIdentity(stage.rootPath),
    };
    if (existsSync(old.cache))
      copyCache(old.cache, oldRoot, homeCache(stage, "app"), {
        root: publishedRoot,
        cache: homeCache(home, "app"),
      });
    syncDirectory(stage.localPath);
    syncDirectory(stagePath);

    if (existsSync(homePath)) rmdirSync(homePath);
    renameSync(stagePath, homePath);
    syncDirectory(path.dirname(homePath));
  });
  return openHome(homePath);
}
