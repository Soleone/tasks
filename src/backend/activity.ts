import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CommandError } from "./errors.js";
import { assertArgs } from "./protocol.js";
import { isTimestamp } from "./taskModel.js";

export function listActivity(
  database: DatabaseSync,
  args: Record<string, unknown>,
  context: string,
): Record<string, unknown> {
  assertArgs(args, ["taskId", "limit", "since", "from"]);
  if (
    args.taskId !== undefined &&
    (typeof args.taskId !== "string" || !/^[A-Za-z0-9_-]+$/.test(args.taskId))
  )
    throw new CommandError("INVALID_ARGUMENT", "invalid activity taskId");
  const limit = args.limit ?? 50;
  if (typeof limit !== "number" || !Number.isSafeInteger(limit))
    throw new CommandError("INVALID_ARGUMENT", "invalid activity limit");
  if (args.since !== undefined && !isTimestamp(args.since))
    throw new CommandError("INVALID_ARGUMENT", "invalid activity since");
  if (args.from !== undefined && args.from !== "cli")
    throw new CommandError("INVALID_ARGUMENT", "invalid activity from");
  const taskId = (args.taskId as string | undefined) ?? null;
  const since = (args.since as string | undefined) ?? null;
  const rows = database
    .prepare(
      // Stored times share one exact form, so text order is time order.
      "SELECT operations.* FROM v2_operations AS operations WHERE context = ? AND (? IS NULL OR created_at > ?) AND (? IS NULL OR task_id = ? OR EXISTS (SELECT 1 FROM v2_operation_members AS members WHERE members.operation_id = operations.id AND members.task_id = ?)) ORDER BY operations.rowid DESC LIMIT ?",
    )
    .all(
      context,
      since,
      since,
      taskId,
      taskId,
      taskId,
      Math.min(100, Math.max(1, limit)),
    ) as Record<string, string>[];
  const members = database.prepare(
    "SELECT task_id FROM v2_operation_members WHERE operation_id = ? ORDER BY task_id",
  );
  return {
    activity: rows.map((row) => {
      const grouped = members.all(row.id).map((member) => member.task_id as string);
      return {
        operationId: row.id,
        taskId: row.task_id,
        taskIds: grouped.length > 0 ? grouped : [row.task_id],
        actor: JSON.parse(row.actor),
        createdAt: row.created_at,
        command: row.command,
        before: JSON.parse(row.before_record),
        after: JSON.parse(row.after_record),
      };
    }),
  };
}

/**
 * What the CLI on this device recorded, so the app can show what agents did. Each client keeps its
 * own cache in the home's local folder; the CLI's is only read here, never created or changed.
 */
export function listCliActivity(
  cachePath: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const cliCache = path.join(path.dirname(cachePath), "cli.db");
  if (!existsSync(cliCache)) return { activity: [] };
  const database = new DatabaseSync(cliCache, { readOnly: true });
  try {
    const state = database
      .prepare("SELECT context FROM v2_query_state WHERE singleton = 1")
      .get() as { context: string } | undefined;
    return state ? listActivity(database, args, state.context) : { activity: [] };
  } finally {
    database.close();
  }
}
