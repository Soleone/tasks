import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCopyTestWorkspace as setup } from "./copyTestWorkspace.js";
import type { CopyTestWorkspace as Workspace } from "./copyTestWorkspace.js";
import type { TaskProjection } from "./queries.js";

const cli = fileURLToPath(new URL("./tasks-cli.js", import.meta.url));
const linux = { skip: process.platform !== "linux" };
const parent = "c8d4206d-c25a-4317-baa4-a2c5443060e9", child = "6e1bf023-da3c-4785-b8a9-a696ac1fa5c1";
const corpus = JSON.parse(readFileSync(new URL("../../scripts/fixtures/taskdb-v2/cases.json", import.meta.url), "utf8")) as {
  taskTemplate: Record<string, unknown>;
  cases: { id: string; action: { argv: string[] }; expect: { command?: string; args?: object; fields?: Record<string, unknown>; error?: string; canonicalWrites?: number; noAutomaticAuthorityRefresh?: boolean } }[];
};
function run(workspace: Workspace, argv: string[], loader?: string) {
  return spawnSync(process.execPath, [...(loader ? ["--import", loader] : []), cli, "--v2-root", workspace.root, "--database", workspace.cache, ...argv], {
    encoding: "utf8", timeout: 10_000,
    env: { ...process.env, TASKS_SYNC_ROOT: path.join(workspace.directory, "v1-must-not-open"), TASKS_DATABASE_PATH: path.join(workspace.directory, "v1-must-not-open.db"), TASKS_SOURCE_REGISTRY_PATH: path.join(workspace.directory, "missing-registry.json") },
  });
}
function ok(workspace: Workspace, argv: string[]) {
  const result = run(workspace, ["--json", ...argv]);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}
function failure(result: ReturnType<typeof run>, code: string, status = 1) {
  assert.equal(result.status, status, result.stderr);
  assert.equal(result.stdout, "");
  const error = result.stderr.split("\n").filter(line => line.startsWith('{"ok":false')).map(line => JSON.parse(line))[0];
  assert.equal(error.error.code, code, result.stderr);
  return error.error;
}
function raw(workspace: Workspace) {
  return ["workspace.json", ...readdirSync(path.join(workspace.root, "tasks")).sort().map(name => `tasks/${name}`)].map(name => [name, readFileSync(path.join(workspace.root, name)).toString("base64")]);
}
function traceLoader(workspace: Workspace) {
  const loader = path.join(workspace.directory, "trace-loader.mjs"), trace = path.join(workspace.directory, "requests.jsonl");
  const entry = `traceRequest(${JSON.stringify(trace)},JSON.stringify(JSON.parse(Buffer.from(bytes).toString()))+String.fromCharCode(10));`;
  writeFileSync(loader, `import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){const result=next(url,context);if(!url.endsWith('/gateway.js'))return result;let source=result.source.toString();const needle='let requestId = null;';if(source.split(needle).length!==2)throw Error('trace entry must be unique');source='import {appendFileSync as traceRequest} from "node:fs";'+source.replace(needle,${JSON.stringify(entry)}+needle);return {...result,source};}});`);
  return { loader, trace };
}
function retryMetadata(result: ReturnType<typeof run>) {
  const line = result.stderr.split("\n").find(line => line.startsWith("tasks-cli retry: "));
  assert.ok(line, result.stderr);
  return JSON.parse(line.slice("tasks-cli retry: ".length)) as { writeContext: string; idempotencyKey: string; expectedVersion?: number; requestHash: string; actor: { kind: string; label: string } };
}
function retryFlags(metadata: ReturnType<typeof retryMetadata>): string[] {
  return ["--write-context", metadata.writeContext, "--idempotency-key", metadata.idempotencyKey, "--request-hash", metadata.requestHash, ...(metadata.expectedVersion === undefined ? [] : ["--expected-version", String(metadata.expectedVersion)])];
}

for (const id of ["cli-literal", "cli-text", "cli-key-context"]) {
  test(`original ${id} executes original argv through the actual opted-in human CLI`, linux, t => {
    const workspace = setup(t), fixture = corpus.cases.find(item => item.id === id)!;
    for (const name of readdirSync(path.join(workspace.root, "tasks"))) rmSync(path.join(workspace.root, "tasks", name));
    writeFileSync(path.join(workspace.root, "tasks/a.json"), `${JSON.stringify(corpus.taskTemplate)}\n`);
    const before = raw(workspace), { loader, trace } = traceLoader(workspace);
    const result = run(workspace, [...fixture.action.argv, "--json"], loader);
    if (fixture.expect.error) {
      failure(result, fixture.expect.error);
      assert.equal(fixture.expect.canonicalWrites, 0);
      assert.equal(fixture.expect.noAutomaticAuthorityRefresh, true);
      assert.deepEqual(raw(workspace), before);
      assert.equal(existsSync(trace), false);
      assert.equal(existsSync(workspace.cache), false);
    } else {
      assert.equal(result.status, 0, result.stderr);
      const requests = readFileSync(trace, "utf8").trim().split("\n").map(line => JSON.parse(line));
      assert.deepEqual(requests.map(item => item.command), ["workspace.info", fixture.expect.command]);
      assert.deepEqual(requests[1].args, fixture.expect.args);
      const task = JSON.parse(result.stdout).task;
      for (const [field, expected] of Object.entries(fixture.expect.fields!)) assert.deepEqual(task[field], expected);
      assert.deepEqual(JSON.parse(readFileSync(path.join(workspace.root, "tasks", `${task.id}.json`), "utf8")), Object.fromEntries(Object.entries(task).filter(([field]) => field !== "version" && field !== "blockedByIds")));
      assert.equal(result.stderr.includes(task.title), false);
    }
  });
}

test("human v2 omits classification updates, clears explicitly and maps description, literal values and shorthand", linux, t => {
  const workspace = setup(t);
  const first = ok(workspace, ["add", "--title", "Call @alice  #literal", "--category", "WORK", "--tag", "TODO", "--tag", "todo", "--description", "**Markdown**\r\n`@none`", "--priority", "3", "--parent", parent]).task as TaskProjection;
  assert.equal(first.title, "Call @alice  #literal");assert.equal(first.description, "**Markdown**\r\n`@none`");assert.deepEqual(first.tags, ["todo"]);
  const literal = ok(workspace, ["update", first.id, "--title", "Changed @literal", "--description", "--v2-root"]).task as TaskProjection;
  assert.equal(literal.category, "work");assert.deepEqual(literal.tags, ["todo"]);assert.equal(literal.description, "--v2-root");
  const cleared = ok(workspace, ["update", first.id, "--clear-category", "--clear-tags", "--description="]).task as TaskProjection;
  assert.equal(cleared.title, "Changed @literal");assert.equal(cleared.category, null);assert.deepEqual(cleared.tags, []);assert.equal(cleared.description, "");
  const replacement = ok(workspace, ["update", first.id, "--text", "New @Play #Fun"]).task as TaskProjection;
  assert.equal(replacement.title, "New");assert.equal(replacement.category, "play");assert.deepEqual(replacement.tags, ["fun"]);
  const unclassified = ok(workspace, ["update", first.id, "--text", "No markers"]).task as TaskProjection;
  assert.equal(unclassified.category, null);assert.deepEqual(unclassified.tags, []);
  const terminator = ok(workspace, ["add", "--", "--v2-root"]).task as TaskProjection;
  assert.equal(terminator.title, "--v2-root");
});

const invalid: string[][] = [
  ["add", "positional", "--title", "literal"], ["add", "--title", "literal", "--text", "text"],
  ["add", "text", "--category", "WORK"], ["add", "--text", "text", "--clear-tags"],
  ["add", "--title", "literal", "--category", "WORK", "--clear-category"],
  ["add", "--title", "literal", "--tag", "TODO", "--clear-tags"],
  ["update", parent, "--text", "text", "--category", "WORK"], ["update", parent],
  ["add", "New", "--descriptionMarkdown", "private-note"], ["sources"], ["list", "--source-key", "personal"],
  ["add", "New", "--title", "literal", "--title", "other"], ["list", "--limit", "9007199254740992"],
  ["list", "--priority", "5"], ["move", parent], ["move", parent, "--root", "--parent", child],
  ["add", "New", "--expected-version", "1"], ["show", parent, "--write-context", "old"],
  ["list", "--category", "WORK", "--uncategorized"], ["add", "New", "--actor-kind", "system"],
  ["complete", parent, "--expected-version", "0"], ["add", "New", "--request-hash", "not-a-hash"],
  ["purge-canceled", parent], ["archive"], ["restore", "one-path"], ["recover"], ["migrate-v1"],
];
for (const argv of invalid) test(`v2 CLI refuses conflicting/unknown/unsafe argv ${JSON.stringify(argv)}`, linux, t => {
  const workspace = setup(t), before = raw(workspace), { loader, trace } = traceLoader(workspace);
  failure(run(workspace, [...argv, "--json"], loader), "INVALID_ARGUMENT", 2);
  assert.equal(existsSync(trace), false);assert.equal(existsSync(workspace.cache), false);assert.deepEqual(raw(workspace), before);
});

test("v2 query flags, literal search, manual ancestor output, slugs and command-group activity are readable", linux, t => {
  const workspace = setup(t);
  const listed = ok(workspace, ["list", "--status", "open", "--status", "paused,done", "--sort", "manual", "--limit", "2", "--offset", "1"]);
  assert.equal(listed.total, 4);assert.equal((listed.tasks as TaskProjection[]).length, 2);
  assert.equal((ok(workspace, ["list", "--category", "@PLANNING", "--tag", "#PRODUCT"]).tasks as TaskProjection[])[0].id, parent);
  assert.equal(ok(workspace, ["list", "--uncategorized"]).total, 1);
  assert.equal(ok(workspace, ["list", "--unblocked"]).total, 3);
  assert.equal(ok(workspace, ["list", "%_"]).total, 0);
  const ancestor = run(workspace, ["list", "--search", "Review", "--sort", "manual", "--include-ancestors"]);
  assert.equal(ancestor.status, 0, ancestor.stderr);assert.match(ancestor.stdout, new RegExp(`context: ${parent}`));assert.match(ancestor.stdout, /\(1 of 1\)/);
  assert.match(run(workspace, ["categories"]).stdout, /@planning \(2\)/);
  assert.match(run(workspace, ["tags"]).stdout, /#product \(1\)/);
  assert.match(run(workspace, ["show", child]).stdout, /blocked-by: c8d4206d/);
  const completed = ok(workspace, ["complete", parent]);
  const activity = run(workspace, ["activity", "--task", parent, "--limit", "1"]);
  assert.match(activity.stdout, new RegExp(String(completed.operationId)));assert.match(activity.stdout, /task.complete/);
  assert.equal(activity.stdout.includes("undefined"), false);assert.equal(activity.stdout.includes("#undefined"), false);
  assert.equal(typeof ok(workspace, ["info"]).writeContext, "string");
  for (const name of ["v1-must-not-open", "v1-must-not-open.db", "missing-registry.json"]) assert.equal(existsSync(path.join(workspace.directory, name)), false);
});

test("v2 previews do not emit executing keys or effects; no-ops retain receipts and report no change", linux, t => {
  const workspace = setup(t), before = raw(workspace);
  for (const flag of ["--dry-run", "--read-only"]) {
    const result = run(workspace, ["add", "Private preview", flag, "--json"]);
    assert.equal(result.status, 0, result.stderr);assert.equal(result.stderr.includes("tasks-cli retry:"), false);
    assert.equal(JSON.parse(result.stdout)[flag === "--dry-run" ? "dryRun" : "readOnly"], true);
    assert.deepEqual(raw(workspace), before);
  }
  const completed = run(workspace, ["complete", "f3e5499b-402e-4d7d-8b61-eefc4409ca32", "--json"]);
  assert.equal(completed.status, 0, completed.stderr);assert.equal(JSON.parse(completed.stdout).changed, false);
  const replay = run(workspace, ["complete", "f3e5499b-402e-4d7d-8b61-eefc4409ca32", ...retryFlags(retryMetadata(completed))]);
  assert.equal(replay.status, 0, replay.stderr);assert.match(replay.stdout, /No change/);
  assert.deepEqual(raw(workspace), before);assert.deepEqual(ok(workspace, ["activity"]).activity, []);
});

for (const verb of ["start", "pause", "complete", "reopen", "cancel", "delete", "undo"]) test(`v2 friendly ${verb} shares accepted status rules`, linux, t => {
  const workspace = setup(t);
  if (verb === "undo") ok(workspace, ["complete", parent]);
  const result = ok(workspace, [verb, parent]).task as TaskProjection;
  const statuses: Record<string, string> = { start: "in_progress", pause: "paused", complete: "done", reopen: "open", cancel: "canceled", delete: "canceled", undo: "open" };
  assert.equal(result.status, statuses[verb]);
});

test("v2 friendly relationships, operation inverse and complete-set purge use the shared safety rules", linux, t => {
  const workspace = setup(t);
  const detached = ok(workspace, ["move", child, "--root"]);
  assert.equal((detached.task as TaskProjection).parentId, null);
  ok(workspace, ["undo-operation", String(detached.operationId)]);
  assert.equal((ok(workspace, ["show", child]).task as TaskProjection).parentId, parent);
  assert.deepEqual((ok(workspace, ["dep-remove", child, parent]).task as TaskProjection).dependencyIds, []);
  assert.deepEqual((ok(workspace, ["dep-add", child, parent]).task as TaskProjection).dependencyIds, [parent]);
  ok(workspace, ["cancel", parent]);
  const rejected = failure(run(workspace, ["purge-canceled", "--json"]), "PURGE_REFERENCED");
  assert.ok(Array.isArray(rejected.details.references));
  ok(workspace, ["cancel", child]);
  const purge = ok(workspace, ["purge-canceled"]);
  assert.deepEqual(new Set(purge.purgedIds as string[]), new Set([parent, child]));assert.equal(existsSync(String(purge.recoveryLocation)), true);
});

test("v2 supplied key/version/hash refuse missing authority before any refresh and retain stale exit3", linux, t => {
  const workspace = setup(t), { loader, trace } = traceLoader(workspace), before = raw(workspace);
  for (const argv of [["complete", parent, "--idempotency-key", "original"], ["complete", parent, "--expected-version", "1"], ["add", "New", "--request-hash", "0".repeat(64)]]) failure(run(workspace, [...argv, "--json"], loader), "WRITE_CONTEXT_REQUIRED");
  failure(run(workspace, ["complete", parent, "--idempotency-key", "original", "--write-context", "old", "--json"], loader), "EXPECTED_VERSION_REQUIRED");
  assert.equal(existsSync(trace), false);assert.equal(existsSync(workspace.cache), false);assert.deepEqual(raw(workspace), before);
  const ctx = String(ok(workspace, ["info"]).writeContext);
  failure(run(workspace, ["complete", parent, "--write-context", ctx, "--expected-version", "999", "--json"]), "STALE_TASK_VERSION", 3);
  assert.deepEqual(raw(workspace), before);
});

test("v2 original key/context/version/actor/flags/payload replay without renewed authority, including missing live task", linux, t => {
  const workspace = setup(t), { loader, trace } = traceLoader(workspace);
  const argv = ["update", parent, "--title", "Private literal @a", "--description", "Private Markdown", "--actor-kind", "human", "--actor-label", "operator", "--json"];
  const first = run(workspace, argv);assert.equal(first.status, 0, first.stderr);
  const metadata = retryMetadata(first);assert.equal(first.stderr.includes("Private literal"), false);assert.equal(first.stderr.includes("Private Markdown"), false);
  assert.equal(metadata.actor.label, "operator");assert.ok(metadata.expectedVersion);
  rmSync(path.join(workspace.root, "tasks", `${parent}.json`));
  const afterRemoval = raw(workspace), replay = run(workspace, [...argv, ...retryFlags(metadata)], loader);
  assert.equal(replay.status, 0, replay.stderr);assert.deepEqual(JSON.parse(replay.stdout), JSON.parse(first.stdout));assert.deepEqual(raw(workspace), afterRemoval);
  const requests = readFileSync(trace, "utf8").trim().split("\n").map(line => JSON.parse(line));assert.deepEqual(requests.map(item => item.command), ["task.update"]);
  for (const changed of [argv.map(item => item === "Private literal @a" ? "Changed payload" : item), argv.map(item => item === "operator" ? "other" : item), [...argv, "--dry-run"]]) failure(run(workspace, [...changed, ...retryFlags(metadata)]), "IDEMPOTENCY_KEY_REUSED");
  assert.equal(readFileSync(trace, "utf8").trim().split("\n").length, 1);
  const withoutHash = retryFlags(metadata).slice(0, 4).concat(["--expected-version", String(metadata.expectedVersion)]);
  failure(run(workspace, [...argv.map(item => item === "Private literal @a" ? "Changed payload" : item), ...withoutHash]), "IDEMPOTENCY_KEY_REUSED");
  rmSync(workspace.cache);
  failure(run(workspace, [...argv, ...retryFlags(metadata)]), "STALE_WRITE_CONTEXT");assert.deepEqual(raw(workspace), afterRemoval);
});

test("v2 lifecycle explicitly initializes/rebuilds/copies disjoint roots without selection or sharing changes", linux, t => {
  const workspace = setup(t), empty = path.join(workspace.directory, "empty");mkdirSync(empty);
  const selected = { ...workspace, root: empty, cache: path.join(workspace.directory, "empty-cache.db") };
  assert.equal(ok(selected, ["info"]).state, "empty");assert.equal(existsSync(path.join(empty, "workspace.json")), false);
  assert.equal(ok(selected, ["init", "--dry-run"]).schemaVersion, 2);assert.equal(existsSync(path.join(empty, "workspace.json")), false);
  assert.equal(ok(selected, ["init"]).schemaVersion, 2);
  assert.equal(readFileSync(path.join(empty, "workspace.json"), "utf8"), '{"schemaVersion":2}\n');
  failure(run(workspace, ["init", "--json"]), "INVALID_CANONICAL");
  const ctx = ok(workspace, ["info"]).writeContext, snapshot = raw(workspace);
  assert.equal(ok(workspace, ["rebuild"]).taskCount, 4);assert.equal(ok(workspace, ["info"]).writeContext, ctx);
  assert.deepEqual(raw(workspace), snapshot);
  const archive = ok(workspace, ["archive", workspace.destination]);assert.equal(archive.taskCount, 4);assert.deepEqual(raw({ ...workspace, root: workspace.destination }), snapshot);
  const restored = path.join(workspace.directory, "restored");
  const restore = run(selected, ["restore", workspace.destination, restored]);assert.equal(restore.status, 0, restore.stderr);assert.match(restore.stdout, /Selection and sharing are unchanged/);
  assert.deepEqual(raw({ ...workspace, root: restored }), snapshot);assert.deepEqual(raw(workspace), snapshot);
  failure(run(workspace, ["archive", path.join(workspace.root, "inside"), "--json"]), "INVALID_ARGUMENT");
});

test("v2 human migration retains original v1 source and explicit v1 rollback, not reverse-converted later edits", linux, t => {
  const fixture = fileURLToPath(new URL("../../scripts/fixtures/taskdb-v1/sync/", import.meta.url)), workspace = setup(t, fixture), before = raw(workspace);
  const order = readFileSync(path.join(workspace.root, "order/root.json"));
  const migrated = run(workspace, ["migrate-v1", workspace.destination]);assert.equal(migrated.status, 0, migrated.stderr);assert.match(migrated.stdout, /Rollback selects preserved pre-migration v1 state/);
  assert.deepEqual(raw(workspace), before);assert.deepEqual(readFileSync(path.join(workspace.root, "order/root.json")), order);
  const adopted = { ...workspace, root: workspace.destination, cache: path.join(workspace.directory, "adopted-cache.db") };
  ok(adopted, ["update", parent, "--title", "Later v2 only"]);
  const old = spawnSync(process.execPath, [cli, "--database", path.join(workspace.directory, "rollback-v1.db"), "show", parent, "--json"], { env: { ...process.env, TASKS_SYNC_ROOT: workspace.root, TASKS_SOURCE_REGISTRY_PATH: "" }, encoding: "utf8" });
  assert.equal(old.status, 0, old.stderr);assert.notEqual(JSON.parse(old.stdout).task.title, "Later v2 only");
});

test("explicit friendly-v2 mode has its own help/cache/safe errors while default v1 mode and flag-valued notes stay v1", t => {
  const workspace = setup(t);
  const help = run(workspace, ["--help"]);assert.equal(help.status, 0);assert.match(help.stdout, /explicitly selected v2/);assert.equal(existsSync(workspace.cache), false);
  const missingCache = spawnSync(process.execPath, [cli, "--v2-root", workspace.root, "add", "Private", "--json"], { env: { ...process.env, TASKS_DATABASE_PATH: workspace.cache }, encoding: "utf8" });
  failure(missingCache, "INVALID_ARGUMENT", 2);assert.equal(existsSync(workspace.cache), false);assert.equal(missingCache.stderr.includes("Private"), false);
  failure(run({ ...workspace, cache: path.join(workspace.root, "inside.db") }, ["list", "--json"]), "INVALID_STORAGE");assert.equal(existsSync(path.join(workspace.root, "inside.db")), false);
  const flagValuedNote = run(workspace, ["add", "New", "--category", "WORK", "--description", "--json"]);
  assert.equal(flagValuedNote.status, 2);assert.match(flagValuedNote.stderr, /^tasks-cli: INVALID_ARGUMENT:/);assert.equal(flagValuedNote.stderr.includes('{"ok":false'), false);
  const v1 = path.join(workspace.directory, "old.db");
  for (const literal of ["--v2-root", "--v2-root=literal"]) {
    const result = spawnSync(process.execPath, [cli, "add", "Legacy", "--description", literal, "--database", v1, "--json"], { env: { ...process.env, TASKS_SYNC_ROOT: "", TASKS_SOURCE_REGISTRY_PATH: "" }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);assert.equal(JSON.parse(result.stdout).task.descriptionMarkdown, literal);assert.equal("description" in JSON.parse(result.stdout).task, false);
  }
  const defaultHelp = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });assert.equal(defaultHelp.status, 0);assert.equal(defaultHelp.stdout.includes("explicitly selected v2"), false);
  const terminated = spawnSync(process.execPath, [cli, "--database", v1, "add", "--json", "--", "--v2-root"], { env: { ...process.env, TASKS_SYNC_ROOT: "", TASKS_SOURCE_REGISTRY_PATH: "" }, encoding: "utf8" });
  assert.equal(terminated.status, 0, terminated.stderr);assert.equal(JSON.parse(terminated.stdout).task.title, "--v2-root");
});
