import { CommandError } from "./errors.js";
import { assertV2Args } from "./v2Protocol.js";
import { validateV2Task } from "./v2TaskModel.js";
import type { V2CanonicalTask } from "./v2TaskModel.js";

export type V2UpdateInput = { id: string; expectedVersion: number; patch: Partial<Pick<V2CanonicalTask, "title" | "description" | "priority" | "category" | "tags">> };
const slugPattern = /^[a-z](?:[a-z0-9_-]*[a-z0-9_])?$/;

function invalidInput(field: string): never {
  throw new CommandError("INVALID_ARGUMENT", `invalid task ${field}`);
}

function slugInput(value: unknown): string {
  if (typeof value !== "string") invalidInput("classification");
  const slug = value.replace(/[A-Z]/g, letter => letter.toLowerCase());
  if (!slugPattern.test(slug)) invalidInput("classification");
  return slug;
}

export function parseV2Shorthand(input: string): Pick<V2CanonicalTask, "title" | "category" | "tags"> {
  let decoded = "";
  const protectedUnits: boolean[] = [];
  const append = (value: string, protect: boolean): void => {
    decoded += value;
    for (let index = 0; index < value.length; index += 1) protectedUnits.push(protect);
  };
  for (let index = 0; index < input.length;) {
    if (input.startsWith("```", index)) {
      const close = input.indexOf("```", index + 3);
      const end = close === -1 ? input.length : close + 3;
      append(input.slice(index, end), true);
      index = end;
      continue;
    }
    if (input[index] === "`") {
      const close = input.indexOf("`", index + 1);
      if (close !== -1 && !input.slice(index, close).includes("\n")) {
        append(input.slice(index, close + 1), true);
        index = close + 1;
        continue;
      }
    }
    if (input[index] === "\\" && ["@", "#", "\\"].includes(input[index + 1])) {
      const escaped = input[index + 1];
      append(escaped, escaped === "@" || escaped === "#");
      index += 2;
      continue;
    }
    append(input[index++], false);
  }
  const categories = new Set<string>();
  const tags = new Set<string>();
  const ranges: { start: number; end: number }[] = [];
  // Escaped markers still participate in boundary checks after decoding.
  for (const match of decoded.matchAll(/(^|[^A-Za-z0-9_/@])([@#])([A-Za-z][A-Za-z0-9_-]*)\b/g)) {
    const start = match.index + match[1].length;
    if (protectedUnits.slice(start, start + match[2].length + match[3].length).some(Boolean)) continue;
    const slug = slugInput(match[3]);
    (match[2] === "@" ? categories : tags).add(slug);
    ranges.push({ start, end: start + 1 + match[3].length });
  }
  if (categories.size > 1) throw new CommandError("MULTIPLE_CATEGORIES", "shorthand contains multiple categories");
  let title = decoded;
  for (const range of ranges.reverse()) title = title.slice(0, range.start) + title.slice(range.end);
  return { title: title.trim(), category: [...categories][0] ?? null, tags: [...tags].sort() };
}

export function parseV2ContentPatch(args: Record<string, unknown>): V2UpdateInput["patch"] {
  if (args.text !== undefined && ["title", "category", "tags"].some(field => args[field] !== undefined)) invalidInput("mixed text/classification");
  const patch: V2UpdateInput["patch"] = {};
  if (args.text !== undefined) {
    if (typeof args.text !== "string") invalidInput("text");
    Object.assign(patch, parseV2Shorthand(args.text));
  }
  if (args.title !== undefined) {
    if (typeof args.title !== "string") invalidInput("title");
    patch.title = args.title.trim();
  }
  if (patch.title !== undefined && (patch.title === "" || patch.title.length > 1000 || /[\uD800-\uDFFF]/u.test(patch.title))) invalidInput("title");
  if (args.description !== undefined) {
    if (typeof args.description !== "string" || args.description.length > 10000 || /[\uD800-\uDFFF]/u.test(args.description)) invalidInput("description");
    patch.description = args.description;
  }
  if (args.priority !== undefined) {
    if (!Number.isInteger(args.priority) || (args.priority as number) < 0 || (args.priority as number) > 4) invalidInput("priority");
    patch.priority = args.priority as V2CanonicalTask["priority"];
  }
  if (args.category !== undefined) patch.category = args.category === null ? null : slugInput(args.category);
  if (args.tags !== undefined) {
    if (!Array.isArray(args.tags)) invalidInput("tags");
    patch.tags = [...new Set(args.tags.map(slugInput))].sort();
  }
  return patch;
}

export function parseV2Update(args: Record<string, unknown>): V2UpdateInput {
  assertV2Args(args, ["id", "expectedVersion", "title", "text", "description", "priority", "category", "tags"]);
  if (typeof args.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(args.id)) invalidInput("id");
  if (!Number.isSafeInteger(args.expectedVersion) || (args.expectedVersion as number) <= 0) {
    throw new CommandError("EXPECTED_VERSION_REQUIRED", "positive safe expectedVersion is required");
  }
  return { id: args.id, expectedVersion: args.expectedVersion as number, patch: parseV2ContentPatch(args) };
}

export function applyV2Update(task: V2CanonicalTask, input: V2UpdateInput, at: string): { task: V2CanonicalTask; changed: boolean } {
  const next = { ...task, ...input.patch };
  const changed = JSON.stringify(next) !== JSON.stringify(task);
  if (changed) next.updatedAt = at;
  return { task: validateV2Task(next, task.id), changed };
}
