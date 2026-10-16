import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { build } from "esbuild";
import { canonicalJson } from "../src/backend/canonicalJson.ts";

const bundleDirectory = mkdtempSync(path.join(tmpdir(), "tasks-android-purge-test-"));
after(() => rmSync(bundleDirectory, { recursive: true, force: true }));
const bundle = await build({
  entryPoints: ["src/legacy/platform/androidBackendEngine.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const bundlePath = path.join(bundleDirectory, "androidBackendEngine.mjs");
writeFileSync(bundlePath, bundle.outputFiles[0].contents);
const { handleAndroidRequest } = await import(pathToFileURL(bundlePath).href);

const timestamp = "2026-09-23T00:00:00.000Z";
let nextRequestId = 0;

function canceledTask(id = "cancel-me") {
  return {
    id,
    title: "Canceled task",
    descriptionMarkdown: "",
    status: "canceled",
    priority: 2,
    category: null,
    tags: [],
    parentId: null,
    dependencyIds: [],
    blockedByIds: [],
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    canceledAt: timestamp,
  };
}

function datedTask(id, createdAt, updatedAt) {
  return {
    id,
    title: id,
    descriptionMarkdown: "",
    status: "open",
    priority: 2,
    category: null,
    tags: [],
    parentId: null,
    dependencyIds: [],
    blockedByIds: [],
    version: 1,
    createdAt,
    updatedAt,
    completedAt: null,
    canceledAt: null,
  };
}

function purgeRequest(idempotencyKey, changes = {}) {
  return {
    version: 1,
    requestId: `request-${++nextRequestId}`,
    command: "task.purgeCanceled",
    args: {},
    actor: { kind: "human", label: "test" },
    idempotencyKey,
    ...changes,
  };
}

function createBackend({
  tasks = [],
  canonicalFiles = null,
  canonicalMeta = null,
  pending = null,
} = {}) {
  const state = {
    tasks: structuredClone(tasks),
    workspaceRevision: 1,
    receipts: new Map(),
    pending,
    canonicalMeta,
    taskVersionOffset: 0,
    replaceRequests: [],
    failNextBegin: false,
  };
  const files = new Map(canonicalFiles ?? []);
  const events = [];
  const readRequests = [];
  const writeRequests = [];
  const syncFolder = canonicalFiles
    ? { uri: "content://tasks", displayName: "Tasks", path: null }
    : null;

  async function storage(request) {
    events.push(request.operation);
    switch (request.operation) {
      case "readReceiveMarker":
        return { marker: null };
      case "readPendingWrite":
        return { pending: state.pending };
      case "readSnapshot":
        return {
          tasks: structuredClone(state.tasks),
          workspaceRevision: state.workspaceRevision,
          taskVersionOffset: state.taskVersionOffset,
        };
      case "shiftSiblingPositions":
      case "insertActivity":
      case "writeOperation":
        return {};
      case "insertTask":
        state.tasks.push({
          ...request.task,
          category: null,
          tags: [],
          dependencyIds: [...(request.task.dependencyIds ?? [])],
          blockedByIds: [],
        });
        return {};
      case "readCanonicalMeta":
        return state.canonicalMeta ?? {};
      case "readReceipt":
        return { receipt: state.receipts.get(request.idempotencyKey) ?? null };
      case "stageCanonicalWrite":
        state.pending = request.pending;
        return { staged: true };
      case "completePendingWrite": {
        const pendingWrite = state.pending;
        assert.equal(pendingWrite?.operationId, request.operationId);
        const existing = state.receipts.get(pendingWrite.idempotencyKey);
        if (existing && existing.requestHash !== pendingWrite.requestHash) {
          throw new Error("pending idempotency key has a different request hash");
        }
        if (!existing) {
          state.receipts.set(pendingWrite.idempotencyKey, {
            requestHash: pendingWrite.requestHash,
            responseJson: pendingWrite.responseJson,
          });
        }
        state.pending = null;
        return { completed: true };
      }
      case "replaceCanonicalWorkspace":
        state.replaceRequests.push(structuredClone(request));
        if (request.forceRebuild) state.taskVersionOffset += 1;
        state.tasks = structuredClone(request.tasks).map((task) => ({
          ...task,
          version: task.version + state.taskVersionOffset,
          blockedByIds: [],
        }));
        state.workspaceRevision += 1;
        state.canonicalMeta = {
          workspaceId: request.workspaceId,
          fingerprint: request.fingerprint,
          cacheVersion: "2",
        };
        return { workspaceRevision: state.workspaceRevision };
      case "begin":
        if (state.failNextBegin) {
          state.failNextBegin = false;
          throw new Error("simulated interruption after canonical write");
        }
        return {};
      case "purgeCanceledTasks":
        state.tasks = state.tasks.filter((task) => task.status !== "canceled");
        state.workspaceRevision += 1;
        return {};
      case "writeReceipt":
        state.receipts.set(request.idempotencyKey, {
          requestHash: request.requestHash,
          responseJson: request.responseJson,
        });
        return {};
      case "commit":
      case "rollback":
        return {};
      default:
        throw new Error(`unexpected Android storage operation: ${request.operation}`);
    }
  }

  const originalWindow = globalThis.window;
  const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => null, setItem: () => undefined },
  });
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: async (command, args = {}) => {
        if (command === "android_storage") return storage(args.request);
        if (command === "get_sync_folder") return syncFolder;
        if (command === "read_sync_files") {
          readRequests.push(args.relativePaths ?? null);
          const requestedPaths = args.relativePaths ? new Set(args.relativePaths) : null;
          return {
            selected: Boolean(syncFolder),
            folderUri: syncFolder?.uri ?? null,
            files: [...files]
              .filter(([relativePath]) => !requestedPaths || requestedPaths.has(relativePath))
              .map(([relativePath, content]) => ({ relativePath, content, modifiedAt: null })),
          };
        }
        if (command === "write_sync_files") {
          writeRequests.push(args.expectedFolderUri ?? null);
          if (args.expectedFolderUri && args.expectedFolderUri !== syncFolder?.uri) {
            throw new Error("selected sync folder changed");
          }
          for (const file of args.files) {
            if (file.content === null) files.delete(file.relativePath);
            else files.set(file.relativePath, file.content);
          }
          return {};
        }
        throw new Error(`unexpected Tauri command: ${command}`);
      },
    },
  };

  return {
    state,
    events,
    files,
    readRequests,
    writeRequests,
    restore() {
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
      if (originalLocalStorage)
        Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
      else delete globalThis.localStorage;
    },
  };
}

async function withBackend(options, run) {
  const backend = createBackend(options);
  try {
    await run(backend);
  } finally {
    backend.restore();
  }
}

function writeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function canonicalRecord(record) {
  const { sync, ...content } = record;
  const syncWithoutHash = {
    revision: sync.revision,
    modifiedBy: sync.modifiedBy,
    basedOnHash: sync.basedOnHash,
  };
  return {
    ...content,
    sync: {
      ...syncWithoutHash,
      contentHash: await sha256(canonicalJson({ ...content, sync: syncWithoutHash })),
    },
  };
}

async function interruptedPurgeFixture() {
  const workspaceId = "workspace";
  const task = canceledTask();
  const taskRecord = await canonicalRecord({
    format: "tasks.task",
    formatVersion: 1,
    workspaceId,
    id: task.id,
    title: task.title,
    descriptionMarkdown: task.descriptionMarkdown,
    status: task.status,
    priority: task.priority,
    parentId: task.parentId,
    dependencyIds: task.dependencyIds,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
    canceledAt: task.canceledAt,
    sync: { revision: task.version, modifiedBy: "test", basedOnHash: null, contentHash: "" },
  });
  const rootOrder = await canonicalRecord({
    format: "tasks.sibling-order",
    formatVersion: 1,
    workspaceId,
    parentId: null,
    taskIds: [task.id],
    sync: { revision: 1, modifiedBy: "test", basedOnHash: null, contentHash: "" },
  });
  const files = new Map([
    [
      "workspace.json",
      writeJson({ format: "tasks.workspace", formatVersion: 1, workspaceId, schemaVersion: 1 }),
    ],
    [`tasks/${task.id}.json`, writeJson(taskRecord)],
    ["order/root.json", writeJson(rootOrder)],
  ]);
  const fingerprintInput = [...files]
    .map(([relativePath, content]) => ({ relativePath, content }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return {
    task,
    files,
    meta: {
      workspaceId,
      fingerprint: await sha256(canonicalJson(fingerprintInput)),
      cacheVersion: "2",
    },
  };
}

test("Android task.list defaults to created/newest", async () => {
  const tasks = [
    datedTask("oldest", "2026-01-01T00:00:00.000Z", "2026-03-03T00:00:00.000Z"),
    datedTask("middle", "2026-01-02T00:00:00.000Z", "2026-03-02T00:00:00.000Z"),
    datedTask("newest", "2026-01-03T00:00:00.000Z", "2026-03-01T00:00:00.000Z"),
  ];
  await withBackend({ tasks }, async () => {
    const response = await handleAndroidRequest({
      version: 1,
      requestId: "list-default-sort",
      command: "task.list",
      args: {},
      actor: { kind: "agent", label: "test" },
    });

    assert.equal(response.ok, true);
    assert.deepEqual(
      response.result.tasks.map((task) => task.id),
      ["newest", "middle", "oldest"],
    );
  });
});

test("Android task creation reuses the sync scan and verifies only staged files", async () => {
  const fixture = await interruptedPurgeFixture();
  await withBackend(
    { tasks: [fixture.task], canonicalFiles: fixture.files, canonicalMeta: fixture.meta },
    async (backend) => {
      const result = await handleAndroidRequest({
        version: 1,
        requestId: "create-request",
        command: "task.create",
        args: { title: "Created from test" },
        actor: { kind: "human", label: "test" },
        idempotencyKey: "create-saf",
      });

      assert.equal(result.ok, true, JSON.stringify(result.error));
      assert.equal(backend.readRequests.length, 2);
      assert.equal(backend.readRequests[0], null);
      assert.deepEqual(
        [...new Set(backend.readRequests[1])].sort(),
        ["workspace.json", `tasks/${result.result.task.id}.json`, "order/root.json"].sort(),
      );
      assert.deepEqual(backend.writeRequests, ["content://tasks"]);
      assert.equal(backend.files.has(`tasks/${result.result.task.id}.json`), true);
      assert.equal(backend.state.pending, null);
    },
  );
});

test("Android workspace.rebuild forces a same-fingerprint cache replacement", async () => {
  const fixture = await interruptedPurgeFixture();
  const damagedTask = { ...fixture.task, title: "Damaged derived cache" };
  await withBackend(
    { tasks: [damagedTask], canonicalFiles: fixture.files, canonicalMeta: fixture.meta },
    async (backend) => {
      const response = await handleAndroidRequest({
        version: 1,
        requestId: "rebuild-request",
        command: "workspace.rebuild",
        args: {},
        actor: { kind: "agent", label: "test" },
      });

      assert.equal(response.ok, true);
      assert.equal(response.result.rebuilt, true);
      assert.equal(response.result.changed, true);
      assert.equal(backend.state.replaceRequests.length, 1);
      assert.equal(backend.state.replaceRequests[0].forceRebuild, true);
      assert.equal(backend.state.tasks[0].title, fixture.task.title);
      assert.ok(backend.state.tasks[0].version > fixture.task.version);
    },
  );
});

test("Android purge returns its original receipt after the canceled tasks are gone", async () => {
  await withBackend({ tasks: [canceledTask()] }, async ({ state, events }) => {
    const first = await handleAndroidRequest(purgeRequest("purge-retry"));
    assert.equal(first.ok, true);
    assert.equal(first.result.deletedCount, 1);
    assert.deepEqual(first.result.deletedTaskIds, ["cancel-me"]);
    assert.equal(typeof first.result.operationId, "string");
    assert.deepEqual(state.tasks, []);

    const retry = await handleAndroidRequest(purgeRequest("purge-retry"));
    assert.deepEqual(retry.result, first.result);
    assert.equal(events.filter((operation) => operation === "purgeCanceledTasks").length, 1);
  });
});

test("Android purge rejects reusing a receipt key with different request content", async () => {
  await withBackend({ tasks: [canceledTask()] }, async () => {
    assert.equal((await handleAndroidRequest(purgeRequest("purge-reuse"))).ok, true);
    const reused = await handleAndroidRequest(
      purgeRequest("purge-reuse", { args: { reason: "different request" } }),
    );
    assert.equal(reused.ok, false);
    assert.equal(reused.error.code, "IDEMPOTENCY_KEY_REUSED");
  });
});

test("an Android purge with no canceled tasks records a no-op receipt", async () => {
  await withBackend({}, async ({ events }) => {
    const result = await handleAndroidRequest(purgeRequest("purge-empty"));
    assert.deepEqual(result.result, { deletedCount: 0 });
    assert.equal(events.includes("readReceipt"), true);
    assert.equal(events.includes("writeReceipt"), true);
    assert.equal(events.includes("purgeCanceledTasks"), false);

    const reused = await handleAndroidRequest(
      purgeRequest("purge-empty", { args: { reason: "different request" } }),
    );
    assert.equal(reused.ok, false);
    assert.equal(reused.error.code, "IDEMPOTENCY_KEY_REUSED");
  });
});

test("Android purge dry-runs and read-only calls do not read or write receipts", async () => {
  for (const flags of [{ dryRun: true }, { readOnly: true }]) {
    await withBackend({ tasks: [canceledTask()] }, async ({ state, events }) => {
      const result = await handleAndroidRequest(purgeRequest(undefined, flags));
      assert.equal(result.ok, true);
      assert.equal(result.result.deletedCount, 1);
      assert.equal(result.result.dryRun, true);
      assert.equal(result.result.readOnly, Boolean(flags.readOnly));
      assert.equal(events.includes("readReceipt"), false);
      assert.equal(
        events.some((operation) =>
          ["begin", "purgeCanceledTasks", "writeReceipt", "stageCanonicalWrite"].includes(
            operation,
          ),
        ),
        false,
      );
      assert.equal(state.tasks.length, 1);
    });
  }
});

test("Android purge replays its receipt after recovering an interrupted canonical write", async () => {
  const fixture = await interruptedPurgeFixture();
  await withBackend(
    { tasks: [fixture.task], canonicalFiles: fixture.files, canonicalMeta: fixture.meta },
    async (backend) => {
      backend.state.failNextBegin = true;
      const request = purgeRequest("purge-recovery");
      const interrupted = await handleAndroidRequest(request);
      assert.equal(interrupted.ok, false);
      assert.equal(backend.state.pending?.idempotencyKey, "purge-recovery");
      assert.equal(backend.files.has(`tasks/${fixture.task.id}.json`), false);

      const replay = await handleAndroidRequest({
        ...request,
        requestId: "request-after-recovery",
      });
      assert.equal(replay.ok, true);
      assert.equal(replay.result.deletedCount, 1);
      assert.deepEqual(replay.result.deletedTaskIds, [fixture.task.id]);
      assert.equal(typeof replay.result.operationId, "string");
      assert.equal(backend.state.pending, null);
      assert.deepEqual(backend.state.tasks, []);
      assert.equal(backend.events.includes("completePendingWrite"), true);
    },
  );
});
