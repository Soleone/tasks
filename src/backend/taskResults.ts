import { isRecord } from "./protocol.js";
import type { TaskProjection } from "./queries.js";
import { validateTask } from "./taskModel.js";

export type TaskExecutionResult =
  | { task: TaskProjection; changed: false; operationId?: never }
  | { task: TaskProjection; changed: true; operationId: string };
export type TaskPreviewResult = {
  task: TaskProjection;
  changed: boolean;
  readOnly: boolean;
  dryRun: boolean;
  operationId?: never;
};
export type TaskEditResult = TaskExecutionResult | TaskPreviewResult;

function invalidTaskResult(): never {
  throw new Error("The backend returned invalid task data; retain the original request");
}

export function parseTaskProjection(value: unknown): TaskProjection {
  if (!isRecord(value)) invalidTaskResult();
  const { version, blockedByIds, ...fields } = value;
  if (
    typeof fields.id !== "string" ||
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    !Array.isArray(blockedByIds)
  )
    invalidTaskResult();
  const task = validateTask(fields, fields.id);
  if (
    !blockedByIds.every(
      (id, index) =>
        typeof id === "string" &&
        task.dependencyIds.includes(id) &&
        (index === 0 || blockedByIds[index - 1] < id),
    )
  )
    invalidTaskResult();
  return { ...task, attachments: task.attachments ?? [], version, blockedByIds };
}

export function parseTaskEditResult(value: unknown, mode: "execution"): TaskExecutionResult;
export function parseTaskEditResult(value: unknown, mode: "preview"): TaskPreviewResult;
export function parseTaskEditResult(value: unknown, mode: "execution" | "preview"): TaskEditResult {
  if (!isRecord(value) || typeof value.changed !== "boolean") invalidTaskResult();
  const task = parseTaskProjection(value.task);
  if (mode === "preview") {
    if (
      typeof value.readOnly !== "boolean" ||
      typeof value.dryRun !== "boolean" ||
      (!value.readOnly && !value.dryRun) ||
      value.operationId !== undefined
    )
      invalidTaskResult();
    return { task, changed: value.changed, readOnly: value.readOnly, dryRun: value.dryRun };
  }
  if (value.readOnly !== undefined || value.dryRun !== undefined) invalidTaskResult();
  if (!value.changed) {
    if (value.operationId !== undefined) invalidTaskResult();
    return { task, changed: false };
  }
  if (typeof value.operationId !== "string" || !value.operationId) invalidTaskResult();
  return { task, changed: true, operationId: value.operationId };
}
