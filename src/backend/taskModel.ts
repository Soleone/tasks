import { CommandError } from "./errors.js";
import { isDueDate } from "./dueDate.js";
export type TaskStatus = "open" | "in_progress" | "paused" | "done" | "canceled";
export type TaskPriority = 0 | 1 | 2 | 3 | 4;
/** How big the work is, 1 (tiny) to 5 (huge). Most tasks are 3 and leave the field out. */
export type TaskEffort = 1 | 2 | 3 | 4 | 5;
export const DEFAULT_EFFORT: TaskEffort = 3;
/** Data other programs keep on a task, one object per client slug. Tasks never reads it. */
export type TaskMeta = Record<string, Record<string, unknown>>;
const MAX_META_LENGTH = 65536;

export type CanonicalTask = {
  id: string;
  title: string;
  text: string | null;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  category: string | null;
  tags: string[];
  parentId: string | null;
  dependencyIds: string[];
  orderKey: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  // Optional fields are absent at their default, so task bytes stay `JSON.stringify(task)`.
  attachments?: string[];
  due?: string | null;
  effort?: TaskEffort;
  meta?: TaskMeta;
  /** Where the task stands in the queue, an order key like `orderKey`; absent when not queued. */
  queue?: string;
};

const requiredFields = [
  "id",
  "title",
  "text",
  "description",
  "status",
  "priority",
  "category",
  "tags",
  "parentId",
  "dependencyIds",
  "orderKey",
  "createdAt",
  "updatedAt",
  "closedAt",
];
const optionalFields = ["attachments", "due", "effort", "meta", "queue"];
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];
export const attachmentName = /^\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]{8}\.(?:png|jpg|webp|gif)$/;
/** A lowercase random UUID, as `randomUUID()` writes operation, plan and clone IDs. */
export const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** A root-relative task file or one of its sync conflict copies. */
export const taskFilePath =
  /^tasks\/(?:[A-Za-z0-9_-]+|[A-Za-z0-9_-]+\.sync-conflict-[^/\\]+)\.json$/;
const safeId = /^[A-Za-z0-9_-]+$/;
const slug = /^[a-z](?:[a-z0-9_-]*[a-z0-9_])?$/;
const statuses = new Set(["open", "in_progress", "paused", "done", "canceled"]);
const digits = /^[0-9A-Za-z]+$/;
const unpairedSurrogate = /[\uD800-\uDFFF]/u;

export function isEffort(value: unknown): value is TaskEffort {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 5;
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return !unpairedSurrogate.test(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return (
    isRecord(value) &&
    Object.entries(value).every(([key, item]) => !unpairedSurrogate.test(key) && isJsonValue(item))
  );
}

/** Namespaces are slugs holding objects, so one client's data never sits loose beside another's. */
export function isTaskMeta(value: unknown): value is TaskMeta {
  return (
    isRecord(value) &&
    Object.entries(value).every(([key, item]) => slug.test(key) && isRecord(item)) &&
    isJsonValue(value) &&
    JSON.stringify(value).length <= MAX_META_LENGTH
  );
}

function invalidTask(field: string): never {
  throw new CommandError("INVALID_CANONICAL", `invalid canonical task ${field}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function isSortedStrings(value: unknown, pattern: RegExp): value is string[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (entry, index) =>
      typeof entry === "string" && pattern.test(entry) && (index === 0 || value[index - 1] < entry),
  );
}

export function isAttachmentList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_ATTACHMENTS &&
    new Set(value).size === value.length &&
    value.every((name) => typeof name === "string" && attachmentName.test(name))
  );
}

export function isOrderKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 2 || value.length > 256) return false;
  const head = value.charCodeAt(0);
  if (!((head >= 65 && head <= 90) || (head >= 97 && head <= 122))) return false;
  if (!digits.test(value.slice(1))) return false;
  const integerLength = head <= 90 ? 92 - head : head - 95;
  if (value.length < integerLength || value === `A${"0".repeat(26)}`) return false;
  return value.length === integerLength || !value.endsWith("0");
}

export function validateManifest(value: unknown): void {
  if (!isRecord(value) || !Number.isInteger(value.schemaVersion)) invalidTask("manifest");
  if (value.schemaVersion !== 2)
    throw new CommandError(
      "UNSUPPORTED_SCHEMA",
      "canonical schema is not supported by this reader",
    );
  if (Object.keys(value).length !== 1) invalidTask("manifest fields");
}

export function validateTask(value: unknown, filenameId: string): CanonicalTask {
  if (!isRecord(value) || requiredFields.some((field) => !Object.hasOwn(value, field)))
    invalidTask("fields");
  const unknown = Object.keys(value).find(
    (field) => !requiredFields.includes(field) && !optionalFields.includes(field),
  );
  if (unknown !== undefined)
    throw new CommandError(
      "UNSUPPORTED_SCHEMA",
      `task field ${unknown} was written by a newer version of Tasks; update Tasks`,
    );
  if (typeof value.id !== "string" || !safeId.test(value.id) || value.id !== filenameId)
    invalidTask("id/filename");
  if (
    typeof value.title !== "string" ||
    value.title.length === 0 ||
    value.title.length > 1000 ||
    value.title.trim() !== value.title ||
    unpairedSurrogate.test(value.title)
  )
    invalidTask("title");
  if (
    value.text !== null &&
    (typeof value.text !== "string" ||
      value.text.length === 0 ||
      value.text.length > 1000 ||
      value.text.trim() !== value.text ||
      unpairedSurrogate.test(value.text))
  )
    invalidTask("text");
  if (
    typeof value.description !== "string" ||
    value.description.length > 10000 ||
    unpairedSurrogate.test(value.description)
  )
    invalidTask("description");
  if (typeof value.status !== "string" || !statuses.has(value.status)) invalidTask("status");
  if (
    typeof value.priority !== "number" ||
    !Number.isInteger(value.priority) ||
    value.priority < 0 ||
    value.priority > 4
  )
    invalidTask("priority");
  if (value.category !== null && (typeof value.category !== "string" || !slug.test(value.category)))
    invalidTask("category");
  if (!isSortedStrings(value.tags, slug)) invalidTask("tags");
  if (
    value.parentId !== null &&
    (typeof value.parentId !== "string" || !safeId.test(value.parentId))
  )
    invalidTask("parentId");
  if (!isSortedStrings(value.dependencyIds, safeId)) invalidTask("dependencyIds");
  if (!isOrderKey(value.orderKey)) invalidTask("orderKey");
  if (value.attachments !== undefined && !isAttachmentList(value.attachments))
    invalidTask("attachments");
  if (value.due !== undefined && value.due !== null && !isDueDate(value.due)) invalidTask("due");
  if (value.effort !== undefined && !isEffort(value.effort)) invalidTask("effort");
  if (value.meta !== undefined && !isTaskMeta(value.meta)) invalidTask("meta");
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt)) invalidTask("timestamps");
  const terminal = value.status === "done" || value.status === "canceled";
  if (terminal ? !isTimestamp(value.closedAt) : value.closedAt !== null)
    invalidTask("closedAt/status");
  if (value.queue !== undefined && (terminal || !isOrderKey(value.queue))) invalidTask("queue");
  return value as CanonicalTask;
}

export function compareTasks(
  left: Pick<CanonicalTask, "id" | "orderKey">,
  right: Pick<CanonicalTask, "id" | "orderKey">,
): number {
  if (left.orderKey !== right.orderKey) return left.orderKey < right.orderKey ? -1 : 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/** Queue order, like `compareTasks` over `queue`; both tasks must be queued. */
export function compareQueue(
  left: { id: string; queue?: string | null },
  right: { id: string; queue?: string | null },
): number {
  if (left.queue !== right.queue) return left.queue! < right.queue! ? -1 : 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export class GraphError extends CommandError {
  readonly taskId: string;
  readonly relation: "parentId" | "dependencyIds";

  constructor(taskId: string, relation: "parentId" | "dependencyIds") {
    super("INVALID_CANONICAL", `invalid canonical task ${relation} graph`);
    this.taskId = taskId;
    this.relation = relation;
  }
}

export function validateGraph(
  tasks: readonly Pick<CanonicalTask, "id" | "parentId" | "dependencyIds">[],
): void {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  if (byId.size !== tasks.length) invalidTask("duplicate IDs");
  // Walk edge kinds separately: a parent/dependency combination is not itself a forbidden cycle.
  for (const relation of ["parentId", "dependencyIds"] as const) {
    const complete = new Set<string>();
    const active = new Set<string>();
    for (const task of tasks) {
      const stack = [{ id: task.id, exit: false }];
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (current.exit) {
          active.delete(current.id);
          complete.add(current.id);
          continue;
        }
        if (complete.has(current.id)) continue;
        const record = byId.get(current.id);
        if (!record || active.has(current.id)) throw new GraphError(current.id, relation);
        active.add(current.id);
        stack.push({ id: current.id, exit: true });
        const targets =
          relation === "dependencyIds"
            ? record.dependencyIds
            : record.parentId === null
              ? []
              : [record.parentId];
        for (const id of targets) stack.push({ id, exit: false });
      }
    }
  }
}
