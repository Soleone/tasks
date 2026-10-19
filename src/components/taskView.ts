import type { ClassificationToken } from "@/backend/taskText";
import type { TaskProjection } from "@/backend/queries";

/** Current task fields with display labels; not a canonical file or write envelope. */
export type TaskView = Omit<TaskProjection, "orderKey" | "category" | "tags"> & {
  category: ClassificationToken | null;
  tags: ClassificationToken[];
};

export type ClassificationOption = ClassificationToken & { taskCount: number };

export function taskView(task: TaskProjection): TaskView {
  return {
    ...task,
    category: task.category === null ? null : { slug: task.category, label: task.category },
    tags: task.tags.map((slug) => ({ slug, label: slug })),
  };
}
