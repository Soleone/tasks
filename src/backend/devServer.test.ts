import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startDevServer } from "./devServer.js";

test("dev server answers only local origins, with the selected folder's token", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-dev-origin-"));
  mkdirSync(path.join(directory, "sync"));
  mkdirSync(path.join(directory, "local"));
  const dev = await startDevServer({ port: 0, home: directory });
  const post = (origin: string, token?: string) =>
    fetch(`${dev.url}/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        ...(token ? { "x-taskdb-selection": token } : {}),
      },
      body: JSON.stringify({ version: 2, command: "workspace.info", readOnly: true }),
    });

  try {
    const health = (await (await fetch(`${dev.url}/health`)).json()) as {
      ok: boolean;
      rootPath: string;
      selectionToken: string;
    };
    assert.equal(health.ok, true);
    assert.equal(health.rootPath, path.join(directory, "sync"));

    assert.equal((await post("https://example.com", health.selectionToken)).status, 403);
    const allowed = await post("http://localhost:5173", health.selectionToken);
    assert.equal(allowed.status, 200);
    assert.equal(((await allowed.json()) as { ok: boolean }).ok, true);
    const tokenless = (await (await post("http://localhost:5173")).json()) as {
      error: { code: string };
    };
    assert.equal(tokenless.error.code, "STALE_DEV_SELECTION");
  } finally {
    await new Promise<void>((resolve) => dev.server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

/** Node's fetch replaces a given Host header, which these checks need to set. */
function send(
  port: number,
  pathname: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{ status: number; type: string | undefined; text: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { port, path: pathname, method: body === undefined ? "GET" : "POST", headers },
      (response) => {
        let text = "";
        response.on("data", (chunk: Buffer) => (text += chunk.toString()));
        response.on("end", () =>
          resolve({ status: response.statusCode!, type: response.headers["content-type"], text }),
        );
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

test("serving the UI, the bridge answers its own page by IP and refuses other names", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-serve-web-"));
  mkdirSync(path.join(directory, "sync"));
  mkdirSync(path.join(directory, "local"));
  const webRoot = path.join(directory, "web");
  mkdirSync(path.join(webRoot, "assets"), { recursive: true });
  writeFileSync(path.join(webRoot, "index.html"), "<!doctype html>");
  writeFileSync(path.join(webRoot, "assets", "app.js"), "export {};");
  writeFileSync(path.join(directory, "secret.txt"), "no");
  const dev = await startDevServer({ port: 0, home: directory, webRoot });
  // A machine reached by its IP address, as over Tailscale.
  const host = `192.0.2.7:${dev.port}`;

  try {
    assert.equal((await send(dev.port, "/", { host })).type, "text/html; charset=utf-8");
    assert.equal(
      (await send(dev.port, "/assets/app.js", { host })).type,
      "text/javascript; charset=utf-8",
    );
    assert.equal((await send(dev.port, "/assets/..%2F..%2Fsecret.txt", { host })).status, 404);

    const health = JSON.parse((await send(dev.port, "/health", { host })).text) as {
      selectionToken: string;
    };
    const sameOrigin = await send(
      dev.port,
      "/command",
      { host, origin: `http://${host}`, "x-taskdb-selection": health.selectionToken },
      JSON.stringify({ version: 2, command: "workspace.info", readOnly: true }),
    );
    assert.equal((JSON.parse(sameOrigin.text) as { ok: boolean }).ok, true);

    const rebound = await send(dev.port, "/health", { host: `attacker.example:${dev.port}` });
    assert.equal(rebound.status, 403);
  } finally {
    await new Promise<void>((resolve) => dev.server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
