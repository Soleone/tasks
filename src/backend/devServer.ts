import http from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeHomeLine } from "./homeGateway.js";
import { EDITOR_COMMANDS } from "./editorCommands.js";
import { homeCache, openHome } from "./home.js";
import { decodeEnvelope, parseRequest, QUERY_COMMANDS } from "./protocol.js";

/**
 * Dev-only HTTP bridge over the same command path as the Tauri sidecar and
 * CLI. It exists so `pnpm dev:web` can iterate on the UI in a plain browser
 * with Vite HMR against a real task folder. Never package or ship this;
 * production desktop traffic stays on the sidecar stdio bridge.
 */
export const DEFAULT_DEV_BACKEND_PORT = 5174;
// Documents can be up to 1 MiB, so the body allows for their JSON escaping.
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const HOME_COMMANDS = [
  "home.document.read",
  "home.document.write",
  "workspace.rebind",
  "workspace.newHistory",
];

export type DevServerOptions = {
  port?: number;
  host?: string;
  /** The Tasks home to edit. */
  home?: string;
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
  if (!options.home?.trim()) {
    throw new Error("the dev bridge requires an explicit --home PATH; there is no default home");
  }
  if (process.platform !== "linux")
    throw new Error("browser editing over the dev bridge runs only on Linux");
  const home = openHome(options.home);
  const databasePath = homeCache(home, "app");
  const selection: DevSelection = {
    version: 2,
    rootPath: home.rootPath,
    databasePath,
    selectionToken: randomUUID(),
    readOnly: false,
    profilePath: home.homePath,
    writeCommands: [...EDITOR_COMMANDS],
  };
  const host = options.host ?? "127.0.0.1";
  const port =
    options.port ?? Number(process.env.TASKS_DEV_BACKEND_PORT ?? DEFAULT_DEV_BACKEND_PORT);

  const server = http.createServer((request, response) => {
    void handleRequest(request, response, selection).catch(() => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(500, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          version: 2,
          requestId: null,
          ok: false,
          error: { code: "INVALID_STORAGE", message: "the dev bridge could not complete safely" },
        }),
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
  selection: DevSelection,
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
    response.end(JSON.stringify({ ok: true, ...selection }));
    return;
  }

  if (request.method === "POST" && (request.url === "/command" || request.url === "/")) {
    const body = await readBody(request);
    const result = executeDevCommand(body, selection, request.headers["x-taskdb-selection"]);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(result));
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
    if (token !== selection.selectionToken) {
      return {
        version: 2,
        requestId,
        ok: false,
        error: {
          code: "STALE_DEV_SELECTION",
          message:
            "dev backend selection changed; preserve the original envelope and paths for manual reconciliation; no automatic reconnection",
        },
      };
    }
    if (
      !(QUERY_COMMANDS as readonly string[]).includes(request.command) &&
      !(EDITOR_COMMANDS as readonly string[]).includes(request.command) &&
      !HOME_COMMANDS.includes(request.command)
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
    return executeHomeLine(body, selection.profilePath, "app");
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
  const home = optionValue(args, "--home");
  if (home === undefined || home.startsWith("--")) throw new Error("--home requires PATH");

  const dev = await startDevServer({ port, home });
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
