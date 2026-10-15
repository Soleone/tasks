import { randomUUID } from "../lib/randomUUID";
import {
  PROTOCOL_VERSION,
  parseTaskCommandResult,
  type ActivityRecord,
  type ProtocolRequest,
  type TaskRecord,
} from "../legacy/backend/protocol";
import { getBackendTransport, isSelectedWorkspaceLaunch } from "../legacy/platform/backendTransport";
import type { AndroidSyncConflict } from "../legacy/platform/androidSyncConflicts";
import { MainWorkspace } from "./mainWorkspace";
import { taskView, type ClassificationOption, type TaskView } from "@/components/taskView";
import { stripClassificationTokens } from "@/backend/taskText";
import type { TaskPriority } from "@/backend/taskModel";
import type { TaskReorderPlacement, TaskReorderTask, TaskTransitionItem } from "@/backend/protocol";
import type { SortField } from "@/components/taskFilters";
import type { ThemeRecord } from "@/backend/themePalette";
import { parseTaskProjection } from "../backend/taskResults";
import { builtinThemes } from "../backend/builtinThemes";
import { GILT_THEME_NAME } from "../backend/themePalette";

let mainWorkspace: MainWorkspace | null = null;

export function selectMainWorkspace(workspace: MainWorkspace): void {
  if (mainWorkspace && mainWorkspace !== workspace) throw new Error("Close the selected workspace before selecting another.");
  mainWorkspace = workspace;
}

export function closeMainWorkspace(): void { mainWorkspace = null; }

export function selectedMainWorkspace(): MainWorkspace | null { return mainWorkspace; }

function relationshipWorkspace(): MainWorkspace | null {
  if (mainWorkspace && !mainWorkspace.supportsRelationships) throw new BackendCommandError("UNSUPPORTED_COMMAND", "Relationship changes are not yet available in this selected workspace.");
  return mainWorkspace;
}

function mainWriteKey(options: CommandOptions): string {
  if (options.readOnly || options.dryRun) throw new BackendCommandError("UNSUPPORTED_COMMAND", "This UI action cannot execute preview-only options. Nothing was sent.");
  return options.idempotencyKey ?? randomUUID();
}

export type TaskListResult = { tasks: TaskView[]; contextTasks: TaskView[]; total: number; limit: number; offset: number; workspaceRevision: number; unresolvedConflicts?: AndroidSyncConflict[] };
export type TaskListFilters = {
  priority?: TaskPriority;
  tags?: string[];
  search?: string;
  category?: string;
  sort?: SortField;
  direction?: "asc" | "desc";
  includeAncestors?: boolean;
};

export type CategoryListResult = { categories: ClassificationOption[] };
export type TagListResult = { tags: ClassificationOption[] };
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
  task: TaskView;
  operationId?: string;
  changed?: boolean;
  dryRun?: boolean;
  readOnly?: boolean;
};
export type TaskReorderResult = {
  tasks: TaskView[];
  operationId?: string;
  changed: boolean;
  dryRun?: boolean;
  readOnly?: boolean;
};
export type TaskTransitionManyResult = {
  tasks: TaskView[];
  operationId?: string;
  changed: boolean;
  dryRun?: boolean;
  readOnly?: boolean;
};
export type TaskStatusUndoManyResult = TaskTransitionManyResult;
export type OperationUndoResult = {
  operationId?: string;
  undoneOperationId: string;
  tasks: TaskView[];
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

function legacyTaskView(task: TaskRecord): TaskView {
  const { title, descriptionMarkdown, completedAt, canceledAt, ...fields } = task;
  return {
    ...fields, title: stripClassificationTokens(title) || title, text: title,
    description: descriptionMarkdown, closedAt: completedAt ?? canceledAt,
  };
}

export async function runBackendCommand<T extends Record<string, unknown>>(
  command: ProtocolRequest["command"],
  args: Record<string, unknown> = {},
  options: CommandOptions = {},
): Promise<T> {
  if (mainWorkspace) throw new BackendCommandError("UNSUPPORTED_COMMAND", "This action is not yet available in the selected workspace.");
  if (isSelectedWorkspaceLaunch()) throw new BackendCommandError("UNSUPPORTED_COMMAND", "This action is not available through the selected workspace. Reopen and confirm it if the development connection was reloaded.");
  const response = await getBackendTransport().request({
    version: PROTOCOL_VERSION,
    requestId: randomUUID(),
    command,
    args,
    actor: { kind: "human", label: "desktop" },
    ...options,
  });

  if (!response.ok) {
    throw new BackendCommandError(response.error.code, response.error.message);
  }

  const result = parseTaskCommandResult(command, response.result);
  // Only the retained legacy wire route needs field normalization; deleted at cutover.
  if (result.task !== undefined) result.task = legacyTaskView(result.task as TaskRecord);
  for (const field of ["tasks", "contextTasks"]) {
    if (Array.isArray(result[field])) result[field] = result[field].map(task => legacyTaskView(task as TaskRecord));
  }
  return result as T;
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

export async function getTask(id: string): Promise<{ task: TaskView }> {
  if (mainWorkspace) return { task: taskView(parseTaskProjection((await mainWorkspace.reader.query("task.get", { id })).task)) };
  return runBackendCommand<{ task: TaskView }>("task.get", { id });
}

export async function createTask(title: string, description: string, options: CommandOptions & { parentId?: string; priority?: TaskPriority }): Promise<TaskMutationResult> {
  if (mainWorkspace) {
    if (options.parentId) {
      if (!mainWorkspace.supportsRelationships) throw new BackendCommandError("UNSUPPORTED_COMMAND", "Child capture is not yet available in the selected workspace.");
      return mainWorkspace.createChild(options.parentId, title, description, options.priority ?? 2, mainWriteKey(options));
    }
    return mainWorkspace.save(title, description, options.priority ?? 2, mainWriteKey(options));
  }
  const { parentId, priority, ...commandOptions } = options;
  return runBackendCommand<TaskMutationResult>("task.create", { title, descriptionMarkdown: description, ...(parentId ? { parentId } : {}), ...(priority !== undefined ? { priority } : {}) }, commandOptions);
}

export async function updateTask(
  id: string,
  title: string,
  description: string,
  expectedVersion: number,
  options: CommandOptions & { priority?: TaskPriority },
): Promise<TaskMutationResult> {
  if (mainWorkspace) return mainWorkspace.save(title, description, options.priority, mainWriteKey(options), id, expectedVersion);
  return runBackendCommand<TaskMutationResult>(
    "task.update",
    { id, title, descriptionMarkdown: description, expectedVersion, ...(options.priority !== undefined ? { priority: options.priority } : {}) },
    options,
  );
}

export async function updateTaskPriority(task: TaskView, priority: TaskPriority, options: CommandOptions): Promise<TaskMutationResult> {
  if (mainWorkspace) return mainWorkspace.priority(task.id, task.version, priority, mainWriteKey(options));
  return updateTask(task.id, task.text ?? task.title, task.description, task.version, { ...options, priority });
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
  if (mainWorkspace) {
    if (!mainWorkspace.supportsStatusBatch) throw new BackendCommandError("UNSUPPORTED_COMMAND", "Changing several tasks at once is not yet available in this selected workspace.");
    return mainWorkspace.transitionMany(tasks, mainWriteKey(options));
  }
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
  tasks: { id: string; expectedVersion: number }[],
  options: CommandOptions,
): Promise<TaskStatusUndoManyResult> {
  return runBackendCommand<TaskStatusUndoManyResult>("task.status.undoMany", { tasks }, options);
}

export async function undoOperation(operationId: string, options: CommandOptions): Promise<OperationUndoResult> {
  if (mainWorkspace) {
    if (!mainWorkspace.supportsOperationUndo) throw new BackendCommandError("UNSUPPORTED_COMMAND", "Undo is limited to status changes in this selected workspace.");
    const { removedIds, ...result } = await mainWorkspace.undo(operationId, mainWriteKey(options));
    return { ...result, undoneOperationId: operationId, deletedTaskIds: removedIds };
  }
  return runBackendCommand<OperationUndoResult>("operation.undo", { operationId }, options);
}

export async function moveTask(id: string, parentId: string | null, expectedVersion: number, options: CommandOptions): Promise<TaskMutationResult> {
  const workspace = relationshipWorkspace();
  if (workspace) return workspace.relationship("task.move", id, expectedVersion, parentId, mainWriteKey(options));
  return runBackendCommand<TaskMutationResult>("task.move", { id, parentId, expectedVersion }, options);
}

export async function reorderTasks(
  tasks: TaskReorderTask[],
  placement: TaskReorderPlacement,
  options: CommandOptions,
): Promise<TaskReorderResult> {
  if (mainWorkspace) {
    if (!mainWorkspace.supportsOrdering) throw new BackendCommandError("UNSUPPORTED_COMMAND", "Reordering is not yet available in this selected workspace.");
    return mainWorkspace.reorder(tasks, placement, mainWriteKey(options));
  }
  return runBackendCommand<TaskReorderResult>("task.reorder", { tasks, placement }, options);
}

export async function addDependency(id: string, dependsOnId: string, expectedVersion: number, options: CommandOptions): Promise<TaskMutationResult> {
  const workspace = relationshipWorkspace();
  if (workspace) return workspace.relationship("task.dependency.add", id, expectedVersion, dependsOnId, mainWriteKey(options));
  return runBackendCommand<TaskMutationResult>("task.dependency.add", { id, dependsOnId, expectedVersion }, options);
}

export async function removeDependency(id: string, dependsOnId: string, expectedVersion: number, options: CommandOptions): Promise<TaskMutationResult> {
  const workspace = relationshipWorkspace();
  if (workspace) return workspace.relationship("task.dependency.remove", id, expectedVersion, dependsOnId, mainWriteKey(options));
  return runBackendCommand<TaskMutationResult>("task.dependency.remove", { id, dependsOnId, expectedVersion }, options);
}

export async function listActivity(taskId?: string): Promise<ActivityListResult> {
  return runBackendCommand<ActivityListResult>("activity.list", taskId ? { taskId } : {});
}

export async function getWorkspaceInfo(): Promise<WorkspaceInfoResult> {
  if (mainWorkspace) return mainWorkspace.info();
  return runBackendCommand<WorkspaceInfoResult>("workspace.info");
}

export async function getWorkspaceRevision(): Promise<number> {
  if (mainWorkspace) return mainWorkspace.revision();
  const info = await runBackendCommand<{ workspaceRevision: number }>("workspace.info");
  return info.workspaceRevision;
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
