import { CommandError } from "./errors.js";
import { assertArgs } from "./protocol.js";
import { parseTaskVersion } from "./updateInputs.js";
import { validateTask } from "./taskModel.js";
import type { CanonicalTask } from "./taskModel.js";

export const STATUS_COMMANDS = [
  "task.start",
  "task.pause",
  "task.complete",
  "task.reopen",
  "task.cancel",
  "task.delete",
] as const;
export type StatusCommand = (typeof STATUS_COMMANDS)[number];
const transitions: Record<
  string,
  { sources: CanonicalTask["status"][]; target: CanonicalTask["status"] }
> = {
  "task.start": { sources: ["open", "in_progress", "paused", "done"], target: "in_progress" },
  "task.pause": { sources: ["open", "in_progress", "paused"], target: "paused" },
  "task.complete": { sources: ["open", "in_progress", "paused", "done"], target: "done" },
  "task.reopen": { sources: ["open", "in_progress", "paused", "done", "canceled"], target: "open" },
  "task.cancel": { sources: ["open", "in_progress", "paused", "canceled"], target: "canceled" },
  "task.delete": {
    sources: ["open", "in_progress", "paused", "done", "canceled"],
    target: "canceled",
  },
};

export function parseStatusInput(args: Record<string, unknown>): {
  id: string;
  expectedVersion: number;
} {
  assertArgs(args, ["id", "expectedVersion"]);
  return parseTaskVersion(args);
}

export function applyStatus(
  task: CanonicalTask,
  command: string,
  at: string,
): { task: CanonicalTask; changed: boolean } {
  const transition = transitions[command];
  if (!transition || !transition.sources.includes(task.status))
    throw new CommandError("INVALID_TRANSITION", "status transition is not allowed");
  if (task.status === transition.target) return { task, changed: false };
  const status = transition.target;
  return {
    task: validateTask(
      { ...task, status, closedAt: status === "done" || status === "canceled" ? at : null },
      task.id,
    ),
    changed: true,
  };
}
