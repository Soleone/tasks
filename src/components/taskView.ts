import type { ClassificationToken, TaskPriority, TaskStatus } from "@/legacy/backend/protocol";
import type { TaskProjection } from "@/backend/queries";

/** Presentation data for the existing list/composer, never a canonical file or protocol envelope. */
export type TaskView = {
  id: string;
  title: string;
  descriptionMarkdown: string;
  status: TaskStatus;
  priority: TaskPriority;
  category: ClassificationToken | null;
  tags: ClassificationToken[];
  parentId: string | null;
  dependencyIds: string[];
  blockedByIds: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  canceledAt: string | null;
  literalTitle?: string;
  inputText?: string;
};

export function inlineTaskText(task: Pick<TaskProjection, "title" | "category" | "tags">): string {
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
  const classification = [task.category ? `@${task.category}` : "", ...task.tags.map(tag => `#${tag}`)].filter(Boolean);
  // Prefix classification so an unclosed code fence in the literal title cannot swallow it.
  return [...classification, escaped].join(" ");
}

export function taskView(task: TaskProjection): TaskView {
  return {
    id: task.id, title: task.title, literalTitle: task.title,
    inputText: task.text ?? inlineTaskText(task),
    descriptionMarkdown: task.description, status: task.status, priority: task.priority,
    category: task.category === null ? null : { slug: task.category, label: task.category },
    tags: task.tags.map(slug => ({ slug, label: slug })), parentId: task.parentId,
    dependencyIds: task.dependencyIds, blockedByIds: task.blockedByIds, version: task.version,
    createdAt: task.createdAt, updatedAt: task.updatedAt,
    completedAt: task.status === "done" ? task.closedAt : null,
    canceledAt: task.status === "canceled" ? task.closedAt : null,
  };
}
