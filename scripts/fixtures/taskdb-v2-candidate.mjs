// Experimental proposal model only. No production client imports this file.
import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

export { generateKeyBetween, generateNKeysBetween };

export const candidateKeyByteLimit = 256;

export function validateCandidateKey(key) {
  if (typeof key !== "string" || !/^[A-Za-z][0-9A-Za-z]+$/.test(key)) throw new Error("INVALID_ORDER_KEY");
  if (key.length > candidateKeyByteLimit) throw new Error("ORDER_KEY_LIMIT");
  const head = key.charCodeAt(0);
  const integerLength = head >= 97 ? head - 97 + 2 : 90 - head + 2;
  if (key.length < integerLength || key === `A${"0".repeat(26)}`
    || key.slice(integerLength).endsWith("0")) throw new Error("INVALID_ORDER_KEY");
}

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

export function candidateReorderPlan(tasks, selectedIds, insertAt) {
  const siblings = [...tasks].sort(compareCandidateTasks);
  if (siblings.length === 0 || selectedIds.length === 0) throw new Error("INVALID_REORDER_SCOPE");
  const parentId = siblings[0].parentId;
  if (siblings.some((task) => task.parentId !== parentId)) throw new Error("INVALID_REORDER_SCOPE");
  if (new Set(siblings.map((task) => task.id)).size !== siblings.length) throw new Error("DUPLICATE_ID");
  for (const task of siblings) {
    if (typeof task.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(task.id)) throw new Error("INVALID_ID");
    validateCandidateKey(task.orderKey);
  }
  const selectedSet = new Set(selectedIds);
  const selected = siblings.filter((task) => selectedSet.has(task.id));
  if (selected.length !== selectedIds.length || selected.some((task, index) => task.id !== selectedIds[index])) {
    throw new Error("INVALID_REORDER_ORDER");
  }
  const remaining = siblings.filter((task) => !selectedSet.has(task.id));
  if (!Number.isInteger(insertAt) || insertAt < 0 || insertAt > remaining.length) throw new Error("INVALID_REORDER_PLACEMENT");
  const finalTasks = [...remaining.slice(0, insertAt), ...selected, ...remaining.slice(insertAt)];
  const finalIds = finalTasks.map((task) => task.id);
  if (finalIds.every((id, index) => id === siblings[index].id)) return { finalIds, writes: [], rekeyedIds: [] };

  let start = insertAt;
  let end = insertAt;
  const lowerKey = remaining[insertAt - 1]?.orderKey;
  const upperKey = remaining[insertAt]?.orderKey;
  // Only an exact gap inside a tied run expands the write set beyond selected tasks.
  if (lowerKey !== undefined && lowerKey === upperKey) {
    while (start > 0 && remaining[start - 1].orderKey === lowerKey) start -= 1;
    while (end < remaining.length && remaining[end].orderKey === lowerKey) end += 1;
  }
  const run = [...remaining.slice(start, insertAt), ...selected, ...remaining.slice(insertAt, end)];
  const keys = generateNKeysBetween(remaining[start - 1]?.orderKey ?? null, remaining[end]?.orderKey ?? null, run.length);
  keys.forEach(validateCandidateKey);
  const writes = run.flatMap((task, index) => task.orderKey === keys[index] ? [] : [{ ...task, orderKey: keys[index] }]);
  return { finalIds, writes, rekeyedIds: writes.filter((task) => !selectedSet.has(task.id)).map((task) => task.id) };
}

export function exactByteHash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readCandidateBytes(taskPath) {
  const bytes = readFileSync(taskPath);
  if (!isUtf8(bytes)) throw new Error("INVALID_UTF8");
  return bytes.toString("utf8");
}

export function stageCandidateWrite(journalPath, taskPath, observedHash, nextBytes) {
  const previousBytes = readCandidateBytes(taskPath);
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

export function observeCandidateScope(taskDirectory, parentId) {
  const files = readdirSync(taskDirectory).filter((name) => /^[A-Za-z0-9_-]+\.json$/.test(name)).sort()
    .map((name) => {
      const taskPath = path.join(taskDirectory, name);
      const bytes = readCandidateBytes(taskPath);
      const task = JSON.parse(bytes);
      if (task.id !== name.slice(0, -5)) throw new Error("INVALID_ID");
      validateCandidateKey(task.orderKey);
      return { taskPath, bytes, parentId: task.parentId };
    }).filter((file) => file.parentId === parentId);
  return { taskDirectory, parentId, files };
}

export function stageCandidateBatch(journalPath, observed, writes) {
  if (JSON.stringify(observeCandidateScope(observed.taskDirectory, observed.parentId)) !== JSON.stringify(observed)) {
    throw new Error("STALE_SCOPE");
  }
  const replacements = new Map(writes.map((task) => [path.join(observed.taskDirectory, `${task.id}.json`), candidateBytes(task)]));
  if (replacements.size !== writes.length || [...replacements.keys()].some((taskPath) => !observed.files.some((file) => file.taskPath === taskPath))) {
    throw new Error("INVALID_WRITE_SET");
  }
  const pending = {
    taskDirectory: observed.taskDirectory, parentId: observed.parentId,
    files: observed.files.map(({ taskPath, bytes }) => ({ taskPath, previousBytes: bytes, nextBytes: replacements.get(taskPath) ?? bytes })),
  };
  writeFileSync(journalPath, candidateBytes(pending), { flag: "wx" });
  return pending;
}

export function candidateBatchRecoveryPlan(pending) {
  const current = observeCandidateScope(pending.taskDirectory, pending.parentId);
  if (current.files.length !== pending.files.length || current.files.some((file, index) => file.taskPath !== pending.files[index].taskPath)) {
    throw new Error("RECOVERY_SCOPE_CONFLICT");
  }
  return pending.files.filter((file, index) => candidateRecoveryAction(file, current.files[index].bytes) === "apply");
}

export function applyCandidateBatch(pending) {
  const remaining = candidateBatchRecoveryPlan(pending);
  for (const file of remaining) {
    // Check the complete scope again before each replacement, not just the selected task.
    if (candidateBatchRecoveryPlan(pending).some((next) => next.taskPath === file.taskPath)) replaceCandidateFile(file);
  }
}

export function replaceCandidateFile(pending) {
  const temporaryPath = `${pending.taskPath}.candidate-tmp`;
  writeFileSync(temporaryPath, pending.nextBytes);
  renameSync(temporaryPath, pending.taskPath);
}
