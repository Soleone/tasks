import { createInterface } from "node:readline";
import path from "node:path";
import { realpathSync } from "node:fs";
import { executeCommand } from "./commands.js";
import { watchCanonicalWorkspace, withCanonicalRootPath } from "./canonicalWorkspace.js";
import { readSourceRegistry } from "./sourceRegistry.js";
import { getDatabasePath } from "./paths.js";
import { executeV2Line } from "./v2Gateway.js";
import { localPathOutsideV2Root } from "./v2QueryCache.js";
import type { V2Response } from "./v2Protocol.js";
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

function writeResponse(response: ProtocolResponse | V2Response): void {
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
  const onCanonicalChange = (): void => {
    backgroundSync = backgroundSync.then(() => {
      try {
        executeCommand(backgroundSyncRequest, databasePath);
      } catch (error) {
        process.stderr.write(`background sync: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    });
  };
  const registryPath = process.env.TASKS_SOURCE_REGISTRY_PATH?.trim();
  const watchers = registryPath
    ? readSourceRegistry(registryPath).sources.map((source) => withCanonicalRootPath(
      source.databasePath,
      source.syncRoot,
      () => watchCanonicalWorkspace(source.databasePath, onCanonicalChange),
    ))
    : [watchCanonicalWorkspace(databasePath, onCanonicalChange)];

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
  for (const watcher of watchers) watcher.close();
  await pending;
  await backgroundSync;
}

async function runV2Stdio(rootPath: string, cachePath: string, writerProfile?: "windows-update-proof"): Promise<void> {
  let buffered = Buffer.alloc(0);
  const respond = (line: Buffer): void => {
    if (line.every(byte => byte === 0x20 || byte === 0x09 || byte === 0x0d)) return;
    writeResponse(executeV2Line(line, rootPath, cachePath, writerProfile));
  };
  // Frame bytes before UTF-8 decoding so invalid input cannot become replacement characters.
  for await (const chunk of process.stdin) {
    buffered = Buffer.concat([buffered, chunk as Buffer]);
    let newline: number;
    while ((newline = buffered.indexOf(0x0a)) !== -1) {
      respond(buffered.subarray(0, newline));
      buffered = buffered.subarray(newline + 1);
    }
  }
  if (buffered.length > 0) respond(buffered);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const windowsUpdateProof = args.includes("--windows-update-proof");
  const localProfile = optionValue(args, "--local-profile");
  if (windowsUpdateProof || args.includes("--local-profile")) {
    if (!windowsUpdateProof || process.platform !== "win32" || !args.includes("--v2-root")
      || !localProfile || !/^[A-Za-z]:[\\/]/.test(localProfile) || localProfile.includes("\u0000")) {
      throw new Error("Windows update proof requires Windows, --v2-root, --database and --local-profile ABSOLUTE_NTFS_PATH");
    }
    process.env.APPDATA = path.win32.resolve(localProfile);
  }
  if (args.includes("--v2-root")) {
    const rootPath = optionValue(args, "--v2-root");
    const cachePath = optionValue(args, "--database");
    if (!args.includes("--stdio") || args.includes("--probe") || !rootPath?.trim() || !cachePath?.trim()
      || rootPath.startsWith("--") || cachePath.startsWith("--")) {
      throw new Error("v2 requires --stdio --v2-root PATH --database CACHE_OUTSIDE_ROOT");
    }
    if (windowsUpdateProof) {
      if ([rootPath, cachePath].some(value => !/^[A-Za-z]:[\\/]/.test(value) || value.includes("\u0000"))) {
        throw new Error("Windows update proof requires explicit local absolute root/cache paths");
      }
      localPathOutsideV2Root(localProfile!, realpathSync(rootPath));
    }
    await runV2Stdio(rootPath, cachePath, windowsUpdateProof ? "windows-update-proof" : undefined);
    return;
  }
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

  process.stderr.write("Usage: tasks-backend --probe [--database PATH] | --stdio [--database PATH] | --stdio --v2-root PATH --database CACHE_OUTSIDE_ROOT [--windows-update-proof --local-profile ABSOLUTE_NTFS_PATH]\n");
  process.exitCode = 2;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
