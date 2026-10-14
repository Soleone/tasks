import http from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeCommand } from "./commands.js";
import { getDataDirectory, getDatabasePath } from "./paths.js";
import { V2_STATUS_COMMANDS } from "./v2TaskStatus.js";
import { errorResponse, parseRequest, successResponse } from "./protocol.js";
import { executeV2Line } from "./v2Gateway.js";
import { V2_RELATIONSHIP_COMMANDS } from "./v2TaskRelationships.js";
import { decodeV2Envelope, parseV2Request, V2_QUERY_COMMANDS } from "./v2Protocol.js";

/**
 * Dev-only HTTP bridge over the same command path as the Tauri sidecar and
 * CLI. It exists so `pnpm dev:web` can iterate on the UI in a plain browser
 * with Vite HMR against real SQLite storage. Never package or ship this;
 * production desktop traffic stays on the sidecar stdio bridge.
 */
export const DEFAULT_DEV_BACKEND_PORT = 5174;
const MAX_BODY_BYTES = 1024 * 1024;

export type DevServerOptions = {
  port?: number;
  host?: string;
  databasePath?: string;
  v2Root?: string;
  v2Edit?: boolean;
};

// Same ordered list as the Linux main-client editor: the native list plus parent/dependency edits,
// manual reorder, operation undo and status batches. Eligibility stays with the gateway.
const V2_EDITOR_COMMANDS = ["task.create", "task.update", ...V2_STATUS_COMMANDS, "task.status.undo", ...V2_RELATIONSHIP_COMMANDS, "task.reorder", "operation.undo", "task.transitionMany", "workspace.archive", "workspace.restore"];
type V2DevSelection = { version: 2; rootPath: string; databasePath: string; selectionToken: string; readOnly: boolean; profilePath?: string; writeCommands?: string[] };

export type DevServer = {
  server: http.Server;
  url: string;
  port: number;
  databasePath: string;
};

function isAllowedOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:") {
    return false;
  }
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1";
}

function readBody(request: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("PAYLOAD_TOO_LARGE: request body exceeds 1 MiB"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

export function startDevServer(options: DevServerOptions = {}): Promise<DevServer> {
  if (options.v2Edit && options.v2Root === undefined) throw new Error("--v2-edit requires explicit --v2-root and --database");
  if (options.v2Edit && process.platform !== "linux") throw new Error("v2 browser editing is unavailable on this platform");
  if (options.v2Root !== undefined && (!options.v2Root.trim() || !options.databasePath?.trim())) {
    throw new Error("v2 requires explicit --v2-root PATH and --database CACHE_OUTSIDE_ROOT; no environment/default fallback");
  }
  const databasePath = options.v2Root === undefined
    ? options.databasePath ?? process.env.TASKS_DATABASE_PATH ?? getDatabasePath()
    : path.resolve(options.databasePath!);
  const selection: V2DevSelection | undefined = options.v2Root === undefined ? undefined : {
    version: 2, rootPath: path.resolve(options.v2Root), databasePath, selectionToken: randomUUID(), readOnly: !options.v2Edit,
    ...(options.v2Edit ? { profilePath: path.resolve(getDataDirectory()), writeCommands: V2_EDITOR_COMMANDS } : {}),
  };
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.TASKS_DEV_BACKEND_PORT ?? DEFAULT_DEV_BACKEND_PORT);

  const server = http.createServer((request, response) => {
    void handleRequest(request, response, databasePath, selection).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify(selection === undefined ? errorResponse("unknown", error) : {
        version: 2, requestId: null, ok: false, error: { code: "INVALID_STORAGE", message: "v2 dev bridge could not complete safely" },
      }));
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address() as AddressInfo;
      resolve({
        server,
        url: `http://${address.address}:${address.port}`,
        port: address.port,
        databasePath,
      });
    });
  });
}

async function handleRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  databasePath: string,
  selection: V2DevSelection | undefined,
): Promise<void> {
  const origin = request.headers.origin;
  if (origin !== undefined && !isAllowedOrigin(origin)) {
    response.writeHead(403, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false, error: { code: "FORBIDDEN_ORIGIN", message: "origin is not allowed" } }));
    return;
  }

  const corsHeaders: Record<string, string> = origin !== undefined
    ? { "access-control-allow-origin": origin, vary: "Origin" }
    : {};
  for (const [name, value] of Object.entries(corsHeaders)) {
    response.setHeader(name, value);
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, x-taskdb-selection",
      "access-control-max-age": "600",
    });
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(selection === undefined ? { ok: true, databasePath } : { ok: true, ...selection }));
    return;
  }

  if (request.method === "POST" && (request.url === "/command" || request.url === "/")) {
    const body = await readBody(request);
    if (selection !== undefined) {
      const result = executeDevV2Command(body, selection, request.headers["x-taskdb-selection"]);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(result));
      return;
    }
    let requestId = "unknown";
    try {
      const parsed = JSON.parse(body.toString("utf8")) as unknown;
      const command = parseRequest(parsed);
      requestId = command.requestId;
      // Run the command before writing the head: a rejected command must
      // answer through the catch, not crash the bridge with double headers.
      const result = executeCommand(command, databasePath);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(successResponse(requestId, result)));
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(errorResponse(requestId, error)));
    }
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "use POST /command or GET /health" } }));
}

function executeDevV2Command(body: Buffer, selection: V2DevSelection, token: string | string[] | undefined): unknown {
  let requestId: string | null = null;
  try {
    const request = parseV2Request(decodeV2Envelope(body));
    requestId = request.requestId;
    if (token !== selection.selectionToken || (selection.profilePath !== undefined && selection.profilePath !== path.resolve(getDataDirectory()))) {
      return { version: 2, requestId, ok: false, error: { code: "STALE_DEV_SELECTION", message: selection.readOnly ? "dev backend selection changed; reload and confirm the selected folder" : "dev backend selection/profile changed; preserve the original envelope and paths for manual reconciliation; no automatic reconnection" } };
    }
    if (!(V2_QUERY_COMMANDS as readonly string[]).includes(request.command)
      && (selection.readOnly || !V2_EDITOR_COMMANDS.includes(request.command))) {
      return { version: 2, requestId, ok: false, error: { code: "UNSUPPORTED_COMMAND", message: selection.readOnly ? "v2 dev app bridge is read-only; use explicit CLI controls outside the app" : "v2 dev editor permits only capture, content updates, single-task status changes, eligible status undo, parent/dependency edits, manual reorder, eligible operation undo and status batches; order normalization, batch status undo and other controls remain unavailable" } };
    }
    return executeV2Line(body, selection.rootPath, selection.databasePath);
  } catch {
    return { version: 2, requestId, ok: false, error: { code: "INVALID_REQUEST", message: "v2 dev app bridge requires a valid protocol-2 request" } };
  }
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const portText = optionValue(args, "--port") ?? process.env.TASKS_DEV_BACKEND_PORT;
  const port = portText === undefined ? undefined : Number(portText);
  if (port !== undefined && (!Number.isInteger(port) || port < 0)) {
    throw new Error("--port must be a non-negative integer");
  }
  const v2Root = optionValue(args, "--v2-root");
  if (args.includes("--v2-root") && (v2Root === undefined || v2Root.startsWith("--"))) throw new Error("--v2-root requires PATH");
  const databasePath = optionValue(args, "--database") ?? (v2Root === undefined ? process.env.TASKS_DATABASE_PATH : undefined);

  const dev = await startDevServer({ port, databasePath, v2Root, v2Edit: args.includes("--v2-edit") });
  process.stdout.write(`tasks dev backend at ${dev.url} (db ${dev.databasePath})\n`);

  const shutdown = (): void => {
    dev.server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const invokedDirectly = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
