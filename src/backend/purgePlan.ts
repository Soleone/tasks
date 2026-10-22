import { CommandError } from "./errors.js";
import { assertArgs } from "./protocol.js";
import type { Request } from "./protocol.js";
import { isTimestamp, validateGraph } from "./taskModel.js";
import type { CanonicalTask } from "./taskModel.js";

export type PurgeReference = {
  taskId: string;
  targetId: string;
  field: "parentId" | "dependencyIds";
};
export class PurgeReferencedError extends CommandError {
  readonly details: { references: PurgeReference[] };
  constructor(references: PurgeReference[]) {
    super("PURGE_REFERENCED", "surviving task references prevent the complete canceled-task purge");
    this.details = { references };
  }
}

function planPurge(tasks: readonly CanonicalTask[]): string[] {
  validateGraph(tasks);
  const purgedIds = tasks
    .filter((task) => task.status === "canceled")
    .map((task) => task.id)
    .sort();
  const removed = new Set(purgedIds);
  const references: PurgeReference[] = [];
  for (const task of [...tasks].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  )) {
    if (removed.has(task.id)) continue;
    if (task.parentId !== null && removed.has(task.parentId))
      references.push({ taskId: task.id, targetId: task.parentId, field: "parentId" });
    for (const id of task.dependencyIds)
      if (removed.has(id))
        references.push({ taskId: task.id, targetId: id, field: "dependencyIds" });
  }
  if (references.length) throw new PurgeReferencedError(references);
  return purgedIds;
}

type ClearScope = "attachments" | "tasks";
export type ClearDoneInput = { closedBefore: string | null; scope: ClearScope; export: boolean };

export function parseClearDone(args: Record<string, unknown>): ClearDoneInput {
  assertArgs(args, ["closedBefore", "scope", "export"]);
  if (args.closedBefore !== null && !isTimestamp(args.closedBefore))
    throw new CommandError("INVALID_ARGUMENT", "closedBefore must be a timestamp or null");
  if (args.scope !== "attachments" && args.scope !== "tasks")
    throw new CommandError("INVALID_ARGUMENT", "scope must be attachments or tasks");
  if (args.export !== undefined && args.export !== true)
    throw new CommandError("INVALID_ARGUMENT", "export must be true when given");
  return { closedBefore: args.closedBefore, scope: args.scope, export: args.export === true };
}

/**
 * What a removal changes: task files it deletes, tasks that lose their attachments, and
 * selected tasks kept because a remaining task links to them.
 */
export type RemovalPlan = { purgedIds: string[]; strippedIds: string[]; keptIds: string[] };

function planClearDone(tasks: readonly CanonicalTask[], input: ClearDoneInput): RemovalPlan {
  validateGraph(tasks);
  const selected = new Set(
    tasks
      .filter(
        (task) =>
          task.status === "done" &&
          (input.closedBefore === null || task.closedAt! < input.closedBefore),
      )
      .map((task) => task.id),
  );
  if (input.scope === "attachments")
    return {
      purgedIds: [],
      strippedIds: tasks
        .filter((task) => selected.has(task.id) && task.attachments)
        .map((task) => task.id)
        .sort(),
      keptIds: [],
    };
  const kept = new Set<string>();
  for (let changed = true; changed;) {
    changed = false;
    for (const task of tasks) {
      if (selected.has(task.id)) continue;
      for (const id of [task.parentId, ...task.dependencyIds])
        if (id !== null && selected.delete(id)) {
          kept.add(id);
          changed = true;
        }
    }
  }
  return { purgedIds: [...selected].sort(), strippedIds: [], keptIds: [...kept].sort() };
}

export function planRemoval(request: Request, tasks: readonly CanonicalTask[]): RemovalPlan {
  if (request.command === "task.clearDone")
    return planClearDone(tasks, parseClearDone(request.args));
  assertArgs(request.args, []);
  return { purgedIds: planPurge(tasks), strippedIds: [], keptIds: [] };
}

/** The tasks left once the plan applies: purged ones gone, stripped ones without attachments. */
export function remainingTasks(
  tasks: readonly CanonicalTask[],
  plan: RemovalPlan,
): CanonicalTask[] {
  return tasks
    .filter((task) => !plan.purgedIds.includes(task.id))
    .map((task) => (plan.strippedIds.includes(task.id) ? strippedTask(task) : task));
}

export function strippedTask(task: CanonicalTask): CanonicalTask {
  const { attachments: _, ...rest } = task;
  return rest;
}

export function listedAttachments(tasks: readonly CanonicalTask[]): Set<string> {
  return new Set(tasks.flatMap((task) => task.attachments ?? []));
}
