import { generateNKeysBetween } from "fractional-indexing";
import { classificationTokenRanges, classifyTaskText, TaskTextError } from "../backend/taskText.js";
import { invalidV1Source, normalizeV1MigrationTimestamp, readV1MigrationSnapshot, type CanonicalTaskFile, type V1MigrationSnapshot } from "./schema1Source.js";
import { compareV2Tasks, validateV2Task, type V2CanonicalTask } from "../backend/taskModel.js";

export type V1ConversionPlan = {
  source: V1MigrationSnapshot;
  tasks: V2CanonicalTask[];
  files: { relativePath: string; bytes: Buffer }[];
};

function convertV1Task(task: CanonicalTaskFile, orderKey: string): V2CanonicalTask {
  const relativePath = `tasks/${task.id}.json`;
  let classification;
  try {
    classification = classifyTaskText(task.title);
  } catch (error) {
    if (!(error instanceof TaskTextError)) throw error;
    return invalidV1Source(relativePath, "title", "multiple distinct legacy categories");
  }
  // The friendly v1 stripper collapses whitespace. Migration removes only recognized spans.
  let title = task.title;
  for (const { start, end } of classificationTokenRanges(task.title).reverse()) title = `${title.slice(0, start)}${title.slice(end)}`;
  title = title.trim();
  if (title === "") invalidV1Source(relativePath, "title", "metadata removal leaves an empty literal title");
  const converted = {
    id: task.id,
    title,
    description: task.descriptionMarkdown,
    status: task.status,
    priority: task.priority,
    category: classification.category?.slug ?? null,
    tags: classification.tags.map((tag) => tag.slug).sort(),
    parentId: task.parentId,
    dependencyIds: [...task.dependencyIds].sort(),
    orderKey,
    createdAt: normalizeV1MigrationTimestamp(task.createdAt, relativePath, "createdAt"),
    updatedAt: normalizeV1MigrationTimestamp(task.updatedAt, relativePath, "updatedAt"),
    closedAt: task.status === "done" ? normalizeV1MigrationTimestamp(task.completedAt, relativePath, "completedAt")
      : task.status === "canceled" ? normalizeV1MigrationTimestamp(task.canceledAt, relativePath, "canceledAt") : null,
  };
  return validateV2Task(converted, task.id);
}

/** Validate a complete v1 root and return deterministic bytes in memory. Never publish or select. */
export function planV1ToV2Conversion(sourceDirectory: string): V1ConversionPlan {
  const source = readV1MigrationSnapshot(sourceDirectory);
  const orderKeys = new Map<string, string>();
  for (const order of source.orders) {
    const keys = generateNKeysBetween(null, null, order.taskIds.length);
    for (const [index, id] of order.taskIds.entries()) orderKeys.set(id, keys[index]);
  }
  const tasks = source.tasks.map((task) => convertV1Task(task, orderKeys.get(task.id)!));
  const byScope = new Map<string | null, V2CanonicalTask[]>();
  for (const task of tasks) {
    if (!byScope.has(task.parentId)) byScope.set(task.parentId, []);
    byScope.get(task.parentId)!.push(task);
  }
  for (const order of source.orders) {
    const sequence = (byScope.get(order.parentId) ?? []).sort(compareV2Tasks).map((task) => task.id);
    if (JSON.stringify(sequence) !== JSON.stringify(order.taskIds)) invalidV1Source(`order/${order.parentId ?? "root"}.json`, "taskIds", "mapped sequence differs from source");
  }
  const files = tasks.map((task) => ({ relativePath: `tasks/${task.id}.json`, bytes: Buffer.from(`${JSON.stringify(task, null, 2)}\n`) }));
  files.push({ relativePath: "workspace.json", bytes: Buffer.from('{"schemaVersion":2}\n') });
  return { source, tasks, files };
}
