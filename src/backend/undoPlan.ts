import { canonicalJson } from "./canonicalJson.js";
import { CommandError } from "./errors.js";
import { assertArgs, isRecord } from "./protocol.js";
import { applyStatus, STATUS_COMMANDS } from "./taskStatus.js";
import { compareTasks, isOrderKey, validateGraph, validateTask, GraphError } from "./taskModel.js";
import type { CanonicalTask } from "./taskModel.js";
import { parseTaskVersion } from "./updateInputs.js";

const statusCommands: readonly string[] = STATUS_COMMANDS;
export const UNDO_COMMANDS = ["task.status.undo", "task.status.undoMany", "task.transitionMany", "operation.undo"];
type Reference = { id: string; expectedVersion: number; command?: string };
export type UndoInput = { kind: "operation"; operationId: string } | { kind: "status" | "transition"; tasks: Reference[] };
export type HistorySource = { id: string; command: string; before: unknown; after: unknown };
export type UndoClaim = { operationId: string; taskId: string };
export type UndoPlan = { selectedIds: string[]; affectedIds: string[]; tasks: CanonicalTask[]; claims: UndoClaim[]; removedIds: string[] };
type HistoryScope = { parentId: string | null; tasks: { id: string; orderKey: string }[] };
function unavailable(status = false): never { throw new CommandError(status ? "UNDO_UNAVAILABLE" : "OPERATION_UNAVAILABLE", "eligible retained undo history or its postconditions are unavailable"); }

export function parseUndo(command: string, args: Record<string, unknown>): UndoInput {
  if (command === "operation.undo") {
    assertArgs(args, ["operationId"]);
    if (typeof args.operationId !== "string" || args.operationId === "") throw new CommandError("INVALID_ARGUMENT", "operationId is required");
    return { kind: "operation", operationId: args.operationId };
  }
  if (command === "task.status.undo") {
    assertArgs(args, ["id", "expectedVersion"]);
    return { kind: "status", tasks: [parseTaskVersion(args)] };
  }
  assertArgs(args, ["tasks"]);
  if (!Array.isArray(args.tasks)) throw new CommandError("INVALID_ARGUMENT", "versioned task list is required");
  const transition = command === "task.transitionMany";
  if (!transition && command !== "task.status.undoMany") throw new CommandError("UNSUPPORTED_COMMAND", "undo command is unavailable");
  const tasks = args.tasks.map(value => {
    if (!isRecord(value)) throw new CommandError("INVALID_ARGUMENT", "invalid batch task reference");
    assertArgs(value, transition ? ["id", "expectedVersion", "command"] : ["id", "expectedVersion"]);
    const reference = parseTaskVersion(value);
    if (transition && (typeof value.command !== "string" || !statusCommands.includes(value.command))) throw new CommandError("INVALID_ARGUMENT", "batch needs an allowed status command");
    return { ...reference, ...(transition ? { command: value.command as string } : {}) };
  });
  if (new Set(tasks.map(task => task.id)).size !== tasks.length) throw new CommandError("INVALID_ARGUMENT", "batch task IDs must be unique");
  return { kind: transition ? "transition" : "status", tasks };
}

export function historyTasks(value: unknown): CanonicalTask[] {
  if (value === null) return [];
  const values = isRecord(value) && Array.isArray(value.tasks) ? value.tasks : [value];
  const tasks = values.map(task => {
    if (!isRecord(task) || typeof task.id !== "string") unavailable();
    return validateTask(task, task.id);
  });
  if (new Set(tasks.map(task => task.id)).size !== tasks.length) unavailable();
  return tasks;
}
function historyScopes(value: unknown): HistoryScope[] {
  if (!isRecord(value) || !Array.isArray(value.scope) || (value.parentId !== null && (typeof value.parentId !== "string" || !/^[A-Za-z0-9_-]+$/.test(value.parentId)))) unavailable();
  const pairs = value.scope.map(pair => {
    if (!isRecord(pair) || typeof pair.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(pair.id) || !isOrderKey(pair.orderKey)) unavailable();
    return { id: pair.id, orderKey: pair.orderKey as string };
  });
  if (new Set(pairs.map(pair => pair.id)).size !== pairs.length || pairs.some((pair, index) => index > 0 && (pairs[index - 1].orderKey > pair.orderKey || (pairs[index - 1].orderKey === pair.orderKey && pairs[index - 1].id >= pair.id)))) unavailable();
  if (historyTasks(value).some(task => task.parentId !== value.parentId || !pairs.some(pair => pair.id === task.id && pair.orderKey === task.orderKey))) unavailable();
  return [{ parentId: value.parentId as string | null, tasks: pairs }];
}
export function historyAffected(source: HistorySource): string[] {
  return [...new Set([...historyTasks(source.before), ...historyTasks(source.after)].map(task => task.id))];
}
function planHistoryTasks(value: unknown, statusOnly: boolean): CanonicalTask[] {
  try { return historyTasks(value); }
  catch (error) {
    if (statusOnly && error instanceof CommandError) unavailable(true);
    throw error;
  }
}
function prospectiveGraph(tasks: CanonicalTask[]): void {
  const ids = new Set(tasks.map(task => task.id));
  if (tasks.some(task => (task.parentId !== null && !ids.has(task.parentId)) || task.dependencyIds.some(id => !ids.has(id)))) unavailable();
  for (const task of tasks) validateTask(task, task.id);
  try { validateGraph(tasks); }
  catch (error) {
    if (!(error instanceof GraphError)) throw error;
    throw new CommandError(error.relation === "parentId" ? "PARENT_CYCLE" : "DEPENDENCY_CYCLE", "prospective undo graph has a cycle");
  }
}

function restoreTaskFields(current: CanonicalTask, historic: { before: CanonicalTask; after: CanonicalTask }, at: string): CanonicalTask {
  const patch: Partial<CanonicalTask> = {};
  let editsTime = false;
  for (const key of Object.keys(historic.before) as (keyof CanonicalTask)[]) {
    if (["id", "createdAt", "updatedAt"].includes(key) || canonicalJson(historic.before[key]) === canonicalJson(historic.after[key])) continue;
    if (canonicalJson(current[key]) !== canonicalJson(historic.after[key])) unavailable();
    Object.assign(patch, { [key]: historic.before[key] });
    if (!["status", "closedAt", "orderKey"].includes(key)) editsTime = true;
  }
  return { ...current, ...patch, ...(editsTime ? { updatedAt: at } : {}) };
}

export function planUndo(input: UndoInput, tasks: CanonicalTask[], at: string, sources: HistorySource[]): UndoPlan {
  const next = new Map(tasks.map(task => [task.id, task]));
  const affected = new Set<string>();
  const claims: UndoClaim[] = [];
  if (input.kind === "transition") {
    if (sources.length) unavailable();
    for (const reference of input.tasks) {
      const old = next.get(reference.id);
      if (!old) throw new CommandError("TASK_NOT_FOUND", "batch task was not found");
      const effect = applyStatus(old, reference.command!, at);
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
      if (!statusOnly && ![...STATUS_COMMANDS, "task.create", "task.update", "task.move", "task.dependency.add", "task.dependency.remove", "task.reorder", "task.order.normalize", "task.transitionMany"].includes(source.command)) unavailable();
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
      const current = tasks.filter(task => task.parentId === scope.parentId).sort(compareTasks).map(({ id, orderKey }) => ({ id, orderKey }));
      if (canonicalJson(current) !== canonicalJson(scope.tasks)) unavailable();
    }
    for (const scope of historyScopes(source.before)) {
      const restored = result.filter(task => task.parentId === scope.parentId).sort(compareTasks).map(({ id, orderKey }) => ({ id, orderKey }));
      if (canonicalJson(restored) !== canonicalJson(scope.tasks)) unavailable();
    }
  }
  return { tasks: result, selectedIds: input.kind === "operation" ? historyAffected(sources[0]) : input.tasks.map(task => task.id), affectedIds: [...affected], claims, removedIds: tasks.filter(task => !next.has(task.id)).map(task => task.id) };
}
