import { RELATIONSHIP_COMMANDS } from "./taskRelationships.js";
import { STATUS_COMMANDS } from "./taskStatus.js";

/** The proven Windows native editor list; native relationship writers remain withheld. */
export const EDITOR_COMMANDS = [
  "task.create",
  "task.update",
  ...STATUS_COMMANDS,
  "task.status.undo",
] as const;
/** Linux workflow commands through the selected gateway: the native list plus parent/dependency edits, manual reorder, operation undo, status batches and backup. Eligibility stays with the gateway. */
export const LINUX_EDITOR_COMMANDS = [
  ...EDITOR_COMMANDS,
  ...RELATIONSHIP_COMMANDS,
  "task.reorder",
  "operation.undo",
  "task.transitionMany",
  "workspace.archive",
  "workspace.restore",
] as const;
