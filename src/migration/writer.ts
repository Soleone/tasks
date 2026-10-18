import { randomUUID } from "node:crypto";
import path from "node:path";
import { CommandError } from "../backend/errors.js";
import { readRegularFile, exactHash } from "../backend/canonicalReader.js";
import { parseCopyArgs, parseCopyIntent, retireCopy } from "../backend/copyJournal.js";
import type { CopyIntent } from "../backend/copyJournal.js";
import { commitCopy } from "../backend/copyWriter.js";
import {
  guardCopyDestination,
  inspectCopyDestination,
  releaseEmptyDestination,
} from "../backend/copyFiles.js";
import {
  persistPending,
  syncDirectory,
  localDomain,
  withRootWriterLock,
} from "../backend/localDomain.js";
import { guardMigrationSource, SCHEMA1_ROLLBACK_WARNING } from "./journal.js";
import { readSchema1MigrationRootDescriptor } from "./schema1Source.js";
import { readPending } from "../backend/pending.js";
import type { Request } from "../backend/protocol.js";
import {
  localPathOutsideRoot,
  synchronizeAuthority,
  withCacheTransaction,
} from "../backend/queryCache.js";
import { findReceipt, requireWriteContext } from "../backend/receipts.js";
import { planSchema1Conversion } from "./conversion.js";

export function executeMigration(request: Request, rootPath: string, cachePath: string) {
  const root = readSchema1MigrationRootDescriptor(rootPath);
  return withRootWriterLock(root, () => {
    let completed: CopyIntent | undefined;
    const outcome = withCacheTransaction(cachePath, root, (database) => {
      const authority = synchronizeAuthority(database, root);
      requireWriteContext(request, authority);
      const input = parseCopyArgs(request);
      const receipt = findReceipt(database, request);
      if (receipt) return { writeContext: authority.writeContext, result: receipt };
      if (readPending(root))
        throw new CommandError("RECOVERY_PENDING", "selected v1 root has an unfinished intent");
      const plan = planSchema1Conversion(root.rootPath);
      if (plan.source.rootIdentity !== root.rootIdentity)
        throw new CommandError(
          "STALE_WRITE_CONTEXT",
          "selected v1 root changed during observation",
        );
      let destination = inspectCopyDestination(root.rootPath, input.destinationDirectory);
      localPathOutsideRoot(cachePath, destination.directory);
      localPathOutsideRoot(localDomain(root), destination.directory);
      if (request.readOnly || request.dryRun)
        return {
          writeContext: authority.writeContext,
          result: {
            sourceDirectory: root.rootPath,
            destinationDirectory: destination.directory,
            taskCount: plan.tasks.length,
            transformedIds: plan.tasks.map((task) => task.id),
            changed: true,
            selectionChanged: false,
            rollbackWarning: SCHEMA1_ROLLBACK_WARNING,
            readOnly: request.readOnly,
            dryRun: request.dryRun,
          },
        };
      destination = releaseEmptyDestination(root.rootPath, destination);
      const operationId = randomUUID();
      const files = plan.files.map((file) => ({
        relativePath: file.relativePath,
        sha256: exactHash(file.bytes),
        bytes: file.bytes.toString("base64"),
      }));
      files.sort((a, b) =>
        a.relativePath === "workspace.json"
          ? -1
          : b.relativePath === "workspace.json"
            ? 1
            : a.relativePath < b.relativePath
              ? -1
              : 1,
      );
      const sourceFiles = plan.source.files.map((file) => {
        const bytes = readRegularFile(path.join(root.rootPath, file.relativePath));
        if (exactHash(bytes) !== file.sha256)
          throw new CommandError(
            "MIGRATION_CONFLICT",
            "source changed before fixed migration intent",
          );
        return { ...file, bytes: bytes.toString("base64") };
      });
      const intent = parseCopyIntent(
        {
          format: "taskdb.pending-copy",
          version: 1,
          root,
          source: root,
          cachePath: localPathOutsideRoot(cachePath, root.rootPath),
          request,
          operationId,
          destination,
          stageDirectory: path.join(
            path.dirname(destination.directory),
            `.${path.basename(destination.directory)}.taskdb-copy-${operationId}.stage`,
          ),
          files,
          migration: { directories: plan.source.directories, files: sourceFiles },
        },
        root,
      );
      guardMigrationSource(intent);
      guardCopyDestination(root.rootPath, destination);
      syncDirectory(path.dirname(destination.directory));
      persistPending(root, intent);
      const result = commitCopy(database, intent);
      completed = intent;
      return { writeContext: authority.writeContext, result };
    });
    if (completed) retireCopy(completed);
    return outcome;
  });
}
