import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { TestContext } from "node:test";
import { executeLine } from "./gateway.js";
import { readRootDescriptor } from "./canonicalReader.js";
import { pendingIntentPath } from "./localDomain.js";
import type { Response } from "./protocol.js";

const golden = fileURLToPath(new URL("../../scripts/fixtures/workspace/root/", import.meta.url));
const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
const id = "c8d4206d-c25a-4317-baa4-a2c5443060e9";
const blockerId = "62f159c1-22a7-45cb-89a0-c0c35aaeb1ed";
const linuxOnly = { skip: process.platform !== "linux" };
type Workspace = { directory: string; root: string; cache: string };

function setup(t: TestContext): Workspace {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-update-fault-"));
  const before = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = path.join(directory, "local");
  t.after(() => {
    if (before === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = before;
    rmSync(directory, { recursive: true, force: true });
  });
  const root = path.join(directory, "root");
  cpSync(golden, root, { recursive: true });
  return { directory, root, cache: path.join(directory, "cache.db") };
}

function send(workspace: Workspace, envelope: object): Response {
  return executeLine(
    Buffer.from(JSON.stringify({ version: 2, ...envelope })),
    workspace.root,
    workspace.cache,
  );
}

function success(response: Response): Extract<Response, { ok: true }> {
  assert.equal(response.ok, true, JSON.stringify(response));
  if (!response.ok) throw new Error("failed");
  return response;
}

function edit(workspace: Workspace, command: string, args: object, key: string) {
  const read = success(send(workspace, { command: "task.get", args: { id } }));
  return {
    version: 2,
    command,
    args: { id, expectedVersion: (read.result.task as { version: number }).version, ...args },
    writeContext: read.writeContext,
    idempotencyKey: key,
  };
}

test(
  "write.verify: a linked task deleted after the replacement fails the edit without a receipt",
  linuxOnly,
  (t) => {
    const workspace = setup(t);
    success(
      send(workspace, edit(workspace, "task.dependency.add", { dependsOnId: blockerId }, "link")),
    );
    const request = edit(workspace, "task.update", { title: "Verified edit" }, "verified");
    const blocker = path.join(workspace.root, "tasks", `${blockerId}.json`);
    const loader = path.join(workspace.directory, "outside-delete.mjs");
    // Only test processes load this transform: the deletion lands between rename and verification.
    writeFileSync(
      loader,
      `import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){const result=next(url,context);let source=result.source?.toString();
if(!url.endsWith('/updateWriter.js')||!source)return result;
const needle='syncDirectory(path.dirname(target));';if(source.split(needle).length!==2)throw Error('flush must be unique');
return {...result,source:'import {rmSync as outsideRemove} from "node:fs";'+source.replace(needle,'outsideRemove(${JSON.stringify(blocker)});'+needle)};}});`,
    );
    const child = spawnSync(
      process.execPath,
      ["--import", loader, cli, "--stdio", "--root", workspace.root, "--database", workspace.cache],
      { input: JSON.stringify(request), timeout: 10_000 },
    );
    assert.equal(child.status, 0, child.stderr.toString());
    const refused = JSON.parse(child.stdout.toString());
    assert.equal(refused.ok, false);
    assert.equal(refused.error.code, "INVALID_CANONICAL");
    assert.equal(existsSync(pendingIntentPath(readRootDescriptor(workspace.root))), false);
    const database = new DatabaseSync(workspace.cache);
    assert.equal(
      database.prepare("SELECT count(*) AS n FROM v2_receipts WHERE key = 'verified'").get()!.n,
      0,
    );
    database.close();
  },
);

test("malformed local intent preserves evidence and info reports manual inspection", (t) => {
  const workspace = setup(t);
  success(send(workspace, { command: "workspace.info" }));
  const pending = pendingIntentPath(readRootDescriptor(workspace.root));
  const bytes = readFileSync(path.join(workspace.root, "tasks", `${id}.json`));
  mkdirSync(path.dirname(pending), { recursive: true });
  writeFileSync(pending, '{"format":');
  const info = success(send(workspace, { command: "workspace.info" }));
  assert.equal(info.result.state, "recovery_pending");
  assert.equal(info.result.pendingOperationId, null);
  assert.equal((info.result.issues as { code: string }[]).at(-1)!.code, "RECOVERY_CONFLICT");
  const blocked = send(workspace, { command: "task.list" });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.error.code, "RECOVERY_CONFLICT");
  assert.deepEqual(readFileSync(path.join(workspace.root, "tasks", `${id}.json`)), bytes);
  assert.equal(readFileSync(pending, "utf8"), '{"format":');
});
