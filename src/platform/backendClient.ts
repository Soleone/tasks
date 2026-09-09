import {
  PROTOCOL_VERSION,
  parseRuntimeProbeResult,
  type ActivityRecord,
  type ProtocolRequest,
  type RuntimeProbeResult,
  type TaskRecord,
  type ThemeRecord,
} from "../backend/protocol";
import { getBackendTransport } from "./backendTransport";

export type ProbeResult = RuntimeProbeResult;
export type TaskListResult = { tasks: TaskRecord[]; total: number; limit: number; offset: number };
export type ActivityListResult = { activity: ActivityRecord[]; limit: number };
export type WorkspaceInfoResult = { databasePath: string; taskCount: number };
export type TasksExportResult = { databasePath: string; destinationPath: string | null; taskCount: number; exportedAt: string };
export type ThemeListResult = { themes: ThemeRecord[]; selected: string };
export type ThemeSetResult = { theme: ThemeRecord; selected: string };

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

export async function listTasks(status?: string | readonly string[], offset = 0, unblocked = false): Promise<TaskListResult> {
  return runBackendCommand<TaskListResult>("task.list", {
    ...(status !== undefined ? { status } : {}),
    ...(unblocked ? { unblocked: true } : {}),
    offset,
  });
}

export async function getTask(id: string): Promise<{ task: TaskRecord }> {
  return runBackendCommand<{ task: TaskRecord }>("task.get", { id });
}

export async function createTask(title: string, descriptionMarkdown: string, options: CommandOptions & { parentId?: string }): Promise<TaskMutationResult> {
  const { parentId, ...commandOptions } = options;
  return runBackendCommand<TaskMutationResult>("task.create", { title, descriptionMarkdown, ...(parentId ? { parentId } : {}) }, commandOptions);
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

export async function deleteTask(id: string, expectedVersion: number, options: CommandOptions): Promise<TaskMutationResult> {
  return runBackendCommand<TaskMutationResult>("task.delete", { id, expectedVersion }, options);
}

export async function transitionTask(
  command: "task.start" | "task.pause" | "task.complete" | "task.reopen" | "task.cancel",
  id: string,
  expectedVersion: number,
  options: CommandOptions,
): Promise<TaskMutationResult> {
  return runBackendCommand<TaskMutationResult>(command, { id, expectedVersion }, options);
}

export async function moveTask(id: string, parentId: string, expectedVersion: number, options: CommandOptions): Promise<TaskMutationResult> {
  return runBackendCommand<TaskMutationResult>("task.move", { id, parentId, expectedVersion }, options);
}

export async function addDependency(id: string, dependsOnId: string, expectedVersion: number, options: CommandOptions): Promise<TaskMutationResult> {
  return runBackendCommand<TaskMutationResult>("task.dependency.add", { id, dependsOnId, expectedVersion }, options);
}

export async function removeDependency(id: string, dependsOnId: string, expectedVersion: number, options: CommandOptions): Promise<TaskMutationResult> {
  return runBackendCommand<TaskMutationResult>("task.dependency.remove", { id, dependsOnId, expectedVersion }, options);
}

export async function listActivity(taskId?: string): Promise<ActivityListResult> {
  return runBackendCommand<ActivityListResult>("activity.list", taskId ? { taskId } : {});
}

export async function getWorkspaceInfo(): Promise<WorkspaceInfoResult> {
  return runBackendCommand<WorkspaceInfoResult>("workspace.info");
}

/** Writes a portable JSON copy beside the database and reports where it landed. */
export async function exportTasks(): Promise<TasksExportResult> {
  return runBackendCommand<TasksExportResult>("workspace.exportTasks");
}

export async function listThemes(): Promise<ThemeListResult> {
  return runBackendCommand<ThemeListResult>("theme.list");
}

export async function setTheme(name: string): Promise<ThemeSetResult> {
  return runBackendCommand<ThemeSetResult>("theme.set", { name });
}

export async function closeBackendSession(): Promise<void> {
  await getBackendTransport().close();
}
