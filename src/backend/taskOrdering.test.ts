import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { compareTasks } from "./taskModel.js";
import type { CanonicalTask } from "./taskModel.js";
import { planOrder } from "./taskOrdering.js";

const corpus = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../scripts/fixtures/workspace/cases.json", import.meta.url)),
    "utf8",
  ),
);
type Placement = { beforeId: string } | { afterId: string } | { first: true } | { last: true };

/**
 * Plans moving `selected` to `at` among the unselected siblings and checks the reader's order,
 * `changed`, and that only the moved tasks and the equal-key run around `at` are rewritten.
 */
function assertPlan(
  keys: Record<string, string>,
  selected: string[],
  placement: Placement,
  at: number,
  variant: string,
) {
  const ids = Object.keys(keys);
  const tasks: CanonicalTask[] = ids.map((id) => ({
    ...corpus.taskTemplate,
    id,
    orderKey: keys[id],
  }));
  const remaining = ids.filter((id) => !selected.includes(id));
  const expected = [...remaining.slice(0, at), ...selected, ...remaining.slice(at)];
  const plan = planOrder(
    { kind: "reorder", tasks: selected.map((id) => ({ id, expectedVersion: 1 })), placement },
    tasks,
  );
  assert.deepEqual(
    [...plan.after].sort(compareTasks).map((task) => task.id),
    expected,
    variant,
  );
  assert.equal(plan.changed, expected.join() !== ids.join(), variant);
  const lower = keys[remaining[at - 1]];
  const tie = lower !== undefined && lower === keys[remaining[at]] ? lower : undefined;
  for (const write of plan.writes) {
    assert.notEqual(write.orderKey, keys[write.id], variant);
    if (!selected.includes(write.id)) assert.equal(keys[write.id], tie, variant);
  }
}

test("order.reorder-gap: all five-task selections/anchors keep the selected order in tied and untied scopes", () => {
  let checked = 0;
  for (const tied of [false, true])
    for (let mask = 1; mask < 32; mask++) {
      const ids = ["a", "b", "c", "d", "e"],
        selected = ids.filter((_, index) => mask & (1 << index));
      const remaining = ids.filter((id) => !selected.includes(id));
      const placements: Placement[] = [
        { first: true },
        { last: true },
        ...remaining.flatMap((id) => [{ beforeId: id }, { afterId: id }]),
      ];
      for (const placement of placements) {
        const at =
          "first" in placement
            ? 0
            : "last" in placement
              ? remaining.length
              : "beforeId" in placement
                ? remaining.indexOf(placement.beforeId)
                : remaining.indexOf(placement.afterId) + 1;
        const keys = Object.fromEntries(ids.map((id, index) => [id, tied ? "a0" : `a${index}`]));
        assertPlan(keys, selected, placement, at, `tied=${tied}, ${JSON.stringify(placement)}`);
        checked++;
      }
    }
  assert.equal(checked, 424);
});

test("order.reorder-gap: all 419 mixed-tie selections/positions splice the selected IDs in order", () => {
  const keyRun = ["a0", "a0", "a1", "a1", "a1", "a2"];
  let checked = 0;
  for (let length = 2; length <= 6; length++) {
    const ids = Array.from({ length }, (_, index) => `task-${index}`);
    const keys = Object.fromEntries(ids.map((id, index) => [id, keyRun[index]]));
    for (let mask = 1; mask < 2 ** length; mask++) {
      const selected = ids.filter((_, index) => mask & (1 << index));
      const remaining = ids.filter((id) => !selected.includes(id));
      for (let at = 0; at <= remaining.length; at++) {
        const placement: Placement =
          at === 0
            ? { first: true }
            : at === remaining.length
              ? { last: true }
              : { beforeId: remaining[at] };
        assertPlan(keys, selected, placement, at, `length=${length}, mask=${mask}, at=${at}`);
        checked++;
      }
    }
  }
  assert.equal(checked, 419);
});
