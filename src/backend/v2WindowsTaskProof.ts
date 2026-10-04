import { batchIntentPlan } from "./v2BatchJournal.js";
import type { V2PendingIntent } from "./v2Pending.js";
import { V2_STATUS_COMMANDS } from "./v2TaskStatus.js";
import type { V2HistorySource } from "./v2UndoPlan.js";

export function isV2SingleStatusSource(source: V2HistorySource): boolean {
  return (V2_STATUS_COMMANDS as readonly string[]).includes(source.command);
}

/** Windows proof authorizes only the published single-task families, including receipt-based cleanup. */
export function isV2WindowsProofIntent(intent: V2PendingIntent): boolean {
  if (intent.format === "taskdb.pending-create") return intent.request.command === "task.create";
  if (intent.format === "taskdb.pending-update") {
    return intent.request.command === "task.update" || (V2_STATUS_COMMANDS as readonly string[]).includes(intent.request.command);
  }
  if (intent.format !== "taskdb.pending-batch" || intent.request.command !== "task.status.undo"
    || intent.sources.length !== 1 || !isV2SingleStatusSource(intent.sources[0])) return false;
  const id = intent.request.args.id, plan = batchIntentPlan(intent);
  const changed = intent.files.filter(file => file.beforeBytes !== file.nextBytes);
  return typeof id === "string" && plan.selectedIds.length === 1 && plan.selectedIds[0] === id
    && plan.affectedIds.length === 1 && plan.affectedIds[0] === id && plan.removedIds.length === 0
    && plan.claims.length === 1 && plan.claims[0].taskId === id && plan.claims[0].operationId === intent.sources[0].id
    && changed.length === 1 && changed[0].taskId === id && changed[0].nextBytes !== null;
}
