import http from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeCommand } from "../legacy/backend/commands.js";
import { getDataDirectory, getDatabasePath } from "./paths.js";
import {
  errorResponse,
  parseRequest as parseLegacyRequest,
  successResponse,
} from "../legacy/backend/protocol.js";
import { executeLine } from "./gateway.js";
import { LINUX_EDITOR_COMMANDS } from "./editorCommands.js";
import { decodeEnvelope, parseRequest, QUERY_COMMANDS } from "./protocol.js";

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
  /** The workspace folder to edit. Required unless `legacy` is set. */
  root?: string;
  /** Serve the legacy engine on its default database instead (removed at cutover). */
  legacy?: boolean;
};

type DevSelection = {
  version: 2;
  rootPath: string;
  databasePath: string;
  selectionToken: string;
  readOnly: false;
  profilePath: string;
  writeCommands: string[];
};

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
  return (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]" ||
    url.hostname === "::1"
  );
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
  if (!options.legacy) {
    if (!options.root?.trim() || !options.databasePath?.trim()) {
      throw new Error(
        "the dev bridge requires explicit --root PATH and --database CACHE_OUTSIDE_ROOT; there is no default workspace (use --legacy for the old app)",
      );
    }
    if (process.platform !== "linux")
      throw new Error("browser editing over the dev bridge runs only on Linux");
  }
  const databasePath = options.legacy
    ? (options.databasePath ?? process.env.TASKS_DATABASE_PATH ?? getDatabasePath())
    : path.resolve(options.databasePath!);
  const selection: DevSelection | undefined = options.legacy
    ? undefined
    : {
        version: 2,
        rootPath: path.resolve(options.root!),
        databasePath,
        selectionToken: randomUUID(),
        readOnly: false,
        profilePath: path.resolve(getDataDirectory()),
        writeCommands: [...LINUX_EDITOR_COMMANDS],
      };
  const host = options.host ?? "127.0.0.1";
  const port =
    options.port ?? Number(process.env.TASKS_DEV_BACKEND_PORT ?? DEFAULT_DEV_BACKEND_PORT);

  const server = http.createServer((request, response) => {
    void handleRequest(request, response, databasePath, selection).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(500, { "content-type": "application/json" });
      response.end(
        JSON.stringify(
          selection === undefined
            ? errorResponse("unknown", error)
            : {
                version: 2,
                requestId: null,
                ok: false,
                error: {
                  code: "INVALID_STORAGE",
                  message: "the dev bridge could not complete safely",
                },
              },
        ),
      );
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
  selection: DevSelection | undefined,
): Promise<void> {
  const origin = request.headers.origin;
  if (origin !== undefined && !isAllowedOrigin(origin)) {
    response.writeHead(403, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ok: false,
        error: { code: "FORBIDDEN_ORIGIN", message: "origin is not allowed" },
      }),
    );
    return;
  }

  const corsHeaders: Record<string, string> =
    origin !== undefined ? { "access-control-allow-origin": origin, vary: "Origin" } : {};
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
    response.end(
      JSON.stringify(
        selection === undefined ? { ok: true, databasePath } : { ok: true, ...selection },
      ),
    );
    return;
  }

  if (request.method === "POST" && (request.url === "/command" || request.url === "/")) {
    const body = await readBody(request);
    if (selection !== undefined) {
      const result = executeDevCommand(body, selection, request.headers["x-taskdb-selection"]);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(result));
      return;
    }
    let requestId = "unknown";
    try {
      const parsed = JSON.parse(body.toString("utf8")) as unknown;
      const command = parseLegacyRequest(parsed);
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
  response.end(
    JSON.stringify({
      ok: false,
      error: { code: "NOT_FOUND", message: "use POST /command or GET /health" },
    }),
  );
}

function executeDevCommand(
  body: Buffer,
  selection: DevSelection,
  token: string | string[] | undefined,
): unknown {
  let requestId: string | null = null;
  try {
    const request = parseRequest(decodeEnvelope(body));
    requestId = request.requestId;
    if (
      token !== selection.selectionToken ||
      selection.profilePath !== path.resolve(getDataDirectory())
    ) {
      return {
        version: 2,
        requestId,
        ok: false,
        error: {
          code: "STALE_DEV_SELECTION",
          message:
            "dev backend selection/profile changed; preserve the original envelope and paths for manual reconciliation; no automatic reconnection",
        },
      };
    }
    if (
      !(QUERY_COMMANDS as readonly string[]).includes(request.command) &&
      !(LINUX_EDITOR_COMMANDS as readonly string[]).includes(request.command)
    ) {
      return {
        version: 2,
        requestId,
        ok: false,
        error: {
          code: "UNSUPPORTED_COMMAND",
          message:
            "the dev bridge permits only capture, content updates, single-task status changes, eligible status undo, parent/dependency edits, manual reorder, eligible operation undo, status batches and backup/restore; order normalization, batch status undo and other controls remain unavailable",
        },
      };
    }
    return executeLine(body, selection.rootPath, selection.databasePath);
  } catch {
    return {
      version: 2,
      requestId,
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: "the dev bridge requires a valid protocol-2 request",
      },
    };
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
  const legacy = args.includes("--legacy");
  const root = optionValue(args, "--root");
  if (args.includes("--root") && (root === undefined || root.startsWith("--")))
    throw new Error("--root requires PATH");
  const databasePath =
    optionValue(args, "--database") ?? (legacy ? process.env.TASKS_DATABASE_PATH : undefined);

  const dev = await startDevServer({ port, databasePath, root, legacy });
  process.stdout.write(`tasks dev backend at ${dev.url} (db ${dev.databasePath})\n`);

  const shutdown = (): void => {
    dev.server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
