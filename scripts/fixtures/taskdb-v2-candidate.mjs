// Experimental proposal model only. No production client imports this file.
import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

export { generateKeyBetween, generateNKeysBetween };

export function candidateTask(id, orderKey = "a0", overrides = {}) {
  return {
    id, title: `Task ${id}`, description: "", status: "open", priority: 2,
    category: null, tags: [], parentId: null, dependencyIds: [], orderKey,
    createdAt: "2026-09-30T12:00:00.000Z", updatedAt: "2026-09-30T12:00:00.000Z",
    closedAt: null, ...overrides,
  };
}

export function candidateBytes(record) {
  return `${JSON.stringify(record)}\n`;
}

export function bytewiseCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareCandidateTasks(left, right) {
  return bytewiseCompare(left.orderKey, right.orderKey) || bytewiseCompare(left.id, right.id);
}

export function exactByteHash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function stageCandidateWrite(journalPath, taskPath, observedHash, nextBytes) {
  const previousBytes = readFileSync(taskPath, "utf8");
  if (exactByteHash(previousBytes) !== observedHash) throw new Error("STALE_FILE");
  const pending = { taskPath, previousBytes, nextBytes };
  writeFileSync(journalPath, candidateBytes(pending), { flag: "wx" });
  return pending;
}

export function candidateRecoveryAction(pending, currentBytes) {
  if (currentBytes === pending.nextBytes) return "already-applied";
  if (currentBytes === pending.previousBytes) return "apply";
  // Absence is not permission to resurrect a staged update after remote deletion.
  throw new Error("RECOVERY_CONFLICT");
}

export function replaceCandidateFile(pending) {
  const temporaryPath = `${pending.taskPath}.candidate-tmp`;
  writeFileSync(temporaryPath, pending.nextBytes);
  renameSync(temporaryPath, pending.taskPath);
}
