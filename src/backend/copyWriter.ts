import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CommandError } from "./errors.js";
import { readCanonicalRoot, readRegularFile, readRootDescriptor } from "./canonicalReader.js";
import { applyCopyJournal, parseCopyArgs, parseCopyIntent, retireCopy } from "./copyJournal.js";
import type { CopyIntent } from "./copyJournal.js";
import { guardCopySource, inspectCopyDestination, releaseEmptyDestination } from "./copyFiles.js";
import { persistPending, syncDirectory, localDomain, withRootWriterLock } from "./localDomain.js";
import { readPending } from "./pending.js";
import type { Request } from "./protocol.js";
import { localPathOutsideRoot, synchronizeAuthority, withCacheTransaction } from "./queryCache.js";
import { findReceipt, requireWriteContext, storeReceipt } from "./receipts.js";
import { exactHash } from "./updateJournal.js";

export function commitCopy(database: DatabaseSync, intent: CopyIntent): Record<string, unknown> {
  const result = applyCopyJournal(intent);
  const authority = synchronizeAuthority(database, intent.root);
  if (authority.writeContext === intent.request.writeContext)
    storeReceipt(database, intent.request, result);
  return result;
}

export function executeCopy(request: Request, rootPath: string, cachePath: string) {
  const root = readRootDescriptor(rootPath);
  return withRootWriterLock(root, () => {
    let completed: CopyIntent | undefined;
    const outcome = withCacheTransaction(cachePath, root, (database) => {
      const authority = synchronizeAuthority(database, root);
      requireWriteContext(request, authority);
      const input = parseCopyArgs(request);
      const receipt = findReceipt(database, request);
      if (receipt) return { writeContext: authority.writeContext, result: receipt };
      if (readPending(root))
        throw new CommandError("RECOVERY_PENDING", "selected root has an unfinished intent");
      const selected = readCanonicalRoot(root.rootPath);
      if (selected.rootIdentity !== root.rootIdentity)
        throw new CommandError("STALE_WRITE_CONTEXT", "selected root changed during observation");
      const sourceRoot =
        request.command === "workspace.archive" ? root : readRootDescriptor(input.sourceDirectory!);
      const copy = () => {
        if (readPending(sourceRoot))
          throw new CommandError("RECOVERY_PENDING", "copy source has an unfinished intent");
        const source = readCanonicalRoot(sourceRoot.rootPath);
        if (source.rootIdentity !== sourceRoot.rootIdentity)
          throw new CommandError("STALE_SCOPE", "source binding changed");
        guardCopySource(source);
        let destination = inspectCopyDestination(source.rootPath, input.destinationDirectory);
        inspectCopyDestination(root.rootPath, destination.directory);
        for (const binding of [root, sourceRoot]) {
          localPathOutsideRoot(cachePath, binding.rootPath);
          localPathOutsideRoot(localDomain(root), binding.rootPath);
        }
        localPathOutsideRoot(localDomain(sourceRoot), destination.directory);
        localPathOutsideRoot(cachePath, destination.directory);
        localPathOutsideRoot(localDomain(root), destination.directory);
        if (request.readOnly || request.dryRun)
          return {
            writeContext: authority.writeContext,
            result: {
              destinationDirectory: destination.directory,
              taskCount: source.tasks.length,
              changed: true,
              readOnly: request.readOnly,
              dryRun: request.dryRun,
            },
          };
        destination = releaseEmptyDestination(source.rootPath, destination);
        const operationId = randomUUID();
        const files = source.files.map((file) => {
          const bytes = readRegularFile(path.join(source.rootPath, file.relativePath));
          if (exactHash(bytes) !== file.sha256)
            throw new CommandError("STALE_FILE", "source changed before fixed copy staging");
          return { ...file, bytes: bytes.toString("base64") };
        });
        const intent = parseCopyIntent(
          {
            format: "taskdb.pending-copy",
            version: 1,
            root,
            source: sourceRoot,
            cachePath: localPathOutsideRoot(cachePath, root.rootPath),
            request,
            operationId,
            destination,
            stageDirectory: path.join(
              path.dirname(destination.directory),
              `.${path.basename(destination.directory)}.taskdb-copy-${operationId}.stage`,
            ),
            files,
          },
          root,
        );
        guardCopySource(source);
        syncDirectory(path.dirname(destination.directory));
        persistPending(root, intent);
        const result = commitCopy(database, intent);
        completed = intent;
        return { writeContext: authority.writeContext, result };
      };
      return sourceRoot.rootPath === root.rootPath && sourceRoot.rootIdentity === root.rootIdentity
        ? copy()
        : withRootWriterLock(sourceRoot, copy);
    });
    if (completed) retireCopy(completed);
    return outcome;
  });
}
