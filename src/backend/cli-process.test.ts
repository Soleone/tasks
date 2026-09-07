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
  } finally {
    output.close();
    child.kill();
    rmSync(directory, { recursive: true, force: true });
  }
});
