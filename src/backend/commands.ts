import { getDatabasePath } from "./paths.js";
import { openDatabase, runRuntimeProbe } from "./database.js";
import { syncCanonicalWorkspace, withWorkspaceLock } from "./canonicalWorkspace.js";
import { CommandError } from "./errors.js";
import { abortReceiveWorkspace, isReceivingWorkspace, prepareReceiveWorkspace, receiveWorkspaceStatus } from "./receiveWorkspace.js";
import type { ProtocolRequest } from "./protocol.js";
import { executeTaskCommand } from "./tasks.js";
import { APP_NAME } from "./branding.js";
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
      if (request.command === "workspace.receive.prepare") return prepareReceiveWorkspace(database, databasePath);
      if (request.command === "workspace.receive.abort") return abortReceiveWorkspace(database, databasePath);
      if (request.command === "workspace.receive.status") return receiveWorkspaceStatus(database, databasePath);
      if (isReceivingWorkspace(databasePath)) {
        throw new CommandError("RECEIVE_PENDING", `${APP_NAME} is waiting for an incoming workspace`);
      }
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
