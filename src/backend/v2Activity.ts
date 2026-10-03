import type { DatabaseSync } from "node:sqlite";
import { CommandError } from "./errors.js";
import { assertV2Args } from "./v2Protocol.js";

export function listV2Activity(database: DatabaseSync, args: Record<string, unknown>, context: string): Record<string, unknown> {
  assertV2Args(args, ["taskId", "limit"]);
  if (args.taskId !== undefined && (typeof args.taskId !== "string" || !/^[A-Za-z0-9_-]+$/.test(args.taskId))) throw new CommandError("INVALID_ARGUMENT", "invalid activity taskId");
  const limit = args.limit ?? 50;
  if (typeof limit !== "number" || !Number.isSafeInteger(limit)) throw new CommandError("INVALID_ARGUMENT", "invalid activity limit");
  const taskId = args.taskId as string | undefined ?? null;
  const rows = database.prepare("SELECT operations.* FROM v2_operations AS operations WHERE context = ? AND (? IS NULL OR task_id = ? OR EXISTS (SELECT 1 FROM v2_operation_members AS members WHERE members.operation_id = operations.id AND members.task_id = ?)) ORDER BY operations.rowid DESC LIMIT ?")
    .all(context, taskId, taskId, taskId, Math.min(100, Math.max(1, limit))) as Record<string, string>[];
  return { activity: rows.map(row => ({
    operationId: row.id, taskId: row.task_id, actor: JSON.parse(row.actor), createdAt: row.created_at,
    command: row.command, before: JSON.parse(row.before_record), after: JSON.parse(row.after_record),
  })) };
}
