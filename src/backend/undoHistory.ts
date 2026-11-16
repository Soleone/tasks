import type { DatabaseSync } from "node:sqlite";
import { CommandError } from "./errors.js";
import { parseCanonicalJson } from "./strictJson.js";
import { historyAffected, historyOrigin, historyTasks } from "./undoPlan.js";
import { isRecord } from "./protocol.js";
import type { HistorySource, UndoInput } from "./undoPlan.js";
import type { CanonicalTask } from "./taskModel.js";

type HistoryRow = { id: string; command: string; before_record: string; after_record: string };

function mentionsRemovedTask(record: unknown, removed: ReadonlySet<string>): boolean {
  const linksRemoved = historyTasks(record).some(
    (task) =>
      removed.has(task.id) ||
      (task.parentId !== null && removed.has(task.parentId)) ||
      task.dependencyIds.some((id) => removed.has(id)),
  );
  const scopesRemoved =
    isRecord(record) &&
    Array.isArray(record.scope) &&
    record.scope.some(
      (pair) => isRecord(pair) && typeof pair.id === "string" && removed.has(pair.id),
    );
  return linksRemoved || scopesRemoved;
}

/** Removed IDs, incoming historical links and complete ordered scopes cannot regain old undo eligibility on reappearance. */
export function invalidatePurgeUndo(
  database: DatabaseSync,
  context: string,
  purgedIds: readonly string[],
  purgeId: string,
): void {
  const removed = new Set(purgedIds);
  const claim = database.prepare("INSERT OR IGNORE INTO v2_undo_claims VALUES (?, ?, ?)");
  const rows = database
    .prepare("SELECT * FROM v2_operations WHERE context = ?")
    .all(context) as (HistoryRow & { task_id: string })[];
  for (const row of rows) {
    let touches = false;
    try {
      for (const raw of [row.before_record, row.after_record])
        if (mentionsRemovedTask(parseCanonicalJson(Buffer.from(raw)), removed)) touches = true;
    } catch (error) {
      if (!(error instanceof CommandError)) throw error;
      touches = true;
    }
    if (!touches) continue;
    const members = database
      .prepare("SELECT task_id FROM v2_operation_members WHERE operation_id = ?")
      .all(row.id) as { task_id: string }[];
    for (const id of new Set([row.task_id, ...members.map((member) => member.task_id)]))
      claim.run(row.id, id, purgeId);
  }
}

function operationById(
  database: DatabaseSync,
  context: string,
  id: string,
): HistoryRow | undefined {
  return database
    .prepare("SELECT * FROM v2_operations WHERE context = ? AND id = ?")
    .get(context, id) as HistoryRow | undefined;
}

function latestOperationOfTask(
  database: DatabaseSync,
  context: string,
  taskId: string,
): HistoryRow | undefined {
  return database
    .prepare(
      "SELECT operations.* FROM v2_operations AS operations WHERE context = ? AND (task_id = ? OR EXISTS (SELECT 1 FROM v2_operation_members AS members WHERE members.operation_id = operations.id AND members.task_id = ?)) ORDER BY operations.rowid DESC LIMIT 1",
    )
    .get(context, taskId, taskId) as HistoryRow | undefined;
}

function parseHistoryRow(row: HistoryRow): HistorySource {
  return {
    id: row.id,
    command: row.command,
    before: parseCanonicalJson(Buffer.from(row.before_record)),
    after: parseCanonicalJson(Buffer.from(row.after_record)),
  };
}

/** An undo or redo stays replayable only while it is the newest link in its origin's undo/redo chain and still holds every claim it made. */
function isCurrentReplay(
  database: DatabaseSync,
  source: HistorySource,
  origin: HistoryRow,
  previous: HistoryRow,
): boolean {
  const previousBefore = parseCanonicalJson(Buffer.from(previous.before_record));
  const claims = (source.before as { undoOf: { operationId: string; taskId: string }[] }).undoOf;
  const followsPrevious =
    source.command === "operation.redo"
      ? previous.command === "operation.undo"
      : previous.id === origin.id || previous.command === "operation.redo";
  const sharesOrigin =
    previous.id === origin.id ||
    (isRecord(previousBefore) && previousBefore.originId === origin.id);
  return (
    followsPrevious &&
    sharesOrigin &&
    claims.every(
      (claim) =>
        database
          .prepare("SELECT undo_id FROM v2_undo_claims WHERE operation_id = ? AND task_id = ?")
          .get(claim.operationId, claim.taskId)?.undo_id === source.id,
    )
  );
}

export function selectUndoHistory(
  database: DatabaseSync,
  context: string,
  input: UndoInput,
  tasks: CanonicalTask[],
): HistorySource[] {
  if (input.kind === "transition" || input.kind === "rename") return [];
  const code = input.kind === "status" ? "UNDO_UNAVAILABLE" : "OPERATION_UNAVAILABLE";
  const unavailable: () => never = () => {
    throw new CommandError(code, "eligible retained undo history is unavailable");
  };
  try {
    const rows =
      input.kind === "operation" || input.kind === "redo"
        ? [operationById(database, context, input.operationId)]
        : input.tasks.map((task) => latestOperationOfTask(database, context, task.id));
    return rows.map((row, index) => {
      if (!row) return unavailable();
      const source = parseHistoryRow(row);
      if (["operation.undo", "operation.redo"].includes(source.command)) {
        if (!isRecord(source.before) || typeof source.before.originId !== "string") unavailable();
        const origin = operationById(database, context, source.before.originId);
        if (!origin) unavailable();
        source.origin = parseHistoryRow(origin);
        historyOrigin(source);
        const claims = source.before.undoOf as { operationId: string }[];
        const previous = operationById(database, context, claims[0].operationId);
        if (!previous || !isCurrentReplay(database, source, origin, previous)) unavailable();
      }
      const ids = input.kind === "status" ? [input.tasks[index].id] : historyAffected(source);
      if (
        ids.length === 0 ||
        ids.some((id) =>
          database
            .prepare("SELECT 1 FROM v2_undo_claims WHERE operation_id = ? AND task_id = ?")
            .get(source.id, id),
        )
      )
        unavailable();
      const origin = historyOrigin(source);
      if (origin.command === "task.create" && source.command !== "operation.undo") {
        const created = historyTasks(origin.after)[0];
        if (
          ids.length !== 1 ||
          latestOperationOfTask(database, context, created.id)?.id !== source.id ||
          !tasks.some((task) => task.id === created.id)
        )
          unavailable();
      }
      return source;
    });
  } catch (error) {
    if (error instanceof CommandError) return unavailable();
    throw error;
  }
}
