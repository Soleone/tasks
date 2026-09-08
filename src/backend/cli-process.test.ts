import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import test from "node:test";

const cliPath = new URL("./cli.js", import.meta.url);

test("compiled CLI creates and lists a classified task", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-cli-m1-"));
  const databasePath = path.join(directory, "cli.db");
  const child = spawn(process.execPath, [fileURLToPath(cliPath), "--stdio", "--database", databasePath], {
    stdio: "pipe",
  });
  const output = readline.createInterface({ input: child.stdout });

  async function send(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    child.stdin.write(`${JSON.stringify(request)}\n`);
    const [line] = await once(output, "line") as [string];
    return JSON.parse(line) as Record<string, unknown>;
  }

  try {
    const created = await send({
      version: 1,
      requestId: "cli-create",
      command: "task.create",
      args: { title: "Prepare @todo-app launch #planning #product" },
      idempotencyKey: "cli-create-key",
    });
    const createdResult = created.result as { task: { category: { slug: string }; tags: Array<{ slug: string }> } };
    assert.equal(created.ok, true);
    assert.equal(createdResult.task.category.slug, "todo-app");
    assert.deepEqual(createdResult.task.tags.map((tag) => tag.slug), ["planning", "product"]);

    const listed = await send({ version: 1, requestId: "cli-list", command: "task.list" });
    const listedResult = listed.result as { total: number; tasks: Array<{ title: string }> };
    assert.equal(listed.ok, true);
    assert.equal(listedResult.total, 1);
    assert.equal(listedResult.tasks[0]?.title, "Prepare @todo-app launch #planning #product");
  } finally {
    output.close();
    child.kill();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("compiled CLI answers the JSON-lines probe protocol", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-cli-"));
  const databasePath = path.join(directory, "cli.db");
  const child = spawn(process.execPath, [fileURLToPath(cliPath), "--stdio", "--database", databasePath], {
    stdio: "pipe",
  });
  const output = readline.createInterface({ input: child.stdout });

  try {
    child.stdin.write(`${JSON.stringify({ version: 1, requestId: "cli-1", command: "runtime.probe" })}\n`);
    const [line] = await once(output, "line") as [string];
    const response = JSON.parse(line) as { ok: boolean; requestId: string; result?: { searchMatches: number } };

    assert.equal(response.ok, true);
    assert.equal(response.requestId, "cli-1");
    assert.equal(response.result?.searchMatches, 1);

    child.kill();
    await once(child, "close");

    const restarted = spawn(process.execPath, [fileURLToPath(cliPath), "--stdio", "--database", databasePath], {
      stdio: "pipe",
    });
    const restartedOutput = readline.createInterface({ input: restarted.stdout });

    try {
      restarted.stdin.write(`${JSON.stringify({ version: 1, requestId: "cli-restart", command: "runtime.probe" })}\n`);
      const [restartedLine] = await once(restartedOutput, "line") as [string];
      const restartedResponse = JSON.parse(restartedLine) as {
        ok: boolean;
        requestId: string;
        result?: { databasePath: string; searchMatches: number };
      };

      assert.equal(restartedResponse.ok, true);
      assert.equal(restartedResponse.requestId, "cli-restart");
      assert.equal(restartedResponse.result?.databasePath, databasePath);
      assert.equal(restartedResponse.result?.searchMatches, 1);
    } finally {
      restartedOutput.close();
      restarted.kill();
    }
  } finally {
    output.close();
    child.kill();
    rmSync(directory, { recursive: true, force: true });
  }
});
