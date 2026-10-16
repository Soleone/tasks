import { CommandError } from "./errors.js";
import { assertArgs } from "./protocol.js";
import { validateTask } from "./taskModel.js";
import type { CanonicalTask } from "./taskModel.js";
import { invalidInput, parseShorthand, slugInput } from "./shorthand.js";

export type UpdateInput = {
  id: string;
  expectedVersion: number;
  patch: Partial<
    Pick<CanonicalTask, "title" | "text" | "description" | "priority" | "category" | "tags">
  >;
};

export function parseContentPatch(args: Record<string, unknown>): UpdateInput["patch"] {
  if (
    args.text !== undefined &&
    ["title", "category", "tags"].some((field) => args[field] !== undefined)
  )
    invalidInput("mixed text/classification");
  const patch: UpdateInput["patch"] = {};
  if (args.text !== undefined) {
    if (
      typeof args.text !== "string" ||
      args.text.trim().length > 1000 ||
      /[\uD800-\uDFFF]/u.test(args.text)
    )
      invalidInput("text");
    Object.assign(patch, parseShorthand(args.text), { text: args.text.trim() });
  }
  if (args.title !== undefined) {
    if (typeof args.title !== "string") invalidInput("title");
    patch.title = args.title.trim();
  }
  if (
    patch.title !== undefined &&
    (patch.title === "" || patch.title.length > 1000 || /[\uD800-\uDFFF]/u.test(patch.title))
  )
    invalidInput("title");
  if (args.description !== undefined) {
    if (
      typeof args.description !== "string" ||
      args.description.length > 10000 ||
      /[\uD800-\uDFFF]/u.test(args.description)
    )
      invalidInput("description");
    patch.description = args.description;
  }
  if (args.priority !== undefined) {
    if (
      !Number.isInteger(args.priority) ||
      (args.priority as number) < 0 ||
      (args.priority as number) > 4
    )
      invalidInput("priority");
    patch.priority = args.priority as CanonicalTask["priority"];
  }
  if (args.category !== undefined)
    patch.category = args.category === null ? null : slugInput(args.category);
  if (args.tags !== undefined) {
    if (!Array.isArray(args.tags)) invalidInput("tags");
    patch.tags = [...new Set(args.tags.map(slugInput))].sort();
  }
  return patch;
}

export function parseTaskVersion(args: Record<string, unknown>): {
  id: string;
  expectedVersion: number;
} {
  if (typeof args.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(args.id)) invalidInput("id");
  if (!Number.isSafeInteger(args.expectedVersion) || (args.expectedVersion as number) <= 0) {
    throw new CommandError(
      "EXPECTED_VERSION_REQUIRED",
      "positive safe expectedVersion is required",
    );
  }
  return { id: args.id, expectedVersion: args.expectedVersion as number };
}

export function parseUpdate(args: Record<string, unknown>): UpdateInput {
  assertArgs(args, [
    "id",
    "expectedVersion",
    "title",
    "text",
    "description",
    "priority",
    "category",
    "tags",
  ]);
  return { ...parseTaskVersion(args), patch: parseContentPatch(args) };
}

export function applyUpdate(
  task: CanonicalTask,
  input: UpdateInput,
  at: string,
): { task: CanonicalTask; changed: boolean } {
  const next = { ...task, ...input.patch };
  // Typed text is kept only while it still describes the title and classification it produced.
  if (
    input.patch.text === undefined &&
    (["title", "category", "tags"] as const).some(
      (field) => JSON.stringify(next[field]) !== JSON.stringify(task[field]),
    )
  )
    next.text = null;
  const changed = JSON.stringify(next) !== JSON.stringify(task);
  if (changed) next.updatedAt = at;
  return { task: validateTask(next, task.id), changed };
}
