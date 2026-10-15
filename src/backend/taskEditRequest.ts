import type { V2Request } from "./protocol.js";
import { V2_RELATIONSHIP_COMMANDS, parseV2Relationship } from "./taskRelationships.js";
import type { V2RelationshipInput } from "./taskRelationships.js";
import { V2_STATUS_COMMANDS, parseV2StatusInput } from "./taskStatus.js";
import type { V2StatusCommand } from "./taskStatus.js";
import { parseV2Update } from "./updateInputs.js";
import type { V2UpdateInput } from "./updateInputs.js";

export type V2TaskEditCommand = "task.update" | V2StatusCommand | typeof V2_RELATIONSHIP_COMMANDS[number];
export type V2TaskEditRequest = V2Request & { command: V2TaskEditCommand };
export type V2DecodedTaskEdit =
  | { kind: "content"; input: V2UpdateInput }
  | { kind: "status"; command: V2StatusCommand; input: ReturnType<typeof parseV2StatusInput> }
  | { kind: "relationship"; input: V2RelationshipInput };

export function isV2TaskEditRequest(request: V2Request): request is V2TaskEditRequest {
  return request.command === "task.update" || (V2_STATUS_COMMANDS as readonly string[]).includes(request.command)
    || (V2_RELATIONSHIP_COMMANDS as readonly string[]).includes(request.command);
}

export function decodeV2TaskEdit(request: V2TaskEditRequest): V2DecodedTaskEdit {
  // Keep request.args untouched: receipt identity covers the original spelling, not this normalized input.
  switch (request.command) {
    case "task.update": return { kind: "content", input: parseV2Update(request.args) };
    case "task.move":
    case "task.dependency.add":
    case "task.dependency.remove": return { kind: "relationship", input: parseV2Relationship(request.command, request.args) };
    default: return { kind: "status", command: request.command, input: parseV2StatusInput(request.args) };
  }
}
