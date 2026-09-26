import { getDatabasePath } from "./paths.js";
import { openDatabase, runRuntimeProbe } from "./database.js";
import { syncCanonicalWorkspace, withWorkspaceLock } from "./canonicalWorkspace.js";
import { executeSourceRegistryCommand } from "./sourceController.js";
import { readSourceRegistry } from "./sourceRegistry.js";
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
  const registryPath = process.env.TASKS_SOURCE_REGISTRY_PATH?.trim();
  if (registryPath !== undefined && registryPath !== "" && request.command !== "runtime.probe") {
    const registry = readSourceRegistry(registryPath);
    return executeSourceRegistryCommand(request, registry, executeWorkspaceCommand);
  }
  if (request.command !== "source.list"
    && (request.args.ref !== undefined || request.args.sourceKey !== undefined || request.args.sourceKeys !== undefined)) {
    throw new CommandError("SOURCE_REGISTRY_REQUIRED", "source references require TASKS_SOURCE_REGISTRY_PATH");
  }
  if (request.command === "source.list") return { sources: [] };
  return executeWorkspaceCommand(request, databasePath);
}

function executeWorkspaceCommand(
  request: ProtocolRequest,
  databasePath: string,
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
