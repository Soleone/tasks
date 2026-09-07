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
