import { randomUUID } from "node:crypto";
import path from "node:path";
import { CommandError } from "./errors.js";
import { readV2RegularFile } from "./v2CanonicalReader.js";
import { parseV2CopyArgs, parseV2CopyIntent, retireV2Copy } from "./v2CopyJournal.js";
import type { V2CopyIntent } from "./v2CopyJournal.js";
import { commitV2Copy } from "./v2CopyWriter.js";
import { guardCopyDestination, inspectCopyDestination } from "./v2CopyFiles.js";
import { persistV2Pending, syncV2Directory, v2LocalDomain, withV2RootWriterLock } from "./v2LocalDomain.js";
import { guardV2MigrationSource, V1_ROLLBACK_WARNING } from "./v2MigrationJournal.js";
import { readV1MigrationRootDescriptor } from "./v2MigrationSource.js";
import { readV2Pending } from "./v2Pending.js";
import type { V2Request } from "./v2Protocol.js";
import { localPathOutsideV2Root, synchronizeV2Authority, withV2CacheTransaction } from "./v2QueryCache.js";
import { findV2Receipt, requireV2WriteContext } from "./v2Receipts.js";
import { exactV2Hash } from "./v2UpdateJournal.js";
import { planV1ToV2Conversion } from "./v2V1Conversion.js";

export function executeV2Migration(request: V2Request, rootPath: string, cachePath: string) {
  const root = readV1MigrationRootDescriptor(rootPath);
  return withV2RootWriterLock(root, () => {
    let completed: V2CopyIntent | undefined;
    const outcome = withV2CacheTransaction(cachePath, root, database => {
      const authority = synchronizeV2Authority(database, root);
      requireV2WriteContext(request, authority);
      const input = parseV2CopyArgs(request);
      const receipt = findV2Receipt(database, request);
      if (receipt) return { writeContext: authority.writeContext, result: receipt };
      if (readV2Pending(root)) throw new CommandError("RECOVERY_PENDING", "selected v1 root has an unfinished intent");
      const plan = planV1ToV2Conversion(root.rootPath);
      if (plan.source.rootIdentity !== root.rootIdentity) throw new CommandError("STALE_WRITE_CONTEXT", "selected v1 root changed during observation");
      const destination = inspectCopyDestination(root.rootPath, input.destinationDirectory);
      localPathOutsideV2Root(cachePath, destination.directory);
      localPathOutsideV2Root(v2LocalDomain(root), destination.directory);
      if (request.readOnly || request.dryRun) return {
        writeContext: authority.writeContext,
        result: { sourceDirectory: root.rootPath, destinationDirectory: destination.directory, taskCount: plan.tasks.length, transformedIds: plan.tasks.map(task => task.id), changed: true, selectionChanged: false, rollbackWarning: V1_ROLLBACK_WARNING, readOnly: request.readOnly, dryRun: request.dryRun },
      };
      const operationId = randomUUID();
      const files = plan.files.map(file => ({ relativePath: file.relativePath, sha256: exactV2Hash(file.bytes), bytes: file.bytes.toString("base64") }));
      files.sort((a, b) => a.relativePath === "workspace.json" ? -1 : b.relativePath === "workspace.json" ? 1 : a.relativePath < b.relativePath ? -1 : 1);
      const sourceFiles = plan.source.files.map(file => {
        const bytes = readV2RegularFile(path.join(root.rootPath, file.relativePath));
        if (exactV2Hash(bytes) !== file.sha256) throw new CommandError("MIGRATION_CONFLICT", "source changed before fixed migration intent");
        return { ...file, bytes: bytes.toString("base64") };
      });
      const intent = parseV2CopyIntent({
        format: "taskdb.pending-copy", version: 1, root, source: root,
        cachePath: localPathOutsideV2Root(cachePath, root.rootPath), request, operationId, destination,
        stageDirectory: path.join(path.dirname(destination.directory), `.${path.basename(destination.directory)}.taskdb-copy-${operationId}.stage`), files,
        migration: { directories: plan.source.directories, files: sourceFiles },
      }, root);
      guardV2MigrationSource(intent);
      guardCopyDestination(root.rootPath, destination);
      syncV2Directory(path.dirname(destination.directory));
      persistV2Pending(root, intent);
      const result = commitV2Copy(database, intent);
      completed = intent;
      return { writeContext: authority.writeContext, result };
    });
    if (completed) retireV2Copy(completed);
    return outcome;
  });
}
