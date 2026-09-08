import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startDevServer } from "./devServer.js";

async function postCommand(url: string, body: unknown, origin?: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${url}/command`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin === undefined ? {} : { origin }),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() as Record<string, unknown> };
}

test("dev server serves health and the same command path as the sidecar", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-dev-server-"));
  const databasePath = path.join(directory, "dev.db");
  const dev = await startDevServer({ port: 0, databasePath });

  try {
    const health = await fetch(`${dev.url}/health`);
    assert.equal(health.status, 200);
    const healthBody = await health.json() as { ok: boolean; databasePath: string };
    assert.equal(healthBody.ok, true);
    assert.equal(healthBody.databasePath, databasePath);

    const probe = await postCommand(dev.url, { version: 1, requestId: "dev-probe", command: "runtime.probe" });
    assert.equal(probe.status, 200);
    assert.equal(probe.json.ok, true);
    const probeResult = probe.json.result as { databasePath: string; searchMatches: number; fts5Enabled: boolean };
    assert.equal(probeResult.databasePath, databasePath);
    assert.equal(probeResult.searchMatches, 1);
    assert.equal(probeResult.fts5Enabled, true);

    const created = await postCommand(dev.url, {
      version: 1,
      requestId: "dev-create",
      command: "task.create",
      args: { title: "Prepare @todo-app launch #planning #product" },
      idempotencyKey: "dev-create-key",
    });
    assert.equal(created.status, 200);
    assert.equal(created.json.ok, true);

    const listed = await postCommand(dev.url, { version: 1, requestId: "dev-list", command: "task.list" });
    const listedResult = (listed.json as { result: { total: number; tasks: Array<{ title: string }> } }).result;
    assert.equal(listed.json.ok, true);
    assert.equal(listedResult.total, 1);
    assert.equal(listedResult.tasks[0]?.title, "Prepare @todo-app launch #planning #product");

    const invalid = await postCommand(dev.url, { version: 1, requestId: "dev-bad", command: "task.nope" });
    assert.equal(invalid.status, 200);
    assert.equal(invalid.json.ok, false);
  } finally {
    await new Promise<void>((resolve) => dev.server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("dev server rejects non-local origins", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-dev-origin-"));
  const dev = await startDevServer({ port: 0, databasePath: path.join(directory, "dev.db") });

  try {
    const rejected = await postCommand(
      dev.url,
      { version: 1, requestId: "dev-origin", command: "runtime.probe" },
      "https://example.com",
    );
    assert.equal(rejected.status, 403);

    const allowed = await postCommand(
      dev.url,
      { version: 1, requestId: "dev-origin-ok", command: "runtime.probe" },
      "http://localhost:5173",
    );
    assert.equal(allowed.status, 200);
    assert.equal(allowed.json.ok, true);
  } finally {
    await new Promise<void>((resolve) => dev.server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
