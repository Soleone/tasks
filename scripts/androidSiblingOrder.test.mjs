import assert from "node:assert/strict";
import test from "node:test";
import {
  AndroidSiblingOrderConflict,
  assertAndroidSiblingOrder,
} from "../src/legacy/platform/androidSiblingOrder.ts";

const initial = ["a", "b", "c", "d"];

test("Android reorder rejects a remote reorder of a disjoint selected sibling", () => {
  const localFinalOrder = ["b", "a", "c", "d"];
  const remoteFinalOrder = ["d", "a", "b", "c"];
  assert.notDeepEqual(localFinalOrder, remoteFinalOrder);
  assert.throws(
    () => assertAndroidSiblingOrder(initial, remoteFinalOrder),
    (error) =>
      error instanceof AndroidSiblingOrderConflict && error.code === "SIBLING_ORDER_CONFLICT",
  );
});

test("retrying a stale reorder still conflicts against the unchanged remote order", () => {
  const remoteFinalOrder = ["d", "a", "b", "c"];
  assert.throws(
    () => assertAndroidSiblingOrder(initial, remoteFinalOrder),
    AndroidSiblingOrderConflict,
  );
  assert.throws(
    () => assertAndroidSiblingOrder(initial, remoteFinalOrder),
    AndroidSiblingOrderConflict,
  );
});

test("Android reorder proceeds when the sibling scope is unchanged", () => {
  assert.doesNotThrow(() => assertAndroidSiblingOrder(initial, [...initial]));
});
