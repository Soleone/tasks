import { generateKeyBetween } from "fractional-indexing";
import { CommandError } from "./errors.js";
import { assertArgs } from "./protocol.js";
import { compareTasks, isOrderKey, isTimestamp, validateTask } from "./taskModel.js";
import { DEFAULT_EFFORT } from "./taskModel.js";
import type { CanonicalTask, TaskEffort } from "./taskModel.js";
import { parseContentPatch } from "./updateInputs.js";

export type CreateInput = Pick<
  CanonicalTask,
  "title" | "text" | "description" | "priority" | "category" | "tags" | "parentId"
> & {
  due: string | null;
  effort: TaskEffort;
  attachments: string[];
  /** Logs a task already done at this time, not after now. */
  closedAt: string | null;
};

export function parseCreate(args: Record<string, unknown>): CreateInput {
  assertArgs(args, [
    "title",
    "text",
    "description",
    "priority",
    "category",
    "tags",
    "due",
    "effort",
    "attachments",
    "parentId",
    "closedAt",
  ]);
  if ((args.title !== undefined) === (args.text !== undefined))
    throw new CommandError("INVALID_ARGUMENT", "create requires exactly one title or text");
  if (
    args.parentId !== undefined &&
    args.parentId !== null &&
    (typeof args.parentId !== "string" || !/^[A-Za-z0-9_-]+$/.test(args.parentId))
  )
    throw new CommandError("INVALID_ARGUMENT", "invalid create parentId");
  if (args.closedAt !== undefined && !isTimestamp(args.closedAt))
    throw new CommandError("INVALID_ARGUMENT", "closedAt must be a timestamp");
  const patch = parseContentPatch(args);
  return {
    title: patch.title!,
    text: patch.text ?? null,
    description: patch.description ?? "",
    priority: patch.priority ?? 2,
    category: patch.category ?? null,
    tags: patch.tags ?? [],
    due: patch.due ?? null,
    effort: patch.effort ?? DEFAULT_EFFORT,
    attachments: patch.attachments ?? [],
    parentId: (args.parentId as string | null | undefined) ?? null,
    closedAt: (args.closedAt as string | undefined) ?? null,
  };
}

export function buildCreatedTask(
  input: CreateInput,
  taskIdentity: { id: string; at: string },
  tasks: CanonicalTask[],
): CanonicalTask {
  if (input.parentId !== null) {
    const parent = tasks.find((task) => task.id === input.parentId);
    if (!parent || parent.status === "canceled")
      throw new CommandError("INVALID_PARENT", "new parent must exist and not be canceled");
  }
  if (input.closedAt !== null && input.closedAt > taskIdentity.at)
    throw new CommandError("INVALID_ARGUMENT", "a logged task can't be done in the future");
  const first = tasks.filter((task) => task.parentId === input.parentId).sort(compareTasks)[0];
  const orderKey = generateKeyBetween(null, first?.orderKey ?? null);
  if (!isOrderKey(orderKey))
    throw new CommandError(
      "ORDER_KEY_LIMIT",
      "first-position allocation exceeds the canonical key limit",
    );
  return validateTask(
    {
      id: taskIdentity.id,
      title: input.title,
      text: input.text,
      description: input.description,
      status: input.closedAt === null ? "open" : "done",
      priority: input.priority,
      category: input.category,
      tags: input.tags,
      parentId: input.parentId,
      dependencyIds: [],
      orderKey,
      createdAt: taskIdentity.at,
      updatedAt: taskIdentity.at,
      closedAt: input.closedAt,
      ...(input.attachments.length > 0 ? { attachments: input.attachments } : {}),
      ...(input.due !== null ? { due: input.due } : {}),
      ...(input.effort !== DEFAULT_EFFORT ? { effort: input.effort } : {}),
    },
    taskIdentity.id,
  );
}
