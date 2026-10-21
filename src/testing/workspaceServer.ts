import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { TestProject } from "vite-plus/test/node";
import { startDevServer, type DevServer } from "../backend/devServer";

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

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const work =
      url.pathname === "/start"
        ? startWorkspace().then((devUrl) => ({ url: devUrl }))
        : stopWorkspace(url.searchParams.get("url") ?? "").then(() => ({}));
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
