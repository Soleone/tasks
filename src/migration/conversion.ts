import { generateNKeysBetween } from "fractional-indexing";
import { classificationTokenRanges, classifyTaskText, TaskTextError } from "../backend/taskText.js";
import {
  invalidSchema1Source,
  normalizeSchema1MigrationTimestamp,
  readSchema1MigrationSnapshot,
  type CanonicalTaskFile,
  type Schema1MigrationSnapshot,
} from "./schema1Source.js";
import { compareTasks, validateTask, type CanonicalTask } from "../backend/taskModel.js";
import { typedText } from "../backend/shorthand.js";

export type Schema1ConversionPlan = {
  source: Schema1MigrationSnapshot;
  tasks: CanonicalTask[];
  files: { relativePath: string; bytes: Buffer }[];
};

function convertSchema1Task(task: CanonicalTaskFile, orderKey: string): CanonicalTask {
  const relativePath = `tasks/${task.id}.json`;
  let classification;
  try {
    classification = classifyTaskText(task.title);
  } catch (error) {
    if (!(error instanceof TaskTextError)) throw error;
    return invalidSchema1Source(relativePath, "title", "multiple distinct legacy categories");
  }
  // The friendly v1 stripper collapses whitespace. Migration removes only recognized spans.
  let title = task.title;
  for (const { start, end } of classificationTokenRanges(task.title).reverse())
    title = `${title.slice(0, start)}${title.slice(end)}`;
  title = title.trim();
  if (title === "")
    invalidSchema1Source(relativePath, "title", "metadata removal leaves an empty literal title");
  const category = classification.category?.slug ?? null;
  const tags = classification.tags.map((tag) => tag.slug).sort();
  const converted = {
    id: task.id,
    title,
    // Schema 1 stored titles as typed. Keep that text when the current shorthand reads it the same way.
    text:
      task.title.trim().length <= 1000
        ? typedText({ title, text: task.title.trim(), category, tags })
        : null,
    description: task.descriptionMarkdown,
    status: task.status,
    priority: task.priority,
    category,
    tags,
    parentId: task.parentId,
    dependencyIds: [...task.dependencyIds].sort(),
    orderKey,
    createdAt: normalizeSchema1MigrationTimestamp(task.createdAt, relativePath, "createdAt"),
    updatedAt: normalizeSchema1MigrationTimestamp(task.updatedAt, relativePath, "updatedAt"),
    closedAt:
      task.status === "done"
        ? normalizeSchema1MigrationTimestamp(task.completedAt, relativePath, "completedAt")
        : task.status === "canceled"
          ? normalizeSchema1MigrationTimestamp(task.canceledAt, relativePath, "canceledAt")
          : null,
  };
  return validateTask(converted, task.id);
}

/** Validate a complete v1 root and return deterministic bytes in memory. Never publish or select. */
export function planSchema1Conversion(sourceDirectory: string): Schema1ConversionPlan {
  const source = readSchema1MigrationSnapshot(sourceDirectory);
  const orderKeys = new Map<string, string>();
  for (const order of source.orders) {
    const keys = generateNKeysBetween(null, null, order.taskIds.length);
    for (const [index, id] of order.taskIds.entries()) orderKeys.set(id, keys[index]);
  }
  const tasks = source.tasks.map((task) => convertSchema1Task(task, orderKeys.get(task.id)!));
  const byScope = new Map<string | null, CanonicalTask[]>();
  for (const task of tasks) {
    if (!byScope.has(task.parentId)) byScope.set(task.parentId, []);
    byScope.get(task.parentId)!.push(task);
  }
  for (const order of source.orders) {
    const sequence = (byScope.get(order.parentId) ?? []).sort(compareTasks).map((task) => task.id);
    if (JSON.stringify(sequence) !== JSON.stringify(order.taskIds))
      invalidSchema1Source(
        `order/${order.parentId ?? "root"}.json`,
        "taskIds",
        "mapped sequence differs from source",
      );
  }
  const files = tasks.map((task) => ({
    relativePath: `tasks/${task.id}.json`,
    bytes: Buffer.from(`${JSON.stringify(task, null, 2)}\n`),
  }));
  files.push({ relativePath: "workspace.json", bytes: Buffer.from('{"schemaVersion":2}\n') });
  return { source, tasks, files };
}
