import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { TestProject } from "vite-plus/test/node";
import { startDevServer, type DevServer } from "../backend/devServer";
import { executeHomeLine } from "../backend/homeGateway";

declare module "vite-plus/test" {
  export interface ProvidedContext {
    workspaceServerUrl: string;
  }
}

// Client tests run as browser code in jsdom and can't start the dev bridge
// themselves, so this Node-side server starts one per disposable workspace.
const running = new Map<string, { dev: DevServer; directory: string }>();

async function startWorkspace(): Promise<string> {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-client-test-"));
  const root = path.join(directory, "sync");
  mkdirSync(path.join(root, "tasks"), { recursive: true });
  mkdirSync(path.join(directory, "local"));
  writeFileSync(path.join(root, "workspace.json"), JSON.stringify({ schemaVersion: 2 }));
  const dev = await startDevServer({ port: 0, home: directory });
  running.set(dev.url, { dev, directory });
  return dev.url;
}

async function stopWorkspace(url: string): Promise<void> {
  const entry = running.get(url);
  if (!entry) return;
  running.delete(url);
  await new Promise<void>((resolve) => entry.dev.server.close(() => resolve()));
  rmSync(entry.directory, { recursive: true, force: true });
}

function directoryOf(url: string): string {
  const entry = running.get(url);
  if (!entry) throw new Error(`no workspace at ${url}`);
  return entry.directory;
}

/** Answers one request the way `tasks-cli` does: against the home with the CLI's own cache. */
function runCli(url: string, request: unknown): unknown {
  return executeHomeLine(Buffer.from(JSON.stringify(request)), directoryOf(url), "cli");
}

/** A task file arriving in the sync folder, as Syncthing delivers one from another device. */
function arrive(url: string, name: string): object {
  copyFileSync(
    path.resolve("scripts/fixtures/workspace/root/tasks", path.basename(name)),
    path.join(directoryOf(url), "sync", "tasks", path.basename(name)),
  );
  return {};
}

async function body(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const workspace = url.searchParams.get("url") ?? "";
    const work =
      url.pathname === "/start"
        ? startWorkspace().then((devUrl) => ({ url: devUrl }))
        : url.pathname === "/cli"
          ? body(request).then((line) => runCli(workspace, line))
          : url.pathname === "/arrive"
            ? Promise.resolve().then(() => arrive(workspace, url.searchParams.get("name") ?? ""))
            : stopWorkspace(workspace).then(() => ({}));
    work.then(
      (body) => {
        response.writeHead(200, {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
        });
        response.end(JSON.stringify(body));
      },
      (error: unknown) => {
        response.writeHead(500, { "access-control-allow-origin": "*" });
        response.end(String(error));
      },
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  project.provide(
    "workspaceServerUrl",
    `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  );
  return async () => {
    await Promise.all([...running.keys()].map(stopWorkspace));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
}
