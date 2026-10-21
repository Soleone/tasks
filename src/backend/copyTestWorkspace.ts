import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
  // The directory is a Tasks home, so the root's lock and recovery files are in its local folder.
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-copy-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, "sync");
  cpSync(fixtureDirectory, root, { recursive: true });
  mkdirSync(path.join(directory, "local"));
  return {
    directory,
    root,
    cache: path.join(directory, "local", "cache.db"),
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

/** A cache copied from another home is refused until the owner starts a new history with it. */
export function startNewHistory(workspace: CopyTestWorkspace): void {
  fail(send(workspace, { command: "workspace.info" }), "CACHE_FROM_ELSEWHERE");
  success(send(workspace, { command: "workspace.newHistory" }));
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
  const info = send(workspace, { command: "workspace.info" });
  if (!info.ok) return info;
  return send(workspace, {
    command: "workspace.recovery.resume",
    args: { operationId },
    writeContext: info.writeContext,
    idempotencyKey: key,
  });
}
