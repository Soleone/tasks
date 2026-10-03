import { CommandError } from "./errors.js";
import type { TaskPriority, TaskStatus } from "./protocol.js";

export type V2CanonicalTask = {
  id: string;
  title: string;
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
};

const fields = ["id", "title", "description", "status", "priority", "category", "tags", "parentId", "dependencyIds", "orderKey", "createdAt", "updatedAt", "closedAt"];
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

export function isV2Timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function isSortedStrings(value: unknown, pattern: RegExp): value is string[] {
  if (!Array.isArray(value)) return false;
  return value.every((entry, index) => typeof entry === "string" && pattern.test(entry) && (index === 0 || value[index - 1] < entry));
}

export function isV2OrderKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 2 || value.length > 256) return false;
  const head = value.charCodeAt(0);
  if (!((head >= 65 && head <= 90) || (head >= 97 && head <= 122))) return false;
  if (!digits.test(value.slice(1))) return false;
  const integerLength = head <= 90 ? 92 - head : head - 95;
  if (value.length < integerLength || value === `A${"0".repeat(26)}`) return false;
  return value.length === integerLength || !value.endsWith("0");
}

export function validateV2Manifest(value: unknown): void {
  if (!isRecord(value) || !Number.isInteger(value.schemaVersion)) invalidTask("manifest");
  if (value.schemaVersion !== 2) throw new CommandError("UNSUPPORTED_SCHEMA", "canonical schema is not supported by the v2 reader");
  if (Object.keys(value).length !== 1) invalidTask("manifest fields");
}

export function validateV2Task(value: unknown, filenameId: string): V2CanonicalTask {
  if (!isRecord(value) || Object.keys(value).length !== fields.length || fields.some((field) => !Object.hasOwn(value, field))) invalidTask("fields");
  if (typeof value.id !== "string" || !safeId.test(value.id) || value.id !== filenameId) invalidTask("id/filename");
  if (typeof value.title !== "string" || value.title.length === 0 || value.title.length > 1000 || value.title.trim() !== value.title || unpairedSurrogate.test(value.title)) invalidTask("title");
  if (typeof value.description !== "string" || value.description.length > 10000 || unpairedSurrogate.test(value.description)) invalidTask("description");
  if (typeof value.status !== "string" || !statuses.has(value.status)) invalidTask("status");
  if (typeof value.priority !== "number" || !Number.isInteger(value.priority) || value.priority < 0 || value.priority > 4) invalidTask("priority");
  if (value.category !== null && (typeof value.category !== "string" || !slug.test(value.category))) invalidTask("category");
  if (!isSortedStrings(value.tags, slug)) invalidTask("tags");
  if (value.parentId !== null && (typeof value.parentId !== "string" || !safeId.test(value.parentId))) invalidTask("parentId");
  if (!isSortedStrings(value.dependencyIds, safeId)) invalidTask("dependencyIds");
  if (!isV2OrderKey(value.orderKey)) invalidTask("orderKey");
  if (!isV2Timestamp(value.createdAt) || !isV2Timestamp(value.updatedAt)) invalidTask("timestamps");
  const terminal = value.status === "done" || value.status === "canceled";
  if (terminal ? !isV2Timestamp(value.closedAt) : value.closedAt !== null) invalidTask("closedAt/status");
  return value as V2CanonicalTask;
}

export function compareV2Tasks(left: V2CanonicalTask, right: V2CanonicalTask): number {
  if (left.orderKey !== right.orderKey) return left.orderKey < right.orderKey ? -1 : 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export class V2GraphError extends CommandError {
  readonly taskId: string;
  readonly relation: "parentId" | "dependencyIds";

  constructor(taskId: string, relation: "parentId" | "dependencyIds") {
    super("INVALID_CANONICAL", `invalid canonical task ${relation} graph`);
    this.taskId = taskId;
    this.relation = relation;
  }
}

export function validateV2Graph(tasks: readonly Pick<V2CanonicalTask, "id" | "parentId" | "dependencyIds">[]): void {
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
        if (current.exit) { active.delete(current.id); complete.add(current.id); continue; }
        if (complete.has(current.id)) continue;
        const record = byId.get(current.id);
        if (!record || active.has(current.id)) throw new V2GraphError(current.id, relation);
        active.add(current.id);
        stack.push({ id: current.id, exit: true });
        const targets = relation === "dependencyIds" ? record.dependencyIds : record.parentId === null ? [] : [record.parentId];
        for (const id of targets) stack.push({ id, exit: false });
      }
    }
  }
}
