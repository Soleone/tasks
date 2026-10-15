import { CommandError } from "./errors.js";
import { assertV2Args } from "./protocol.js";
import { parseV2TaskVersion } from "./updateInputs.js";
import { validateV2Task } from "./taskModel.js";
import type { V2CanonicalTask } from "./taskModel.js";

export const V2_STATUS_COMMANDS = ["task.start", "task.pause", "task.complete", "task.reopen", "task.cancel", "task.delete"] as const;
export type V2StatusCommand = typeof V2_STATUS_COMMANDS[number];
const transitions: Record<string, { sources: V2CanonicalTask["status"][]; target: V2CanonicalTask["status"] }> = {
  "task.start": { sources: ["open", "in_progress", "paused", "done"], target: "in_progress" },
  "task.pause": { sources: ["open", "in_progress", "paused"], target: "paused" },
  "task.complete": { sources: ["open", "in_progress", "paused", "done"], target: "done" },
  "task.reopen": { sources: ["open", "in_progress", "paused", "done", "canceled"], target: "open" },
  "task.cancel": { sources: ["open", "in_progress", "paused", "canceled"], target: "canceled" },
  "task.delete": { sources: ["open", "in_progress", "paused", "done", "canceled"], target: "canceled" },
};

export function parseV2StatusInput(args: Record<string, unknown>): { id: string; expectedVersion: number } {
  assertV2Args(args, ["id", "expectedVersion"]);
  return parseV2TaskVersion(args);
}

export function applyV2Status(task: V2CanonicalTask, command: string, at: string): { task: V2CanonicalTask; changed: boolean } {
  const transition = transitions[command];
  if (!transition || !transition.sources.includes(task.status)) throw new CommandError("INVALID_TRANSITION", "status transition is not allowed");
  if (task.status === transition.target) return { task, changed: false };
  const status = transition.target;
  return { task: validateV2Task({ ...task, status, closedAt: status === "done" || status === "canceled" ? at : null }, task.id), changed: true };
}
