import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fail, send, success } from "./copyTestWorkspace.js";
import { pendingIntentPath } from "./localDomain.js";
import { readRootDescriptor } from "./canonicalReader.js";
import {
  batch,
  counts,
  get,
  linux,
  materialize,
  patch,
  prepared,
  raw,
  rows,
} from "./undoTestWorkspace.js";
import type { Projection } from "./undoTestWorkspace.js";

for (const command of [
  "task.update",
  "task.move",
  "task.dependency.add",
  "task.dependency.remove",
  "task.reorder",
  "task.order.normalize",
  "task.transitionMany",
]) {
  test(
    `redo.operation: ${command} round trips preserve unrelated fields, graph/order and groups`,
    linux,
    (t) => {
      const w = materialize(t, {
        a: {
          dependencyIds: command === "task.dependency.remove" ? ["target"] : [],
          orderKey: "a0V",
        },
        b: { orderKey: "a1V" },
        target: { orderKey: "a2V", status: "canceled", closedAt: "2026-09-08T14:00:00.000Z" },
      });
      const original = get(w),
        allBefore = raw(w);
      let req;
      if (command === "task.reorder") {
        req = batch(w, command, [{ id: "a" }]);
        req.args.placement = { last: true };
      } else if (command === "task.order.normalize") {
        req = batch(w, command, [{ id: "a" }, { id: "b" }, { id: "target" }]);
        req.args.parentId = null;
      } else if (command === "task.transitionMany")
        req = batch(w, command, [
          { id: "a", command: "task.complete" },
          { id: "b", command: "task.pause" },
        ]);
      else
        req = prepared(w, command, {
          id: "a",
          ...(command === "task.update"
            ? { priority: 0 }
            : command === "task.move"
              ? { parentId: "b" }
              : { dependsOnId: command === "task.dependency.add" ? "b" : "target" }),
        });
      const forward = success(send(w, req));
      const changed = get(w);
      patch(w, "a", { description: "Later unrelated note", updatedAt: "2035-01-01T00:00:00.000Z" });
      const start = new Date().toISOString();
      const inverse = prepared(w, "operation.undo", { operationId: forward.result.operationId });
      const result = success(send(w, inverse)).result;
      const task = get(w);
      assert.equal(task.description, "Later unrelated note");
      assert.equal(task.priority, original.priority);
      assert.equal(task.parentId, original.parentId);
      assert.deepEqual(task.dependencyIds, original.dependencyIds);
      assert.equal(task.orderKey, original.orderKey);
      assert.equal(task.status, original.status);
      assert.equal(task.closedAt, original.closedAt);
      if (["task.reorder", "task.order.normalize", "task.transitionMany"].includes(command))
        assert.equal(task.updatedAt, "2035-01-01T00:00:00.000Z");
      else assert.ok(task.updatedAt >= start && task.updatedAt <= new Date().toISOString());
      assert.equal(rows(w).length, 2);
      assert.deepEqual(success(send(w, inverse)).result, result);
      fail(send(w, { ...inverse, idempotencyKey: "second-undo" }), "OPERATION_UNAVAILABLE");
      if (!["task.reorder", "task.order.normalize", "task.transitionMany"].includes(command))
        assert.deepEqual(
          raw(w).find(([file]) => file === "target.json"),
          allBefore.find(([file]) => file === "target.json"),
        );
      const redo = prepared(w, "operation.redo", { operationId: result.operationId });
      const beforePreview = counts(w);
      success(send(w, { ...redo, dryRun: true }));
      assert.deepEqual(counts(w), beforePreview);
      const reapplied = success(send(w, redo)).result;
      assert.deepEqual(success(send(w, redo)).result, reapplied);
      fail(send(w, { ...redo, idempotencyKey: "second-redo" }), "OPERATION_UNAVAILABLE");
      const redone = get(w);
      for (const field of [
        "priority",
        "parentId",
        "dependencyIds",
        "orderKey",
        "status",
        "closedAt",
      ] as const)
        assert.deepEqual(redone[field], changed[field]);
      assert.equal(redone.description, "Later unrelated note");
      const undoneAgain = success(
        send(
          w,
          prepared(w, "operation.undo", { operationId: reapplied.operationId }, "undo-again"),
        ),
      ).result;
      assert.equal(get(w).priority, original.priority);
      assert.equal(get(w).status, original.status);
      assert.equal(get(w).orderKey, original.orderKey);
      success(
        send(
          w,
          prepared(w, "operation.redo", { operationId: undoneAgain.operationId }, "redo-again"),
        ),
      );
      assert.equal(get(w).closedAt, changed.closedAt);
    },
  );
}

test(
  "redo.claims: status redo restores the recorded closure and only accepts an eligible undo",
  linux,
  (t) => {
    const w = materialize(t);
    const forward = success(send(w, prepared(w, "task.complete", { id: "a" }))).result;
    const closedAt = get(w).closedAt;
    fail(
      send(w, prepared(w, "operation.redo", { operationId: forward.operationId })),
      "OPERATION_UNAVAILABLE",
    );
    const undo = success(
      send(w, prepared(w, "operation.undo", { operationId: forward.operationId })),
    ).result;
    fail(
      send(w, prepared(w, "operation.undo", { operationId: undo.operationId }, "undo-an-undo")),
      "OPERATION_UNAVAILABLE",
    );
    patch(w, "a", { description: "Independent note", updatedAt: "2035-01-01T00:00:00.000Z" });
    const redo = success(
      send(w, prepared(w, "operation.redo", { operationId: undo.operationId })),
    ).result;
    assert.equal(get(w).closedAt, closedAt);
    assert.equal(get(w).updatedAt, "2035-01-01T00:00:00.000Z");
    assert.equal(get(w).description, "Independent note");
    assert.equal(new Set([forward.operationId, undo.operationId, redo.operationId]).size, 3);
  },
);

test(
  "redo.create: capture round trips restore the same raw task, ID and timestamps",
  linux,
  (t) => {
    const w = materialize(t, {});
    let operation = success(
      send(
        w,
        prepared(w, "task.create", { text: "Call @home #phone", description: "**Keep**\r\n" }),
      ),
    ).result;
    const task = operation.task as Projection;
    const bytes = raw(w);
    for (let cycle = 0; cycle < 2; cycle++) {
      operation = success(
        send(
          w,
          prepared(w, "operation.undo", { operationId: operation.operationId }, `undo-${cycle}`),
        ),
      ).result;
      assert.deepEqual(raw(w), []);
      const request = prepared(
        w,
        "operation.redo",
        { operationId: operation.operationId },
        `redo-${cycle}`,
      );
      const before = counts(w);
      const preview = success(send(w, { ...request, dryRun: true })).result;
      assert.ok((preview.tasks as Projection[])[0].version > 0);
      assert.deepEqual(counts(w), before);
      assert.deepEqual(raw(w), []);
      operation = success(send(w, request)).result;
      assert.deepEqual(raw(w), bytes);
      assert.equal((operation.tasks as Projection[])[0].id, task.id);
      assert.deepEqual(success(send(w, request)).result, operation);
    }
  },
);

test(
  "auth.context: capture redo refuses exhausted authority before publishing an intent",
  linux,
  (t) => {
    const w = materialize(t, {});
    const created = success(send(w, prepared(w, "task.create", { title: "Capture" }))).result;
    const undo = success(
      send(w, prepared(w, "operation.undo", { operationId: created.operationId })),
    ).result;
    const db = new DatabaseSync(w.cache);
    db.prepare("UPDATE v2_query_state SET counter = ?").run(Number.MAX_SAFE_INTEGER - 10);
    db.close();
    const retained = counts(w);
    fail(
      send(w, prepared(w, "operation.redo", { operationId: undo.operationId })),
      "UNSUPPORTED_COMMAND",
    );
    assert.deepEqual(raw(w), []);
    assert.deepEqual(counts(w), retained);
    assert.equal(existsSync(pendingIntentPath(readRootDescriptor(w.root))), false);
  },
);

for (const fault of [
  "reappeared",
  "conflict",
  "parent-missing",
  "archive-missing",
  "origin-missing",
  "claim-missing",
]) {
  test(
    `redo.unavailable: capture ${fault} refuses without effects or consuming a key`,
    linux,
    (t) => {
      const w = materialize(t);
      const created = success(
        send(w, prepared(w, "task.create", { title: "Child", parentId: "a" })),
      ).result;
      const task = created.task as Projection;
      const taskPath = path.join(w.root, "tasks", `${task.id}.json`);
      const bytes = readFileSync(taskPath);
      const undo = success(
        send(w, prepared(w, "operation.undo", { operationId: created.operationId })),
      ).result;
      if (fault === "reappeared") writeFileSync(taskPath, bytes);
      if (fault === "conflict")
        writeFileSync(
          path.join(w.root, "tasks", `${task.id}.sync-conflict-device.json`),
          "Keep conflict",
        );
      if (fault === "parent-missing") rmSync(path.join(w.root, "tasks/a.json"));
      if (fault === "archive-missing") rmSync(undo.recoveryLocation as string);
      if (fault === "origin-missing" || fault === "claim-missing") {
        const db = new DatabaseSync(w.cache);
        if (fault === "origin-missing")
          db.prepare("DELETE FROM v2_operations WHERE id = ?").run(created.operationId as string);
        else
          db.prepare("DELETE FROM v2_undo_claims WHERE undo_id = ?").run(
            undo.operationId as string,
          );
        db.close();
      }
      const before = raw(w),
        retained = counts(w);
      const request = prepared(w, "operation.redo", { operationId: undo.operationId });
      fail(send(w, { ...request, dryRun: true }), "OPERATION_UNAVAILABLE");
      fail(send(w, request), "OPERATION_UNAVAILABLE");
      assert.deepEqual(raw(w), before);
      assert.deepEqual(counts(w), retained);
      assert.equal(existsSync(pendingIntentPath(readRootDescriptor(w.root))), false);
    },
  );
}

for (const direction of ["redo", "undo"]) {
  test(
    `redo.operation: ${direction} of an order reversal still checks the complete sibling scope`,
    linux,
    (t) => {
      const w = materialize(t, {
        a: { orderKey: "a0" },
        b: { orderKey: "a1" },
        c: { orderKey: "a2" },
      });
      const reorder = batch(w, "task.reorder", [{ id: "a" }]);
      reorder.args.placement = { last: true };
      let operation = success(send(w, reorder)).result;
      operation = success(
        send(w, prepared(w, "operation.undo", { operationId: operation.operationId })),
      ).result;
      if (direction === "undo")
        operation = success(
          send(w, prepared(w, "operation.redo", { operationId: operation.operationId })),
        ).result;
      patch(w, "c", { orderKey: "a1V" });
      const before = raw(w);
      fail(
        send(
          w,
          prepared(
            w,
            `operation.${direction}`,
            { operationId: operation.operationId },
            "refused-order",
          ),
        ),
        "OPERATION_UNAVAILABLE",
      );
      assert.deepEqual(raw(w), before);
    },
  );
}

test(
  "redo.unavailable: a conflicting batch refuses every task and purge invalidation survives reappearance",
  linux,
  (t) => {
    const w = materialize(t, { a: {}, b: { orderKey: "a1" } });
    const forward = success(
      send(
        w,
        batch(w, "task.transitionMany", [
          { id: "a", command: "task.complete" },
          { id: "b", command: "task.pause" },
        ]),
      ),
    ).result;
    const undo = success(
      send(w, prepared(w, "operation.undo", { operationId: forward.operationId })),
    ).result;
    const original = readFileSync(path.join(w.root, "tasks/a.json"));
    patch(w, "b", { status: "in_progress" });
    const request = prepared(w, "operation.redo", { operationId: undo.operationId });
    const before = raw(w);
    fail(send(w, request), "OPERATION_UNAVAILABLE");
    assert.deepEqual(raw(w), before);
    patch(w, "b", { status: "open" });
    success(send(w, prepared(w, "task.cancel", { id: "a" })));
    success(send(w, prepared(w, "task.purgeCanceled", {})));
    writeFileSync(path.join(w.root, "tasks/a.json"), original);
    fail(send(w, request), "OPERATION_UNAVAILABLE");
    assert.equal(get(w).status, "open");
  },
);
