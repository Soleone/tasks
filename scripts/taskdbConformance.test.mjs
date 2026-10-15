import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import test from "node:test";
import { contentHash } from "../dist/legacy/backend/requestHash.js";

const fixtureRoot = fileURLToPath(new URL("./fixtures/taskdb-v1/sync/", import.meta.url));
const sidecarPath = fileURLToPath(new URL("../dist/backend/cli.js", import.meta.url));
const tasksCliPath = fileURLToPath(new URL("../dist/backend/tasks-cli.js", import.meta.url));
const fixtureWorkspace = JSON.parse(readFileSync(path.join(fixtureRoot, "workspace.json"), "utf8"));
const fixtureTasks = readdirSync(path.join(fixtureRoot, "tasks"))
  .filter((name) => name.endsWith(".json"))
  .map((name) => JSON.parse(readFileSync(path.join(fixtureRoot, "tasks", name), "utf8")));

let nextRequestId = 0;

function copyFixture(directory) {
  const syncRoot = path.join(directory, "sync");
  mkdirSync(directory, { recursive: true });
  cpSync(fixtureRoot, syncRoot, { recursive: true });
  return syncRoot;
}

function tasksEnvironment(overrides = {}) {
  const env = { ...process.env, TASKS_SYNC_ROOT: "", ...overrides };
  if (!Object.hasOwn(overrides, "TASKS_SOURCE_REGISTRY_PATH")) delete env.TASKS_SOURCE_REGISTRY_PATH;
  return env;
}

function startSidecar(databasePath, envOverrides = {}) {
  const child = spawn(process.execPath, [sidecarPath, "--stdio", "--database", databasePath], {
    env: tasksEnvironment(envOverrides),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const output = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  output.on("line", (line) => {
    const response = JSON.parse(line);
    const waiting = pending.get(response.requestId);
    if (!waiting) return;
    pending.delete(response.requestId);
    clearTimeout(waiting.timer);
    waiting.resolve(response);
  });
  child.on("close", (code, signal) => {
    for (const waiting of pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(new Error(`tasks-backend closed (${code ?? signal}): ${stderr}`));
    }
    pending.clear();
  });
  child.on("error", (error) => {
    for (const waiting of pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(error);
    }
    pending.clear();
  });

  return {
    send(command, args = {}, options = {}) {
      const requestId = `taskdb-conformance-${++nextRequestId}`;
      const request = {
        version: 1,
        requestId,
        command,
        args,
        actor: options.actor ?? { kind: "agent", label: "taskdb-conformance" },
        ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
      };
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          child.kill();
          reject(new Error(`timed out waiting for ${command}; stderr: ${stderr}`));
        }, 10_000);
        pending.set(requestId, { resolve, reject, timer });
        child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
          if (!error) return;
          pending.delete(requestId);
          clearTimeout(timer);
          reject(error);
        });
      });
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const closed = once(child, "close");
      const killTimer = setTimeout(() => child.kill(), 5_000);
      child.stdin.end();
      await closed;
      clearTimeout(killTimer);
      output.close();
    },
  };
}

function requireSuccess(response) {
  assert.equal(response.ok, true, response.ok ? undefined : `${response.error.code}: ${response.error.message}`);
  return response.result;
}

function requireError(response, code) {
  assert.equal(response.ok, false, "expected a protocol error response");
  assert.equal(response.error.code, code, response.error.message);
  return response.error;
}

function taskProjection(task) {
  return {
    id: task.id,
    title: task.title,
    descriptionMarkdown: task.descriptionMarkdown,
    status: task.status,
    priority: task.priority,
    category: task.category?.slug ?? null,
    tags: task.tags.map((tag) => tag.slug).sort(),
    parentId: task.parentId,
    dependencyIds: [...task.dependencyIds].sort(),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
    canceledAt: task.canceledAt,
  };
}

function removeCache(databasePath) {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    rmSync(`${databasePath}${suffix}`, { force: true });
  }
  rmSync(path.join(path.dirname(databasePath), ".tasks-local"), { recursive: true, force: true });
}

test("JSON-lines v1 preserves fixture behavior, write safety, rebuild, conflicts, and snapshot round-trip", async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-taskdb-conformance-"));
  const syncRoot = copyFixture(path.join(directory, "primary"));
  const databasePath = path.join(directory, "primary", "tasks.db");
  const exportPath = path.join(directory, "fixture-snapshot.json");
  const restoredDatabasePath = path.join(directory, "restored", "tasks.db");
  let sidecar;

  t.after(async () => {
    await sidecar?.stop();
    rmSync(directory, { recursive: true, force: true });
  });

  sidecar = startSidecar(databasePath);
  const listed = requireSuccess(await sidecar.send("task.list", { sort: "manual" }));
  assert.equal(listed.total, fixtureTasks.length);
  const actualById = new Map(listed.tasks.map((task) => [task.id, task]));
  for (const canonical of fixtureTasks) {
    const task = actualById.get(canonical.id);
    assert.ok(task, `missing fixture task ${canonical.id}`);
    assert.equal(task.title, canonical.title);
    assert.equal(task.status, canonical.status);
    assert.equal(task.priority, canonical.priority);
    assert.equal(task.parentId, canonical.parentId);
    assert.deepEqual([...task.dependencyIds].sort(), [...canonical.dependencyIds].sort());
  }
  assert.deepEqual(
    listed.tasks.map((task) => task.id),
    [
      "62f159c1-22a7-45cb-89a0-c0c35aaeb1ed",
      "f3e5499b-402e-4d7d-8b61-eefc4409ca32",
      "c8d4206d-c25a-4317-baa4-a2c5443060e9",
      "6e1bf023-da3c-4785-b8a9-a696ac1fa5c1",
    ],
  );
  const parentId = "c8d4206d-c25a-4317-baa4-a2c5443060e9";
  const childId = "6e1bf023-da3c-4785-b8a9-a696ac1fa5c1";
  const parentBefore = actualById.get(parentId);
  const child = actualById.get(childId);
  assert.deepEqual(parentBefore.category, { slug: "planning", label: "planning" });
  assert.deepEqual(parentBefore.tags.map((tag) => tag.slug), ["product"]);
  assert.equal(child.parentId, parentId);
  assert.deepEqual(child.dependencyIds, [parentId]);
  assert.equal(actualById.get("f3e5499b-402e-4d7d-8b61-eefc4409ca32").status, "done");
  assert.equal(actualById.get("62f159c1-22a7-45cb-89a0-c0c35aaeb1ed").status, "paused");

  const changedTitle = "Plan launch reviewed @planning #product";
  const updated = requireSuccess(await sidecar.send("task.update", {
    id: parentId,
    title: changedTitle,
    expectedVersion: parentBefore.version,
  }, {
    idempotencyKey: "conformance-update-parent",
    actor: { kind: "human", label: "fixture-editor" },
  }));
  assert.equal(updated.task.title, changedTitle);
  const activity = requireSuccess(await sidecar.send("activity.list", { taskId: parentId }));
  assert.ok(activity.activity.some((entry) => entry.actor.label === "fixture-editor"));
  requireError(await sidecar.send("task.update", {
    id: parentId,
    title: "Stale title",
    expectedVersion: parentBefore.version,
  }, { idempotencyKey: "conformance-stale-parent" }), "STALE_TASK_VERSION");

  const defaultPriority = requireSuccess(await sidecar.send("task.create", {
    title: "Default priority",
  }, { idempotencyKey: "conformance-default-priority" }));
  assert.equal(defaultPriority.task.priority, 2);
  const p4 = requireSuccess(await sidecar.send("task.create", {
    title: "Lowest priority boundary",
    priority: 4,
  }, { idempotencyKey: "conformance-priority-four" }));
  assert.equal(p4.task.priority, 4);
  const createArgs = { title: "Retry exactly once @planning #retry", priority: 0 };
  const firstCreate = requireSuccess(await sidecar.send("task.create", createArgs, { idempotencyKey: "conformance-create-retry" }));
  const replay = requireSuccess(await sidecar.send("task.create", createArgs, { idempotencyKey: "conformance-create-retry" }));
  assert.deepEqual(replay, firstCreate);
  requireError(await sidecar.send("task.create", { title: "Different payload" }, {
    idempotencyKey: "conformance-create-retry",
  }), "IDEMPOTENCY_KEY_REUSED");
  let statusTask = firstCreate.task;
  for (const [command, expectedStatus] of [
    ["task.start", "in_progress"],
    ["task.pause", "paused"],
    ["task.complete", "done"],
    ["task.reopen", "open"],
    ["task.cancel", "canceled"],
    ["task.reopen", "open"],
  ]) {
    const transition = requireSuccess(await sidecar.send(command, {
      id: statusTask.id,
      expectedVersion: statusTask.version,
    }, { idempotencyKey: `conformance-status-${command}-${statusTask.version}` }));
    statusTask = transition.task;
    assert.equal(statusTask.status, expectedStatus);
  }
  requireError(await sidecar.send("task.create", { title: "Two scopes @one @two" }, {
    idempotencyKey: "conformance-multiple-categories",
  }), "MULTIPLE_CATEGORIES");

  const parentAfterUpdate = requireSuccess(await sidecar.send("task.get", { id: parentId })).task;
  requireError(await sidecar.send("task.dependency.add", {
    id: parentId,
    dependsOnId: childId,
    expectedVersion: parentAfterUpdate.version,
  }, { idempotencyKey: "conformance-dependency-cycle" }), "DEPENDENCY_CYCLE");
  requireError(await sidecar.send("task.move", {
    id: parentId,
    parentId: childId,
    expectedVersion: parentAfterUpdate.version,
  }, { idempotencyKey: "conformance-parent-cycle" }), "PARENT_CYCLE");

  const preRebuildTasks = requireSuccess(await sidecar.send("task.list", { sort: "manual" })).tasks;
  const preRebuildVersion = parentAfterUpdate.version;
  await sidecar.stop();
  sidecar = undefined;
  removeCache(databasePath);
  sidecar = startSidecar(databasePath);
  const rebuilt = requireSuccess(await sidecar.send("task.list", { sort: "manual" }));
  assert.equal(rebuilt.total, preRebuildTasks.length);
  assert.deepEqual(rebuilt.tasks.map(taskProjection), preRebuildTasks.map(taskProjection));
  assert.ok(rebuilt.tasks.find((task) => task.id === parentId).version > 1_000_000);
  requireError(await sidecar.send("task.update", {
    id: parentId,
    title: "Write with pre-rebuild version",
    expectedVersion: preRebuildVersion,
  }, { idempotencyKey: "conformance-stale-after-rebuild" }), "STALE_TASK_VERSION");

  const conflictPath = path.join(syncRoot, "tasks", `${parentId}.sync-conflict-conformance.json`);
  const canonicalParent = JSON.parse(readFileSync(path.join(syncRoot, "tasks", `${parentId}.json`), "utf8"));
  const conflictRecord = {
    ...canonicalParent,
    title: `${canonicalParent.title} conflict copy`,
    sync: {
      revision: canonicalParent.sync.revision + 1,
      modifiedBy: "conformance",
      basedOnHash: canonicalParent.sync.contentHash,
      contentHash: "",
    },
  };
  conflictRecord.sync.contentHash = contentHash({
    ...conflictRecord,
    sync: {
      revision: conflictRecord.sync.revision,
      modifiedBy: conflictRecord.sync.modifiedBy,
      basedOnHash: conflictRecord.sync.basedOnHash,
    },
  });
  writeFileSync(conflictPath, `${JSON.stringify(conflictRecord, null, 2)}\n`);
  const sync = requireSuccess(await sidecar.send("workspace.sync"));
  assert.equal(sync.unresolvedConflictCount, 1);
  const conflicts = requireSuccess(await sidecar.send("workspace.conflict.list"));
  assert.equal(conflicts.conflicts.length, 1);
  assert.equal(requireSuccess(await sidecar.send("task.get", { id: parentId })).task.title, changedTitle);

  requireSuccess(await sidecar.send("workspace.export", { destinationPath: exportPath }));
  assert.equal(existsSync(exportPath), true);
  requireSuccess(await sidecar.send("workspace.restore", {
    sourcePath: exportPath,
    destinationPath: restoredDatabasePath,
  }, { idempotencyKey: "conformance-restore" }));
  const restoredWorkspace = JSON.parse(readFileSync(path.join(directory, "restored", "sync", "workspace.json"), "utf8"));
  assert.notEqual(restoredWorkspace.workspaceId, fixtureWorkspace.workspaceId);

  await sidecar.stop();
  sidecar = undefined;
  sidecar = startSidecar(restoredDatabasePath);
  const restored = requireSuccess(await sidecar.send("task.list", { sort: "manual" }));
  assert.deepEqual(restored.tasks.map(taskProjection), preRebuildTasks.map(taskProjection));
});

test("incomplete v1 workspaces fail without inventing an identity", async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-taskdb-incomplete-"));
  const syncRoot = copyFixture(path.join(directory, "workspace"));
  const databasePath = path.join(directory, "workspace", "tasks.db");
  rmSync(path.join(syncRoot, "workspace.json"));
  let sidecar = startSidecar(databasePath);

  t.after(async () => {
    await sidecar?.stop();
    rmSync(directory, { recursive: true, force: true });
  });

  requireError(await sidecar.send("task.list"), "INVALID_CANONICAL");
  assert.equal(existsSync(path.join(syncRoot, "workspace.json")), false);
});

test("tasks-cli still reads and writes the copied v1 workspace", (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-taskdb-cli-"));
  const syncRoot = copyFixture(path.join(directory, "workspace"));
  const databasePath = path.join(directory, "workspace", "tasks.db");

  t.after(() => rmSync(directory, { recursive: true, force: true }));

  function runCli(args) {
    const result = spawnSync(process.execPath, [tasksCliPath, ...args], {
      env: tasksEnvironment(),
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  }

  const listed = runCli(["list", "--database", databasePath, "--json"]);
  assert.equal(listed.total, fixtureTasks.length);
  const task = listed.tasks.find((entry) => entry.id === "c8d4206d-c25a-4317-baa4-a2c5443060e9");
  assert.ok(task);
  const updated = runCli([
    "update", task.id,
    "--title", "CLI changed @operations #roundtrip",
    "--database", databasePath,
    "--idempotency-key", "conformance-cli-update",
    "--json",
  ]);
  assert.equal(updated.task.title, "CLI changed @operations #roundtrip");
  assert.equal(updated.task.category.slug, "operations");
  assert.deepEqual(updated.task.tags.map((tag) => tag.slug), ["roundtrip"]);
  assert.equal(existsSync(path.join(syncRoot, "tasks", `${task.id}.json`)), true);
});

test("source registry combines TaskDB roots and routes ref writes through JSON-lines and CLI", async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-source-registry-"));
  const alphaDatabase = path.join(directory, "alpha", "tasks.db");
  const betaDatabase = path.join(directory, "beta", "tasks.db");
  const alphaSyncRoot = path.join(directory, "alpha", "sync");

  function runCli(args, envOverrides = {}) {
    const result = spawnSync(process.execPath, [tasksCliPath, ...args], {
      env: tasksEnvironment(envOverrides),
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  }

  const alphaCreated = runCli(["add", "Alpha @planning #home", "--database", alphaDatabase, "--idempotency-key", "seed-alpha", "--json"]);
  const betaCreated = runCli(["add", "Beta without a category", "--database", betaDatabase, "--idempotency-key", "seed-beta", "--json"]);
  const registryPath = path.join(directory, "sources.json");
  const registry = {
    format: "tasks.source-registry",
    formatVersion: 1,
    defaultSourceKey: "alpha",
    sources: [
      { key: "alpha", label: "Alpha", databasePath: "alpha/tasks.db", syncRoot: "alpha/sync" },
      { key: "beta", label: "Beta", databasePath: "beta/tasks.db", syncRoot: "beta/sync" },
    ],
  };
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

  let sidecar;
  let duplicateSidecar;
  t.after(async () => {
    await sidecar?.stop();
    await duplicateSidecar?.stop();
    rmSync(directory, { recursive: true, force: true });
  });

  sidecar = startSidecar(alphaDatabase, { TASKS_SOURCE_REGISTRY_PATH: registryPath });
  const sources = requireSuccess(await sidecar.send("source.list"));
  assert.deepEqual(sources.sources.map((source) => source.key), ["alpha", "beta"]);
  assert.equal(sources.sources[0].capabilities.task.list, true);
  const sync = requireSuccess(await sidecar.send("workspace.sync"));
  assert.equal(sync.sources.length, 2);

  const listed = requireSuccess(await sidecar.send("task.list", { sort: "manual" }));
  assert.equal(listed.total, 2);
  assert.deepEqual(listed.tasks.map((task) => task.ref.sourceKey), ["alpha", "beta"]);
  assert.deepEqual(listed.tasks.map((task) => task.ref.taskId), [alphaCreated.task.id, betaCreated.task.id]);
  const uncategorized = requireSuccess(await sidecar.send("task.list", { category: { kind: "uncategorized" } }));
  assert.equal(uncategorized.total, 1);
  assert.equal(uncategorized.tasks[0].ref.sourceKey, "beta");
  const legacyUncategorized = requireSuccess(await sidecar.send("task.list", { categoryIsNull: true }));
  assert.equal(legacyUncategorized.total, 1);
  assert.equal(legacyUncategorized.tasks[0].ref.sourceKey, "beta");
  const secondPage = requireSuccess(await sidecar.send("task.list", { sort: "manual", limit: 1, offset: 1 }));
  assert.equal(secondPage.tasks[0].ref.sourceKey, "beta");
  requireError(await sidecar.send("task.list", { limit: 101 }), "INVALID_ARGUMENT");
  requireError(await sidecar.send("task.list", { offset: -1 }), "INVALID_ARGUMENT");
  const defaultCapture = requireSuccess(await sidecar.send("task.create", {
    title: "Captured at the configured default",
  }, { idempotencyKey: "source-default-capture" }));
  assert.equal(defaultCapture.task.ref.sourceKey, "alpha");

  const beta = listed.tasks.find((task) => task.ref.sourceKey === "beta");
  requireError(await sidecar.send("task.update", {
    id: beta.id,
    title: "Must not guess a source",
    expectedVersion: beta.version,
  }, { idempotencyKey: "source-missing-ref" }), "SOURCE_REQUIRED");
  const routedUpdate = requireSuccess(await sidecar.send("task.update", {
    ref: beta.ref,
    title: "Beta updated from protocol @project",
    expectedVersion: beta.version,
  }, { idempotencyKey: "source-beta-protocol-update" }));
  assert.equal(routedUpdate.task.ref.sourceKey, "beta");

  const cliList = runCli(["list", "--source-key", "beta", "--database", alphaDatabase, "--json"], {
    TASKS_SOURCE_REGISTRY_PATH: registryPath,
  });
  assert.equal(cliList.total, 1);
  assert.equal(cliList.tasks[0].ref.sourceKey, "beta");
  const cliUpdate = runCli([
    "update", betaCreated.task.id,
    "--source-key", "beta",
    "--title", "Beta updated from CLI @launch",
    "--database", alphaDatabase,
    "--idempotency-key", "source-beta-cli-update",
    "--json",
  ], { TASKS_SOURCE_REGISTRY_PATH: registryPath });
  assert.equal(cliUpdate.task.ref.sourceKey, "beta");

  const betaReadback = runCli(["show", betaCreated.task.id, "--database", betaDatabase, "--json"]);
  const alphaReadback = runCli(["show", alphaCreated.task.id, "--database", alphaDatabase, "--json"]);
  assert.equal(betaReadback.task.title, "Beta updated from CLI @launch");
  assert.equal(alphaReadback.task.title, "Alpha @planning #home");

  const duplicateRoot = path.join(directory, "duplicate", "sync");
  mkdirSync(path.dirname(duplicateRoot), { recursive: true });
  cpSync(alphaSyncRoot, duplicateRoot, { recursive: true });
  const duplicateRegistryPath = path.join(directory, "duplicate-sources.json");
  writeFileSync(duplicateRegistryPath, `${JSON.stringify({
    format: "tasks.source-registry",
    formatVersion: 1,
    sources: [
      { key: "alpha", label: "Alpha", databasePath: "alpha/tasks.db", syncRoot: "alpha/sync" },
      { key: "duplicate", label: "Duplicate", databasePath: "duplicate/cache/tasks.db", syncRoot: "duplicate/sync" },
    ],
  }, null, 2)}\n`);
  duplicateSidecar = startSidecar(alphaDatabase, { TASKS_SOURCE_REGISTRY_PATH: duplicateRegistryPath });
  requireError(await duplicateSidecar.send("task.list"), "DUPLICATE_SOURCE_MOUNT");
});
