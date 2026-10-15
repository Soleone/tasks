import type { ClassificationToken } from "@/backend/taskText";
import type { TaskProjection } from "@/backend/queries";

/** Current task fields with display labels; not a canonical file or write envelope. */
export type TaskView = Omit<TaskProjection, "orderKey" | "category" | "tags"> & {
  category: ClassificationToken | null;
  tags: ClassificationToken[];
};

export type ClassificationOption = ClassificationToken & { taskCount: number };

export function inlineTaskText(task: Pick<TaskView, "title" | "category" | "tags">): string {
  let escaped = "";
  for (let index = 0; index < task.title.length;) {
    const marker = task.title.startsWith("```", index) ? "```" : task.title[index] === "`" ? "`" : null;
    if (marker) {
      const close = task.title.indexOf(marker, index + marker.length);
      const protectedEnd = close < 0 ? task.title.length : close + marker.length;
      if (marker === "```" || (close >= 0 && !task.title.slice(index, close).includes("\n"))) {
        escaped += task.title.slice(index, protectedEnd);
        index = protectedEnd;
        continue;
      }
    }
    const character = task.title[index++];
    escaped += ["\\", "@", "#"].includes(character) ? `\\${character}` : character;
  }
  const classification = [task.category ? `@${task.category.slug}` : "", ...task.tags.map(tag => `#${tag.slug}`)].filter(Boolean);
  // Prefix classification so an unclosed code fence in the literal title cannot swallow it.
  return [...classification, escaped].join(" ");
}

export function taskView(task: TaskProjection): TaskView {
  return {
    ...task,
    category: task.category === null ? null : { slug: task.category, label: task.category },
    tags: task.tags.map(slug => ({ slug, label: slug })),
  };
}
