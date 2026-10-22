import { CommandError } from "./errors.js";
export type TaskStatus = "open" | "in_progress" | "paused" | "done" | "canceled";
export type TaskPriority = 0 | 1 | 2 | 3 | 4;

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
const optionalFields = ["attachments"];
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];
export const attachmentName = /^\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]{8}\.(?:png|jpg|webp|gif)$/;
const safeId = /^[A-Za-z0-9_-]+$/;
const slug = /^[a-z](?:[a-z0-9_-]*[a-z0-9_])?$/;
const statuses = new Set(["open", "in_progress", "paused", "done", "canceled"]);
const digits = /^[0-9A-Za-z]+$/;
const unpairedSurrogate = /[\uD800-\uDFFF]/u;

function invalidTask(field: string): never {
  throw new CommandError("INVALID_CANONICAL", `invalid canonical task ${field}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function matchesEntireString(value: string, pattern: RegExp): boolean {
  return pattern.exec(value)?.[0] === value;
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
      typeof entry === "string" &&
      matchesEntireString(entry, pattern) &&
      (index === 0 || value[index - 1] < entry),
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
  if (!matchesEntireString(value.slice(1), digits)) return false;
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
  if (
    typeof value.id !== "string" ||
    !matchesEntireString(value.id, safeId) ||
    value.id !== filenameId
  )
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
  if (
    value.category !== null &&
    (typeof value.category !== "string" || !matchesEntireString(value.category, slug))
  )
    invalidTask("category");
  if (!isSortedStrings(value.tags, slug)) invalidTask("tags");
  if (
    value.parentId !== null &&
    (typeof value.parentId !== "string" || !matchesEntireString(value.parentId, safeId))
  )
    invalidTask("parentId");
  if (!isSortedStrings(value.dependencyIds, safeId)) invalidTask("dependencyIds");
  if (!isOrderKey(value.orderKey)) invalidTask("orderKey");
  if (value.attachments !== undefined && !isAttachmentList(value.attachments))
    invalidTask("attachments");
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt)) invalidTask("timestamps");
  const terminal = value.status === "done" || value.status === "canceled";
  if (terminal ? !isTimestamp(value.closedAt) : value.closedAt !== null)
    invalidTask("closedAt/status");
  return value as CanonicalTask;
}

export function compareTasks(left: CanonicalTask, right: CanonicalTask): number {
  if (left.orderKey !== right.orderKey) return left.orderKey < right.orderKey ? -1 : 1;
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
