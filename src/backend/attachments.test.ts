import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { TestContext } from "node:test";
import { executeLine } from "./gateway.js";
import type { Response } from "./protocol.js";

const golden = fileURLToPath(new URL("../../scripts/fixtures/workspace/root/", import.meta.url));
const cli = fileURLToPath(new URL("./tasks-cli.js", import.meta.url));
const taskId = "c8d4206d-c25a-4317-baa4-a2c5443060e9";
const png = Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n", "latin1"), Buffer.from("pixels")]);
type Workspace = { directory: string; root: string; cache: string };

function setup(t: TestContext): Workspace {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-attachments-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
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
function failure(response: Response): string {
  assert.equal(response.ok, false, JSON.stringify(response));
  return response.ok ? "" : response.error.code;
}
function current(workspace: Workspace) {
  const read = success(send(workspace, { command: "task.get", args: { id: taskId } }));
  return {
    writeContext: read.writeContext,
    task: read.result.task as { version: number; attachments: string[] },
  };
}
function write(workspace: Workspace, bytes: Buffer, type = "image/png"): Response {
  return send(workspace, {
    command: "attachment.write",
    writeContext: current(workspace).writeContext,
    idempotencyKey: `write-${Math.random()}`,
    args: { type, data: bytes.toString("base64") },
  });
}
function list(workspace: Workspace, attachments: string[]): Response {
  const { writeContext, task } = current(workspace);
  return send(workspace, {
    command: "task.update",
    writeContext,
    idempotencyKey: `list-${Math.random()}`,
    args: { id: taskId, expectedVersion: task.version, attachments },
  });
}
function taskFile(workspace: Workspace): string {
  return readFileSync(path.join(workspace.root, "tasks", `${taskId}.json`), "utf8");
}

test("attach.write: stores the image once under a time-ordered name", (t) => {
  const workspace = setup(t);
  const written = success(write(workspace, png));
  const name = written.result.name as string;
  assert.match(name, /^\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]{8}\.png$/);
  assert.deepEqual(readdirSync(path.join(workspace.root, "attachments")), [name]);
  assert.deepEqual(readFileSync(path.join(workspace.root, "attachments", name)), png);
  for (const [bytes, type] of [
    [Buffer.from("not an image"), "image/png"],
    [png, "image/jpeg"],
    [png, "image/bmp"],
    [Buffer.concat([png, Buffer.alloc(10 * 1024 * 1024)]), "image/png"],
  ] as const)
    assert.equal(failure(write(workspace, bytes, type)), "INVALID_ARGUMENT");
});

test("data.optional-fields: tasks without images keep their bytes; an emptied list is left out", (t) => {
  const workspace = setup(t);
  assert.equal(taskFile(workspace).includes("attachments"), false);
  const name = success(write(workspace, png)).result.name as string;
  const listed = success(list(workspace, [name])).result.task as { attachments: string[] };
  assert.deepEqual(listed.attachments, [name]);
  assert.deepEqual(JSON.parse(taskFile(workspace)).attachments, [name]);
  success(list(workspace, []));
  assert.equal(taskFile(workspace).includes("attachments"), false);
  assert.deepEqual(current(workspace).task.attachments, []);
});

test("attach.list-replace: added names must exist; names already listed may be missing", (t) => {
  const workspace = setup(t);
  assert.equal(failure(list(workspace, ["2026-10-22-143012-3f9a1c2b.png"])), "INVALID_ARGUMENT");
  assert.equal(failure(list(workspace, ["../tasks/escape.png"])), "INVALID_ARGUMENT");
  const first = success(write(workspace, png)).result.name as string;
  const second = success(write(workspace, png)).result.name as string;
  success(list(workspace, [first, second]));
  rmSync(path.join(workspace.root, "attachments", first));
  assert.deepEqual(
    (success(list(workspace, [second, first])).result.task as { attachments: string[] })
      .attachments,
    [second, first],
  );
});

test("attach.read: serves stored bytes and refuses missing or corrupt files", (t) => {
  const workspace = setup(t);
  const name = success(write(workspace, png)).result.name as string;
  const read = (attachment: string) =>
    send(workspace, { command: "attachment.read", args: { name: attachment } });
  assert.deepEqual(success(read(name)).result, { type: "image/png", data: png.toString("base64") });
  assert.equal(failure(read("2026-10-22-143012-3f9a1c2b.png")), "ATTACHMENT_NOT_FOUND");
  writeFileSync(path.join(workspace.root, "attachments", name), "damaged");
  assert.equal(failure(read(name)), "INVALID_STORAGE");
});

test("data.attachment-file: reading the workspace ignores what else is in attachments/", (t) => {
  const workspace = setup(t);
  mkdirSync(path.join(workspace.root, "attachments"));
  writeFileSync(path.join(workspace.root, "attachments", "notes.txt"), "someone else's file");
  success(send(workspace, { command: "task.list", args: {} }));
  success(write(workspace, png));
  assert.equal(existsSync(path.join(workspace.root, "attachments", "notes.txt")), true);
});

test("data.unknown-fields: a field from a newer version says to update Tasks", (t) => {
  const workspace = setup(t);
  const file = path.join(workspace.root, "tasks", `${taskId}.json`);
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), reminder: 1 }));
  const response = send(workspace, { command: "task.list", args: {} });
  assert.equal(failure(response), "UNSUPPORTED_SCHEMA");
  if (!response.ok) assert.match(response.error.message, /reminder.*newer version of Tasks/);
});

test("undo.operation: undoing and redoing a first image removes and restores the field", (t) => {
  const workspace = setup(t);
  const before = taskFile(workspace);
  const name = success(write(workspace, png)).result.name as string;
  const listed = success(list(workspace, [name]));
  const undone = success(
    send(workspace, {
      command: "operation.undo",
      writeContext: listed.writeContext,
      idempotencyKey: "undo",
      args: { operationId: listed.result.operationId },
    }),
  );
  const restored = JSON.parse(taskFile(workspace));
  assert.equal(Object.hasOwn(restored, "attachments"), false);
  assert.deepEqual({ ...restored, updatedAt: null }, { ...JSON.parse(before), updatedAt: null });
  success(
    send(workspace, {
      command: "operation.redo",
      writeContext: undone.writeContext,
      idempotencyKey: "redo",
      args: { operationId: undone.result.operationId },
    }),
  );
  assert.deepEqual(JSON.parse(taskFile(workspace)).attachments, [name]);
});

test("cli.attachment-paths: attach lists an image file and show prints its path", (t) => {
  const workspace = setup(t);
  const image = path.join(workspace.directory, "screenshot.png");
  writeFileSync(image, png);
  const run = (...args: string[]) =>
    spawnSync(
      process.execPath,
      [cli, "--root", workspace.root, "--database", workspace.cache, ...args],
      { encoding: "utf8" },
    );
  const attached = run("attach", taskId, image);
  assert.equal(attached.status, 0, attached.stderr);
  const [name] = readdirSync(path.join(workspace.root, "attachments"));
  assert.deepEqual(JSON.parse(taskFile(workspace)).attachments, [name]);
  const shown = run("show", taskId);
  assert.match(
    shown.stdout,
    new RegExp(`image: ${path.join(workspace.root, "attachments", name)}\\n`),
  );
  rmSync(path.join(workspace.root, "attachments", name));
  assert.match(run("show", taskId).stdout, /\(missing\)/);
  const text = path.join(workspace.directory, "notes.txt");
  writeFileSync(text, "not an image");
  assert.equal(run("attach", taskId, text).status, 2);
});
