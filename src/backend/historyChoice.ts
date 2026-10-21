import { existsSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readRootDescriptor } from "./canonicalReader.js";
import { CommandError } from "./errors.js";
import { syncDirectory, withRootWriterLock } from "./localDomain.js";
import { readPending } from "./pending.js";
import { assertArgs } from "./protocol.js";
import type { Request } from "./protocol.js";
import {
  cacheOrigin,
  confirmMovedBinding,
  localPathOutsideRoot,
  observeQueryAuthority,
  withCacheTransaction,
} from "./queryCache.js";

/** Moves a cache made for another copy of the folder aside, untouched, so a fresh one can start. */
function retireCache(cachePath: string): string {
  // Opening once rolls back a hot journal, so the retired file is complete on its own.
  new DatabaseSync(cachePath).close();
  const retired = path.join(path.dirname(cachePath), "retired");
  mkdirSync(retired, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const target = path.join(retired, `${path.basename(cachePath, ".db")}-${stamp}.db`);
  renameSync(cachePath, target);
  syncDirectory(retired);
  syncDirectory(path.dirname(cachePath));
  return target;
}

/**
 * The owner's answer when a cache doesn't match its folder: `workspace.rebind` keeps history after
 * the folder and cache moved together, `workspace.newHistory` sets a copied cache aside. Neither
 * runs while the folder has unfinished work, which must be resolved where it started.
 */
export function executeHistoryChoice(request: Request, rootPath: string, cachePath: string) {
  assertArgs(request.args, []);
  const root = readRootDescriptor(rootPath);
  return withRootWriterLock(root, () => {
    if (readPending(root))
      throw new CommandError(
        "RECOVERY_PENDING",
        "finish the unfinished operation at the folder's original location first",
      );
    const cache = localPathOutsideRoot(cachePath, root.rootPath);
    const origin = existsSync(cache)
      ? withCacheTransaction(cache, root, (database) => cacheOrigin(database, root))
      : "new";
    let retiredPath: string | null = null;
    if (request.command === "workspace.rebind") {
      if (origin === "copied")
        throw new CommandError(
          "CACHE_FROM_ELSEWHERE",
          "this cache belongs to another copy of the folder; only a new history can use it",
        );
      if (origin === "moved" || origin === "device")
        withCacheTransaction(cache, root, (database) => confirmMovedBinding(database, root));
    } else {
      if (origin !== "copied")
        throw new CommandError("UNSUPPORTED_COMMAND", "this cache already belongs to the folder");
      retiredPath = retireCache(cache);
    }
    const authority = observeQueryAuthority(cache, root);
    return {
      writeContext: authority.writeContext,
      result: { changed: origin !== "same" && origin !== "new", retiredPath },
    };
  });
}
