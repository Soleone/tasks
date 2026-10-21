import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { TestContext } from "node:test";
import { executeLine } from "./gateway.js";
import { executeHomeLine } from "./homeGateway.js";
import type { Response } from "./protocol.js";

const golden = fileURLToPath(new URL("../../scripts/fixtures/workspace/root/", import.meta.url));
const actor = { kind: "human", label: "adoption test" };

type Old = {
  directory: string;
  root: string;
  cache: string;
  profile: string;
  domain: string;
  writeContext: string;
  operationId: string;
  activity: unknown;
};

function ok(response: Response): Extract<Response, { ok: true }> {
  assert.equal(response.ok, true, JSON.stringify(response));
  if (!response.ok) throw new Error("failed");
  return response;
}

function refused(response: Response, code: string): void {
  assert.equal(response.ok ? "" : response.error.code, code, JSON.stringify(response));
}

function sendHome(home: string, command: string, args: object = {}, extra: object = {}) {
  return executeHomeLine(
    Buffer.from(JSON.stringify({ version: 2, command, args, ...extra })),
    home,
    "app",
  );
}

/**
 * A device as the app left it before Tasks homes: the task folder in Documents, its cache in the
 * app profile and its lock and recovery files in the profile's `taskdb-v2/roots/<key>`.
 */
function oldInstallation(t: TestContext): Old {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-adoption-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, "Documents", "Tasks");
  cpSync(golden, root, { recursive: true });
  writeFileSync(path.join(root, ".stignore"), "(?d).DS_Store\n");
  const profile = path.join(directory, "profile");
  const cache = path.join(profile, "caches", "0a1b2c3d4e5f.db");
  const send = (envelope: object) =>
    ok(executeLine(Buffer.from(JSON.stringify({ version: 2, ...envelope })), root, cache));
  const { writeContext } = send({ command: "workspace.info" });
  const created = send({
    command: "task.create",
    args: { title: "Written before the move" },
    writeContext,
    idempotencyKey: "create",
    actor,
  });
  const { activity } = send({ command: "activity.list" }).result;
  // Today other roots keep their files beside the cache under the same key the old app used.
  mkdirSync(path.join(profile, "taskdb-v2"));
  renameSync(path.join(profile, "caches", "roots"), path.join(profile, "taskdb-v2", "roots"));
  const roots = path.join(profile, "taskdb-v2", "roots");
  const domain = path.join(roots, readdirSync(roots)[0]);
  writeFileSync(path.join(domain, "undo-finished.recovery.json"), '{"kept":true}\n');
  return {
    directory,
    root,
    cache,
    profile,
    domain,
    writeContext,
    operationId: created.result.operationId as string,
    activity,
  };
}

function adopt(old: Old, home: string): Response {
  return sendHome(home, "home.adopt", { root: old.root, cache: old.cache, profile: old.profile });
}

/** Every file below `directory` with its hash, to show the old installation wasn't touched. */
function tree(directory: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    files[path.relative(directory, file)] = createHash("sha256")
      .update(readFileSync(file))
      .digest("hex");
  }
  return files;
}

test("home.adopt: an old task folder moves into a new home with its history; the original stays as it was", (t) => {
  const old = oldInstallation(t);
  const before = { root: tree(old.root), profile: tree(old.profile) };
  const home = path.join(old.directory, "Tasks");

  const adopted = ok(adopt(old, home));
  assert.equal(adopted.result.homePath, home);
  assert.equal(adopted.writeContext, old.writeContext);
  assert.deepEqual({ root: tree(old.root), profile: tree(old.profile) }, before);
  assert.deepEqual(tree(path.join(home, "sync")), before.root);
  assert.deepEqual(readdirSync(path.join(home, "local")).sort(), [
    "adoption.json",
    "app.db",
    "undo-finished.recovery.json",
  ]);
  assert.equal(existsSync(path.join(old.directory, ".Tasks.adopting")), false);

  assert.equal((old.activity as unknown[]).length, 1);
  assert.deepEqual(ok(sendHome(home, "activity.list")).result.activity, old.activity);
  ok(adopt(old, home));
  ok(
    sendHome(
      home,
      "operation.undo",
      { operationId: old.operationId },
      { writeContext: old.writeContext, idempotencyKey: "undo", actor },
    ),
  );
  assert.deepEqual(tree(old.root), before.root);
});

test("home.adopt: unfinished work, a running old writer and occupied or nested places are refused", (t) => {
  const old = oldInstallation(t);
  const home = path.join(old.directory, "Tasks");

  writeFileSync(path.join(old.domain, "pending.json"), "{}\n");
  refused(adopt(old, home), "RECOVERY_PENDING");
  rmSync(path.join(old.domain, "pending.json"));
  assert.equal(existsSync(home), false);

  const lock = new DatabaseSync(path.join(old.domain, "lock.db"));
  lock.exec("BEGIN IMMEDIATE");
  refused(adopt(old, home), "FOLDER_IN_USE");
  lock.close();

  mkdirSync(home);
  writeFileSync(path.join(home, "notes.txt"), "keep");
  refused(adopt(old, home), "HOME_CONFLICT");
  assert.deepEqual(readdirSync(home), ["notes.txt"]);

  refused(adopt(old, path.join(old.root, "home")), "HOME_CONFLICT");
  assert.equal(existsSync(path.join(old.root, "home")), false);
});

test("home.adopt: an interrupted adoption published nothing and runs again; a stranger's folder stays", (t) => {
  const old = oldInstallation(t);
  const home = path.join(old.directory, "Tasks");
  const stage = path.join(old.directory, ".Tasks.adopting");

  mkdirSync(path.join(stage, "local"), { recursive: true });
  writeFileSync(path.join(stage, "notes.txt"), "keep");
  refused(adopt(old, home), "HOME_CONFLICT");
  assert.deepEqual(readdirSync(stage).sort(), ["local", "notes.txt"]);

  rmSync(path.join(stage, "notes.txt"));
  writeFileSync(path.join(stage, "local", "adoption.json"), "{}\n");
  mkdirSync(path.join(stage, "sync", "tasks"), { recursive: true });
  ok(adopt(old, home));
  assert.equal(existsSync(stage), false);
  assert.equal(ok(sendHome(home, "workspace.info")).result.state, "ready");
});
