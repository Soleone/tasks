import { createHash } from "node:crypto";
import { existsSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { CommandError } from "./errors.js";
import { canonicalJson } from "./canonicalJson.js";
import { applyUpdate, parseUpdate } from "./updateInputs.js";
import { applyStatus, parseStatusInput } from "./taskStatus.js";
import {
  applyRelationship,
  matchesRelationshipEffect,
  parseRelationship,
  RELATIONSHIP_COMMANDS,
} from "./taskRelationships.js";
import { parseCanonicalJson } from "./strictJson.js";
import { readCanonicalRoot, readRegularFile } from "./canonicalReader.js";
import type { CanonicalSnapshot, FileObservation } from "./canonicalReader.js";
import { pendingIntentPath, syncDirectory, writeDurableFile } from "./localDomain.js";
import { parseRequest } from "./protocol.js";
import { isTaskEditRequest } from "./taskEditRequest.js";
import type { TaskEditRequest } from "./taskEditRequest.js";
import type { RootBinding } from "./queryCache.js";
import { isTimestamp, validateGraph, validateTask } from "./taskModel.js";

export type UpdateIntent = {
  format: "taskdb.pending-update";
  version: 1;
  root: RootBinding;
  cachePath: string;
  request: TaskEditRequest;
  operationId: string;
  at: string;
  taskId: string;
  beforeBytes: string;
  nextBytes: string;
  guards: FileObservation[];
};

function recoveryConflict(): never {
  throw new CommandError(
    "RECOVERY_CONFLICT",
    "pending update has missing, divergent or invalid evidence",
  );
}

export function exactHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function readPending(root: RootBinding): UpdateIntent | undefined {
  const filePath = pendingIntentPath(root);
  if (!existsSync(filePath)) {
    if (existsSync(`${filePath}.preparing`)) recoveryConflict();
    return undefined;
  }
  try {
    const intent = parseCanonicalJson(readRegularFile(filePath)) as UpdateIntent;
    if (
      intent.format !== "taskdb.pending-update" ||
      intent.version !== 1 ||
      intent.root.rootPath !== root.rootPath ||
      intent.root.rootIdentity !== root.rootIdentity ||
      typeof intent.cachePath !== "string" ||
      !/^[A-Za-z0-9_-]+$/.test(intent.taskId) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        intent.operationId,
      )
    )
      recoveryConflict();
    for (const encoded of [intent.beforeBytes, intent.nextBytes]) {
      if (
        typeof encoded !== "string" ||
        Buffer.from(encoded, "base64").toString("base64") !== encoded
      )
        recoveryConflict();
      validateTask(parseCanonicalJson(Buffer.from(encoded, "base64")), intent.taskId);
    }
    const request = parseRequest(intent.request);
    if (
      !isTaskEditRequest(request) ||
      request.args.id !== intent.taskId ||
      request.readOnly ||
      request.dryRun ||
      !request.writeContext ||
      !request.idempotencyKey
    )
      recoveryConflict();
    if (
      !Array.isArray(intent.guards) ||
      intent.guards.length === 0 ||
      new Set(intent.guards.map((file) => file.relativePath)).size !== intent.guards.length
    )
      recoveryConflict();
    for (const file of intent.guards) {
      if (
        typeof file.relativePath !== "string" ||
        typeof file.sha256 !== "string" ||
        !/^[0-9a-f]{64}$/.test(file.sha256)
      )
        recoveryConflict();
    }
    if (
      !intent.guards.some(
        (file) =>
          file.relativePath === `tasks/${intent.taskId}.json` &&
          file.sha256 === exactHash(Buffer.from(intent.beforeBytes, "base64")),
      )
    )
      recoveryConflict();
    const next = validateTask(
      parseCanonicalJson(Buffer.from(intent.nextBytes, "base64")),
      intent.taskId,
    );
    if (!isTimestamp(intent.at)) recoveryConflict();
    const before = validateTask(
      parseCanonicalJson(Buffer.from(intent.beforeBytes, "base64")),
      intent.taskId,
    );
    if ((RELATIONSHIP_COMMANDS as readonly string[]).includes(request.command)) {
      if (
        !matchesRelationshipEffect(
          before,
          next,
          parseRelationship(request.command, request.args),
          intent.at,
        )
      )
        recoveryConflict();
    } else {
      if (request.command !== "task.update") parseStatusInput(request.args);
      const expected =
        request.command === "task.update"
          ? applyUpdate(before, parseUpdate(request.args), intent.at)
          : applyStatus(before, request.command, intent.at);
      if (!expected.changed || canonicalJson(expected.task) !== canonicalJson(next))
        recoveryConflict();
    }
    return { ...intent, request };
  } catch {
    return recoveryConflict();
  }
}

export function guardUpdate(intent: UpdateIntent, recovery: boolean): CanonicalSnapshot {
  const fail = (code: string): never => {
    throw new CommandError(
      recovery ? "RECOVERY_CONFLICT" : code,
      "canonical update baseline changed",
    );
  };
  let snapshot: CanonicalSnapshot;
  try {
    snapshot = readCanonicalRoot(intent.root.rootPath);
  } catch (error) {
    if (recovery) return recoveryConflict();
    throw error;
  }
  if (
    snapshot.rootPath !== intent.root.rootPath ||
    snapshot.rootIdentity !== intent.root.rootIdentity
  )
    fail("STALE_SCOPE");
  const observed = new Map(snapshot.files.map((file) => [file.relativePath, file.sha256]));
  if (
    observed.size !== intent.guards.length ||
    intent.guards.some((file) => !observed.has(file.relativePath))
  )
    fail("STALE_SCOPE");
  const nextHash = exactHash(Buffer.from(intent.nextBytes, "base64"));
  for (const file of intent.guards) {
    const actual = observed.get(file.relativePath);
    const alreadyApplied =
      recovery && file.relativePath === `tasks/${intent.taskId}.json` && actual === nextHash;
    if (actual !== file.sha256 && !alreadyApplied) fail("STALE_FILE");
  }
  if ((RELATIONSHIP_COMMANDS as readonly string[]).includes(intent.request.command)) {
    try {
      const before = validateTask(
        parseCanonicalJson(Buffer.from(intent.beforeBytes, "base64")),
        intent.taskId,
      );
      // All other exact bytes passed the guards; substitute the fixed preimage if the target was already applied.
      const original = snapshot.tasks.map((task) => (task.id === intent.taskId ? before : task));
      validateGraph(original);
      const expected = applyRelationship(
        before,
        parseRelationship(intent.request.command, intent.request.args),
        original,
        intent.at,
      );
      if (
        !expected.changed ||
        canonicalJson(expected.task) !==
          canonicalJson(parseCanonicalJson(Buffer.from(intent.nextBytes, "base64")))
      )
        fail("STALE_SCOPE");
    } catch (error) {
      if (recovery) return recoveryConflict();
      throw error;
    }
  }
  return snapshot;
}

export function applyJournal(intent: UpdateIntent): CanonicalSnapshot {
  let snapshot: CanonicalSnapshot;
  try {
    snapshot = guardUpdate(intent, true);
  } catch {
    return recoveryConflict();
  }
  const bytes = Buffer.from(intent.nextBytes, "base64");
  const target = path.join(intent.root.rootPath, "tasks", `${intent.taskId}.json`);
  if (
    snapshot.files.find((file) => file.relativePath === `tasks/${intent.taskId}.json`)!.sha256 !==
    exactHash(bytes)
  ) {
    const temporary = path.join(
      intent.root.rootPath,
      "tasks",
      `.syncthing.taskdb-${intent.operationId}.tmp`,
    );
    if (existsSync(temporary)) {
      if (!readRegularFile(temporary).equals(bytes)) recoveryConflict();
      unlinkSync(temporary);
    }
    writeDurableFile(temporary, bytes);
    guardUpdate(intent, true);
    renameSync(temporary, target);
  }
  // Recovery may see next bytes after a process died between rename and directory flush.
  syncDirectory(path.dirname(target));
  snapshot = guardUpdate(intent, true);
  if (
    snapshot.files.find((file) => file.relativePath === `tasks/${intent.taskId}.json`)!.sha256 !==
    exactHash(bytes)
  )
    recoveryConflict();
  return snapshot;
}
