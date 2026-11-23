import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fail, send, success } from "./copyTestWorkspace.js";
import type { CanonicalTask } from "./taskModel.js";
import {
  batch,
  corpus,
  counts,
  get,
  linux,
  materialize,
  prepared,
  raw,
  rows,
} from "./undoTestWorkspace.js";

const statuses = ["open", "in_progress", "paused", "done", "canceled"] as const;
const allowed: Record<string, readonly string[]> = {
  start: ["open", "in_progress", "paused", "done"],
  pause: ["open", "in_progress", "paused"],
  complete: ["open", "in_progress", "paused", "done"],
  reopen: statuses,
  cancel: ["open", "in_progress", "paused", "canceled"],
  delete: statuses,
};
for (const [suffix, states] of Object.entries(allowed))
  for (const status of statuses.filter((state) => states.includes(state))) {
    test(
      `latest status undo ${suffix} from ${status} restores exact closure/edit time or has no meaningful history`,
      linux,
      (t) => {
        const w = materialize(t, {
          a: {
            status,
            updatedAt: "2030-01-01T00:00:00.000Z",
            closedAt: ["done", "canceled"].includes(status) ? "2026-09-08T14:00:00.000Z" : null,
          },
        });
        const before = get(w),
          changed = success(send(w, prepared(w, `task.${suffix}`, { id: "a" }))).result.changed;
        const req = prepared(w, "task.status.undo", { id: "a" });
        if (!changed) {
          fail(send(w, req), "UNDO_UNAVAILABLE");
          return;
        }
        const result = success(send(w, req)).result;
        const current = get(w);
        for (const key of Object.keys(corpus.taskTemplate) as (keyof CanonicalTask)[])
          assert.deepEqual(current[key], before[key]);
        assert.ok(current.version > before.version);
        assert.deepEqual(success(send(w, req)).result, result);
        fail(send(w, prepared(w, "task.status.undo", { id: "a" }, "again")), "UNDO_UNAVAILABLE");
      },
    );
  }

for (const corruption of ["invalid-preimage", "invalid-postimage", "missing-preimage"]) {
  test(`selected status undo ${corruption} remains unavailable without effects`, linux, (t) => {
    const w = materialize(t);
    success(send(w, prepared(w, "task.complete", { id: "a" })));
    const request = prepared(w, "task.status.undo", { id: "a" });
    const db = new DatabaseSync(w.cache);
    try {
      const history = db.prepare("SELECT before_record, after_record FROM v2_operations").get() as {
        before_record: string;
        after_record: string;
      };
      if (corruption === "invalid-preimage") {
        const before = JSON.parse(history.before_record);
        delete before.status;
        db.prepare("UPDATE v2_operations SET before_record = ?").run(JSON.stringify(before));
      } else {
        db.prepare(
          `UPDATE v2_operations SET ${corruption === "missing-preimage" ? "before_record" : "after_record"} = ?`,
        ).run(corruption === "missing-preimage" ? JSON.stringify({ tasks: [] }) : "{}");
      }
    } finally {
      db.close();
    }
    const before = raw(w),
      state = counts(w);
    fail(send(w, request), "UNDO_UNAVAILABLE");
    assert.deepEqual(raw(w), before);
    assert.deepEqual(counts(w), state);
  });
}

test(
  "batch transition and per-task status undo claims retain partial group eligibility without replaying others",
  linux,
  (t) => {
    const w = materialize(t, {
      a: {},
      b: { orderKey: "a1" },
      c: { status: "done", closedAt: "2026-09-08T14:00:00.000Z", orderKey: "a2" },
    });
    const cBefore = get(w, "c"),
      bytes = raw(w);
    const req = batch(w, "task.transitionMany", [
      { id: "a", command: "task.complete" },
      { id: "b", command: "task.start" },
      { id: "c", command: "task.complete" },
    ]);
    const changed = success(send(w, req));
    assert.equal(rows(w).length, 1);
    assert.equal(rows(w, "c").length, 0);
    assert.equal(get(w, "c").version, cBefore.version);
    assert.deepEqual(
      raw(w).find(([file]) => file === "c.json"),
      bytes.find(([file]) => file === "c.json"),
    );
    success(send(w, prepared(w, "task.status.undo", { id: "a" })));
    fail(
      send(w, prepared(w, "operation.undo", { operationId: changed.result.operationId })),
      "OPERATION_UNAVAILABLE",
    );
    success(send(w, batch(w, "task.status.undoMany", [{ id: "b" }])));
    assert.equal(get(w, "a").status, "open");
    assert.equal(get(w, "b").status, "open");
    assert.deepEqual(success(send(w, req)).result, changed.result);
    assert.equal(rows(w).length, 3);
    assert.deepEqual(counts(w), [3, 3, 2]);
  },
);

test(
  "status undoMany gathers distinct sources into one group and refuses all effects when any item is unavailable",
  linux,
  (t) => {
    const w = materialize(t, { a: {}, b: { orderKey: "a1" }, c: { orderKey: "a2" } });
    success(send(w, prepared(w, "task.complete", { id: "a" })));
    success(send(w, prepared(w, "task.pause", { id: "b" })));
    const before = raw(w);
    fail(send(w, batch(w, "task.status.undoMany", [{ id: "a" }, { id: "c" }])), "UNDO_UNAVAILABLE");
    assert.deepEqual(raw(w), before);
    success(send(w, batch(w, "task.status.undoMany", [{ id: "a" }, { id: "b" }])));
    assert.equal(rows(w).length, 3);
    assert.equal(get(w).status, "open");
    assert.equal(get(w, "b").status, "open");
  },
);
test(
  "latest status undo is invalidated by meaningful local or imported changes, not receipt-only no-ops",
  linux,
  (t) => {
    const w = materialize(t);
    const completed = success(send(w, prepared(w, "task.complete", { id: "a" })));
    success(send(w, prepared(w, "task.complete", { id: "a" }, "noop")));
    success(send(w, prepared(w, "task.status.undo", { id: "a" })));
    const again = success(send(w, prepared(w, "task.complete", { id: "a" }, "complete-again")));
    success(send(w, prepared(w, "task.update", { id: "a", description: "Intervening note" })));
    fail(send(w, prepared(w, "task.status.undo", { id: "a" }, "unavailable")), "UNDO_UNAVAILABLE");
    success(
      send(
        w,
        prepared(
          w,
          "operation.undo",
          { operationId: again.result.operationId },
          "group-undo-status",
        ),
      ),
    );
    assert.equal(get(w).description, "Intervening note");
    assert.equal(get(w).status, "open");
    assert.notEqual(completed.result.operationId, again.result.operationId);
  },
);
