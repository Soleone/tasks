import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
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
import { createHome, openHome } from "./home.js";
import { executeHomeLine } from "./homeGateway.js";
import type { Response } from "./protocol.js";

const cli = fileURLToPath(new URL("./tasks-cli.js", import.meta.url));

function scratch(t: TestContext): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-home-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function send(home: string, command: string, args: object = {}, extra: object = {}): Response {
  return executeHomeLine(
    Buffer.from(JSON.stringify({ version: 2, command, args, ...extra })),
    home,
    "app",
  );
}

function ok(response: Response): Extract<Response, { ok: true }> {
  assert.equal(response.ok, true, JSON.stringify(response));
  if (!response.ok) throw new Error("failed");
  return response;
}

function refused(response: Response, code: string): void {
  assert.equal(response.ok ? "" : response.error.code, code, JSON.stringify(response));
}

test("home.create: setup creates the folders, runs again after an interruption and opens", (t) => {
  const home = path.join(scratch(t), "Tasks");
  const created = ok(send(home, "home.create"));
  assert.equal(created.result.homePath, home);
  assert.deepEqual(readdirSync(home).sort(), ["local", "sync"]);
  ok(send(home, "home.create"));
  const info = ok(send(home, "workspace.info"));
  assert.equal(info.result.state, "empty");
  ok(send(home, "workspace.init", {}, { writeContext: info.writeContext, idempotencyKey: "init" }));
  assert.equal(ok(send(home, "workspace.info")).result.state, "ready");
  assert.equal(existsSync(path.join(home, "local", "app.db")), true);
  assert.equal(existsSync(path.join(home, "sync", "workspace.json")), true);
});

test("home.create: other folders and parts of homes are never taken over", (t) => {
  const directory = scratch(t);
  const occupied = path.join(directory, "occupied");
  mkdirSync(occupied);
  writeFileSync(path.join(occupied, "notes.txt"), "keep");
  assert.throws(() => createHome(occupied), { code: "HOME_CONFLICT" });
  assert.deepEqual(readdirSync(occupied), ["notes.txt"]);

  const old = path.join(directory, "old");
  mkdirSync(path.join(old, "tasks"), { recursive: true });
  writeFileSync(path.join(old, "workspace.json"), '{"schemaVersion":2}\n');
  assert.throws(() => createHome(old), { code: "OLD_TASK_FOLDER" });
  assert.throws(() => openHome(old), { code: "OLD_TASK_FOLDER" });

  const home = createHome(path.join(directory, "home")).homePath;
  assert.throws(() => createHome(path.join(home, "sync")), { code: "HOME_NESTED" });
  assert.throws(() => createHome(path.join(home, "inside")), { code: "HOME_NESTED" });
  assert.throws(() => createHome(path.join(directory, "missing", "home")), {
    code: "HOME_MISSING",
  });
});

test("home.refuse-unsafe: a home inside a Syncthing folder is refused, and so is syncing the home", (t) => {
  const directory = scratch(t);
  const synced = path.join(directory, "synced");
  mkdirSync(path.join(synced, ".stfolder"), { recursive: true });
  assert.throws(() => createHome(path.join(synced, "Tasks")), { code: "HOME_IN_SYNC_FOLDER" });
  const home = createHome(path.join(directory, "home")).homePath;
  mkdirSync(path.join(home, "sync", ".stfolder"));
  assert.equal(openHome(home).homePath, home);
  mkdirSync(path.join(home, ".stfolder"));
  refused(send(home, "workspace.info"), "HOME_IN_SYNC_FOLDER");
});

test("home.missing: a missing home is reported and nothing is created", (t) => {
  const home = path.join(scratch(t), "gone");
  refused(send(home, "workspace.info"), "HOME_MISSING");
  refused(send(home, "home.document.read", { name: "settings" }), "HOME_MISSING");
  assert.equal(existsSync(home), false);
  mkdirSync(home);
  refused(send(home, "workspace.info"), "NOT_A_HOME");
  assert.deepEqual(readdirSync(home), []);
});

test("home.documents: settings and undo records are replaced durably, damage is kept", (t) => {
  const home = path.join(scratch(t), "home");
  ok(send(home, "home.create"));
  assert.equal(ok(send(home, "home.document.read", { name: "settings" })).result.text, null);
  ok(send(home, "home.document.write", { name: "settings", text: '{"a":1}' }));
  ok(send(home, "home.document.write", { name: "undo", text: '{"b":2}' }));
  assert.equal(readFileSync(path.join(home, "settings.json"), "utf8"), '{"a":1}');
  assert.equal(readFileSync(path.join(home, "local", "undo.json"), "utf8"), '{"b":2}');
  assert.equal(ok(send(home, "home.document.read", { name: "undo" })).result.text, '{"b":2}');
  refused(send(home, "home.document.write", { name: "settings", text: "[]" }), "INVALID_ARGUMENT");
  refused(send(home, "home.document.write", { name: "other", text: "{}" }), "INVALID_ARGUMENT");
  writeFileSync(path.join(home, "settings.json"), "{damaged");
  writeFileSync(path.join(home, "settings.json.preparing"), "unpublished");
  const replaced = ok(
    send(home, "home.document.write", { name: "settings", text: "{}", replaceDamaged: true }),
  );
  const kept = replaced.result.keptPath as string;
  assert.match(path.basename(kept), /^settings\.damaged-.*\.json$/);
  assert.equal(readFileSync(kept, "utf8"), "{damaged");
  assert.equal(readFileSync(path.join(home, "settings.json"), "utf8"), "{}");
  assert.equal(existsSync(path.join(home, "settings.json.preparing")), false);
});

test(
  "cli.explicit-root: tasks-cli works in a home with its own cache, and --home can't be mixed",
  { skip: process.platform !== "linux" },
  (t) => {
    const home = path.join(scratch(t), "home");
    const run = (...argv: string[]) =>
      spawnSync(process.execPath, [cli, ...argv], { encoding: "utf8", timeout: 10_000 });
    assert.equal(run("--home", home, "init").status, 0);
    assert.equal(run("--home", home, "add", "From the CLI").status, 0);
    const listed = run("--home", home, "list", "--json");
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(
      (JSON.parse(listed.stdout).tasks as { title: string }[]).map((task) => task.title),
      ["From the CLI"],
    );
    assert.equal(existsSync(path.join(home, "local", "cli.db")), true);
    assert.equal(existsSync(path.join(home, "local", "app.db")), false);
    const mixed = run("--home", home, "--database", path.join(home, "other.db"), "list");
    assert.equal(mixed.status, 2);
    assert.match(mixed.stderr, /--home already selects/);
    assert.equal(run("list").status, 2);
  },
);
