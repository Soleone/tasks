import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { CommandError } from "./errors.js";
import { readV2CanonicalRoot, readV2RegularFile, readV2RootDescriptor } from "./v2CanonicalReader.js";
import type { V2FileObservation } from "./v2CanonicalReader.js";
import { directoryIdentity, guardCopyDestination, guardCopySource, inspectCopyDestination, verifyCopyStage } from "./v2CopyFiles.js";
import { readV2Pending } from "./v2Pending.js";
import { syncV2Directory, v2LocalDomain, withV2RootWriterLock, writeV2DurableFile } from "./v2LocalDomain.js";
import { exactV2Hash } from "./v2UpdateJournal.js";
export type V2CopyStageReport = {
  operationId: string;
  state: "verified_stage";
  sourceDirectory: string;
  destinationDirectory: string;
  stageDirectory: string;
  taskCount: number;
  conflictCount: number;
  files: V2FileObservation[];
  intentPath: string;
  completionPath: string;
};

/** Builds a verified, private stage only. No publication, selection switch, receipts or automatic recovery. */
export function stageV2CanonicalCopy(sourceDirectory: string, destinationDirectory: string): V2CopyStageReport {
  if (process.platform !== "linux") throw new CommandError("UNSUPPORTED_COMMAND", "canonical copy staging requires the tested Linux filesystem boundary");
  const root = readV2RootDescriptor(sourceDirectory);
  return withV2RootWriterLock(root, () => {
    if (readV2Pending(root)) throw new CommandError("RECOVERY_PENDING", "unfinished source update must be reconciled before copying");
    const source = readV2CanonicalRoot(root.rootPath);
    if (source.rootIdentity !== root.rootIdentity) throw new CommandError("STALE_SCOPE", "physical source changed before copying");
    const destination = inspectCopyDestination(source.rootPath, destinationDirectory);
    const operationId = randomUUID();
    const stageDirectory = path.join(path.dirname(destination.directory), `.${path.basename(destination.directory)}.taskdb-copy-${operationId}.stage`);
    const intentPath = path.join(v2LocalDomain(root), `copy-stage-${operationId}.intent.json`);
    const completionPath = path.join(v2LocalDomain(root), `copy-stage-${operationId}.verified.json`);
    const report: V2CopyStageReport = {
      operationId, state: "verified_stage", sourceDirectory: source.rootPath, destinationDirectory: destination.directory,
      stageDirectory, taskCount: source.tasks.length, conflictCount: source.conflictFiles.length,
      files: source.files, intentPath, completionPath,
    };
    guardCopySource(source);
    guardCopyDestination(source.rootPath, destination);
    syncV2Directory(path.dirname(destination.directory));
    writeV2DurableFile(intentPath, Buffer.from(`${JSON.stringify({
      format: "taskdb.canonical-copy-stage", version: 1, operationId, source: root,
      destination, stageDirectory, files: source.files, taskCount: source.tasks.length, conflictCount: source.conflictFiles.length,
    })}\n`));
    syncV2Directory(path.dirname(intentPath));
    guardCopySource(source);
    guardCopyDestination(source.rootPath, destination);
    mkdirSync(stageDirectory, { mode: 0o700 });
    syncV2Directory(path.dirname(stageDirectory));
    mkdirSync(path.join(stageDirectory, "tasks"), { mode: 0o700 });
    syncV2Directory(stageDirectory);
    const stageIdentity = directoryIdentity(stageDirectory);
    const taskDirectoryIdentity = directoryIdentity(path.join(stageDirectory, "tasks"));
    // The descriptor is last, so earlier file prefixes cannot appear to be a complete schema-2 root.
    const files = [...source.files.filter(file => file.relativePath !== "workspace.json"), ...source.files.filter(file => file.relativePath === "workspace.json")];
    for (const file of files) {
      if (directoryIdentity(stageDirectory) !== stageIdentity || directoryIdentity(path.join(stageDirectory, "tasks")) !== taskDirectoryIdentity) {
        throw new CommandError("STALE_SCOPE", "private stage binding changed");
      }
      const bytes = readV2RegularFile(path.join(source.rootPath, file.relativePath));
      if (exactV2Hash(bytes) !== file.sha256) throw new CommandError("STALE_FILE", "source changed before its staged copy");
      writeV2DurableFile(path.join(stageDirectory, file.relativePath), bytes);
      syncV2Directory(path.dirname(path.join(stageDirectory, file.relativePath)));
    }
    if (directoryIdentity(stageDirectory) !== stageIdentity || directoryIdentity(path.join(stageDirectory, "tasks")) !== taskDirectoryIdentity) {
      throw new CommandError("STALE_SCOPE", "private stage binding changed");
    }
    verifyCopyStage(source, stageDirectory);
    guardCopySource(source);
    guardCopyDestination(source.rootPath, destination);
    writeV2DurableFile(completionPath, Buffer.from(`${JSON.stringify(report)}\n`));
    syncV2Directory(path.dirname(completionPath));
    // Retained evidence belongs to this private backup stage, not a successful-request receipt ledger.
    return report;
  });
}
