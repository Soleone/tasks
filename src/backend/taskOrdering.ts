import { generateNKeysBetween } from "fractional-indexing";
import { CommandError } from "./errors.js";
import { assertArgs, isRecord } from "./protocol.js";
import { compareTasks, isOrderKey } from "./taskModel.js";
import type { CanonicalTask } from "./taskModel.js";
import { parseTaskVersion } from "./updateInputs.js";

type TaskVersion = { id: string; expectedVersion: number };
type Placement = { beforeId: string } | { afterId: string } | { first: true } | { last: true };
export type OrderInput = { tasks: TaskVersion[] } & (
  | { kind: "reorder"; placement: Placement }
  | { kind: "normalize"; parentId: string | null }
);
export type OrderPlan = {
  parentId: string | null;
  before: CanonicalTask[];
  after: CanonicalTask[];
  selectedIds: string[];
  writes: CanonicalTask[];
  changed: boolean;
};
export const ORDER_COMMANDS = ["task.reorder", "task.order.normalize"];
function invalid(message: string): never {
  throw new CommandError("INVALID_ARGUMENT", message);
}
function allocateKeys(lower: string | null, upper: string | null, count: number): string[] {
  try {
    const keys = generateNKeysBetween(lower, upper, count);
    if (!keys.every(isOrderKey)) throw new Error("unrepresentable allocation");
    return keys;
  } catch {
    throw new CommandError(
      "ORDER_KEY_LIMIT",
      "ordering allocation exceeds the canonical key limit",
    );
  }
}

export function parseOrder(command: string, args: Record<string, unknown>): OrderInput {
  const normalize = command === "task.order.normalize";
  assertArgs(args, ["tasks", normalize ? "parentId" : "placement"]);
  if (!Array.isArray(args.tasks) || (!normalize && args.tasks.length === 0))
    invalid("ordering needs a versioned task list");
  const tasks = args.tasks.map((value) => {
    if (!isRecord(value)) invalid("invalid ordering task reference");
    assertArgs(value, ["id", "expectedVersion"]);
    return parseTaskVersion(value);
  });
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length)
    invalid("ordering IDs must be unique");
  if (normalize) {
    if (
      args.parentId !== null &&
      (typeof args.parentId !== "string" || !/^[A-Za-z0-9_-]+$/.test(args.parentId))
    )
      invalid("normalization needs explicit parentId or null");
    return { kind: "normalize", tasks, parentId: args.parentId as string | null };
  }
  if (command !== "task.reorder")
    throw new CommandError("UNSUPPORTED_COMMAND", "ordering command is unavailable");
  const placement = args.placement;
  if (!isRecord(placement) || Object.keys(placement).length !== 1)
    invalid("placement needs exactly one anchor or end");
  const key = Object.keys(placement)[0];
  if (!["beforeId", "afterId", "first", "last"].includes(key))
    invalid("invalid ordering placement");
  if (key === "first" || key === "last") {
    if (placement[key] !== true) invalid("end placement must be true");
  } else if (
    typeof placement[key] !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(placement[key] as string)
  )
    invalid("invalid ordering anchor");
  return { kind: "reorder", tasks, placement: placement as Placement };
}

export function planOrder(input: OrderInput, tasks: CanonicalTask[]): OrderPlan {
  const selectedIds = input.tasks.map((task) => task.id);
  const selectedSet = new Set(selectedIds);
  const first = tasks.find((task) => task.id === selectedIds[0]);
  if (input.kind === "reorder" && !first)
    throw new CommandError("TASK_NOT_FOUND", "selected ordering task was not found");
  const parentId = input.kind === "normalize" ? input.parentId : first!.parentId;
  const before = tasks.filter((task) => task.parentId === parentId).sort(compareTasks);
  const selected = before.filter((task) => selectedSet.has(task.id));
  if (selected.length !== selectedIds.length)
    invalid("selected tasks must belong to one sibling scope");
  if (selected.some((task, index) => task.id !== selectedIds[index]))
    invalid("selected task list must follow current sibling order");
  if (input.kind === "normalize") {
    if (selected.length !== before.length)
      throw new CommandError(
        "STALE_SCOPE",
        "normalization requires the complete observed sibling list",
      );
    const keys = allocateKeys(null, null, before.length);
    const after = before.map((task, index) => ({ ...task, orderKey: keys[index] }));
    return {
      parentId,
      before,
      after,
      selectedIds,
      writes: after.filter((task, index) => task.orderKey !== before[index].orderKey),
      changed: after.some((task, index) => task.orderKey !== before[index].orderKey),
    };
  }
  const remaining = before.filter((task) => !selectedSet.has(task.id));
  let insertAt: number;
  if ("first" in input.placement) insertAt = 0;
  else if ("last" in input.placement) insertAt = remaining.length;
  else {
    const anchorId =
      "beforeId" in input.placement ? input.placement.beforeId : input.placement.afterId;
    const anchor = remaining.findIndex((task) => task.id === anchorId);
    if (anchor === -1) invalid("anchor must be an unselected task in the same scope");
    insertAt = anchor + ("afterId" in input.placement ? 1 : 0);
  }
  const final = [...remaining.slice(0, insertAt), ...selected, ...remaining.slice(insertAt)];
  if (final.every((task, index) => task.id === before[index].id))
    return { parentId, before, after: before, selectedIds, writes: [], changed: false };
  let start = insertAt,
    end = insertAt;
  const lower = remaining[insertAt - 1]?.orderKey;
  if (lower !== undefined && lower === remaining[insertAt]?.orderKey) {
    while (start > 0 && remaining[start - 1].orderKey === lower) start--;
    while (end < remaining.length && remaining[end].orderKey === lower) end++;
  }
  const run = [...remaining.slice(start, insertAt), ...selected, ...remaining.slice(insertAt, end)];
  const keys = allocateKeys(
    remaining[start - 1]?.orderKey ?? null,
    remaining[end]?.orderKey ?? null,
    run.length,
  );
  const allocated = new Map(
    run.map((task, index) => [task.id, { ...task, orderKey: keys[index] }]),
  );
  const after = final.map((task) => allocated.get(task.id) ?? task);
  const writes = run.flatMap((task, index) =>
    task.orderKey === keys[index] ? [] : [allocated.get(task.id)!],
  );
  return { parentId, before, after, selectedIds, writes, changed: true };
}
