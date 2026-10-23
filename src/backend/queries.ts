import { CommandError } from "./errors.js";
import { assertArgs } from "./protocol.js";
import type { CanonicalTask } from "./taskModel.js";
import { compareTasks, isTimestamp } from "./taskModel.js";
import { typedText } from "./shorthand.js";
import type { QueryAuthority } from "./queryCache.js";

export type TaskProjection = CanonicalTask & {
  attachments: string[];
  due: string | null;
  version: number;
  blockedByIds: string[];
};
const slugPattern = /^[a-z](?:[a-z0-9_-]*[a-z0-9_])?$/;
const taskStatuses = new Set(["open", "in_progress", "paused", "done", "canceled"]);

function invalidFilter(field: string): never {
  throw new CommandError("INVALID_ARGUMENT", `invalid query ${field}`);
}

function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function filterSlug(value: unknown, marker: string): string {
  if (typeof value !== "string") invalidFilter("classification");
  const trimmed = value.trim();
  const slug = asciiLower(trimmed.startsWith(marker) ? trimmed.slice(1) : trimmed);
  if (!slugPattern.test(slug)) invalidFilter("classification");
  return slug;
}

function queryInteger(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) invalidFilter("integer");
  return value;
}

export function projectTasks(tasks: CanonicalTask[], authority: QueryAuthority): TaskProjection[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return tasks.map((task) => ({
    ...task,
    text: typedText(task),
    attachments: task.attachments ?? [],
    due: task.due ?? null,
    version: authority.versions.get(task.id)!,
    blockedByIds: task.dependencyIds.filter((id) => byId.get(id)!.status !== "canceled"),
  }));
}

function manualPreorder(tasks: TaskProjection[]): TaskProjection[] {
  const scopes = new Map<string | null, TaskProjection[]>();
  for (const task of tasks) {
    const scope = scopes.get(task.parentId) ?? [];
    scope.push(task);
    scopes.set(task.parentId, scope);
  }
  for (const scope of scopes.values()) scope.sort(compareTasks);
  const stack = [...(scopes.get(null) ?? [])].reverse();
  const ordered: TaskProjection[] = [];
  while (stack.length > 0) {
    const task = stack.pop()!;
    ordered.push(task);
    const children = scopes.get(task.id) ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
  }
  return ordered;
}

function listTasks(
  tasks: TaskProjection[],
  args: Record<string, unknown>,
  revision: number,
): Record<string, unknown> {
  assertArgs(args, [
    "status",
    "priority",
    "category",
    "categoryIsNull",
    "tags",
    "search",
    "unblocked",
    "closedSince",
    "includeAncestors",
    "includeDescendants",
    "sort",
    "direction",
    "limit",
    "offset",
  ]);
  const statuses =
    args.status === undefined ? [] : Array.isArray(args.status) ? args.status : [args.status];
  if (statuses.some((status) => typeof status !== "string" || !taskStatuses.has(status)))
    invalidFilter("status");
  const priority = args.priority === undefined ? undefined : queryInteger(args.priority, 2);
  if (priority !== undefined && (priority < 0 || priority > 4)) invalidFilter("priority");
  for (const field of ["categoryIsNull", "unblocked", "includeAncestors", "includeDescendants"]) {
    if (args[field] !== undefined && typeof args[field] !== "boolean") invalidFilter(field);
  }
  const category = args.category === undefined ? undefined : filterSlug(args.category, "@");
  if (category !== undefined && args.categoryIsNull === true) invalidFilter("category/null");
  const rawTags =
    args.tags === undefined ? undefined : Array.isArray(args.tags) ? args.tags : [args.tags];
  if (rawTags?.length === 0) invalidFilter("tags");
  const tags = rawTags?.map((tag) => filterSlug(tag, "#")) ?? [];
  let search: string | undefined;
  if (args.search !== undefined) {
    if (typeof args.search !== "string" || args.search.trim() === "") invalidFilter("search");
    search = args.search.trim().slice(0, 200);
    if (/[\uD800-\uDBFF]$/.test(search)) search = search.slice(0, -1);
    search = asciiLower(search);
  }
  // Stored times share this exact form, so text order is time order.
  const closedSince = args.closedSince;
  if (closedSince !== undefined && !isTimestamp(closedSince)) invalidFilter("closedSince");
  const sort = args.sort === undefined ? "created" : args.sort;
  if (!["created", "updated", "priority", "due", "closed", "manual"].includes(sort as string))
    invalidFilter("sort");
  const direction =
    args.direction === undefined
      ? sort === "priority" || sort === "due"
        ? "asc"
        : "desc"
      : args.direction;
  if (direction !== "asc" && direction !== "desc") invalidFilter("direction");
  const limit = Math.min(100, Math.max(1, queryInteger(args.limit, 50)));
  const offset = Math.max(0, queryInteger(args.offset, 0));
  const ordered = manualPreorder(tasks);
  const matching = ordered.filter(
    (task) =>
      (statuses.length === 0 || statuses.includes(task.status)) &&
      (priority === undefined || task.priority === priority) &&
      (category === undefined || task.category === category) &&
      (args.categoryIsNull !== true || task.category === null) &&
      tags.every((tag) => task.tags.includes(tag)) &&
      (args.unblocked !== true || task.blockedByIds.length === 0) &&
      (closedSince === undefined || (task.closedAt !== null && task.closedAt >= closedSince)) &&
      (search === undefined ||
        asciiLower(task.title).includes(search) ||
        asciiLower(task.description).includes(search)),
  );
  if (sort !== "manual") {
    const sortValue = (task: TaskProjection): string | number =>
      sort === "priority"
        ? task.priority
        : sort === "created"
          ? task.createdAt
          : sort === "updated"
            ? task.updatedAt
            : sort === "closed"
              ? (task.closedAt ?? "")
              : (task.due ?? "");
    // Undated tasks, and active tasks under the closed sort, stay last in either direction.
    const missing = (task: TaskProjection): boolean =>
      sort === "due" ? task.due === null : sort === "closed" && task.closedAt === null;
    matching.sort((left, right) => {
      if (missing(left) !== missing(right)) return missing(left) ? 1 : -1;
      const a = sortValue(left);
      const b = sortValue(right);
      if (a !== b) return (a < b ? -1 : 1) * (direction === "asc" ? 1 : -1);
      if (sort === "due" && left.priority !== right.priority) return left.priority - right.priority;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
  }
  const page = matching.slice(offset, offset + limit);
  const pageIds = new Set(page.map((task) => task.id));
  const contextIds = new Set<string>();
  const includeContext = args.includeAncestors === true || args.includeDescendants === true;
  if (includeContext) {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    for (const task of page) {
      let parentId = task.parentId;
      while (parentId !== null) {
        if (!pageIds.has(parentId)) contextIds.add(parentId);
        parentId = byId.get(parentId)!.parentId;
      }
    }
  }
  if (args.includeDescendants === true) {
    const treeIds = new Set([...pageIds, ...contextIds]);
    for (const task of ordered) {
      if (task.parentId !== null && treeIds.has(task.parentId)) treeIds.add(task.id);
    }
    for (const id of treeIds) {
      if (!pageIds.has(id)) contextIds.add(id);
    }
  }
  return {
    tasks: page,
    ...(includeContext ? { contextTasks: ordered.filter((task) => contextIds.has(task.id)) } : {}),
    total: matching.length,
    limit,
    offset,
    workspaceRevision: revision,
  };
}

export function executeQuery(
  command: string,
  args: Record<string, unknown>,
  tasks: TaskProjection[],
  revision: number,
): Record<string, unknown> {
  if (command === "task.list") return listTasks(tasks, args, revision);
  if (command === "task.get") {
    assertArgs(args, ["id"]);
    if (typeof args.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(args.id)) invalidFilter("id");
    const task = tasks.find((task) => task.id === args.id);
    if (!task) throw new CommandError("TASK_NOT_FOUND", "task was not found");
    return { task };
  }
  assertArgs(args, []);
  const counts = new Map<string, number>();
  for (const task of tasks) {
    if (task.status === "canceled") continue;
    const slugs =
      command === "category.list" ? (task.category === null ? [] : [task.category]) : task.tags;
    for (const slug of slugs) counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  const entries = [...counts]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([slug, taskCount]) => ({ slug, taskCount }));
  return command === "category.list" ? { categories: entries } : { tags: entries };
}
