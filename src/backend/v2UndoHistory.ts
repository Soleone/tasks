import type { DatabaseSync } from "node:sqlite";
import { CommandError } from "./errors.js";
import { parseV2CanonicalJson } from "./v2CanonicalJson.js";
import { historyAffected, historyTasks } from "./v2UndoPlan.js";
import type { V2HistorySource, V2UndoInput } from "./v2UndoPlan.js";
import type { V2CanonicalTask } from "./v2TaskModel.js";

type HistoryRow = { id: string; command: string; before_record: string; after_record: string };
function latest(database: DatabaseSync, context: string, taskId: string): HistoryRow | undefined {
  return database.prepare("SELECT operations.* FROM v2_operations AS operations WHERE context = ? AND (task_id = ? OR EXISTS (SELECT 1 FROM v2_operation_members AS members WHERE members.operation_id = operations.id AND members.task_id = ?)) ORDER BY operations.rowid DESC LIMIT 1").get(context, taskId, taskId) as HistoryRow | undefined;
}

export function selectV2UndoHistory(database: DatabaseSync, context: string, input: V2UndoInput, tasks: V2CanonicalTask[]): V2HistorySource[] {
  if (input.kind === "transition") return [];
  const code = input.kind === "status" ? "UNDO_UNAVAILABLE" : "OPERATION_UNAVAILABLE";
  const unavailable = (): never => { throw new CommandError(code, "eligible retained undo history is unavailable"); };
  try {
    const rows = input.kind === "operation"
      ? [database.prepare("SELECT * FROM v2_operations WHERE context = ? AND id = ?").get(context, input.operationId) as HistoryRow | undefined]
      : input.tasks.map(task => latest(database, context, task.id));
    return rows.map((row, index) => {
      if (!row) return unavailable();
      const source = { id: row.id, command: row.command, before: parseV2CanonicalJson(Buffer.from(row.before_record)), after: parseV2CanonicalJson(Buffer.from(row.after_record)) };
      const ids = input.kind === "status" ? [input.tasks[index].id] : historyAffected(source);
      if (ids.length === 0 || ids.some(id => database.prepare("SELECT 1 FROM v2_undo_claims WHERE operation_id = ? AND task_id = ?").get(source.id, id))) unavailable();
      if (source.command === "task.create") {
        const created = historyTasks(source.after)[0];
        if (ids.length !== 1 || latest(database, context, created.id)?.id !== source.id || !tasks.some(task => task.id === created.id)) unavailable();
      }
      return source;
    });
  } catch (error) { if (error instanceof CommandError) return unavailable(); throw error; }
}
