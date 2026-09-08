import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeCommand } from "./commands.js";
import { getDatabasePath } from "./paths.js";
import { errorResponse, parseRequest, successResponse } from "./protocol.js";

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
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1";
}

function readBody(request: http.IncomingMessage): Promise<string> {
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
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

export function startDevServer(options: DevServerOptions = {}): Promise<DevServer> {
  const databasePath = options.databasePath ?? process.env.TASKS_DATABASE_PATH ?? getDatabasePath();
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.TASKS_DEV_BACKEND_PORT ?? DEFAULT_DEV_BACKEND_PORT);

  const server = http.createServer((request, response) => {
    void handleRequest(request, response, databasePath).catch((error: unknown) => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify(errorResponse("unknown", error)));
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
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "600",
    });
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, databasePath }));
    return;
  }

  if (request.method === "POST" && (request.url === "/command" || request.url === "/")) {
    let requestId = "unknown";
    try {
      const parsed = JSON.parse(await readBody(request)) as unknown;
      const command = parseRequest(parsed);
      requestId = command.requestId;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(successResponse(requestId, executeCommand(command, databasePath))));
    } catch (error) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(errorResponse(requestId, error)));
    }
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "use POST /command or GET /health" } }));
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
  const databasePath = optionValue(args, "--database") ?? process.env.TASKS_DATABASE_PATH ?? undefined;

  const dev = await startDevServer(port === undefined && databasePath === undefined ? {} : { port, databasePath });
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
