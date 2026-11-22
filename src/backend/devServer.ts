import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isIP, type AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { trustRenames } from "./canonicalReader.js";
import { executeHomeLine } from "./homeGateway.js";
import { EDITOR_COMMANDS } from "./editorCommands.js";
import { homeCache, openHome } from "./home.js";
import { decodeEnvelope, parseRequest, QUERY_COMMANDS } from "./protocol.js";

/**
 * HTTP bridge over the same command path as the Tauri sidecar and CLI. `pnpm dev:web` uses it
 * to iterate on the UI in a plain browser with Vite HMR; `pnpm serve:web` adds the built UI on
 * the same port, for a machine without a desktop. Never package it in the apps; their traffic
 * stays on the sidecar stdio bridge.
 */
const DEFAULT_DEV_BACKEND_PORT = 5174;
// Attachments can be 10 MiB, which base64 grows to about 13.4 MiB.
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const HOME_COMMANDS = [
  "home.document.read",
  "home.document.write",
  "home.themes.list",
  "workspace.rebind",
  "workspace.newHistory",
];

type DevServerOptions = {
  port?: number;
  /** The address to listen on; loopback unless given. */
  host?: string;
  /** The Tasks home to edit. */
  home?: string;
  /** A built UI to serve next to the bridge, so the page and bridge share an origin. */
  webRoot?: string;
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

const LOOPBACK_NAMES = ["localhost", "127.0.0.1", "[::1]"];
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

// Any other name could be a stranger's domain pointed at this address (DNS rebinding), whose
// pages would count as same-origin, so the bridge answers only loopback names and bare IPs.
function isAllowedHost(host: string | undefined): boolean {
  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    return false;
  }
  return LOOPBACK_NAMES.includes(hostname) || isIP(hostname.replace(/^\[|\]$/g, "")) !== 0;
}

function isAllowedOrigin(origin: string, host: string | undefined): boolean {
  if (origin === `http://${host}`) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:") {
    return false;
  }
  return LOOPBACK_NAMES.includes(url.hostname);
}

function readBody(request: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("PAYLOAD_TOO_LARGE: request body exceeds 16 MiB"));
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
  trustRenames();
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

  const server = http.createServer((request, response) => {
    void handleRequest(request, response, selection, options.webRoot).catch(() => {
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
    server.listen(options.port ?? DEFAULT_DEV_BACKEND_PORT, options.host ?? "127.0.0.1", () => {
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
  webRoot: string | undefined,
): Promise<void> {
  const { host, origin } = request.headers;
  if (!isAllowedHost(host)) {
    response.writeHead(403, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ok: false,
        error: { code: "FORBIDDEN_HOST", message: "open this by IP address or localhost" },
      }),
    );
    return;
  }
  if (origin !== undefined && !isAllowedOrigin(origin, host)) {
    response.writeHead(403, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ok: false,
        error: { code: "FORBIDDEN_ORIGIN", message: "origin is not allowed" },
      }),
    );
    return;
  }

  if (origin !== undefined) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "Origin");
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

  if (request.method === "GET" && webRoot !== undefined) {
    const file = webFile(webRoot, request.url ?? "/");
    const body =
      file &&
      (await readFile(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      }));
    if (body) {
      response.writeHead(200, {
        "content-type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
        // Vite names assets by content hash; the page itself must be fetched fresh.
        "cache-control": file.endsWith("index.html")
          ? "no-cache"
          : "public, max-age=31536000, immutable",
      });
      response.end(body);
      return;
    }
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      ok: false,
      error: { code: "NOT_FOUND", message: "use POST /command or GET /health" },
    }),
  );
}

/** The page for `/`, or a file under `assets/`; nothing else in the build folder is served. */
function webFile(webRoot: string, url: string): string | undefined {
  const pathname = new URL(url, "http://bridge").pathname;
  if (pathname === "/") return path.join(webRoot, "index.html");
  if (!/^\/assets\/[\w.-]+$/.test(pathname)) return undefined;
  return path.join(webRoot, pathname);
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
      !HOME_COMMANDS.includes(request.command) &&
      request.command !== "workspace.doctor.inspect" &&
      request.command !== "workspace.export"
    ) {
      return {
        version: 2,
        requestId,
        ok: false,
        error: {
          code: "UNSUPPORTED_COMMAND",
          message:
            "the dev bridge permits only capture, content updates, single-task status changes, eligible status undo, parent/dependency edits, manual reorder, eligible operation undo, status batches, images, deleting canceled and done tasks, reviewed conflict repair, and backup/restore; order normalization, batch status undo and other controls remain unavailable",
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
  const host = optionValue(args, "--host");
  const webRoot = optionValue(args, "--web");

  const dev = await startDevServer({ port, host, home, webRoot });
  process.stdout.write(
    webRoot === undefined
      ? `tasks dev backend at ${dev.url} (db ${dev.databasePath})\n`
      : `Tasks for ${home} at ${dev.url}\n`,
  );

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
