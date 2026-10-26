import { build } from "esbuild";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type { TestProject } from "vite-plus/test/node";
import { executeHomeLine } from "../backend/homeGateway";
import type { BridgeCommand, BridgeReply, BridgeRequest } from "./workspaceBridge";

declare module "vite-plus/test" {
  export interface ProvidedContext {
    workspaceServerUrl: string;
  }
}

// Client tests run as browser code in jsdom and can't start the dev bridge
// themselves, so this Node-side server starts one per disposable workspace.
// A bridge runs commands synchronously, so each runs on a thread with no other workspace:
// on one shared thread, parallel tests waited behind each other's durable writes.
type BridgeThread = {
  worker: Worker;
  workspaces: number;
  replies: Map<number, (reply: BridgeReply) => void>;
};
const threads: BridgeThread[] = [];
const running = new Map<string, { thread: BridgeThread; directory: string }>();
let bridgeScript = "";
let nextRequest = 0;

function startThread(): BridgeThread {
  // Imported from an eval script: as the thread's main module, the bundle would run devServer's CLI.
  const worker = new Worker(`import(${JSON.stringify(pathToFileURL(bridgeScript).href)})`, {
    eval: true,
  });
  const thread: BridgeThread = { worker, workspaces: 0, replies: new Map() };
  worker.on("message", (reply: BridgeReply) => {
    thread.replies.get(reply.id)?.(reply);
    thread.replies.delete(reply.id);
  });
  threads.push(thread);
  return thread;
}

function ask(thread: BridgeThread, command: BridgeCommand): Promise<BridgeReply> {
  const id = nextRequest++;
  return new Promise((resolve, reject) => {
    thread.replies.set(id, (reply) =>
      reply.error === undefined ? resolve(reply) : reject(new Error(reply.error)),
    );
    thread.worker.postMessage({ id, ...command } satisfies BridgeRequest);
  });
}

async function startWorkspace(): Promise<string> {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-client-test-"));
  const root = path.join(directory, "sync");
  mkdirSync(path.join(root, "tasks"), { recursive: true });
  mkdirSync(path.join(directory, "local"));
  writeFileSync(path.join(root, "workspace.json"), JSON.stringify({ schemaVersion: 2 }));
  const thread = threads.find((candidate) => candidate.workspaces === 0) ?? startThread();
  thread.workspaces += 1;
  const { url } = await ask(thread, { start: directory });
  running.set(url!, { thread, directory });
  return url!;
}

async function stopWorkspace(url: string): Promise<void> {
  const entry = running.get(url);
  if (!entry) return;
  running.delete(url);
  await ask(entry.thread, { stop: url });
  entry.thread.workspaces -= 1;
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

/** An image file removed on another device, or not synced here yet. */
function loseImage(url: string, name: string): object {
  rmSync(path.join(directoryOf(url), "sync", "attachments", path.basename(name)));
  return {};
}

async function body(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const bundle = mkdtempSync(path.join(os.tmpdir(), "tasks-client-bridge-"));
  bridgeScript = path.join(bundle, "workspaceBridge.mjs");
  await build({
    entryPoints: [path.resolve("src/testing/workspaceBridge.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: bridgeScript,
    logLevel: "error",
  });
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
            : url.pathname === "/lose-image"
              ? Promise.resolve().then(() =>
                  loseImage(workspace, url.searchParams.get("name") ?? ""),
                )
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
    await Promise.all(threads.map((thread) => thread.worker.terminate()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(bundle, { recursive: true, force: true });
  };
}
