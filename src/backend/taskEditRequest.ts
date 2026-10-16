import type { Request } from "./protocol.js";
import { RELATIONSHIP_COMMANDS, parseRelationship } from "./taskRelationships.js";
import type { RelationshipInput } from "./taskRelationships.js";
import { STATUS_COMMANDS, parseStatusInput } from "./taskStatus.js";
import type { StatusCommand } from "./taskStatus.js";
import { parseUpdate } from "./updateInputs.js";
import type { UpdateInput } from "./updateInputs.js";

type TaskEditCommand = "task.update" | StatusCommand | typeof RELATIONSHIP_COMMANDS[number];
export type TaskEditRequest = Request & { command: TaskEditCommand };
export type DecodedTaskEdit =
  | { kind: "content"; input: UpdateInput }
  | { kind: "status"; command: StatusCommand; input: ReturnType<typeof parseStatusInput> }
  | { kind: "relationship"; input: RelationshipInput };

export function isTaskEditRequest(request: Request): request is TaskEditRequest {
  return request.command === "task.update" || (STATUS_COMMANDS as readonly string[]).includes(request.command)
    || (RELATIONSHIP_COMMANDS as readonly string[]).includes(request.command);
}

export function decodeTaskEdit(request: TaskEditRequest): DecodedTaskEdit {
  // Keep request.args untouched: receipt identity covers the original spelling, not this normalized input.
  switch (request.command) {
    case "task.update": return { kind: "content", input: parseUpdate(request.args) };
    case "task.move":
    case "task.dependency.add":
    case "task.dependency.remove": return { kind: "relationship", input: parseRelationship(request.command, request.args) };
    default: return { kind: "status", command: request.command, input: parseStatusInput(request.args) };
  }
}
