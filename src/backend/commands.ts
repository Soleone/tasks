import { getDatabasePath } from "./paths.js";
import { runRuntimeProbe } from "./database.js";
import type { RuntimeProbeRequest, RuntimeProbeResult } from "./protocol.js";

export function executeCommand(
  request: RuntimeProbeRequest,
  databasePath = getDatabasePath(),
): RuntimeProbeResult {
  switch (request.command) {
    case "runtime.probe":
      return runRuntimeProbe(databasePath);
  }
}
