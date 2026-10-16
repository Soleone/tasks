import { batchIntentPlan } from "./batchJournal.js";
import type { PendingIntent } from "./pending.js";
import { STATUS_COMMANDS } from "./taskStatus.js";
import type { HistorySource } from "./undoPlan.js";

export function isSingleStatusSource(source: HistorySource): boolean {
  return (STATUS_COMMANDS as readonly string[]).includes(source.command);
}

/** Windows proof checks concrete families and destination scope, including receipt-based cleanup. */
export function isWindowsProofIntent(intent: PendingIntent): boolean {
  if (intent.format === "taskdb.pending-update") {
    return (
      intent.request.command === "task.update" ||
      (STATUS_COMMANDS as readonly string[]).includes(intent.request.command)
    );
  }
  if (intent.format === "taskdb.pending-copy") {
    return (
      ["workspace.archive", "workspace.restore"].includes(intent.request.command) &&
      intent.destination.identity === null &&
      intent.migration === undefined
    );
  }
  if (
    intent.format !== "taskdb.pending-batch" ||
    intent.request.command !== "task.status.undo" ||
    intent.sources.length !== 1 ||
    !isSingleStatusSource(intent.sources[0])
  )
    return false;
  const id = intent.request.args.id,
    plan = batchIntentPlan(intent);
  const changed = intent.files.filter((file) => file.beforeBytes !== file.nextBytes);
  return (
    typeof id === "string" &&
    plan.selectedIds.length === 1 &&
    plan.selectedIds[0] === id &&
    plan.affectedIds.length === 1 &&
    plan.affectedIds[0] === id &&
    plan.removedIds.length === 0 &&
    plan.claims.length === 1 &&
    plan.claims[0].taskId === id &&
    plan.claims[0].operationId === intent.sources[0].id &&
    changed.length === 1 &&
    changed[0].taskId === id &&
    changed[0].nextBytes !== null
  );
}
