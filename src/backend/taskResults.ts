import { isV2Record } from "./protocol.js";
import type { V2TaskProjection } from "./queries.js";
import { validateV2Task } from "./taskModel.js";

export type V2TaskExecutionResult =
  | { task: V2TaskProjection; changed: false; operationId?: never }
  | { task: V2TaskProjection; changed: true; operationId: string };
export type V2TaskPreviewResult = {
  task: V2TaskProjection; changed: boolean; readOnly: boolean; dryRun: boolean; operationId?: never;
};
export type V2TaskEditResult = V2TaskExecutionResult | V2TaskPreviewResult;

function invalidTaskResult(): never {
  throw new Error("v2 backend returned invalid task data; retain the original request; no v1 fallback");
}

export function parseV2TaskProjection(value: unknown): V2TaskProjection {
  if (!isV2Record(value)) invalidTaskResult();
  const { version, blockedByIds, ...fields } = value;
  if (typeof fields.id !== "string" || typeof version !== "number" || !Number.isSafeInteger(version) || version < 1
    || !Array.isArray(blockedByIds)) invalidTaskResult();
  const task = validateV2Task(fields, fields.id);
  if (!blockedByIds.every((id, index) => typeof id === "string" && task.dependencyIds.includes(id)
    && (index === 0 || blockedByIds[index - 1] < id))) invalidTaskResult();
  return { ...task, version, blockedByIds };
}

export function parseV2TaskEditResult(value: unknown, mode: "execution"): V2TaskExecutionResult;
export function parseV2TaskEditResult(value: unknown, mode: "preview"): V2TaskPreviewResult;
export function parseV2TaskEditResult(value: unknown, mode: "execution" | "preview"): V2TaskEditResult {
  if (!isV2Record(value) || typeof value.changed !== "boolean") invalidTaskResult();
  const task = parseV2TaskProjection(value.task);
  if (mode === "preview") {
    if (typeof value.readOnly !== "boolean" || typeof value.dryRun !== "boolean"
      || (!value.readOnly && !value.dryRun) || value.operationId !== undefined) invalidTaskResult();
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
