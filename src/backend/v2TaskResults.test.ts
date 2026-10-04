import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseV2TaskEditResult, parseV2TaskProjection } from "./v2TaskResults.js";
import type { V2TaskExecutionResult } from "./v2TaskResults.js";

const file = fileURLToPath(new URL("../../scripts/fixtures/taskdb-v2/root/tasks/c8d4206d-c25a-4317-baa4-a2c5443060e9.json", import.meta.url));
const projection = { ...JSON.parse(readFileSync(file, "utf8")), version: 7, blockedByIds: [] };

test("execution results distinguish historical changed success from receipt-only no-op", () => {
  const changed = { task: projection, changed: true, operationId: "fixed-operation" };
  const noop = { task: projection, changed: false };
  assert.deepEqual(parseV2TaskEditResult(changed, "execution"), changed);
  assert.deepEqual(parseV2TaskEditResult(noop, "execution"), noop);
  assert.equal(parseV2TaskEditResult(changed, "execution").task.version, 7);
});

test("preview result flags describe a nonexecuting effect and never imply an operation", () => {
  for (const [readOnly, dryRun] of [[false, true], [true, false], [true, true]]) {
    const preview = { task: projection, changed: true, readOnly, dryRun };
    assert.deepEqual(parseV2TaskEditResult(preview, "preview"), preview);
  }
  assert.throws(() => parseV2TaskEditResult({ task: projection, changed: false, readOnly: false, dryRun: false }, "preview"));
});

for (const [label, patch] of [
  ["missing changed", {}], ["nonboolean changed", { changed: 1 }], ["missing operation", { changed: true }],
  ["empty operation", { changed: true, operationId: "" }], ["noop with operation", { changed: false, operationId: "unexpected" }],
  ["execution with preview flag", { changed: true, operationId: "fixed", dryRun: false }],
] as const) {
  test(`execution result refuses ${label}`, () => assert.throws(() => parseV2TaskEditResult({ task: projection, ...patch }, "execution")));
}

for (const [label, patch] of [
  ["zero version", { version: 0 }], ["unsafe version", { version: Number.MAX_SAFE_INTEGER + 1 }],
  ["legacy field", { descriptionMarkdown: "not canonical" }], ["wrong blocker", { blockedByIds: ["unrelated"] }],
] as const) {
  test(`receipt/reply projection refuses ${label}`, () => {
    const task = { ...projection, ...patch };
    assert.throws(() => parseV2TaskProjection(task));
    assert.throws(() => parseV2TaskEditResult({ task, changed: false }, "execution"));
  });
}

test("TypeScript requires operation identity for changed execution and forbids it for no-op", () => {
  // Deliberately invalid compile fixtures; never commit or acknowledge them.
  // @ts-expect-error changed execution requires operationId
  const missingOperation: V2TaskExecutionResult = { task: projection, changed: true };
  // @ts-expect-error no-op execution cannot claim an operation
  const noopOperation: V2TaskExecutionResult = { task: projection, changed: false, operationId: "unexpected" };
  assert.equal(missingOperation.changed, true);
  assert.equal(noopOperation.operationId, "unexpected");
});
