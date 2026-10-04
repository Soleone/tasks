import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CommandError } from "./errors.js";
import { readV2CanonicalRoot, readV2RegularFile, readV2RootDescriptor } from "./v2CanonicalReader.js";
import { applyV2CopyJournal, parseV2CopyArgs, parseV2CopyIntent, retireV2Copy } from "./v2CopyJournal.js";
import type { V2CopyIntent } from "./v2CopyJournal.js";
import { guardCopySource, inspectCopyDestination } from "./v2CopyFiles.js";
import { persistV2Pending, syncV2Directory, v2LocalDomain, withV2RootWriterLock } from "./v2LocalDomain.js";
import { readV2Pending } from "./v2Pending.js";
import type { V2Request } from "./v2Protocol.js";
import { localPathOutsideV2Root, synchronizeV2Authority, withV2CacheTransaction } from "./v2QueryCache.js";
import { findV2Receipt, requireV2WriteContext, storeV2Receipt } from "./v2Receipts.js";
import { exactV2Hash } from "./v2UpdateJournal.js";

export function commitV2Copy(database: DatabaseSync, intent: V2CopyIntent): Record<string, unknown> {
  const result = applyV2CopyJournal(intent);
  const authority = synchronizeV2Authority(database, intent.root);
  if (authority.writeContext === intent.request.writeContext) storeV2Receipt(database, intent.request, result);
  return result;
}

export function executeV2Copy(request: V2Request, rootPath: string, cachePath: string, windowsAbsentDestination = false) {
  const root = readV2RootDescriptor(rootPath);
  return withV2RootWriterLock(root, () => {
    let completed: V2CopyIntent | undefined;
    const outcome = withV2CacheTransaction(cachePath, root, database => {
      const authority = synchronizeV2Authority(database, root);
      requireV2WriteContext(request, authority);
      const input = parseV2CopyArgs(request);
      const receipt = findV2Receipt(database, request);
      if (receipt) return { writeContext: authority.writeContext, result: receipt };
      if (readV2Pending(root)) throw new CommandError("RECOVERY_PENDING", "selected root has an unfinished intent");
      const selected = readV2CanonicalRoot(root.rootPath);
      if (selected.rootIdentity !== root.rootIdentity) throw new CommandError("STALE_WRITE_CONTEXT", "selected root changed during observation");
      const sourceRoot = request.command === "workspace.archive" ? root : readV2RootDescriptor(input.sourceDirectory!);
      const copy = () => {
        if (readV2Pending(sourceRoot)) throw new CommandError("RECOVERY_PENDING", "copy source has an unfinished intent");
        const source = readV2CanonicalRoot(sourceRoot.rootPath);
        if (source.rootIdentity !== sourceRoot.rootIdentity) throw new CommandError("STALE_SCOPE", "source binding changed");
        guardCopySource(source);
        const destination = inspectCopyDestination(source.rootPath, input.destinationDirectory);
        if (windowsAbsentDestination && destination.identity !== null) {
          throw new CommandError("UNSUPPORTED_COMMAND", "Windows copy proof requires an absent destination; existing empty directories are not supported");
        }
        inspectCopyDestination(root.rootPath, destination.directory);
        for (const binding of [root, sourceRoot]) {
          localPathOutsideV2Root(cachePath, binding.rootPath);
          localPathOutsideV2Root(v2LocalDomain(root), binding.rootPath);
          localPathOutsideV2Root(v2LocalDomain(sourceRoot), destination.directory);
        }
        localPathOutsideV2Root(cachePath, destination.directory);
        localPathOutsideV2Root(v2LocalDomain(root), destination.directory);
        if (request.readOnly || request.dryRun) return { writeContext: authority.writeContext, result: { destinationDirectory: destination.directory, taskCount: source.tasks.length, changed: true, readOnly: request.readOnly, dryRun: request.dryRun } };
        const operationId = randomUUID();
        const files = source.files.map(file => {
          const bytes = readV2RegularFile(path.join(source.rootPath, file.relativePath));
          if (exactV2Hash(bytes) !== file.sha256) throw new CommandError("STALE_FILE", "source changed before fixed copy staging");
          return { ...file, bytes: bytes.toString("base64") };
        });
        const intent = parseV2CopyIntent({
          format: "taskdb.pending-copy", version: 1, root, source: sourceRoot,
          cachePath: localPathOutsideV2Root(cachePath, root.rootPath), request, operationId, destination,
          stageDirectory: path.join(path.dirname(destination.directory), `.${path.basename(destination.directory)}.taskdb-copy-${operationId}.stage`), files,
        }, root);
        guardCopySource(source);
        syncV2Directory(path.dirname(destination.directory));
        persistV2Pending(root, intent);
        const result = commitV2Copy(database, intent);
        completed = intent;
        return { writeContext: authority.writeContext, result };
      };
      return sourceRoot.rootPath === root.rootPath && sourceRoot.rootIdentity === root.rootIdentity ? copy() : withV2RootWriterLock(sourceRoot, copy);
    });
    if (completed) retireV2Copy(completed);
    return outcome;
  });
}
