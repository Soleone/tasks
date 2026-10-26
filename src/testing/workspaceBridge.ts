import { parentPort } from "node:worker_threads";
import { startDevServer, type DevServer } from "../backend/devServer";

export type BridgeCommand = { start: string } | { stop: string };
export type BridgeRequest = { id: number } & BridgeCommand;
export type BridgeReply = { id: number; url?: string; error?: string };

// A thread of dev bridges for `workspaceServer.ts`. Their durable writes block this thread only,
// not the test runner or another test's bridge.
const servers = new Map<string, DevServer>();
const port = parentPort!;

port.on("message", (request: BridgeRequest) => {
  answer(request).then(
    (url) => port.postMessage({ id: request.id, url } satisfies BridgeReply),
    (error: unknown) =>
      port.postMessage({ id: request.id, error: String(error) } satisfies BridgeReply),
  );
});

async function answer(request: BridgeRequest): Promise<string | undefined> {
  if ("start" in request) {
    const dev = await startDevServer({ port: 0, home: request.start });
    servers.set(dev.url, dev);
    return dev.url;
  }
  const dev = servers.get(request.stop);
  servers.delete(request.stop);
  await new Promise<void>((resolve) => (dev ? dev.server.close(() => resolve()) : resolve()));
  return undefined;
}
