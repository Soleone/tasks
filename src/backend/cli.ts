import { createInterface } from "node:readline";
import { executeCommand } from "./commands.js";
import { watchCanonicalWorkspace } from "./canonicalWorkspace.js";
import { getDatabasePath } from "./paths.js";
import {
  errorResponse,
  parseLine,
  parseRequest,
  successResponse,
  type ProtocolResponse,
} from "./protocol.js";

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function writeResponse(response: ProtocolResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function requestForProbe(): ReturnType<typeof parseRequest> {
  return parseRequest({
    version: 1,
    requestId: "runtime-probe",
    command: "runtime.probe",
  });
}

async function runStdio(databasePath: string): Promise<void> {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const backgroundSyncRequest = parseRequest({
    version: 1,
    requestId: "background-sync",
    command: "workspace.sync",
    actor: { kind: "system", label: "filesystem-watcher" },
  });
  let pending = Promise.resolve();
  let backgroundSync = Promise.resolve();
  const watcher = watchCanonicalWorkspace(databasePath, () => {
    backgroundSync = backgroundSync.then(() => {
      try {
        executeCommand(backgroundSyncRequest, databasePath);
      } catch (error) {
        process.stderr.write(`background sync: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    });
  });

  input.on("line", (line) => {
    if (line.trim() === "") {
      return;
    }

    pending = pending.then(() => {
      let requestId = "unknown";
      try {
        const request = parseLine(line);
        requestId = request.requestId;
        writeResponse(successResponse(requestId, executeCommand(request, databasePath)));
      } catch (error) {
        writeResponse(errorResponse(requestId, error));
      }
    });
  });

  await new Promise<void>((resolve) => {
    input.once("close", resolve);
  });
  watcher.close();
  await pending;
  await backgroundSync;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const databasePath = optionValue(args, "--database") ?? getDatabasePath();

  if (args.includes("--stdio")) {
    await runStdio(databasePath);
    return;
  }

  if (args.includes("--probe")) {
    const request = requestForProbe();
    writeResponse(successResponse(request.requestId, executeCommand(request, databasePath)));
    return;
  }

  process.stderr.write("Usage: tasks-backend --probe [--database PATH] | --stdio [--database PATH]\n");
  process.exitCode = 2;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
