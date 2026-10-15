import { canonicalJson } from "./canonicalJson.js";
import { CommandError } from "./errors.js";
import { assertV2Args, isV2Record } from "./protocol.js";
import { applyV2Status, V2_STATUS_COMMANDS } from "./taskStatus.js";
import { compareV2Tasks, isV2OrderKey, validateV2Graph, validateV2Task, V2GraphError } from "./taskModel.js";
import type { V2CanonicalTask } from "./taskModel.js";
import { parseV2TaskVersion } from "./updateInputs.js";

const statusCommands: readonly string[] = V2_STATUS_COMMANDS;
export const V2_UNDO_COMMANDS = ["task.status.undo", "task.status.undoMany", "task.transitionMany", "operation.undo"];
type Reference = { id: string; expectedVersion: number; command?: string };
export type V2UndoInput = { kind: "operation"; operationId: string } | { kind: "status" | "transition"; tasks: Reference[] };
export type V2HistorySource = { id: string; command: string; before: unknown; after: unknown };
export type V2UndoClaim = { operationId: string; taskId: string };
export type V2UndoPlan = { selectedIds: string[]; affectedIds: string[]; tasks: V2CanonicalTask[]; claims: V2UndoClaim[]; removedIds: string[] };
type HistoryScope = { parentId: string | null; tasks: { id: string; orderKey: string }[] };
function unavailable(status = false): never { throw new CommandError(status ? "UNDO_UNAVAILABLE" : "OPERATION_UNAVAILABLE", "eligible retained undo history or its postconditions are unavailable"); }

export function parseV2Undo(command: string, args: Record<string, unknown>): V2UndoInput {
  if (command === "operation.undo") {
    assertV2Args(args, ["operationId"]);
    if (typeof args.operationId !== "string" || args.operationId === "") throw new CommandError("INVALID_ARGUMENT", "operationId is required");
    return { kind: "operation", operationId: args.operationId };
  }
  if (command === "task.status.undo") {
    assertV2Args(args, ["id", "expectedVersion"]);
    return { kind: "status", tasks: [parseV2TaskVersion(args)] };
  }
  assertV2Args(args, ["tasks"]);
  if (!Array.isArray(args.tasks)) throw new CommandError("INVALID_ARGUMENT", "versioned task list is required");
  const transition = command === "task.transitionMany";
  if (!transition && command !== "task.status.undoMany") throw new CommandError("UNSUPPORTED_COMMAND", "undo command is unavailable");
  const tasks = args.tasks.map(value => {
    if (!isV2Record(value)) throw new CommandError("INVALID_ARGUMENT", "invalid batch task reference");
    assertV2Args(value, transition ? ["id", "expectedVersion", "command"] : ["id", "expectedVersion"]);
    const reference = parseV2TaskVersion(value);
    if (transition && (typeof value.command !== "string" || !statusCommands.includes(value.command))) throw new CommandError("INVALID_ARGUMENT", "batch needs an allowed status command");
    return { ...reference, ...(transition ? { command: value.command as string } : {}) };
  });
  if (new Set(tasks.map(task => task.id)).size !== tasks.length) throw new CommandError("INVALID_ARGUMENT", "batch task IDs must be unique");
  return { kind: transition ? "transition" : "status", tasks };
}

export function historyTasks(value: unknown): V2CanonicalTask[] {
  if (value === null) return [];
  const values = isV2Record(value) && Array.isArray(value.tasks) ? value.tasks : [value];
  const tasks = values.map(task => {
    if (!isV2Record(task) || typeof task.id !== "string") unavailable();
    return validateV2Task(task, task.id);
  });
  if (new Set(tasks.map(task => task.id)).size !== tasks.length) unavailable();
  return tasks;
}
function historyScopes(value: unknown): HistoryScope[] {
  if (!isV2Record(value) || !Array.isArray(value.scope) || (value.parentId !== null && (typeof value.parentId !== "string" || !/^[A-Za-z0-9_-]+$/.test(value.parentId)))) unavailable();
  const pairs = value.scope.map(pair => {
    if (!isV2Record(pair) || typeof pair.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(pair.id) || !isV2OrderKey(pair.orderKey)) unavailable();
    return { id: pair.id, orderKey: pair.orderKey as string };
  });
  if (new Set(pairs.map(pair => pair.id)).size !== pairs.length || pairs.some((pair, index) => index > 0 && (pairs[index - 1].orderKey > pair.orderKey || (pairs[index - 1].orderKey === pair.orderKey && pairs[index - 1].id >= pair.id)))) unavailable();
  if (historyTasks(value).some(task => task.parentId !== value.parentId || !pairs.some(pair => pair.id === task.id && pair.orderKey === task.orderKey))) unavailable();
  return [{ parentId: value.parentId as string | null, tasks: pairs }];
}
export function historyAffected(source: V2HistorySource): string[] {
  return [...new Set([...historyTasks(source.before), ...historyTasks(source.after)].map(task => task.id))];
}
function planHistoryTasks(value: unknown, statusOnly: boolean): V2CanonicalTask[] {
  try { return historyTasks(value); }
  catch (error) {
    if (statusOnly && error instanceof CommandError) unavailable(true);
    throw error;
  }
}
function prospectiveGraph(tasks: V2CanonicalTask[]): void {
  const ids = new Set(tasks.map(task => task.id));
  if (tasks.some(task => (task.parentId !== null && !ids.has(task.parentId)) || task.dependencyIds.some(id => !ids.has(id)))) unavailable();
  for (const task of tasks) validateV2Task(task, task.id);
  try { validateV2Graph(tasks); }
  catch (error) {
    if (!(error instanceof V2GraphError)) throw error;
    throw new CommandError(error.relation === "parentId" ? "PARENT_CYCLE" : "DEPENDENCY_CYCLE", "prospective undo graph has a cycle");
  }
}

function restoreTaskFields(current: V2CanonicalTask, historic: { before: V2CanonicalTask; after: V2CanonicalTask }, at: string): V2CanonicalTask {
  const patch: Partial<V2CanonicalTask> = {};
  let editsTime = false;
  for (const key of Object.keys(historic.before) as (keyof V2CanonicalTask)[]) {
    if (["id", "createdAt", "updatedAt"].includes(key) || canonicalJson(historic.before[key]) === canonicalJson(historic.after[key])) continue;
    if (canonicalJson(current[key]) !== canonicalJson(historic.after[key])) unavailable();
    Object.assign(patch, { [key]: historic.before[key] });
    if (!["status", "closedAt", "orderKey"].includes(key)) editsTime = true;
  }
  return { ...current, ...patch, ...(editsTime ? { updatedAt: at } : {}) };
}

export function planV2Undo(input: V2UndoInput, tasks: V2CanonicalTask[], at: string, sources: V2HistorySource[]): V2UndoPlan {
  const next = new Map(tasks.map(task => [task.id, task]));
  const affected = new Set<string>();
  const claims: V2UndoClaim[] = [];
  if (input.kind === "transition") {
    if (sources.length) unavailable();
    for (const reference of input.tasks) {
      const old = next.get(reference.id);
      if (!old) throw new CommandError("TASK_NOT_FOUND", "batch task was not found");
      const effect = applyV2Status(old, reference.command!, at);
      next.set(old.id, effect.task);
      if (effect.changed) affected.add(old.id);
    }
  } else {
    if (input.kind === "operation" && (sources.length !== 1 || sources[0].id !== input.operationId)) unavailable();
    if (input.kind === "status" && sources.length !== input.tasks.length) unavailable(true);
    for (const [index, source] of sources.entries()) {
      const statusOnly = input.kind === "status";
      const before = planHistoryTasks(source.before, statusOnly), after = planHistoryTasks(source.after, statusOnly);
      if (!["task.transitionMany", "task.reorder", "task.order.normalize"].includes(source.command) && (before.length > 1 || after.length !== 1)) unavailable(statusOnly);
      const ids = statusOnly ? [input.tasks[index].id] : historyAffected(source);
      if (statusOnly && !statusCommands.includes(source.command) && source.command !== "task.transitionMany") unavailable(true);
      if (!statusOnly && ![...V2_STATUS_COMMANDS, "task.create", "task.update", "task.move", "task.dependency.add", "task.dependency.remove", "task.reorder", "task.order.normalize", "task.transitionMany"].includes(source.command)) unavailable();
      for (const id of ids) {
        const old = before.find(task => task.id === id), post = after.find(task => task.id === id), current = next.get(id);
        if (!current || !post || current.createdAt !== post.createdAt) unavailable(statusOnly);
        if (!old) {
          if (source.command !== "task.create" || canonicalJson(current) !== canonicalJson(post)) unavailable(statusOnly);
          if (tasks.some(task => task.id !== id && (task.parentId === id || task.dependencyIds.includes(id)))) unavailable();
          next.delete(id);
        } else if (statusOnly) {
          if (canonicalJson(current) !== canonicalJson(post) || old.status === post.status) unavailable(true);
          next.set(id, { ...current, status: old.status, closedAt: old.closedAt });
        } else {
          next.set(id, restoreTaskFields(current, { before: old, after: post }, at));
        }
        affected.add(id);
        claims.push({ operationId: source.id, taskId: id });
      }
    }
  }
  const result = [...next.values()];
  prospectiveGraph(result);
  // Graph validity precedes order eligibility, so a restored link cannot hide a cycle behind a scope failure.
  for (const source of sources) {
    if (!["task.reorder", "task.order.normalize"].includes(source.command)) continue;
    for (const scope of historyScopes(source.after)) {
      const current = tasks.filter(task => task.parentId === scope.parentId).sort(compareV2Tasks).map(({ id, orderKey }) => ({ id, orderKey }));
      if (canonicalJson(current) !== canonicalJson(scope.tasks)) unavailable();
    }
    for (const scope of historyScopes(source.before)) {
      const restored = result.filter(task => task.parentId === scope.parentId).sort(compareV2Tasks).map(({ id, orderKey }) => ({ id, orderKey }));
      if (canonicalJson(restored) !== canonicalJson(scope.tasks)) unavailable();
    }
  }
  return { tasks: result, selectedIds: input.kind === "operation" ? historyAffected(sources[0]) : input.tasks.map(task => task.id), affectedIds: [...affected], claims, removedIds: tasks.filter(task => !next.has(task.id)).map(task => task.id) };
}
