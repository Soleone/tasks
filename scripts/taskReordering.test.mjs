import assert from "node:assert/strict";
import test from "node:test";
import {
  placementForMove,
  placementTargetId,
  selectableSiblingRows,
  selectedRowsForReorder,
  selectionMembershipMatches,
} from "../src/components/taskReordering.ts";

function row(id, parentId = null, contextOnly = false) {
  return {
    task: { id, parentId },
    depth: parentId === null ? 0 : 1,
    hasChildren: false,
    contextOnly,
  };
}

test("selection and reorder calculations stay within visible sibling scopes", () => {
  const roots = [row("root-a"), row("root-context", null, true), row("root-b")];
  const children = [
    row("child-a", "root-a"),
    row("child-b", "root-a"),
    row("other-child", "root-b"),
  ];
  const rows = [...roots, ...children];

  assert.deepEqual(
    selectableSiblingRows(children[0], rows).map(({ task }) => task.id),
    ["child-a", "child-b"],
  );
  assert.deepEqual(selectedRowsForReorder(roots[0], rows, new Set()), [roots[0]]);
  assert.deepEqual(selectedRowsForReorder(children[0], rows, new Set(["child-a", "child-b"])), [
    children[0],
    children[1],
  ]);
  assert.equal(selectedRowsForReorder(roots[0], rows, new Set(["root-a", "child-a"])), null);
  assert.equal(selectedRowsForReorder(roots[1], rows, new Set()), null);
});

test("move placements preserve selected siblings and report visible boundaries", () => {
  const rows = [row("a"), row("b"), row("c"), row("d")];
  const selected = [rows[1], rows[2]];

  assert.deepEqual(placementForMove("up", rows[1], selected, rows), { beforeId: "a" });
  assert.deepEqual(placementForMove("down", rows[1], selected, rows), { afterId: "d" });
  assert.deepEqual(placementForMove("start", rows[1], selected, rows), { beforeId: "a" });
  assert.deepEqual(placementForMove("end", rows[1], selected, rows), { afterId: "d" });
  assert.equal(placementForMove("up", rows[0], [rows[0]], rows), null);
  assert.equal(placementForMove("start", rows[0], [rows[0]], rows), null);
  assert.equal(placementForMove("down", rows[3], [rows[3]], rows), null);
  assert.equal(placementForMove("end", rows[3], [rows[3]], rows), null);
  assert.equal(placementForMove("up", rows[1], [row("missing")], rows), null);
});

test("reorder refresh checks selection by membership and narrows placement targets", () => {
  const rows = [row("a"), row("b")];

  assert.equal(selectionMembershipMatches(rows, ["b", "a"]), true);
  assert.equal(selectionMembershipMatches(rows, ["a", "missing"]), false);
  assert.equal(selectionMembershipMatches(rows, ["a"]), false);
  assert.equal(placementTargetId({ beforeId: "a" }), "a");
  assert.equal(placementTargetId({ afterId: "b" }), "b");
});
