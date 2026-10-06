import {
  PROTOCOL_VERSION,
  parseRuntimeProbeResult,
  parseTaskCommandResult,
  type ActivityRecord,
  type ProtocolRequest,
  type CategoryRecord,
  type RuntimeProbeResult,
  type TagRecord,
  type TaskListSort,
  type TaskPriority,
  type TaskRecord,
  type TaskReorderPlacement,
  type TaskReorderTask,
  type TaskStatusUndoItem,
  type TaskTransitionItem,
  type ThemeRecord,
} from "../backend/protocol";
import { getBackendTransport } from "./backendTransport";
import type { AndroidSyncConflict } from "./androidSyncConflicts";
import { MainWorkspace } from "./mainWorkspace";
import { taskView } from "@/components/taskView";
import { parseV2TaskProjection } from "../backend/v2TaskResults";
import { builtinThemes } from "../backend/builtinThemes";
import { GILT_THEME_NAME } from "../backend/themePalette";

let mainWorkspace: MainWorkspace | null = null;

export function selectMainWorkspace(workspace: MainWorkspace): void {
  if (mainWorkspace && mainWorkspace !== workspace) throw new Error("Close the selected workspace before selecting another.");
  mainWorkspace = workspace;
}

export function selectedMainWorkspace(): MainWorkspace | null { return mainWorkspace; }

function mainWriteKey(options: CommandOptions): string {
  if (options.readOnly || options.dryRun) throw new BackendCommandError("UNSUPPORTED_COMMAND", "This UI action cannot execute preview-only options. Nothing was sent.");
  return options.idempotencyKey ?? crypto.randomUUID();
}

export type ProbeResult = RuntimeProbeResult;
export type TaskListResult = { tasks: TaskRecord[]; contextTasks: TaskRecord[]; total: number; limit: number; offset: number; workspaceRevision: number; unresolvedConflicts?: AndroidSyncConflict[] };
export type TaskListFilters = {
  priority?: TaskPriority;
  tags?: string[];
  search?: string;
  category?: string;
  sort?: TaskListSort;
  direction?: "asc" | "desc";
  includeAncestors?: boolean;
};

export type CategoryListResult = { categories: CategoryRecord[] };
export type TagListResult = { tags: TagRecord[] };
export type ActivityListResult = { activity: ActivityRecord[]; limit: number };
export type WorkspaceInfoResult = { databasePath: string; workspaceId?: string; sourceRegistryPath?: string; primarySourceKey?: string; sourceCount?: number; taskCount: number; canceledTaskCount: number; workspaceRevision: number };
export type TasksExportResult = { databasePath: string; destinationPath: string | null; displayName?: string; taskCount: number; exportedAt: string };
export type ThemeListResult = { themes: ThemeRecord[]; selected: string };
export type ThemeSetResult = { theme: ThemeRecord; selected: string };
export type ReceiveWorkspaceResult = { waiting: boolean; ready?: boolean; adopted?: boolean; restored?: boolean; backupRoot?: string; syncRoot?: string; taskCount?: number; sync?: Record<string, unknown> };

export type CommandOptions = {
  idempotencyKey?: string;
  readOnly?: boolean;
  dryRun?: boolean;
};

export type TaskMutationResult = {
  task: TaskRecord;
  operationId?: string;
  changed?: boolean;
  dryRun?: boolean;
  readOnly?: boolean;
};
export type TaskReorderResult = {
  tasks: TaskRecord[];
  operationId?: string;
  changed: boolean;
  dryRun?: boolean;
  readOnly?: boolean;
};
export type TaskTransitionManyResult = {
  tasks: TaskRecord[];
  operationId?: string;
  changed: boolean;
  dryRun?: boolean;
  readOnly?: boolean;
};
export type TaskStatusUndoManyResult = TaskTransitionManyResult;
export type OperationUndoResult = {
  operationId: string;
  undoneOperationId: string;
  tasks: TaskRecord[];
  deletedTaskIds?: string[];
  changed: boolean;
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
  if (mainWorkspace || import.meta.env.VITE_TASKDB_V2_NATIVE_SELECTION) throw new BackendCommandError("UNSUPPORTED_COMMAND", "This action is not available through the selected workspace. Reopen and confirm it if the development connection was reloaded.");
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

  return parseTaskCommandResult(command, response.result) as T;
}

export async function runRuntimeProbe(): Promise<ProbeResult> {
  const result = await runBackendCommand<Record<string, unknown>>("runtime.probe");
  return parseRuntimeProbeResult(result);
}

export async function listTasks(
  status?: string | readonly string[],
  offset = 0,
  unblocked = false,
  category?: string,
  filters: TaskListFilters = {},
): Promise<TaskListResult> {
  const args = {
    ...(status !== undefined ? { status } : {}),
    ...(unblocked ? { unblocked: true } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(filters.category !== undefined ? { category: filters.category } : {}),
    ...(filters.priority !== undefined ? { priority: filters.priority } : {}),
    ...(filters.tags !== undefined && filters.tags.length > 0 ? { tags: filters.tags } : {}),
    ...(filters.search !== undefined && filters.search.trim() !== "" ? { search: filters.search.trim() } : {}),
    ...(filters.sort !== undefined ? { sort: filters.sort } : {}),
    ...(filters.direction !== undefined ? { direction: filters.direction } : {}),
    ...(filters.includeAncestors ? { includeAncestors: true } : {}),
    offset,
  };
  if (mainWorkspace) return mainWorkspace.tasks(args);
  return runBackendCommand<TaskListResult>("task.list", args);
}

export async function listCategories(): Promise<CategoryListResult> {
  if (mainWorkspace) return { categories: (await mainWorkspace.categories()).map(entry => ({ ...entry, label: entry.slug })) };
  return runBackendCommand<CategoryListResult>("category.list");
}

export async function listTags(): Promise<TagListResult> {
  if (mainWorkspace) return { tags: (await mainWorkspace.tags()).map(entry => ({ ...entry, label: entry.slug })) };
  return runBackendCommand<TagListResult>("tag.list");
}

export async function getTask(id: string): Promise<{ task: TaskRecord }> {
  if (mainWorkspace) return { task: taskView(parseV2TaskProjection((await mainWorkspace.reader.query("task.get", { id })).task)) };
  return runBackendCommand<{ task: TaskRecord }>("task.get", { id });
}

export async function createTask(title: string, descriptionMarkdown: string, options: CommandOptions & { parentId?: string; priority?: TaskPriority }): Promise<TaskMutationResult> {
  if (mainWorkspace) {
    if (options.parentId) throw new BackendCommandError("UNSUPPORTED_COMMAND", "Child capture is not yet available in the selected Windows workspace.");
    return mainWorkspace.save(title, descriptionMarkdown, options.priority ?? 2, mainWriteKey(options));
  }
  const { parentId, priority, ...commandOptions } = options;
  return runBackendCommand<TaskMutationResult>("task.create", { title, descriptionMarkdown, ...(parentId ? { parentId } : {}), ...(priority !== undefined ? { priority } : {}) }, commandOptions);
}

export async function updateTask(
  id: string,
  title: string,
  descriptionMarkdown: string,
  expectedVersion: number,
  options: CommandOptions & { priority?: TaskPriority },
): Promise<TaskMutationResult> {
  if (mainWorkspace) return mainWorkspace.save(title, descriptionMarkdown, options.priority, mainWriteKey(options), id, expectedVersion);
  return runBackendCommand<TaskMutationResult>(
    "task.update",
    { id, title, descriptionMarkdown, expectedVersion, ...(options.priority !== undefined ? { priority: options.priority } : {}) },
    options,
  );
}

export async function updateTaskPriority(task: TaskRecord, priority: TaskPriority, options: CommandOptions): Promise<TaskMutationResult> {
  if (mainWorkspace) return mainWorkspace.priority(task.id, task.version, priority, mainWriteKey(options));
  return updateTask(task.id, task.title, task.descriptionMarkdown, task.version, { ...options, priority });
}

export async function deleteTask(id: string, expectedVersion: number, options: CommandOptions): Promise<TaskMutationResult> {
  if (mainWorkspace) return mainWorkspace.status("task.delete", id, expectedVersion, mainWriteKey(options));
  return runBackendCommand<TaskMutationResult>("task.delete", { id, expectedVersion }, options);
}

export async function purgeCanceledTasks(options: CommandOptions): Promise<{ deletedCount: number; dryRun?: boolean; readOnly?: boolean }> {
  return runBackendCommand<{ deletedCount: number; dryRun?: boolean; readOnly?: boolean }>("task.purgeCanceled", {}, options);
}

export async function transitionTask(
  command: "task.start" | "task.pause" | "task.complete" | "task.reopen" | "task.cancel",
  id: string,
  expectedVersion: number,
  options: CommandOptions,
): Promise<TaskMutationResult> {
  if (mainWorkspace) return mainWorkspace.status(command, id, expectedVersion, mainWriteKey(options));
  return runBackendCommand<TaskMutationResult>(command, { id, expectedVersion }, options);
}

export async function transitionTasks(
  tasks: TaskTransitionItem[],
  options: CommandOptions,
): Promise<TaskTransitionManyResult> {
  return runBackendCommand<TaskTransitionManyResult>("task.transitionMany", { tasks }, options);
}

export async function undoStatusChange(
  id: string,
  expectedVersion: number,
  options: CommandOptions,
): Promise<TaskMutationResult & { undoneSeq?: number }> {
  if (mainWorkspace) return mainWorkspace.status("task.status.undo", id, expectedVersion, mainWriteKey(options));
  return runBackendCommand<TaskMutationResult & { undoneSeq?: number }>("task.status.undo", { id, expectedVersion }, options);
}

export async function undoStatusChanges(
  tasks: TaskStatusUndoItem[],
  options: CommandOptions,
): Promise<TaskStatusUndoManyResult> {
  return runBackendCommand<TaskStatusUndoManyResult>("task.status.undoMany", { tasks }, options);
}

export async function undoOperation(operationId: string, options: CommandOptions): Promise<OperationUndoResult> {
  return runBackendCommand<OperationUndoResult>("operation.undo", { operationId }, options);
}

export async function moveTask(id: string, parentId: string | null, expectedVersion: number, options: CommandOptions): Promise<TaskMutationResult> {
  return runBackendCommand<TaskMutationResult>("task.move", { id, parentId, expectedVersion }, options);
}

export async function reorderTasks(
  tasks: TaskReorderTask[],
  placement: TaskReorderPlacement,
  options: CommandOptions,
): Promise<TaskReorderResult> {
  return runBackendCommand<TaskReorderResult>("task.reorder", { tasks, placement }, options);
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
  if (mainWorkspace) return mainWorkspace.info();
  return runBackendCommand<WorkspaceInfoResult>("workspace.info");
}

/** Writes a portable JSON copy beside the database and reports where it landed. */
export async function exportTasks(): Promise<TasksExportResult> {
  return runBackendCommand<TasksExportResult>("workspace.exportTasks");
}

export async function prepareReceiveWorkspace(): Promise<ReceiveWorkspaceResult> {
  return runBackendCommand<ReceiveWorkspaceResult>("workspace.receive.prepare");
}

export async function receiveWorkspaceStatus(): Promise<ReceiveWorkspaceResult> {
  if (mainWorkspace) return { waiting: false };
  return runBackendCommand<ReceiveWorkspaceResult>("workspace.receive.status");
}

export async function abortReceiveWorkspace(): Promise<ReceiveWorkspaceResult> {
  return runBackendCommand<ReceiveWorkspaceResult>("workspace.receive.abort");
}

export async function listThemes(): Promise<ThemeListResult> {
  if (mainWorkspace) {
    const themes = builtinThemes();
    const stored = localStorage.getItem("tasks.selectedTheme");
    return { themes, selected: themes.some(theme => theme.name === stored) ? stored! : GILT_THEME_NAME };
  }
  return runBackendCommand<ThemeListResult>("theme.list");
}

export async function setTheme(name: string): Promise<ThemeSetResult> {
  if (mainWorkspace) {
    const theme = builtinThemes().find(theme => theme.name === name);
    if (!theme) throw new BackendCommandError("THEME_NOT_FOUND", "Choose an available built-in theme.");
    localStorage.setItem("tasks.selectedTheme", name);
    return { theme, selected: name };
  }
  return runBackendCommand<ThemeSetResult>("theme.set", { name });
}

export async function closeBackendSession(): Promise<void> {
  if (mainWorkspace) { await mainWorkspace.reader.close(); return; }
  await getBackendTransport().close();
}
