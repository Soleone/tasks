import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  bytewiseCompare, candidateBytes, candidateRecoveryAction, candidateTask,
  compareCandidateTasks, exactByteHash, generateKeyBetween, generateNKeysBetween,
  replaceCandidateFile, stageCandidateWrite,
} from "./fixtures/taskdb-v2-candidate.mjs";

function scratchWrite(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "taskdb-v2-candidate-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const taskPath = path.join(directory, "task.json");
  const journalPath = path.join(directory, "pending.json");
  const originalBytes = candidateBytes(candidateTask("original"));
  const nextBytes = candidateBytes(candidateTask("original", "a1"));
  writeFileSync(taskPath, originalBytes);
  return { taskPath, journalPath, originalBytes, nextBytes };
}

const keyVectors = [
  [null, null, "a0"], [null, "a0", "Zz"], ["a0", null, "a1"],
  ["a0", "a1", "a0V"], ["a0", "a0V", "a0G"], ["Zz", "a0", "ZzV"],
];

test("v2 candidate: pinned fractional-indexing 3.2.0 matches exact key vectors", () => {
  for (const [lower, upper, expected] of keyVectors) {
    assert.equal(generateKeyBetween(lower, upper), expected);
  }
  assert.deepEqual(generateNKeysBetween(null, null, 4), ["a0", "a1", "a2", "a3"]);
  assert.deepEqual(generateNKeysBetween("a0", "a1", 2), ["a0G", "a0V"]);
  assert.throws(() => generateKeyBetween("a1", "a0"), />=/);
});

test("v2 candidate: ASCII comparison is case-sensitive, prefix-first, then exact task ID", () => {
  const keys = ["a0a", "a0Z", "a0V", "a0", "Zz"];
  assert.deepEqual(keys.sort(bytewiseCompare), ["Zz", "a0", "a0V", "a0Z", "a0a"]);
  const tasks = [candidateTask("legacy-a"), candidateTask("Legacy-A"), candidateTask("0001")];
  assert.deepEqual(tasks.sort(compareCandidateTasks).map((task) => task.id), ["0001", "Legacy-A", "legacy-a"]);
});

test("v2 candidate: independent offline captures converge but tie-break does not preserve chronology", () => {
  const common = candidateTask("common", "a1");
  const key = generateKeyBetween(null, common.orderKey);
  const capturedA = candidateTask("z-later", key, { createdAt: "2026-09-30T12:00:02.000Z" });
  const capturedB = candidateTask("a-earlier", key, { createdAt: "2026-09-30T12:00:01.000Z" });
  const peerA = [capturedA, common, capturedB].sort(compareCandidateTasks);
  const peerB = [capturedB, common, capturedA].sort(compareCandidateTasks);
  assert.deepEqual(peerA, peerB);
  assert.deepEqual(peerA.map((task) => task.id), ["a-earlier", "z-later", "common"]);
  assert.equal(capturedA.orderKey, capturedB.orderKey);
  assert.ok(peerA[0].createdAt < peerA[1].createdAt, "ID order does not put the newer capture first");
});

test("v2 candidate: equal-key insertion has no fractional gap despite the ID tie-break", () => {
  const left = candidateTask("a");
  const right = candidateTask("z");
  assert.ok(compareCandidateTasks(left, right) < 0);
  assert.throws(() => generateKeyBetween(left.orderKey, right.orderKey), />=/);
  assert.ok(generateKeyBetween(null, left.orderKey) < left.orderKey);
  assert.ok(generateKeyBetween(right.orderKey, null) > right.orderKey);
});

test("v2 candidate: distinct-task conflicting placements converge without satisfying both intentions", () => {
  const left = candidateTask("left", "a0");
  const right = candidateTask("right", "a1");
  const key = generateKeyBetween(left.orderKey, right.orderKey);
  const movedA = candidateTask("moved-a", key);
  const movedB = candidateTask("moved-b", key);
  const merged = [right, movedB, left, movedA].sort(compareCandidateTasks);
  assert.deepEqual(merged.map((task) => task.id), ["left", "moved-a", "moved-b", "right"]);
  // Each peer intended its task to be immediately before right; both cannot be adjacent.
  assert.equal(merged.at(-2).id, "moved-b");
});

test("v2 candidate: repeated same-gap insertion grows strings rather than exhausting float precision", () => {
  let upper = "a1";
  for (let index = 0; index < 1_000; index += 1) {
    const key = generateKeyBetween("a0", upper);
    assert.ok("a0" < key && key < upper);
    upper = key;
  }
  assert.ok(upper.length > 100);
});

test("v2 candidate: v1 migration maps each sibling sequence independently without changing IDs", () => {
  for (const ids of [["legacy-parent", "old_task", "child-1"], ["nested-b", "nested-a"], []]) {
    const keys = generateNKeysBetween(null, null, ids.length);
    const tasks = ids.map((id, index) => candidateTask(id, keys[index]));
    assert.deepEqual(tasks.sort(compareCandidateTasks).map((task) => task.id), ids);
  }
});

test("v2 candidate: even a formatting-only external edit rejects an observed-byte baseline", (t) => {
  const { taskPath, journalPath, originalBytes, nextBytes } = scratchWrite(t);
  const externalBytes = `${JSON.stringify(JSON.parse(originalBytes), null, 2)}\n`;
  assert.deepEqual(JSON.parse(originalBytes), JSON.parse(externalBytes));
  writeFileSync(taskPath, externalBytes);
  assert.throws(() => stageCandidateWrite(journalPath, taskPath, exactByteHash(originalBytes), nextBytes), /STALE_FILE/);
  assert.equal(readFileSync(taskPath, "utf8"), externalBytes);
});

test("v2 candidate: crash before replacement replays a persisted intent; crash after is a no-op", (t) => {
  const { taskPath, journalPath, originalBytes, nextBytes } = scratchWrite(t);
  stageCandidateWrite(journalPath, taskPath, exactByteHash(originalBytes), nextBytes);
  const recovered = JSON.parse(readFileSync(journalPath, "utf8"));
  assert.equal(candidateRecoveryAction(recovered, readFileSync(taskPath, "utf8")), "apply");
  replaceCandidateFile(recovered);
  assert.equal(readFileSync(taskPath, "utf8"), nextBytes);
  assert.equal(candidateRecoveryAction(recovered, readFileSync(taskPath, "utf8")), "already-applied");
  assert.equal(readFileSync(journalPath, "utf8"), candidateBytes(recovered));
});

test("v2 candidate: recovery preserves intent and refuses an external edit or disappearance", (t) => {
  const { taskPath, journalPath, originalBytes, nextBytes } = scratchWrite(t);
  const pending = stageCandidateWrite(journalPath, taskPath, exactByteHash(originalBytes), nextBytes);
  const externalBytes = candidateBytes(candidateTask("original", "a2", { title: "External edit" }));
  writeFileSync(taskPath, externalBytes);
  assert.throws(() => candidateRecoveryAction(pending, externalBytes), /RECOVERY_CONFLICT/);
  assert.equal(readFileSync(taskPath, "utf8"), externalBytes);
  rmSync(taskPath);
  assert.throws(() => candidateRecoveryAction(pending, null), /RECOVERY_CONFLICT/);
  assert.equal(readFileSync(journalPath, "utf8"), candidateBytes(pending));
});

test("v2 candidate: final-read/rename race can overwrite unseen bytes, even with a journal", (t) => {
  const { taskPath, journalPath, originalBytes, nextBytes } = scratchWrite(t);
  const pending = stageCandidateWrite(journalPath, taskPath, exactByteHash(originalBytes), nextBytes);
  assert.equal(candidateRecoveryAction(pending, readFileSync(taskPath, "utf8")), "apply");
  const racedBytes = candidateBytes(candidateTask("original", "a3", { title: "Unseen racing edit" }));
  writeFileSync(taskPath, racedBytes);
  replaceCandidateFile(pending);
  assert.equal(readFileSync(taskPath, "utf8"), nextBytes);
  assert.equal(readFileSync(journalPath, "utf8").includes("Unseen racing edit"), false);
});
