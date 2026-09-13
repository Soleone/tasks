import { getDatabasePath } from "./paths.js";
import { openDatabase, runRuntimeProbe } from "./database.js";
import { syncCanonicalWorkspace, withWorkspaceLock } from "./canonicalWorkspace.js";
import type { ProtocolRequest } from "./protocol.js";
import { executeTaskCommand } from "./tasks.js";
import { executeThemeCommand } from "./themes.js";

export function executeCommand(
  request: ProtocolRequest,
  databasePath = getDatabasePath(),
): Record<string, unknown> {
  if (request.command === "runtime.probe") {
    return runRuntimeProbe(databasePath) as unknown as Record<string, unknown>;
  }

  return withWorkspaceLock(databasePath, () => {
    const database = openDatabase(databasePath);
    try {
      const syncResult = syncCanonicalWorkspace(database, databasePath);
      // Theme commands read palette files beside the database, so they need its path.
      const result = request.command.startsWith("theme.")
        ? executeThemeCommand(database, databasePath, request)
        : executeTaskCommand(database, databasePath, request);
      return request.command === "workspace.sync" ? { ...result, lastSync: syncResult } : result;
    } finally {
      database.close();
    }
  });
}
