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
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { TestContext } from "node:test";
import { createHome, openHome } from "./home.js";
import type { HomeClient } from "./home.js";
import { executeHomeLine } from "./homeGateway.js";
import type { Response } from "./protocol.js";

const cli = fileURLToPath(new URL("./tasks-cli.js", import.meta.url));

function scratch(t: TestContext): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-home-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function sendAs(
  client: HomeClient,
  home: string,
  command: string,
  args: object = {},
  extra: object = {},
): Response {
  return executeHomeLine(
    Buffer.from(JSON.stringify({ version: 2, command, args, ...extra })),
    home,
    client,
  );
}

function send(home: string, command: string, args: object = {}, extra: object = {}): Response {
  return sendAs("app", home, command, args, extra);
}

function ok(response: Response): Extract<Response, { ok: true }> {
  assert.equal(response.ok, true, JSON.stringify(response));
  if (!response.ok) throw new Error("failed");
  return response;
}

function refused(response: Response, code: string): void {
  assert.equal(response.ok ? "" : response.error.code, code, JSON.stringify(response));
}

function createAndInit(home: string): void {
  ok(send(home, "home.create"));
  const { writeContext } = ok(send(home, "workspace.info"));
  ok(send(home, "workspace.init", {}, { writeContext, idempotencyKey: "init" }));
}

function createTask(client: HomeClient, home: string, writeContext: string, title: string) {
  return sendAs(
    client,
    home,
    "task.create",
    { title },
    { writeContext, idempotencyKey: title, actor: { kind: "human", label: "home test" } },
  );
}

function contextOf(client: HomeClient, home: string): string {
  return ok(sendAs(client, home, "workspace.info")).writeContext;
}

function titles(client: HomeClient, home: string): string[] {
  const { tasks } = ok(sendAs(client, home, "task.list")).result as { tasks: { title: string }[] };
  return tasks.map((task) => task.title).sort();
}

/** Every file under `directory`, by its path relative to it. */
function files(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)))
    .sort();
}

test("home.create: setup creates the folders, runs again after an interruption and opens", (t) => {
  const home = path.join(scratch(t), "Tasks");
  const created = ok(send(home, "home.create"));
  assert.equal(created.result.homePath, home);
  assert.deepEqual(readdirSync(home).sort(), ["local", "sync"]);
  mkdirSync(path.join(home, "exports"));
  writeFileSync(path.join(home, ".nomedia"), "");
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

test("home.refuse-unsafe: an ordinary ancestor with a local folder is not a Tasks home", (t) => {
  const temporary = path.join(scratch(t), "AppData", "local", "Temp");
  mkdirSync(temporary, { recursive: true });
  const home = createHome(path.join(temporary, "Tasks"));
  assert.equal(openHome(home.homePath).homePath, home.homePath);
  assert.deepEqual(readdirSync(home.homePath).sort(), ["local", "sync"]);
  assert.throws(() => createHome(path.join(home.homePath, "nested")), { code: "HOME_NESTED" });
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

test(
  "write.lock: the app and the CLI share one home's lock and recovery files under every spelling",
  { skip: process.platform !== "linux" },
  (t) => {
    const directory = scratch(t);
    const home = path.join(directory, "home");
    const alias = path.join(directory, "alias");
    createAndInit(home);
    symlinkSync(home, alias);
    ok(createTask("app", home, contextOf("app", home), "From the app"));
    ok(createTask("cli", alias, contextOf("cli", alias), "From the CLI"));
    assert.deepEqual(titles("app", alias), ["From the CLI", "From the app"]);
    assert.deepEqual(titles("cli", home), ["From the CLI", "From the app"]);

    const contexts = { app: contextOf("app", alias), cli: contextOf("cli", home) };
    const lock = new DatabaseSync(path.join(home, "local", "lock.db"));
    lock.exec("BEGIN IMMEDIATE");
    const busy = createTask("app", alias, contexts.app, "While locked");
    refused(busy, "FOLDER_IN_USE");
    assert.match(busy.ok ? "" : busy.error.message, /Another Tasks window or the CLI is busy/);
    refused(createTask("cli", home, contexts.cli, "While locked too"), "FOLDER_IN_USE");
    lock.close();
    // Each client's own cache refuses the same way while another process of that client writes.
    const cache = new DatabaseSync(path.join(home, "local", "cli.db"));
    cache.exec("BEGIN IMMEDIATE");
    refused(createTask("cli", alias, contexts.cli, "While the cache is busy"), "FOLDER_IN_USE");
    cache.close();
    assert.deepEqual(titles("cli", alias), ["From the CLI", "From the app"]);

    writeFileSync(path.join(home, "local", "pending.json"), "{}\n");
    refused(createTask("cli", alias, contexts.cli, "While pending"), "RECOVERY_CONFLICT");
    refused(createTask("app", home, contexts.app, "While pending too"), "RECOVERY_CONFLICT");
    assert.equal(readdirSync(path.join(home, "sync", "tasks")).length, 2);
  },
);

test("share.folder-only: two device homes exchange only sync/; tasks add up, the rest stays on each device", (t) => {
  const directory = scratch(t);
  const laptop = path.join(directory, "laptop");
  const phone = path.join(directory, "phone");
  // A filesystem copy of new files stands in for Syncthing, which sees only each home's sync/.
  const exchange = (from: string, to: string) =>
    cpSync(path.join(from, "sync"), path.join(to, "sync"), { recursive: true, force: false });
  createAndInit(laptop);
  ok(send(phone, "home.create"));
  exchange(laptop, phone);

  ok(createTask("app", laptop, contextOf("app", laptop), "On the laptop"));
  ok(createTask("app", phone, contextOf("app", phone), "On the phone"));
  ok(send(laptop, "home.document.write", { name: "settings", text: '{"theme":"dark"}' }));
  ok(send(phone, "home.document.write", { name: "settings", text: '{"theme":"light"}' }));
  ok(send(phone, "home.document.write", { name: "undo", text: '{"entries":[]}' }));
  exchange(laptop, phone);
  exchange(phone, laptop);

  assert.deepEqual(titles("app", laptop), ["On the laptop", "On the phone"]);
  assert.deepEqual(titles("app", phone), ["On the laptop", "On the phone"]);
  assert.deepEqual(files(path.join(laptop, "sync")), files(path.join(phone, "sync")));
  assert.notEqual(contextOf("app", laptop), contextOf("app", phone));
  assert.equal(readFileSync(path.join(laptop, "settings.json"), "utf8"), '{"theme":"dark"}');
  assert.equal(readFileSync(path.join(phone, "settings.json"), "utf8"), '{"theme":"light"}');
  assert.equal(existsSync(path.join(laptop, "local", "undo.json")), false);
});

test("backup.full-home: a copy of the whole home holds all of it; its caches start a new history", (t) => {
  const directory = scratch(t);
  const home = path.join(directory, "home");
  createAndInit(home);
  ok(createTask("app", home, contextOf("app", home), "From the app"));
  ok(createTask("cli", home, contextOf("cli", home), "From the CLI"));
  ok(send(home, "home.document.write", { name: "settings", text: '{"theme":"dark"}' }));
  ok(send(home, "home.document.write", { name: "undo", text: '{"entries":[]}' }));
  const context = contextOf("app", home);

  // With every writer closed, the whole home is copied, here straight to where it is restored.
  const restored = path.join(directory, "restored");
  cpSync(home, restored, { recursive: true });
  assert.deepEqual(files(restored), files(home));
  for (const file of ["settings.json", "local/undo.json", "local/app.db", "local/cli.db"])
    assert.equal(existsSync(path.join(restored, file)), true, file);

  refused(send(restored, "workspace.info"), "CACHE_FROM_ELSEWHERE");
  refused(sendAs("cli", restored, "workspace.info"), "CACHE_FROM_ELSEWHERE");
  const fresh = ok(send(restored, "workspace.newHistory"));
  assert.notEqual(fresh.writeContext, context);
  assert.equal(
    path.dirname(fresh.result.retiredPath as string),
    path.join(restored, "local", "retired"),
  );
  assert.deepEqual(titles("app", restored), ["From the CLI", "From the app"]);
  assert.equal(
    ok(send(restored, "home.document.read", { name: "settings" })).result.text,
    '{"theme":"dark"}',
  );
  assert.equal(
    ok(send(restored, "home.document.read", { name: "undo" })).result.text,
    '{"entries":[]}',
  );
  refused(sendAs("cli", restored, "workspace.info"), "CACHE_FROM_ELSEWHERE");
  assert.equal(contextOf("app", home), context);
});
