import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TestContext } from "node:test";
import { executeLine } from "./gateway.js";
import type { Response } from "./protocol.js";

export type CopyTestWorkspace = {
  directory: string;
  root: string;
  cache: string;
  destination: string;
};

export function createCopyTestWorkspace(
  t: TestContext,
  fixtureDirectory = fileURLToPath(
    new URL("../../scripts/fixtures/workspace/root/", import.meta.url),
  ),
): CopyTestWorkspace {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-copy-"));
  const before = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = path.join(directory, "local");
  t.after(() => {
    if (before === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = before;
    rmSync(directory, { recursive: true, force: true });
  });
  const root = path.join(directory, "root");
  cpSync(fixtureDirectory, root, { recursive: true });
  return {
    directory,
    root,
    cache: path.join(directory, "cache.db"),
    destination: path.join(directory, "archive"),
  };
}

const cli = fileURLToPath(new URL("./cli.js", import.meta.url));

/** One JSON-lines request through the gateway, in process. */
export function send(workspace: CopyTestWorkspace, envelope: object): Response {
  return executeLine(
    Buffer.from(JSON.stringify({ version: 2, ...envelope })),
    workspace.root,
    workspace.cache,
  );
}

export function success(response: Response): Extract<Response, { ok: true }> {
  assert.equal(response.ok, true, JSON.stringify(response));
  if (!response.ok) throw new Error("failed");
  return response;
}

export function fail(response: Response, code: string): void {
  assert.equal(response.ok, false, JSON.stringify(response));
  if (!response.ok) assert.equal(response.error.code, code, JSON.stringify(response));
}

/** One request through the stdio CLI in a child process, optionally with a module hook that cuts it short. */
export function run(workspace: CopyTestWorkspace, request: object, loader?: string) {
  return spawnSync(
    process.execPath,
    [
      ...(loader ? ["--import", loader] : []),
      cli,
      "--stdio",
      "--root",
      workspace.root,
      "--database",
      workspace.cache,
    ],
    { input: JSON.stringify(request), env: process.env, encoding: "utf8", timeout: 10_000 },
  );
}

export function recover(
  workspace: CopyTestWorkspace,
  operationId: string,
  key = "resume",
): Response {
  const info = success(send(workspace, { command: "workspace.info" }));
  return send(workspace, {
    command: "workspace.recovery.resume",
    args: { operationId },
    writeContext: info.writeContext,
    idempotencyKey: key,
  });
}
