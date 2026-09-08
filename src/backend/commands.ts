import { getDatabasePath } from "./paths.js";
import { openDatabase, runRuntimeProbe } from "./database.js";
import type { ProtocolRequest } from "./protocol.js";
import { executeTaskCommand } from "./tasks.js";

export function executeCommand(
  request: ProtocolRequest,
  databasePath = getDatabasePath(),
): Record<string, unknown> {
  if (request.command === "runtime.probe") {
    return runRuntimeProbe(databasePath) as unknown as Record<string, unknown>;
  }

  const database = openDatabase(databasePath);
  try {
    return executeTaskCommand(database, request);
  } finally {
    database.close();
  }
}
