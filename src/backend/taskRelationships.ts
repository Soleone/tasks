import { generateKeyBetween } from "fractional-indexing";
import { canonicalJson } from "./canonicalJson.js";
import { CommandError } from "./errors.js";
import { assertArgs } from "./protocol.js";
import { compareTasks, isOrderKey, validateGraph, validateTask, GraphError } from "./taskModel.js";
import type { CanonicalTask } from "./taskModel.js";
import { parseTaskVersion } from "./updateInputs.js";

export const RELATIONSHIP_COMMANDS = [
  "task.move",
  "task.dependency.add",
  "task.dependency.remove",
] as const;
export type RelationshipInput = { id: string; expectedVersion: number } & (
  | { kind: "parent"; parentId: string | null }
  | { kind: "add" | "remove"; dependsOnId: string }
);

export function parseRelationship(
  command: string,
  args: Record<string, unknown>,
): RelationshipInput {
  const parent = command === "task.move";
  assertArgs(args, ["id", "expectedVersion", parent ? "parentId" : "dependsOnId"]);
  const reference = parseTaskVersion(args);
  if (parent) {
    if (
      args.parentId !== null &&
      (typeof args.parentId !== "string" || !/^[A-Za-z0-9_-]+$/.test(args.parentId))
    )
      throw new CommandError(
        "INVALID_ARGUMENT",
        "parentId must be a safe task ID or explicit null",
      );
    return { ...reference, kind: "parent", parentId: args.parentId as string | null };
  }
  if (!["task.dependency.add", "task.dependency.remove"].includes(command))
    throw new CommandError("UNSUPPORTED_COMMAND", "relationship command is unavailable");
  if (typeof args.dependsOnId !== "string" || !/^[A-Za-z0-9_-]+$/.test(args.dependsOnId))
    throw new CommandError("INVALID_ARGUMENT", "dependsOnId must be a safe task ID");
  return {
    ...reference,
    kind: command === "task.dependency.add" ? "add" : "remove",
    dependsOnId: args.dependsOnId,
  };
}

function relationshipPatch(
  task: CanonicalTask,
  input: RelationshipInput,
): Partial<Pick<CanonicalTask, "parentId" | "dependencyIds">> | undefined {
  if (input.kind === "parent")
    return task.parentId === input.parentId ? undefined : { parentId: input.parentId };
  const exists = task.dependencyIds.includes(input.dependsOnId);
  if (exists === (input.kind === "add")) return undefined;
  return {
    dependencyIds:
      input.kind === "add"
        ? [...task.dependencyIds, input.dependsOnId].sort()
        : task.dependencyIds.filter((id) => id !== input.dependsOnId),
  };
}

/** Validate fixed local effects without requiring live files for pending inspection or historical replay. */
export function matchesRelationshipEffect(
  before: CanonicalTask,
  next: CanonicalTask,
  input: RelationshipInput,
  at: string,
): boolean {
  const patch = relationshipPatch(before, input);
  if (!patch) return false;
  const expected = {
    ...before,
    ...patch,
    updatedAt: at,
    ...(input.kind === "parent" ? { orderKey: next.orderKey } : {}),
  };
  // Guarded execution must independently reproduce the recorded allocation from the original graph.
  return canonicalJson(expected) === canonicalJson(next);
}

export function applyRelationship(
  task: CanonicalTask,
  input: RelationshipInput,
  tasks: CanonicalTask[],
  at: string,
): { task: CanonicalTask; changed: boolean } {
  const patch = relationshipPatch(task, input);
  if (!patch) return { task, changed: false };
  const targetId =
    input.kind === "parent" ? input.parentId : input.kind === "add" ? input.dependsOnId : null;
  if (targetId !== null) {
    const target = tasks.find((task) => task.id === targetId);
    if (!target || target.status === "canceled")
      throw new CommandError(
        input.kind === "parent" ? "INVALID_PARENT" : "INVALID_DEPENDENCY",
        "new relationship target must exist and not be canceled",
      );
  }
  let next = { ...task, ...patch, updatedAt: at };
  try {
    validateGraph(tasks.map((record) => (record.id === task.id ? next : record)));
  } catch (error) {
    if (error instanceof GraphError)
      throw new CommandError(
        error.relation === "parentId" ? "PARENT_CYCLE" : "DEPENDENCY_CYCLE",
        "prospective relationship graph has a cycle",
      );
    throw error;
  }
  if (input.kind === "parent") {
    const first = tasks
      .filter((record) => record.parentId === input.parentId)
      .sort(compareTasks)[0];
    const orderKey = generateKeyBetween(null, first?.orderKey ?? null);
    if (!isOrderKey(orderKey))
      throw new CommandError(
        "ORDER_KEY_LIMIT",
        "first-position allocation exceeds the canonical key limit",
      );
    next = { ...next, orderKey };
  }
  return { task: validateTask(next, task.id), changed: true };
}
