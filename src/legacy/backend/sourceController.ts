import { randomUUID } from "node:crypto";
import { withCanonicalRootPath } from "./canonicalWorkspace.js";
import { CommandError } from "../../backend/errors.js";
import type { ProtocolRequest, TaskRecord, TaskRef } from "./protocol.js";
import type { TaskDbV1Source, TaskSourceRegistry } from "./sourceRegistry.js";

type SingleWorkspaceExecutor = (request: ProtocolRequest, databasePath: string) => Record<string, unknown>;
type ResolvedSource = TaskDbV1Source & { workspaceId: string; info: Record<string, unknown> };
type ListedTask = { sourceKey: string; task: TaskRecord; sourceOrder: number };

const TASK_CAPABILITIES = {
  list: true,
  get: true,
  create: true,
  update: true,
  complete: true,
  reopen: true,
  start: true,
  pause: true,
  cancel: true,
  parent: true,
  dependencies: true,
  reorder: false,
};

const TARGETED_COMMANDS = new Set<ProtocolRequest["command"]>([
  "task.get",
  "task.update",
  "task.delete",
  "task.start",
  "task.pause",
  "task.complete",
  "task.reopen",
  "task.cancel",
  "task.status.undo",
  "task.move",
  "task.dependency.add",
  "task.dependency.remove",
]);

function internalRequest(command: ProtocolRequest["command"], args: Record<string, unknown> = {}): ProtocolRequest {
  return {
    version: 1,
    requestId: randomUUID(),
    command,
    args,
    actor: { kind: "system", label: "source-controller" },
  };
}

function executeSource(
  request: ProtocolRequest,
  source: TaskDbV1Source,
  executeSingle: SingleWorkspaceExecutor,
): Record<string, unknown> {
  return withCanonicalRootPath(source.databasePath, source.syncRoot, () => executeSingle(request, source.databasePath));
}

function resolveSources(registry: TaskSourceRegistry, executeSingle: SingleWorkspaceExecutor): ResolvedSource[] {
  const mounted = new Map<string, string>();
  return registry.sources.map((source) => {
    const info = executeSource(internalRequest("workspace.info"), source, executeSingle);
    const workspaceId = info.workspaceId;
    if (typeof workspaceId !== "string" || workspaceId.trim() === "") {
      throw new CommandError("INVALID_STORAGE", `source ${source.key} did not report a workspace identity`);
    }
    const previousKey = mounted.get(workspaceId);
    if (previousKey !== undefined) {
      throw new CommandError("DUPLICATE_SOURCE_MOUNT", `sources ${previousKey} and ${source.key} mount the same workspace`);
    }
    mounted.set(workspaceId, source.key);
    return { ...source, workspaceId, info };
  });
}

function sourceNotFound(sourceKey: string): never {
  throw new CommandError("SOURCE_NOT_FOUND", `source ${sourceKey} is not registered`);
}

function sourceForKey(sources: ResolvedSource[], sourceKey: string): ResolvedSource {
  const source = sources.find((candidate) => candidate.key === sourceKey);
  return source ?? sourceNotFound(sourceKey);
}

function listSources(sources: ResolvedSource[]): Record<string, unknown> {
  return {
    sources: sources.map((source) => ({
      key: source.key,
      label: source.label,
      capabilities: { task: { ...TASK_CAPABILITIES } },
    })),
  };
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CommandError("INVALID_ARGUMENT", `${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CommandError("INVALID_ARGUMENT", `${field} must be a non-empty string`);
  }
  return value;
}

function taskRef(value: unknown): TaskRef {
  const ref = asRecord(value, "ref");
  return {
    sourceKey: nonEmptyString(ref.sourceKey, "ref.sourceKey"),
    taskId: nonEmptyString(ref.taskId, "ref.taskId"),
  };
}

function targetForRequest(request: ProtocolRequest, sources: ResolvedSource[]): { source: ResolvedSource; ref: TaskRef } {
  const args = request.args;
  const ref = args.ref === undefined
    ? undefined
    : taskRef(args.ref);
  const explicitSourceKey = args.sourceKey === undefined ? undefined : nonEmptyString(args.sourceKey, "sourceKey");
  const sourceKey = ref?.sourceKey ?? explicitSourceKey;
  const taskId = ref?.taskId ?? (typeof args.id === "string" ? args.id : undefined);
  if (ref !== undefined && typeof args.id === "string" && args.id !== ref.taskId) {
    throw new CommandError("INVALID_ARGUMENT", "id must match ref.taskId when both are provided");
  }
  if (ref !== undefined && explicitSourceKey !== undefined && explicitSourceKey !== ref.sourceKey) {
    throw new CommandError("INVALID_ARGUMENT", "sourceKey must match ref.sourceKey when both are provided");
  }
  if (taskId === undefined || taskId.trim() === "") {
    throw new CommandError("INVALID_ARGUMENT", `${request.command} requires ref.taskId`);
  }
  if (sourceKey === undefined) {
    if (sources.length !== 1) throw new CommandError("SOURCE_REQUIRED", `${request.command} requires a TaskRef in a multi-source workspace`);
    return { source: sources[0]!, ref: { sourceKey: sources[0]!.key, taskId } };
  }
  const source = sourceForKey(sources, sourceKey);
  return { source, ref: { sourceKey, taskId } };
}

function annotateTask(value: unknown, sourceKey: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const task = value as Record<string, unknown>;
  if (typeof task.id !== "string") return value;
  return { ...task, ref: { sourceKey, taskId: task.id } satisfies TaskRef };
}

function annotateResult(value: Record<string, unknown>, sourceKey: string): Record<string, unknown> {
  const result = { ...value };
  if (result.task !== undefined) result.task = annotateTask(result.task, sourceKey);
  if (Array.isArray(result.tasks)) result.tasks = result.tasks.map((task) => annotateTask(task, sourceKey));
  return result;
}

function categoryArgs(value: unknown, args: Record<string, unknown>): Record<string, unknown> {
  const result = { ...args };
  const categoryIsNull = args.categoryIsNull;
  if (categoryIsNull !== undefined && typeof categoryIsNull !== "boolean") {
    throw new CommandError("INVALID_ARGUMENT", "categoryIsNull must be a boolean");
  }
  if (categoryIsNull === true && value !== undefined) {
    throw new CommandError("INVALID_ARGUMENT", "categoryIsNull cannot be combined with category");
  }
  delete result.sourceKeys;
  delete result.sourceKey;
  delete result.categoryIsNull;
  if (value === undefined) {
    delete result.category;
    if (categoryIsNull === true) result.categoryIsNull = true;
    return result;
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value) && (value as Record<string, unknown>).kind === "all") {
    delete result.category;
    return result;
  }
  if (typeof value === "string") {
    result.category = value;
    return result;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CommandError("INVALID_ARGUMENT", "category must be a slug or a category selection object");
  }
  const selection = value as Record<string, unknown>;
  if (selection.kind === "slug") {
    result.category = nonEmptyString(selection.slug, "category.slug");
    return result;
  }
  if (selection.kind === "uncategorized") {
    delete result.category;
    result.categoryIsNull = true;
    return result;
  }
  throw new CommandError("INVALID_ARGUMENT", "category.kind must be all, slug, or uncategorized");
}

function selectedSources(request: ProtocolRequest, sources: ResolvedSource[]): ResolvedSource[] {
  const sourceKeys = request.args.sourceKeys;
  const sourceKey = request.args.sourceKey;
  if (sourceKeys === undefined) {
    return sourceKey === undefined ? sources : [sourceForKey(sources, nonEmptyString(sourceKey, "sourceKey"))];
  }
  if (sourceKey !== undefined) throw new CommandError("INVALID_ARGUMENT", "sourceKey cannot be combined with sourceKeys");
  if (!Array.isArray(sourceKeys) || sourceKeys.length === 0 || sourceKeys.some((key) => typeof key !== "string" || key.trim() === "")) {
    throw new CommandError("INVALID_ARGUMENT", "sourceKeys must be a non-empty array of source keys");
  }
  const keys = sourceKeys as string[];
  if (new Set(keys).size !== keys.length) {
    throw new CommandError("INVALID_ARGUMENT", "sourceKeys must not contain duplicates");
  }
  return keys.map((key) => sourceForKey(sources, key));
}

function integerArgument(args: Record<string, unknown>, name: string, fallback: number): number {
  const value = args[name];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new CommandError("INVALID_ARGUMENT", `${name} must be a safe integer`);
  }
  return value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function orderTasks(entries: ListedTask[], sort: unknown, direction: unknown): ListedTask[] {
  const sortBy = sort ?? "created";
  const directionBy = direction ?? "desc";
  const reverse = sortBy === "manual" ? false : sortBy === "priority" ? directionBy === "asc" : directionBy === "desc";
  return entries.sort((left, right) => {
    if (sortBy === "manual") {
      return compareText(left.sourceKey, right.sourceKey)
        || left.sourceOrder - right.sourceOrder
        || compareText(left.task.id, right.task.id);
    }
    let comparison = 0;
    if (sortBy === "priority") comparison = left.task.priority - right.task.priority;
    else if (sortBy === "updated") comparison = compareText(left.task.updatedAt, right.task.updatedAt);
    else comparison = compareText(left.task.createdAt, right.task.createdAt);
    if (comparison !== 0) return reverse ? -comparison : comparison;
    return compareText(left.sourceKey, right.sourceKey) || compareText(left.task.id, right.task.id);
  });
}

function listTasks(
  request: ProtocolRequest,
  sources: ResolvedSource[],
  executeSingle: SingleWorkspaceExecutor,
): Record<string, unknown> {
  const selected = selectedSources(request, sources);
  const limit = integerArgument(request.args, "limit", 50);
  const offset = integerArgument(request.args, "offset", 0);
  if (limit < 1 || limit > 100) throw new CommandError("INVALID_ARGUMENT", "limit must be between 1 and 100");
  if (offset < 0) throw new CommandError("INVALID_ARGUMENT", "offset must be a nonnegative integer");
  const wantedCount = offset + limit;
  if (!Number.isSafeInteger(wantedCount)) throw new CommandError("INVALID_ARGUMENT", "offset plus limit is too large");
  const baseArgs = categoryArgs(request.args.category, request.args);
  delete baseArgs.limit;
  delete baseArgs.offset;

  const entries: ListedTask[] = [];
  const contextTasks = new Map<string, TaskRecord>();
  let total = 0;
  let workspaceRevision = 0;

  for (const source of selected) {
    let sourceOffset = 0;
    let sourceTotal = 0;
    let sourceRevision = 0;
    while (sourceOffset < wantedCount && (sourceOffset === 0 || sourceOffset < sourceTotal)) {
      const pageLimit = Math.min(100, wantedCount - sourceOffset);
      const pageRequest: ProtocolRequest = {
        ...request,
        args: { ...baseArgs, limit: pageLimit, offset: sourceOffset },
      };
      const page = executeSource(pageRequest, source, executeSingle);
      const tasks = Array.isArray(page.tasks) ? page.tasks as TaskRecord[] : [];
      if (sourceOffset === 0) {
        sourceTotal = typeof page.total === "number" ? page.total : 0;
        sourceRevision = typeof page.workspaceRevision === "number" ? page.workspaceRevision : 0;
      }
      tasks.forEach((task, index) => {
        entries.push({
          sourceKey: source.key,
          task: { ...task, ref: { sourceKey: source.key, taskId: task.id } },
          sourceOrder: sourceOffset + index,
        });
      });
      if (Array.isArray(page.contextTasks)) {
        for (const contextTask of page.contextTasks as TaskRecord[]) {
          contextTasks.set(`${source.key}\0${contextTask.id}`, {
            ...contextTask,
            ref: { sourceKey: source.key, taskId: contextTask.id },
          });
        }
      }
      if (tasks.length === 0) break;
      sourceOffset += tasks.length;
    }
    total += sourceTotal;
    workspaceRevision += sourceRevision;
  }

  const sorted = orderTasks(entries, request.args.sort, request.args.direction);
  return {
    tasks: sorted.slice(offset, offset + limit).map((entry) => entry.task),
    contextTasks: [...contextTasks.values()],
    total,
    limit,
    offset,
    workspaceRevision,
  };
}

function createTask(
  request: ProtocolRequest,
  registry: TaskSourceRegistry,
  sources: ResolvedSource[],
  executeSingle: SingleWorkspaceExecutor,
): Record<string, unknown> {
  const requestedKey = request.args.sourceKey;
  const sourceKey = requestedKey === undefined ? registry.defaultSourceKey : nonEmptyString(requestedKey, "sourceKey");
  if (sourceKey === undefined) throw new CommandError("SOURCE_REQUIRED", "task.create requires sourceKey when no default source is configured");
  const source = sourceForKey(sources, sourceKey);
  const { sourceKey: _sourceKey, ...args } = request.args;
  const result = executeSource({ ...request, args }, source, executeSingle);
  return annotateResult(result, source.key);
}

function runTargetedCommand(
  request: ProtocolRequest,
  sources: ResolvedSource[],
  executeSingle: SingleWorkspaceExecutor,
): Record<string, unknown> {
  const { source, ref } = targetForRequest(request, sources);
  const { ref: _ref, sourceKey: _sourceKey, ...args } = request.args;
  const result = executeSource({ ...request, args: { ...args, id: ref.taskId } }, source, executeSingle);
  return annotateResult(result, source.key);
}

function workspaceInfo(request: ProtocolRequest, registry: TaskSourceRegistry, sources: ResolvedSource[]): Record<string, unknown> {
  const selected = selectedSources(request, sources);
  const primarySource = selected.length === sources.length
    ? sources.find((source) => source.key === registry.defaultSourceKey) ?? sources[0]!
    : selected[0]!;
  return {
    databasePath: primarySource.databasePath,
    sourceRegistryPath: registry.path,
    primarySourceKey: primarySource.key,
    ...(selected.length === 1 ? { workspaceId: primarySource.workspaceId } : {}),
    sourceCount: selected.length,
    taskCount: selected.reduce((sum, source) => sum + Number(source.info.taskCount ?? 0), 0),
    canceledTaskCount: selected.reduce((sum, source) => sum + Number(source.info.canceledTaskCount ?? 0), 0),
    workspaceRevision: selected.reduce((sum, source) => sum + Number(source.info.workspaceRevision ?? 0), 0),
  };
}

function listClassifications(
  request: ProtocolRequest,
  sources: ResolvedSource[],
  executeSingle: SingleWorkspaceExecutor,
): Record<string, unknown> {
  const field = request.command === "category.list" ? "categories" : "tags";
  const entries = new Map<string, { slug: string; label: string; taskCount: number }>();
  for (const source of selectedSources(request, sources)) {
    const result = executeSource(request, source, executeSingle);
    const values = result[field];
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      const item = asRecord(value, `${field}[]`);
      const slug = nonEmptyString(item.slug, `${field}[].slug`);
      const label = nonEmptyString(item.label, `${field}[].label`);
      const taskCount = typeof item.taskCount === "number" ? item.taskCount : 0;
      const existing = entries.get(slug);
      if (existing) existing.taskCount += taskCount;
      else entries.set(slug, { slug, label, taskCount });
    }
  }
  const values = [...entries.values()].sort((left, right) => compareText(left.label.toLowerCase(), right.label.toLowerCase()) || compareText(left.slug, right.slug));
  return { [field]: values };
}

function syncSources(
  request: ProtocolRequest,
  sources: ResolvedSource[],
  executeSingle: SingleWorkspaceExecutor,
): Record<string, unknown> {
  const results: Array<Record<string, unknown>> = selectedSources(request, sources).map((source) => ({ sourceKey: source.key, ...executeSource(request, source, executeSingle) }));
  const sum = (field: string): number => results.reduce((total, result) => total + Number(result[field] ?? 0), 0);
  const lastSync = results.map((result) => result["lastSync"]).filter((value): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value));
  return {
    sources: results,
    taskFileCount: sum("taskFileCount"),
    orderFileCount: sum("orderFileCount"),
    unresolvedConflictCount: sum("unresolvedConflictCount"),
    cacheGeneration: sum("cacheGeneration"),
    lastSync: {
      tasks: lastSync.reduce((total, result) => total + Number(result.tasks ?? 0), 0),
      orders: lastSync.reduce((total, result) => total + Number(result.orders ?? 0), 0),
      conflicts: lastSync.reduce((total, result) => total + Number(result.conflicts ?? 0), 0),
      skipped: lastSync.reduce((total, result) => total + Number(result.skipped ?? 0), 0),
      bootstrapped: lastSync.some((result) => result.bootstrapped === true),
    },
  };
}

export function executeSourceRegistryCommand(
  request: ProtocolRequest,
  registry: TaskSourceRegistry,
  executeSingle: SingleWorkspaceExecutor,
): Record<string, unknown> {
  const sources = resolveSources(registry, executeSingle);
  if (request.command === "source.list") return listSources(selectedSources(request, sources));
  if (request.command === "workspace.info") return workspaceInfo(request, registry, sources);
  if (request.command === "task.list") return listTasks(request, sources, executeSingle);
  if (request.command === "category.list" || request.command === "tag.list") return listClassifications(request, sources, executeSingle);
  if (request.command === "workspace.sync") return syncSources(request, sources, executeSingle);
  if (request.command === "task.create") return createTask(request, registry, sources, executeSingle);
  if (TARGETED_COMMANDS.has(request.command)) return runTargetedCommand(request, sources, executeSingle);

  if (typeof request.args.sourceKey === "string") {
    const source = sourceForKey(sources, request.args.sourceKey);
    const { sourceKey: _sourceKey, ...args } = request.args;
    return { ...executeSource({ ...request, args }, source, executeSingle), sourceKey: source.key };
  }
  if (sources.length === 1) return executeSource(request, sources[0]!, executeSingle);

  throw new CommandError("CAPABILITY_UNSUPPORTED", `${request.command} is not available across multiple registered sources`);
}
