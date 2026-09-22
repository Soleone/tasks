import {
  TASKS_EXPORT_FORMAT,
  TASKS_EXPORT_FORMAT_VERSION,
  type TaskRecord,
  type TasksExportFile,
} from "./protocol.js";

/** Portable task view shared by the desktop exporter and Android document picker. */
export function portableTaskExport(
  tasks: TaskRecord[],
  siblingOrders: ReadonlyMap<string, number>,
  exportedAt: string,
): TasksExportFile {
  return {
    format: TASKS_EXPORT_FORMAT,
    formatVersion: TASKS_EXPORT_FORMAT_VERSION,
    exportedAt,
    taskCount: tasks.length,
    tasks: tasks.map((task) => ({
      id: task.id,
      siblingOrder: siblingOrders.get(task.id) ?? 0,
      title: task.title,
      status: task.status,
      priority: task.priority,
      category: task.category?.slug ?? null,
      tags: task.tags.map((tag) => tag.slug),
      parentId: task.parentId,
      blockedByIds: task.dependencyIds,
      notesMarkdown: task.descriptionMarkdown,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt,
      canceledAt: task.canceledAt,
    })),
  };
}
