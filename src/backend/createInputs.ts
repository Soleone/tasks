import { generateKeyBetween } from "fractional-indexing";
import { CommandError } from "./errors.js";
import { assertV2Args } from "./protocol.js";
import { compareV2Tasks, isV2OrderKey, validateV2Task } from "./taskModel.js";
import type { V2CanonicalTask } from "./taskModel.js";
import { parseV2ContentPatch } from "./updateInputs.js";

export type V2CreateInput = Pick<V2CanonicalTask, "title" | "description" | "priority" | "category" | "tags" | "parentId">;

export function parseV2Create(args: Record<string, unknown>): V2CreateInput {
  assertV2Args(args, ["title", "text", "description", "priority", "category", "tags", "parentId"]);
  if ((args.title !== undefined) === (args.text !== undefined)) throw new CommandError("INVALID_ARGUMENT", "create requires exactly one title or text");
  if (args.parentId !== undefined && args.parentId !== null && (typeof args.parentId !== "string" || !/^[A-Za-z0-9_-]+$/.test(args.parentId))) throw new CommandError("INVALID_ARGUMENT", "invalid create parentId");
  const patch = parseV2ContentPatch(args);
  return { title: patch.title!, description: patch.description ?? "", priority: patch.priority ?? 2, category: patch.category ?? null, tags: patch.tags ?? [], parentId: args.parentId as string | null | undefined ?? null };
}

export function buildV2CreatedTask(input: V2CreateInput, taskIdentity: { id: string; at: string }, tasks: V2CanonicalTask[]): V2CanonicalTask {
  if (input.parentId !== null) {
    const parent = tasks.find(task => task.id === input.parentId);
    if (!parent || parent.status === "canceled") throw new CommandError("INVALID_PARENT", "new parent must exist and not be canceled");
  }
  const first = tasks.filter(task => task.parentId === input.parentId).sort(compareV2Tasks)[0];
  const orderKey = generateKeyBetween(null, first?.orderKey ?? null);
  if (!isV2OrderKey(orderKey)) throw new CommandError("ORDER_KEY_LIMIT", "first-position allocation exceeds the canonical key limit");
  return validateV2Task({
    id: taskIdentity.id, title: input.title, description: input.description, status: "open", priority: input.priority,
    category: input.category, tags: input.tags, parentId: input.parentId, dependencyIds: [], orderKey,
    createdAt: taskIdentity.at, updatedAt: taskIdentity.at, closedAt: null,
  }, taskIdentity.id);
}
