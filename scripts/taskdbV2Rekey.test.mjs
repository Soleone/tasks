import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyCandidateBatch, candidateBatchRecoveryPlan, candidateBytes, candidateKeyByteLimit,
  candidateReorderPlan, candidateTask, compareCandidateTasks, generateKeyBetween,
  generateNKeysBetween, observeCandidateScope, replaceCandidateFile, stageCandidateBatch,
  validateCandidateKey,
} from "./fixtures/taskdb-v2-candidate.mjs";

function tiedTasks() {
  return [
    candidateTask("lower", "a0"), candidateTask("a", "a1"),
    candidateTask("b", "a1", { status: "canceled", closedAt: "2026-09-30T12:01:00.000Z" }),
    candidateTask("upper", "a2"), candidateTask("move", "a3", { description: "Keep content", extra: { keep: true } }),
    candidateTask("tail", "a4"),
  ];
}

function applyPlan(tasks, plan) {
  const replacements = new Map(plan.writes.map((task) => [task.id, task]));
  return tasks.map((task) => replacements.get(task.id) ?? task).sort(compareCandidateTasks);
}

function scratchBatch(t, tasks = tiedTasks()) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "taskdb-v2-rekey-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const taskDirectory = path.join(directory, "tasks");
  mkdirSync(taskDirectory);
  for (const task of tasks) writeFileSync(path.join(taskDirectory, `${task.id}.json`), candidateBytes(task));
  return { taskDirectory, journalPath: path.join(directory, "pending.json") };
}

function readScopeTasks(taskDirectory) {
  return observeCandidateScope(taskDirectory, null).files.map(({ bytes }) => JSON.parse(bytes)).sort(compareCandidateTasks);
}

test("v2 rekey: an exact tied gap expands only its tied run and keeps all non-order fields", () => {
  const tasks = tiedTasks();
  const plan = candidateReorderPlan(tasks, ["move"], 2);
  assert.deepEqual(plan.finalIds, ["lower", "a", "move", "b", "upper", "tail"]);
  assert.deepEqual(plan.writes.map((task) => [task.id, task.orderKey]), [["a", "a0V"], ["move", "a1"], ["b", "a1V"]]);
  assert.deepEqual(plan.rekeyedIds, ["a", "b"]);
  assert.deepEqual(applyPlan(tasks, plan).map((task) => task.id), plan.finalIds);
  for (const task of plan.writes) assert.deepEqual({ ...task, orderKey: tasks.find((original) => original.id === task.id).orderKey }, tasks.find((original) => original.id === task.id));
});

test("v2 rekey: a changed logical move can leave the selected task's key unchanged", () => {
  const tasks = [candidateTask("a", "a0"), candidateTask("b", "a0"), candidateTask("move", "a1")];
  const plan = candidateReorderPlan(tasks, ["move"], 1);
  assert.deepEqual(plan.finalIds, ["a", "move", "b"]);
  assert.deepEqual(plan.writes.map((task) => [task.id, task.orderKey]), [["b", "a2"]]);
  assert.deepEqual(applyPlan(tasks, plan).map((task) => task.id), plan.finalIds);
});

test("v2 rekey: selected groups retain their order and hidden canceled siblings participate", () => {
  const tasks = [...tiedTasks(), candidateTask("move-2", "a5")];
  const plan = candidateReorderPlan(tasks, ["move", "move-2"], 2);
  assert.deepEqual(applyPlan(tasks, plan).map((task) => task.id), ["lower", "a", "move", "move-2", "b", "upper", "tail"]);
  assert.ok(plan.rekeyedIds.includes("b"));
  assert.throws(() => candidateReorderPlan(tasks, ["move-2", "move"], 2), /INVALID_REORDER_ORDER/);
});

test("v2 rekey: edge and distinct-key moves write only selected records; no-ops write nothing", () => {
  const tasks = tiedTasks();
  for (const index of [0, 1, 3, 5]) {
    const plan = candidateReorderPlan(tasks, ["move"], index);
    assert.deepEqual(plan.writes.map((task) => task.id), ["move"]);
    assert.deepEqual(plan.rekeyedIds, []);
    assert.deepEqual(applyPlan(tasks, plan).map((task) => task.id), plan.finalIds);
  }
  const noOp = candidateReorderPlan(tasks, ["move"], 4);
  assert.deepEqual(noOp.writes, []);
  assert.deepEqual(candidateReorderPlan(tasks, ["a"], 1).writes, []);
  const repaired = applyPlan(tasks, candidateReorderPlan(tasks, ["move"], 2));
  assert.deepEqual(candidateReorderPlan(repaired, ["move"], 2).writes, []);
});

test("v2 rekey: root and child scopes reject invalid or mixed membership before planning", () => {
  const tasks = tiedTasks();
  const nested = tasks.map((task) => ({ ...task, parentId: "parent" }));
  assert.deepEqual(candidateReorderPlan(nested, ["move"], 2).finalIds, candidateReorderPlan(tasks, ["move"], 2).finalIds);
  assert.throws(() => candidateReorderPlan([...tasks, candidateTask("child", "a0", { parentId: "parent" })], ["move"], 2), /INVALID_REORDER_SCOPE/);
  assert.throws(() => candidateReorderPlan([...tasks, tasks[0]], ["move"], 2), /DUPLICATE_ID/);
  assert.throws(() => candidateReorderPlan(tasks, ["missing"], 2), /INVALID_REORDER_ORDER/);
  assert.throws(() => candidateReorderPlan(tasks, ["move", "move"], 2), /INVALID_REORDER_ORDER/);
  assert.throws(() => candidateReorderPlan(tasks, ["move"], 99), /INVALID_REORDER_PLACEMENT/);
});

test("v2 rekey: exhaustive small tied scopes satisfy every selected-group placement", () => {
  for (let length = 2; length <= 6; length += 1) {
    const tasks = Array.from({ length }, (_, index) => candidateTask(`task-${index}`, ["a0", "a0", "a1", "a1", "a1", "a2"][index]));
    for (let mask = 1; mask < 2 ** length; mask += 1) {
      const selectedIds = tasks.filter((_, index) => mask & (1 << index)).map((task) => task.id);
      for (let insertAt = 0; insertAt <= length - selectedIds.length; insertAt += 1) {
        const plan = candidateReorderPlan(tasks, selectedIds, insertAt);
        assert.deepEqual(applyPlan(tasks, plan).map((task) => task.id), plan.finalIds);
        assert.equal(new Set(plan.finalIds).size, length);
      }
    }
  }
});

test("v2 rekey: offline repairs expose same-path collisions and deterministic survivor ordering", () => {
  const tasks = tiedTasks();
  const first = candidateReorderPlan(tasks, ["upper"], 2);
  const second = candidateReorderPlan(tasks, ["move"], 2);
  const overlapping = first.writes.filter((task) => second.writes.some((other) => other.id === task.id && candidateBytes(other) !== candidateBytes(task)));
  assert.ok(overlapping.length > 0);
  const firstById = new Map(first.writes.map((task) => [task.id, task]));
  const secondById = new Map(second.writes.map((task) => [task.id, task]));
  const merged = tasks.map((task) => secondById.get(task.id) ?? firstById.get(task.id) ?? task);
  assert.deepEqual([...merged].reverse().sort(compareCandidateTasks), merged.sort(compareCandidateTasks));
  assert.equal(new Set(merged.map((task) => task.id)).size, tasks.length);
  assert.notDeepEqual(merged.map((task) => task.id), first.finalIds);
});

test("v2 rekey: naive ID suffixing can escape a prefix upper bound", () => {
  const upper = "a0V";
  const core = generateKeyBetween(null, upper);
  const naiveUniqueKey = `${core}f0000000000000000000000000000001`;
  assert.ok(naiveUniqueKey >= upper, "Appending entropy can escape a prefix upper bound");
});

test("v2 rekey: canonical key grammar and 256-byte limit reject malformed input", () => {
  for (const key of ["a0", "Zz", "a0V", "b00", `A${"0".repeat(26)}1`, `z${"z".repeat(26)}`]) validateCandidateKey(key);
  for (const key of [null, 1, "", "a", "0a", "b0", "a_", "a0!", "a0é", "a0V0", `A${"0".repeat(26)}`]) {
    assert.throws(() => validateCandidateKey(key), /INVALID_ORDER_KEY/);
  }
  const limitKey = `a0${"0".repeat(candidateKeyByteLimit - 3)}1`;
  validateCandidateKey(limitKey);
  assert.throws(() => validateCandidateKey(`${limitKey}V`), /ORDER_KEY_LIMIT/);
  const tasks = [candidateTask("lower", "a0"), candidateTask("upper", limitKey), candidateTask("move", "a1")];
  const original = structuredClone(tasks);
  assert.throws(() => candidateReorderPlan(tasks, ["move"], 1), /ORDER_KEY_LIMIT/);
  assert.deepEqual(tasks, original);
  // Whole-scope normalization is possible but must be a separate explicit operation.
  const normalized = generateNKeysBetween(null, null, 10_000);
  normalized.forEach(validateCandidateKey);
  assert.ok(normalized.every((key) => key.length <= 4));
});

test("v2 rekey: a stale task, boundary, or new sibling rejects the whole batch before staging", (t) => {
  for (const change of ["selected", "boundary", "arrival"]) {
    const { taskDirectory, journalPath } = scratchBatch(t);
    const observed = observeCandidateScope(taskDirectory, null);
    const plan = candidateReorderPlan(tiedTasks(), ["move"], 2);
    const task = change === "selected" ? candidateTask("move", "a3", { title: "Remote edit" })
      : change === "boundary" ? candidateTask("upper", "a2V") : candidateTask("arrival", "a1V");
    writeFileSync(path.join(taskDirectory, `${task.id}.json`), candidateBytes(task));
    const before = observeCandidateScope(taskDirectory, null);
    assert.throws(() => stageCandidateBatch(journalPath, observed, plan.writes), /STALE_SCOPE/);
    assert.deepEqual(observeCandidateScope(taskDirectory, null), before);
    assert.equal(existsSync(journalPath), false);
  }
});

test("v2 rekey: partial JSON and invalid UTF-8 refuse staging without rewriting files", (t) => {
  for (const bytes of [Buffer.from('{"id":'), Buffer.from([0xff, 0xfe])]) {
    const { taskDirectory, journalPath } = scratchBatch(t);
    const observed = observeCandidateScope(taskDirectory, null);
    const taskPath = path.join(taskDirectory, "b.json");
    writeFileSync(taskPath, bytes);
    assert.throws(() => stageCandidateBatch(journalPath, observed, candidateReorderPlan(tiedTasks(), ["move"], 2).writes));
    assert.deepEqual(readFileSync(taskPath), bytes);
    assert.equal(existsSync(journalPath), false);
  }
});

test("v2 rekey: every persisted partial-write prefix resumes without replaying verified files", (t) => {
  const plan = candidateReorderPlan(tiedTasks(), ["move"], 2);
  for (let cut = 0; cut <= plan.writes.length; cut += 1) {
    const { taskDirectory, journalPath } = scratchBatch(t);
    const pending = stageCandidateBatch(journalPath, observeCandidateScope(taskDirectory, null), plan.writes);
    const toWrite = candidateBatchRecoveryPlan(pending);
    for (const file of toWrite.slice(0, cut)) replaceCandidateFile(file);
    const restarted = JSON.parse(readFileSync(journalPath, "utf8"));
    assert.equal(candidateBatchRecoveryPlan(restarted).length, toWrite.length - cut);
    applyCandidateBatch(restarted);
    assert.deepEqual(readScopeTasks(taskDirectory).map((task) => task.id), plan.finalIds);
    assert.deepEqual(candidateBatchRecoveryPlan(restarted), []);
    const finished = observeCandidateScope(taskDirectory, null);
    applyCandidateBatch(restarted);
    assert.deepEqual(observeCandidateScope(taskDirectory, null), finished);
    assert.equal(readFileSync(journalPath, "utf8"), candidateBytes(pending));
  }
});

test("v2 rekey: recovery stops on an edited, deleted, or newly arrived sibling without rollback", (t) => {
  for (const change of ["edit", "delete", "arrival"]) {
    const { taskDirectory, journalPath } = scratchBatch(t);
    const plan = candidateReorderPlan(tiedTasks(), ["move"], 2);
    const pending = stageCandidateBatch(journalPath, observeCandidateScope(taskDirectory, null), plan.writes);
    replaceCandidateFile(candidateBatchRecoveryPlan(pending)[0]);
    const movePath = path.join(taskDirectory, "move.json");
    if (change === "edit") writeFileSync(movePath, candidateBytes(candidateTask("move", "a3", { title: "Remote edit" })));
    if (change === "delete") rmSync(movePath);
    if (change === "arrival") writeFileSync(path.join(taskDirectory, "arrival.json"), candidateBytes(candidateTask("arrival", "a1V")));
    const beforeRetry = observeCandidateScope(taskDirectory, null);
    assert.throws(() => applyCandidateBatch(JSON.parse(readFileSync(journalPath, "utf8"))), /RECOVERY_(SCOPE_)?CONFLICT/);
    assert.deepEqual(observeCandidateScope(taskDirectory, null), beforeRetry);
    assert.equal(readFileSync(journalPath, "utf8"), candidateBytes(pending));
  }
});

test("v2 rekey: a competing reorder cannot replace persisted intent or change canonical bytes", (t) => {
  const { taskDirectory, journalPath } = scratchBatch(t);
  const observed = observeCandidateScope(taskDirectory, null);
  const plan = candidateReorderPlan(tiedTasks(), ["move"], 2);
  stageCandidateBatch(journalPath, observed, plan.writes);
  const pendingBytes = readFileSync(journalPath, "utf8");
  const competingPlan = candidateReorderPlan(tiedTasks(), ["move"], 0);
  assert.throws(() => stageCandidateBatch(journalPath, observed, competingPlan.writes), /EEXIST/);
  assert.equal(readFileSync(journalPath, "utf8"), pendingBytes);
  assert.deepEqual(observeCandidateScope(taskDirectory, null), observed);
  applyCandidateBatch(JSON.parse(readFileSync(journalPath, "utf8")));
  assert.deepEqual(readScopeTasks(taskDirectory).map((task) => task.id), ["lower", "a", "move", "b", "upper", "tail"]);
});

test("v2 rekey: existing v1 fixture sibling order maps to valid sparse keys with unchanged records", () => {
  const root = new URL("./fixtures/schema1/sync/", import.meta.url);
  const tasks = readdirSync(new URL("tasks/", root)).map((name) => JSON.parse(readFileSync(new URL(`tasks/${name}`, root), "utf8")));
  let covered = 0;
  for (const name of readdirSync(new URL("order/", root))) {
    const sequence = JSON.parse(readFileSync(new URL(`order/${name}`, root), "utf8"));
    const keys = generateNKeysBetween(null, null, sequence.taskIds.length);
    const mapped = sequence.taskIds.map((id, index) => ({ ...tasks.find((task) => task.id === id), orderKey: keys[index] }));
    for (const task of mapped) {
      validateCandidateKey(task.orderKey);
      assert.equal(task.parentId, sequence.parentId);
      const { orderKey: _, ...unchanged } = task;
      assert.deepEqual(unchanged, tasks.find((original) => original.id === task.id));
    }
    assert.deepEqual(mapped.sort(compareCandidateTasks).map((task) => task.id), sequence.taskIds);
    covered += mapped.length;
  }
  assert.equal(covered, tasks.length);
});
