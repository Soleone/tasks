import { mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { CommandError } from "./errors.js";
import { INIT_STAGE, assertInitRoot, readCanonicalRoot } from "./canonicalReader.js";
import type { CanonicalSnapshot } from "./canonicalReader.js";
import { syncDirectory, writeDurableFile } from "./localDomain.js";
import type { RootBinding } from "./queryCache.js";

const INIT_DESCRIPTOR = '{"schemaVersion":2}\n';

/** Creates `tasks` and publishes `workspace.json` by renaming a flushed stage into place. */
export function initRoot(root: RootBinding): CanonicalSnapshot {
  mkdirSync(path.join(root.rootPath, "tasks"), { recursive: true, mode: 0o700 });
  const stage = path.join(root.rootPath, INIT_STAGE);
  rmSync(stage, { force: true });
  writeDurableFile(stage, Buffer.from(INIT_DESCRIPTOR));
  assertInitRoot(root.rootPath);
  renameSync(stage, path.join(root.rootPath, "workspace.json"));
  syncDirectory(root.rootPath);
  const snapshot = readCanonicalRoot(root.rootPath);
  if (snapshot.rootIdentity !== root.rootIdentity || snapshot.tasks.length !== 0)
    throw new CommandError("STALE_SCOPE", "empty root changed during initialization");
  return snapshot;
}
