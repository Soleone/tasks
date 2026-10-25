import { randomUUID } from "../lib/randomUUID";
import { EditorError, type InlineDraft } from "./editorClient";
import { MainWorkspace } from "./mainWorkspace";
import { taskView, type ClassificationOption, type TaskView } from "@/components/taskView";
import type { TaskPriority } from "@/backend/taskModel";
import type { TaskReorderPlacement, TaskReorderTask, TaskTransitionItem } from "@/backend/protocol";
import type { SortField } from "@/components/taskFilters";
import { parseTaskProjection } from "../backend/taskResults";

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

function relationshipWorkspace(workspace: MainWorkspace): MainWorkspace {
  if (!workspace.supportsRelationships)
    throw unsupported("Relationship changes are not yet available in this selected workspace.");
  return workspace;
}

// A workspace runs one write at a time and refuses a second. The UI queues instead, so changes
// made faster than the disk keeps up apply in order. A write belongs to the workspace selected
// when it was requested and is dropped unsent if that workspace closes first.
const writeQueues = new WeakMap<MainWorkspace, Promise<unknown>>();

function queued<T>(write: (workspace: MainWorkspace) => Promise<T>): Promise<T> {
  const workspace = selected();
  const send = () =>
    mainWorkspace === workspace
      ? write(workspace)
      : Promise.reject(
          new EditorError("NO_WORKSPACE", "The task folder closed before this change was sent."),
        );
  const next = (writeQueues.get(workspace) ?? Promise.resolve()).then(send, send);
  writeQueues.set(
    workspace,
    next.catch(() => undefined),
  );
  return next;
}

export async function waitForTaskWrites(): Promise<MainWorkspace> {
  const workspace = selected();
  await writeQueues.get(workspace);
  if (mainWorkspace !== workspace)
    throw new EditorError("NO_WORKSPACE", "The task folder closed before this change was sent.");
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
  includeDescendants?: boolean;
  closedSince?: string;
  dueBefore?: string;
  limit?: number;
};

export type CategoryListResult = { categories: ClassificationOption[] };
export type TagListResult = { tags: ClassificationOption[] };
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
    ...(filters.includeDescendants ? { includeDescendants: true } : {}),
    ...(filters.closedSince !== undefined ? { closedSince: filters.closedSince } : {}),
    ...(filters.dueBefore !== undefined ? { dueBefore: filters.dueBefore } : {}),
    ...(filters.limit !== undefined ? { limit: filters.limit } : {}),
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
  draft: InlineDraft,
  options: CommandOptions & { parentId?: string },
): Promise<TaskMutationResult> {
  return queued(async (workspace) => {
    if (options.parentId) {
      if (!workspace.supportsRelationships)
        throw unsupported("Child capture is not yet available in the selected workspace.");
      return workspace.createChild(options.parentId, draft, writeKey(options));
    }
    return workspace.save(draft, writeKey(options));
  });
}

export async function updateTask(
  id: string,
  draft: InlineDraft,
  expectedVersion: number,
  options: CommandOptions,
): Promise<TaskMutationResult> {
  return queued((workspace) => workspace.save(draft, writeKey(options), id, expectedVersion));
}

// Images never change once written, so each is read at most once per open workspace.
const images = new WeakMap<MainWorkspace, Map<string, Promise<string>>>();

function imagesOf(workspace: MainWorkspace): Map<string, Promise<string>> {
  let cached = images.get(workspace);
  if (!cached) images.set(workspace, (cached = new Map()));
  return cached;
}

/** The image as a data URL. A missing one is read again next time, since it may sync later. */
export function readAttachment(name: string): Promise<string> {
  const workspace = selected();
  const cached = imagesOf(workspace);
  let image = cached.get(name);
  if (!image) {
    image = workspace.editor
      .readAttachment(name)
      .then(({ type, data }) => `data:${type};base64,${data}`);
    cached.set(name, image);
    image.catch(() => cached.delete(name));
  }
  return image;
}

/** Stores an image given as a data URL and returns its name. */
export async function writeAttachment(dataUrl: string): Promise<string> {
  const workspace = selected();
  const [header, data] = dataUrl.split(",", 2);
  const type = header.slice("data:".length, header.indexOf(";"));
  const name = await workspace.editor.writeAttachment(type, data);
  imagesOf(workspace).set(name, Promise.resolve(dataUrl));
  return name;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** The canceled tasks a purge removes. A refusal names linking tasks in `details.references`. */
export function purgeCanceled(preview: boolean): Promise<{ purgedIds: string[] }> {
  return queued(async (workspace) => {
    const result = await workspace.editor.remove("task.purgeCanceled", {}, preview);
    if (!isStringList(result.purgedIds))
      throw new Error("The editor returned an invalid purge result.");
    return { purgedIds: result.purgedIds };
  });
}

export type ClearDoneScope = "attachments" | "tasks";
export type ClearDoneResult = {
  clearedIds: string[];
  keptIds: string[];
  removedAttachments: string[];
  bytes: number;
  exportLocation?: string;
};

/** Deletes done tasks closed before `closedBefore` (all when null), or only their images. */
export function clearDone(
  closedBefore: string | null,
  scope: ClearDoneScope,
  options: { preview?: boolean; export?: boolean } = {},
): Promise<ClearDoneResult> {
  return queued(async (workspace) => {
    const result = await workspace.editor.remove(
      "task.clearDone",
      { closedBefore, scope, ...(options.export ? { export: true } : {}) },
      options.preview ?? false,
    );
    if (
      !isStringList(result.clearedIds) ||
      !isStringList(result.keptIds) ||
      !isStringList(result.removedAttachments) ||
      typeof result.bytes !== "number" ||
      (result.exportLocation !== undefined && typeof result.exportLocation !== "string")
    )
      throw new Error("The editor returned an invalid result for deleting done tasks.");
    return {
      clearedIds: result.clearedIds,
      keptIds: result.keptIds,
      removedAttachments: result.removedAttachments,
      bytes: result.bytes,
      ...(result.exportLocation === undefined ? {} : { exportLocation: result.exportLocation }),
    };
  });
}

export async function updateTaskPriority(
  task: TaskView,
  priority: TaskPriority,
  options: CommandOptions,
): Promise<TaskMutationResult> {
  return queued((workspace) =>
    workspace.priority(task.id, task.version, priority, writeKey(options)),
  );
}

export async function deleteTask(
  id: string,
  expectedVersion: number,
  options: CommandOptions,
): Promise<TaskMutationResult> {
  return queued((workspace) =>
    workspace.status("task.delete", id, expectedVersion, writeKey(options)),
  );
}

export async function transitionTask(
  command: "task.start" | "task.pause" | "task.complete" | "task.reopen" | "task.cancel",
  id: string,
  expectedVersion: number,
  options: CommandOptions,
): Promise<TaskMutationResult> {
  return queued((workspace) => workspace.status(command, id, expectedVersion, writeKey(options)));
}

export async function transitionTasks(
  tasks: TaskTransitionItem[],
  options: CommandOptions,
): Promise<TaskTransitionManyResult> {
  return queued(async (workspace) => {
    if (!workspace.supportsStatusBatch)
      throw unsupported(
        "Changing several tasks at once is not yet available in this selected workspace.",
      );
    return workspace.transitionMany(tasks, writeKey(options));
  });
}

export async function undoStatusChange(
  id: string,
  expectedVersion: number,
  options: CommandOptions,
): Promise<TaskMutationResult> {
  return queued((workspace) =>
    workspace.status("task.status.undo", id, expectedVersion, writeKey(options)),
  );
}

export async function undoOperation(
  operationId: string,
  options: CommandOptions,
): Promise<OperationUndoResult> {
  return queued(async (workspace) => {
    if (!workspace.supportsOperationUndo)
      throw unsupported("Undo is limited to status changes in this selected workspace.");
    const { removedIds, ...result } = await workspace.undo(operationId, writeKey(options));
    return { ...result, undoneOperationId: operationId, deletedTaskIds: removedIds };
  });
}

export async function redoOperation(
  operationId: string,
  options: CommandOptions,
): Promise<TaskReorderResult> {
  return queued((workspace) => {
    if (!workspace.supportsOperationRedo)
      throw unsupported("Redo is not available in this selected workspace.");
    return workspace.redo(operationId, writeKey(options));
  });
}

export async function moveTask(
  id: string,
  parentId: string | null,
  expectedVersion: number,
  options: CommandOptions,
): Promise<TaskMutationResult> {
  return queued((workspace) =>
    relationshipWorkspace(workspace).relationship(
      "task.move",
      id,
      expectedVersion,
      parentId,
      writeKey(options),
    ),
  );
}

export async function reorderTasks(
  tasks: TaskReorderTask[],
  placement: TaskReorderPlacement,
  options: CommandOptions,
): Promise<TaskReorderResult> {
  return queued(async (workspace) => {
    if (!workspace.supportsOrdering)
      throw unsupported("Reordering is not yet available in this selected workspace.");
    return workspace.reorder(tasks, placement, writeKey(options));
  });
}

export async function addDependency(
  id: string,
  dependsOnId: string,
  expectedVersion: number,
  options: CommandOptions,
): Promise<TaskMutationResult> {
  return queued((workspace) =>
    relationshipWorkspace(workspace).relationship(
      "task.dependency.add",
      id,
      expectedVersion,
      dependsOnId,
      writeKey(options),
    ),
  );
}

export async function removeDependency(
  id: string,
  dependsOnId: string,
  expectedVersion: number,
  options: CommandOptions,
): Promise<TaskMutationResult> {
  return queued((workspace) =>
    relationshipWorkspace(workspace).relationship(
      "task.dependency.remove",
      id,
      expectedVersion,
      dependsOnId,
      writeKey(options),
    ),
  );
}

export async function getWorkspaceRevision(): Promise<number> {
  return selected().revision();
}

export async function closeBackendSession(): Promise<void> {
  await mainWorkspace?.reader.close();
}
