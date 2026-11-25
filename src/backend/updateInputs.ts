import { CommandError } from "./errors.js";
import { assertArgs } from "./protocol.js";
import { isDueDate } from "./dueDate.js";
import {
  compareQueue,
  DEFAULT_EFFORT,
  isAttachmentList,
  isEffort,
  isTaskMeta,
  validateTask,
} from "./taskModel.js";
import type { CanonicalTask, TaskEffort, TaskMeta } from "./taskModel.js";
import { invalidInput, parseShorthand, slugInput } from "./shorthand.js";
import { allocateKeys, parsePlacement, type Placement } from "./taskOrdering.js";

export type UpdateInput = {
  id: string;
  expectedVersion: number;
  patch: Partial<
    Pick<
      CanonicalTask,
      "title" | "text" | "description" | "priority" | "category" | "tags" | "attachments"
    > & {
      due: string | null;
      effort: TaskEffort;
      /** Replaces each named namespace; `null` removes one. Others are kept. */
      meta: Record<string, TaskMeta[string] | null>;
    }
  >;
  /** Where the task goes in the queue, like a reorder placement, or `null` to take it out. */
  queue?: Placement | null;
};

/** The fields typed text sets, so a patch takes either the text or these, never both. */
const SHORTHAND_FIELDS = ["title", "category", "tags", "due"] as const;

export function parseContentPatch(args: Record<string, unknown>): UpdateInput["patch"] {
  if (args.text !== undefined && SHORTHAND_FIELDS.some((field) => args[field] !== undefined))
    invalidInput("mixed text/classification");
  const patch: UpdateInput["patch"] = {};
  if (args.text !== undefined) {
    if (typeof args.text !== "string" || /[\uD800-\uDFFF]/u.test(args.text)) invalidInput("text");
    // Checked after parsing, since due words grow into dates in the stored text.
    const parsed = parseShorthand(args.text);
    if (parsed.text.length > 1000) invalidInput("text");
    Object.assign(patch, parsed);
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
  if (args.effort !== undefined) {
    if (!isEffort(args.effort)) invalidInput("effort");
    patch.effort = args.effort;
  }
  if (args.category !== undefined)
    patch.category = args.category === null ? null : slugInput(args.category);
  if (args.tags !== undefined) {
    if (!Array.isArray(args.tags)) invalidInput("tags");
    patch.tags = [...new Set(args.tags.map(slugInput))].sort();
  }
  if (args.due !== undefined) {
    if (args.due !== null && !isDueDate(args.due)) invalidInput("due");
    patch.due = args.due;
  }
  if (args.attachments !== undefined) {
    if (!isAttachmentList(args.attachments)) invalidInput("attachments");
    patch.attachments = args.attachments;
  }
  if (args.meta !== undefined) {
    // `null` removes a namespace; checked as an empty one, since that is what it leaves.
    const meta = args.meta as Record<string, unknown>;
    if (
      meta === null ||
      typeof meta !== "object" ||
      Array.isArray(meta) ||
      !isTaskMeta(
        Object.fromEntries(Object.entries(meta).map(([key, value]) => [key, value ?? {}])),
      )
    )
      invalidInput("meta");
    patch.meta = meta as UpdateInput["patch"]["meta"];
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
    "due",
    "effort",
    "queue",
    "attachments",
    "meta",
  ]);
  const input: UpdateInput = { ...parseTaskVersion(args), patch: parseContentPatch(args) };
  if (args.queue !== undefined)
    input.queue = args.queue === null ? null : parsePlacement(args.queue);
  return input;
}

export function applyUpdate(
  task: CanonicalTask,
  input: UpdateInput,
  at: string,
  tasks: readonly CanonicalTask[],
): { task: CanonicalTask; changed: boolean } {
  const { meta, ...fields } = input.patch;
  const next: CanonicalTask = { ...task, ...fields };
  if (input.queue === null) delete next.queue;
  else if (input.queue !== undefined) next.queue = queueKey(task, input.queue, tasks);
  if (meta !== undefined) next.meta = mergeMeta(task.meta ?? {}, meta);
  if (next.meta !== undefined && Object.keys(next.meta).length === 0) delete next.meta;
  if (next.attachments?.length === 0) delete next.attachments;
  if (next.due === null) delete next.due;
  if (next.effort === DEFAULT_EFFORT) delete next.effort;
  // Typed text is kept only while it still describes what it set.
  if (
    input.patch.text === undefined &&
    SHORTHAND_FIELDS.some((field) => JSON.stringify(next[field]) !== JSON.stringify(task[field]))
  )
    next.text = null;
  const changed = JSON.stringify(next) !== JSON.stringify(task);
  // Other programs' data and the queue aren't edits to the task, so they leave its time alone.
  const edited = JSON.stringify(ownFields(next)) !== JSON.stringify(ownFields(task));
  if (edited) next.updatedAt = at;
  return { task: validateTask(next, task.id), changed };
}

function ownFields({ meta: _meta, queue: _queue, ...fields }: CanonicalTask) {
  return fields;
}

/** A queue key that puts the task at `placement` among the other queued tasks. */
function queueKey(
  task: CanonicalTask,
  placement: Placement,
  tasks: readonly CanonicalTask[],
): string {
  if (task.status === "done" || task.status === "canceled") invalidInput("queue");
  const queued = tasks
    .filter((other) => other.queue !== undefined && other.id !== task.id)
    .sort(compareQueue);
  let index: number;
  if ("first" in placement) index = 0;
  else if ("last" in placement) index = queued.length;
  else {
    const anchorId = "beforeId" in placement ? placement.beforeId : placement.afterId;
    const anchor = queued.findIndex((other) => other.id === anchorId);
    if (anchor === -1) invalidInput("queue anchor");
    index = anchor + ("afterId" in placement ? 1 : 0);
  }
  return allocateKeys(queued[index - 1]?.queue ?? null, queued[index]?.queue ?? null, 1)[0];
}

function mergeMeta(current: TaskMeta, patch: NonNullable<UpdateInput["patch"]["meta"]>): TaskMeta {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch))
    if (value === null) delete next[key];
    else next[key] = value;
  return next;
}
