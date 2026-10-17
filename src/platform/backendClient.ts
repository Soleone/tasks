import { randomUUID } from "../lib/randomUUID";
import { EditorError } from "./editorClient";
import { MainWorkspace } from "./mainWorkspace";
import { taskView, type ClassificationOption, type TaskView } from "@/components/taskView";
import type { TaskPriority } from "@/backend/taskModel";
import type { TaskReorderPlacement, TaskReorderTask, TaskTransitionItem } from "@/backend/protocol";
import type { SortField } from "@/components/taskFilters";
import type { ThemeRecord } from "@/backend/themePalette";
import { parseTaskProjection } from "../backend/taskResults";
import { builtinThemes } from "../backend/builtinThemes";
import { GILT_THEME_NAME } from "../backend/themePalette";

let mainWorkspace: MainWorkspace | null = null;

export function selectMainWorkspace(workspace: MainWorkspace): void {
  if (mainWorkspace && mainWorkspace !== workspace)
    throw new Error("Close the selected workspace before selecting another.");
  mainWorkspace = workspace;
}

export function closeMainWorkspace(): void {
  mainWorkspace = null;
}

export function selectedMainWorkspace(): MainWorkspace | null {
  return mainWorkspace;
}

function selected(): MainWorkspace {
  if (!mainWorkspace) throw new EditorError("NO_WORKSPACE", "No task folder is open.");
  return mainWorkspace;
}

function unsupported(message: string): EditorError {
  return new EditorError("UNSUPPORTED_COMMAND", message);
}

function relationshipWorkspace(): MainWorkspace {
  const workspace = selected();
  if (!workspace.supportsRelationships)
    throw unsupported("Relationship changes are not yet available in this selected workspace.");
  return workspace;
}

function writeKey(options: CommandOptions): string {
  return options.idempotencyKey ?? randomUUID();
}

export type TaskListResult = {
  tasks: TaskView[];
  contextTasks: TaskView[];
  total: number;
  limit: number;
  offset: number;
  workspaceRevision: number;
};
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
export type WorkspaceInfoResult = {
  databasePath: string;
  taskCount: number;
  canceledTaskCount: number;
  workspaceRevision: number;
};
export type ThemeListResult = { themes: ThemeRecord[]; selected: string };
export type ThemeSetResult = { theme: ThemeRecord; selected: string };
export type CommandOptions = { idempotencyKey?: string };

export type TaskMutationResult = {
  task: TaskView;
  operationId?: string;
  changed?: boolean;
};
export type TaskReorderResult = {
  tasks: TaskView[];
  operationId?: string;
  changed: boolean;
};
export type TaskTransitionManyResult = {
  tasks: TaskView[];
  operationId?: string;
  changed: boolean;
};
export type OperationUndoResult = {
  operationId?: string;
  undoneOperationId: string;
  tasks: TaskView[];
  deletedTaskIds?: string[];
  changed: boolean;
};

export async function listTasks(
  status?: string | readonly string[],
  offset = 0,
  unblocked = false,
  category?: string,
  filters: TaskListFilters = {},
): Promise<TaskListResult> {
  return selected().tasks({
    ...(status !== undefined ? { status } : {}),
    ...(unblocked ? { unblocked: true } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(filters.category !== undefined ? { category: filters.category } : {}),
    ...(filters.priority !== undefined ? { priority: filters.priority } : {}),
    ...(filters.tags !== undefined && filters.tags.length > 0 ? { tags: filters.tags } : {}),
    ...(filters.search !== undefined && filters.search.trim() !== ""
      ? { search: filters.search.trim() }
      : {}),
    ...(filters.sort !== undefined ? { sort: filters.sort } : {}),
    ...(filters.direction !== undefined ? { direction: filters.direction } : {}),
    ...(filters.includeAncestors ? { includeAncestors: true } : {}),
    offset,
  });
}

export async function listCategories(): Promise<CategoryListResult> {
  return {
    categories: (await selected().categories()).map((entry) => ({ ...entry, label: entry.slug })),
  };
}

export async function listTags(): Promise<TagListResult> {
  return { tags: (await selected().tags()).map((entry) => ({ ...entry, label: entry.slug })) };
}

export async function getTask(id: string): Promise<{ task: TaskView }> {
  const result = await selected().reader.query("task.get", { id });
  return { task: taskView(parseTaskProjection(result.task)) };
}

export async function createTask(
  title: string,
  description: string,
  options: CommandOptions & { parentId?: string; priority?: TaskPriority },
): Promise<TaskMutationResult> {
  const workspace = selected();
  if (options.parentId) {
    if (!workspace.supportsRelationships)
      throw unsupported("Child capture is not yet available in the selected workspace.");
    return workspace.createChild(
      options.parentId,
      title,
      description,
      options.priority ?? 2,
      writeKey(options),
    );
  }
  return workspace.save(title, description, options.priority ?? 2, writeKey(options));
}

export async function updateTask(
  id: string,
  title: string,
  description: string,
  expectedVersion: number,
  options: CommandOptions & { priority?: TaskPriority },
): Promise<TaskMutationResult> {
  return selected().save(
    title,
    description,
    options.priority,
    writeKey(options),
    id,
    expectedVersion,
  );
}

export async function updateTaskPriority(
  task: TaskView,
  priority: TaskPriority,
  options: CommandOptions,
): Promise<TaskMutationResult> {
  return selected().priority(task.id, task.version, priority, writeKey(options));
}

export async function deleteTask(
  id: string,
  expectedVersion: number,
  options: CommandOptions,
): Promise<TaskMutationResult> {
  return selected().status("task.delete", id, expectedVersion, writeKey(options));
}

export async function transitionTask(
  command: "task.start" | "task.pause" | "task.complete" | "task.reopen" | "task.cancel",
  id: string,
  expectedVersion: number,
  options: CommandOptions,
): Promise<TaskMutationResult> {
  return selected().status(command, id, expectedVersion, writeKey(options));
}

export async function transitionTasks(
  tasks: TaskTransitionItem[],
  options: CommandOptions,
): Promise<TaskTransitionManyResult> {
  const workspace = selected();
  if (!workspace.supportsStatusBatch)
    throw unsupported(
      "Changing several tasks at once is not yet available in this selected workspace.",
    );
  return workspace.transitionMany(tasks, writeKey(options));
}

export async function undoStatusChange(
  id: string,
  expectedVersion: number,
  options: CommandOptions,
): Promise<TaskMutationResult> {
  return selected().status("task.status.undo", id, expectedVersion, writeKey(options));
}

export async function undoOperation(
  operationId: string,
  options: CommandOptions,
): Promise<OperationUndoResult> {
  const workspace = selected();
  if (!workspace.supportsOperationUndo)
    throw unsupported("Undo is limited to status changes in this selected workspace.");
  const { removedIds, ...result } = await workspace.undo(operationId, writeKey(options));
  return { ...result, undoneOperationId: operationId, deletedTaskIds: removedIds };
}

export async function moveTask(
  id: string,
  parentId: string | null,
  expectedVersion: number,
  options: CommandOptions,
): Promise<TaskMutationResult> {
  return relationshipWorkspace().relationship(
    "task.move",
    id,
    expectedVersion,
    parentId,
    writeKey(options),
  );
}

export async function reorderTasks(
  tasks: TaskReorderTask[],
  placement: TaskReorderPlacement,
  options: CommandOptions,
): Promise<TaskReorderResult> {
  const workspace = selected();
  if (!workspace.supportsOrdering)
    throw unsupported("Reordering is not yet available in this selected workspace.");
  return workspace.reorder(tasks, placement, writeKey(options));
}

export async function addDependency(
  id: string,
  dependsOnId: string,
  expectedVersion: number,
  options: CommandOptions,
): Promise<TaskMutationResult> {
  return relationshipWorkspace().relationship(
    "task.dependency.add",
    id,
    expectedVersion,
    dependsOnId,
    writeKey(options),
  );
}

export async function removeDependency(
  id: string,
  dependsOnId: string,
  expectedVersion: number,
  options: CommandOptions,
): Promise<TaskMutationResult> {
  return relationshipWorkspace().relationship(
    "task.dependency.remove",
    id,
    expectedVersion,
    dependsOnId,
    writeKey(options),
  );
}

export async function getWorkspaceInfo(): Promise<WorkspaceInfoResult> {
  return selected().info();
}

export async function getWorkspaceRevision(): Promise<number> {
  return selected().revision();
}

// Themes are a per-device preference, kept in the browser profile rather than the task folder.
export async function listThemes(): Promise<ThemeListResult> {
  const themes = builtinThemes();
  const stored = localStorage.getItem("tasks.selectedTheme");
  return {
    themes,
    selected: themes.some((theme) => theme.name === stored) ? stored! : GILT_THEME_NAME,
  };
}

export async function setTheme(name: string): Promise<ThemeSetResult> {
  const theme = builtinThemes().find((theme) => theme.name === name);
  if (!theme) throw new EditorError("THEME_NOT_FOUND", "Choose an available built-in theme.");
  localStorage.setItem("tasks.selectedTheme", name);
  return { theme, selected: name };
}

export async function closeBackendSession(): Promise<void> {
  await mainWorkspace?.reader.close();
}
