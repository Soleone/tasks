import { existsSync } from "node:fs";
import { attachmentPath } from "./attachments.js";
import type { Response } from "./protocol.js";
import type { TaskProjection } from "./queries.js";
import { DEFAULT_EFFORT } from "./taskModel.js";

function taskLine(task: TaskProjection): string {
  return [
    task.id,
    `[${task.status}]`,
    task.title,
    `(p${task.priority})`,
    ...(task.effort === DEFAULT_EFFORT ? [] : [`(e${task.effort})`]),
    ...(task.category === null ? [] : [`@${task.category}`]),
    ...task.tags.map((tag) => `#${tag}`),
    ...(task.due === null ? [] : [`!${task.due}`]),
    ...(task.blockedByIds.length ? [`blocked-by:${task.blockedByIds.length}`] : []),
    `v${task.version}`,
  ].join(" ");
}
function taskDetail(task: TaskProjection, rootPath: string): string {
  return [
    `${task.id} [${task.status}] v${task.version}`,
    `title: ${task.title}`,
    `priority: ${task.priority}`,
    `effort: ${task.effort}`,
    `category: ${task.category === null ? "none" : `@${task.category}`}`,
    `tags: ${task.tags.map((tag) => `#${tag}`).join(" ") || "none"}`,
    `due: ${task.due ?? "none"}`,
    `parent: ${task.parentId ?? "none"}`,
    `depends-on: ${task.dependencyIds.join(", ") || "none"}`,
    `blocked-by: ${task.blockedByIds.join(", ") || "none"}`,
    ...task.attachments.map((name) => {
      const file = attachmentPath(rootPath, name);
      return `image: ${file}${existsSync(file) ? "" : " (missing)"}`;
    }),
    ...(task.description ? [`---\n${task.description}`] : []),
    `created: ${task.createdAt} updated: ${task.updatedAt} closed: ${task.closedAt ?? "none"}`,
  ].join("\n");
}
export function printHumanResult(
  command: string,
  response: Extract<Response, { ok: true }>,
  json: boolean,
  rootPath: string,
): void {
  // Info exposes transport authority for callers preparing their own stable key.
  const result =
    command === "workspace.info"
      ? { ...response.result, writeContext: response.writeContext }
      : response.result;
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const lines: string[] = [];
  if (result.readOnly === true || result.dryRun === true)
    lines.push("Preview only. No canonical effects, receipt or history.");
  if (Array.isArray(result.tasks)) {
    for (const task of (result.contextTasks as TaskProjection[] | undefined) ?? [])
      lines.push(`context: ${taskLine(task)}`);
    for (const task of result.tasks as TaskProjection[]) lines.push(taskLine(task));
    if (!result.tasks.length) lines.push("No tasks.");
    if (typeof result.total === "number") lines.push(`(${result.tasks.length} of ${result.total})`);
  } else if (result.task) lines.push(taskDetail(result.task as TaskProjection, rootPath));
  else if (Array.isArray(result.categories) || Array.isArray(result.tags)) {
    const marker = command === "category.list" ? "@" : "#",
      entries = (result.categories ?? result.tags) as { slug: string; taskCount: number }[];
    for (const entry of entries) lines.push(`${marker}${entry.slug} (${entry.taskCount})`);
    if (!entries.length) lines.push(command === "category.list" ? "No categories." : "No tags.");
  } else if (Array.isArray(result.activity)) {
    for (const entry of result.activity as {
      operationId: string;
      command: string;
      taskId: string | null;
      createdAt: string;
      actor: { label: string };
    }[])
      lines.push(
        `${entry.operationId} ${entry.createdAt} ${entry.command}${entry.taskId === null ? "" : ` ${entry.taskId}`} (${entry.actor.label})`,
      );
    if (!result.activity.length) lines.push("No activity.");
  } else lines.push(JSON.stringify(result, null, 2));
  if (result.changed === false) lines.push("No change.");
  if (typeof result.operationId === "string") lines.push(`operation: ${result.operationId}`);
  if (typeof result.recoveryLocation === "string")
    lines.push(`recovery: ${result.recoveryLocation}`);
  process.stdout.write(`${lines.join("\n")}\n`);
}
