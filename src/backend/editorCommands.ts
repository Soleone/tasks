import { RELATIONSHIP_COMMANDS } from "./taskRelationships.js";
import { STATUS_COMMANDS } from "./taskStatus.js";

/** The commands the app sends through the selected gateway. Eligibility stays with the gateway. */
export const EDITOR_COMMANDS = [
  "task.create",
  "task.update",
  ...STATUS_COMMANDS,
  "task.status.undo",
  ...RELATIONSHIP_COMMANDS,
  "task.reorder",
  "operation.undo",
  "operation.redo",
  "task.transitionMany",
  "attachment.write",
] as const;
