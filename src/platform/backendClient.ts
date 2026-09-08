import {
  PROTOCOL_VERSION,
  parseRuntimeProbeResult,
  type ActivityRecord,
  type ProtocolRequest,
  type RuntimeProbeResult,
  type TaskRecord,
} from "../backend/protocol";
import { getBackendTransport } from "./backendTransport";

export type ProbeResult = RuntimeProbeResult;
export type TaskListResult = { tasks: TaskRecord[]; total: number; limit: number; offset: number };
export type ActivityListResult = { activity: ActivityRecord[]; limit: number };

export type CommandOptions = {
  idempotencyKey?: string;
  readOnly?: boolean;
  dryRun?: boolean;
};

export type TaskMutationResult = {
  task: TaskRecord;
  changed?: boolean;
  dryRun?: boolean;
  readOnly?: boolean;
};

export class BackendCommandError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BackendCommandError";
    this.code = code;
  }
}

export async function runBackendCommand<T extends Record<string, unknown>>(
  command: ProtocolRequest["command"],
  args: Record<string, unknown> = {},
  options: CommandOptions = {},
): Promise<T> {
  const response = await getBackendTransport().request({
    version: PROTOCOL_VERSION,
    requestId: crypto.randomUUID(),
    command,
    args,
    actor: { kind: "human", label: "desktop" },
    ...options,
  });

  if (!response.ok) {
    throw new BackendCommandError(response.error.code, response.error.message);
  }

  return response.result as T;
}

export async function runRuntimeProbe(): Promise<ProbeResult> {
  const result = await runBackendCommand<Record<string, unknown>>("runtime.probe");
  return parseRuntimeProbeResult(result);
}

export async function listTasks(status?: string, offset = 0): Promise<TaskListResult> {
  return runBackendCommand<TaskListResult>("task.list", { ...(status ? { status } : {}), offset });
}

export async function getTask(id: string): Promise<{ task: TaskRecord }> {
  return runBackendCommand<{ task: TaskRecord }>("task.get", { id });
}

export async function createTask(title: string, descriptionMarkdown: string, options: CommandOptions): Promise<TaskMutationResult> {
  return runBackendCommand<TaskMutationResult>("task.create", { title, descriptionMarkdown }, options);
}

export async function updateTask(
  id: string,
  title: string,
  descriptionMarkdown: string,
  expectedVersion: number,
  options: CommandOptions,
): Promise<TaskMutationResult> {
  return runBackendCommand<TaskMutationResult>(
    "task.update",
    { id, title, descriptionMarkdown, expectedVersion },
    options,
  );
}

export async function deleteTask(id: string, expectedVersion: number, options: CommandOptions): Promise<{ id: string; deleted: boolean }> {
  return runBackendCommand("task.delete", { id, expectedVersion }, options);
}

export async function transitionTask(
  command: "task.start" | "task.complete" | "task.reopen" | "task.cancel",
  id: string,
  expectedVersion: number,
  options: CommandOptions,
): Promise<TaskMutationResult> {
  return runBackendCommand<TaskMutationResult>(command, { id, expectedVersion }, options);
}

export async function listActivity(taskId?: string): Promise<ActivityListResult> {
  return runBackendCommand<ActivityListResult>("activity.list", taskId ? { taskId } : {});
}

export async function closeBackendSession(): Promise<void> {
  await getBackendTransport().close();
}
