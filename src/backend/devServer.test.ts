import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startDevServer } from "./devServer.js";

test("dev server answers only local origins, with the selected folder's token", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-dev-origin-"));
  const previousDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = path.join(directory, "profile");
  mkdirSync(path.join(directory, "root"));
  const dev = await startDevServer({
    port: 0,
    root: path.join(directory, "root"),
    databasePath: path.join(directory, "dev.db"),
  });
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
    assert.equal(health.rootPath, path.join(directory, "root"));

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
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    rmSync(directory, { recursive: true, force: true });
  }
});
