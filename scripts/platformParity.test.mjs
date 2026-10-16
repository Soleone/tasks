import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { executeCommand } from "../dist/legacy/backend/commands.js";
import { canonicalRootPath } from "../dist/legacy/backend/canonicalWorkspace.js";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/platform-parity.json", import.meta.url), "utf8"),
);
const bundleDirectory = mkdtempSync(path.join(os.tmpdir(), "tasks-platform-parity-"));
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

test.after(() => rmSync(bundleDirectory, { recursive: true, force: true }));

let nextRequestId = 0;
function request(command, args = {}, idempotencyKey) {
  return {
    version: 1,
    requestId: `platform-parity-${++nextRequestId}`,
    command,
    args,
    actor: { kind: "agent", label: "platform-parity" },
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  };
}

function createAndroidBackend(canonicalFiles = null) {
  const state = {
    tasks: [],
    canonicalMeta: null,
    categories: new Map(),
    tags: new Map(),
    receipts: new Map(),
    operation: null,
    workspaceRevision: 1,
    taskVersionOffset: 0,
  };
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

  async function storage(request) {
    switch (request.operation) {
      case "readReceiveMarker":
        return { marker: null };
      case "readPendingWrite":
        return { pending: null };
      case "readCanonicalMeta":
        return state.canonicalMeta ?? {};
      case "replaceCanonicalWorkspace":
        state.tasks = structuredClone(request.tasks).map((task) => ({ ...task, blockedByIds: [] }));
        state.canonicalMeta = {
          workspaceId: request.workspaceId,
          fingerprint: request.fingerprint,
          cacheVersion: "2",
        };
        state.workspaceRevision += 1;
        return { workspaceRevision: state.workspaceRevision };
      case "readSnapshot":
        return {
          tasks: structuredClone(state.tasks)
            .sort(
              (left, right) => left.position - right.position || left.id.localeCompare(right.id),
            )
            .map(({ position: _position, ...task }) => task),
          workspaceRevision: state.workspaceRevision,
          taskVersionOffset: state.taskVersionOffset,
        };
      case "readReceipt":
        return { receipt: state.receipts.get(request.idempotencyKey) ?? null };
      case "readOperation":
        return { operation: structuredClone(state.operation) };
      case "begin":
        return { started: true };
      case "ensureCategory": {
        const existing = [...state.categories.values()].find(
          (category) => category.slug === request.slug,
        );
        const category = existing ?? { id: request.id, slug: request.slug, label: request.label };
        state.categories.set(category.id, category);
        return { id: category.id };
      }
      case "ensureTag": {
        const existing = [...state.tags.values()].find((tag) => tag.slug === request.slug);
        const tag = existing ?? { id: request.id, slug: request.slug, label: request.label };
        state.tags.set(tag.id, tag);
        return { id: tag.id };
      }
      case "shiftSiblingPositions":
        for (const task of state.tasks) {
          if (task.parentId === request.parentId) task.position += 1;
        }
        return {};
      case "insertTask": {
        const task = request.task;
        state.tasks.push({
          id: task.id,
          title: task.title,
          descriptionMarkdown: task.descriptionMarkdown,
          status: task.status,
          priority: task.priority,
          category: task.categoryId === null ? null : state.categories.get(task.categoryId),
          tags: [],
          parentId: task.parentId,
          dependencyIds: [],
          blockedByIds: [],
          version: task.version,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          completedAt: task.completedAt,
          canceledAt: task.canceledAt,
          position: task.position,
        });
        state.workspaceRevision += 1;
        return {};
      }
      case "updateTask": {
        const taskIndex = state.tasks.findIndex((entry) => entry.id === request.task.id);
        assert.notEqual(taskIndex, -1);
        const current = state.tasks[taskIndex];
        assert.equal(current.version, request.expectedVersion);
        const dependencyIds = [...request.dependencyIds];
        state.tasks[taskIndex] = {
          ...current,
          title: request.task.title,
          descriptionMarkdown: request.task.descriptionMarkdown,
          status: request.task.status,
          priority: request.task.priority,
          category:
            request.task.categoryId === null ? null : state.categories.get(request.task.categoryId),
          tags: request.tagIds.map((id) => state.tags.get(id)),
          parentId: request.task.parentId,
          dependencyIds,
          blockedByIds: dependencyIds.filter(
            (id) => state.tasks.find((entry) => entry.id === id)?.status !== "canceled",
          ),
          version: request.task.version,
          createdAt: request.task.createdAt,
          updatedAt: request.task.updatedAt,
          completedAt: request.task.completedAt,
          canceledAt: request.task.canceledAt,
          position: request.task.position,
        };
        state.workspaceRevision += 1;
        return {};
      }
      case "insertTaskTag": {
        const task = state.tasks.find((entry) => entry.id === request.taskId);
        const tag = state.tags.get(request.tagId);
        assert.ok(task && tag);
        task.tags.push(tag);
        return {};
      }
      case "insertActivity":
        return {};
      case "writeOperation":
        state.operation = structuredClone(request.record);
        return { saved: true };
      case "writeReceipt":
        state.receipts.set(request.idempotencyKey, {
          requestHash: request.requestHash,
          responseJson: request.responseJson,
        });
        return {};
      case "deleteTask": {
        const index = state.tasks.findIndex((task) => task.id === request.id);
        assert.notEqual(index, -1);
        assert.equal(state.tasks[index].version, request.expectedVersion);
        state.tasks.splice(index, 1);
        state.workspaceRevision += 1;
        return { deleted: true };
      }
      case "clearOperation":
        assert.equal(state.operation?.id, request.operationId);
        state.operation = null;
        return { cleared: true };
      case "commit":
      case "rollback":
        return {};
      default:
        throw new Error(`unexpected Android storage operation: ${request.operation}`);
    }
  }

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => null, setItem: () => undefined },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: async (command, args = {}) => {
          if (command === "android_storage") return storage(args.request);
          if (command === "get_sync_folder")
            return canonicalFiles
              ? { uri: "content://parity", displayName: "Parity", path: null }
              : null;
          if (command === "read_sync_files")
            return {
              selected: canonicalFiles !== null,
              files: canonicalFiles
                ? [...canonicalFiles].map(([relativePath, content]) => ({
                    relativePath,
                    content,
                    modifiedAt: null,
                  }))
                : [],
            };
          throw new Error(`unexpected Tauri command: ${command}`);
        },
      },
    },
  });

  return {
    state,
    restore() {
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
      else delete globalThis.window;
      if (originalLocalStorage)
        Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
      else delete globalThis.localStorage;
    },
  };
}

test("desktop and Android follow the shared task behavior fixture", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-platform-parity-db-"));
  const databasePath = path.join(directory, "tasks.db");
  const desktopIds = new Map();
  let androidCanonical;
  try {
    for (const entry of fixture.tasks) {
      const parentId = entry.parent === undefined ? null : desktopIds.get(entry.parent);
      const desktopResult = executeCommand(
        request(
          "task.create",
          {
            title: entry.title,
            priority: entry.priority,
            parentId,
          },
          `fixture-${entry.key}`,
        ),
        databasePath,
      );
      desktopIds.set(entry.key, desktopResult.task.id);
      assert.equal(desktopResult.task.category?.slug ?? null, entry.category);
      assert.equal(desktopResult.task.priority, entry.priority);
      assert.deepEqual(desktopResult.task.tags.map((tag) => tag.slug).sort(), entry.tags);
    }

    const canonicalRoot = canonicalRootPath(databasePath);
    const relativePaths = ["workspace.json"]
      .concat(readdirSync(path.join(canonicalRoot, "tasks")).map((name) => `tasks/${name}`))
      .concat(readdirSync(path.join(canonicalRoot, "order")).map((name) => `order/${name}`));
    const canonicalFiles = new Map(
      relativePaths.map((relativePath) => [
        relativePath,
        readFileSync(path.join(canonicalRoot, relativePath), "utf8"),
      ]),
    );
    androidCanonical = createAndroidBackend(canonicalFiles);

    for (const entry of fixture.tasks) {
      const response = await handleAndroidRequest(
        request("task.get", { id: desktopIds.get(entry.key) }),
      );
      assert.equal(response.ok, true, response.ok ? undefined : response.error.message);
      assert.equal(response.result.task.category?.slug ?? null, entry.category);
      assert.deepEqual(response.result.task.tags.map((tag) => tag.slug).sort(), entry.tags);
    }

    for (const query of fixture.queries) {
      const desktopResult = executeCommand(request("task.list", query.args), databasePath);
      const androidResult = await handleAndroidRequest(request("task.list", query.args));
      assert.equal(
        androidResult.ok,
        true,
        androidResult.ok ? undefined : androidResult.error.message,
      );
      assert.deepEqual(
        desktopResult.tasks.map((task) => task.title),
        query.titles,
      );
      assert.deepEqual(
        androidResult.result.tasks.map((task) => task.title),
        query.titles,
      );
    }

    const alphaId = desktopIds.get("alpha");
    const staleRequest = request(
      "task.update",
      {
        id: alphaId,
        title: "Stale write",
        descriptionMarkdown: "",
        expectedVersion: 2,
      },
      "stale-fixture-alpha",
    );
    assert.throws(
      () => executeCommand(staleRequest, databasePath),
      (error) => error.code === "STALE_TASK_VERSION",
    );
    const staleAndroid = await handleAndroidRequest(staleRequest);
    assert.equal(staleAndroid.ok, false);
    assert.equal(staleAndroid.error.code, "STALE_TASK_VERSION");

    androidCanonical.restore();
    androidCanonical = undefined;
    const androidLocal = createAndroidBackend();
    try {
      const transitionTitle = "Status parity";
      let desktopTransition = executeCommand(
        request("task.create", { title: transitionTitle }, "desktop-status-create"),
        databasePath,
      ).task;
      const androidCreated = await handleAndroidRequest(
        request("task.create", { title: transitionTitle }, "android-status-create"),
      );
      assert.equal(androidCreated.ok, true);
      let androidTransition = androidCreated.result.task;
      for (const [command, status] of [
        ["task.start", "in_progress"],
        ["task.pause", "paused"],
        ["task.complete", "done"],
        ["task.reopen", "open"],
        ["task.cancel", "canceled"],
        ["task.reopen", "open"],
      ]) {
        const desktopStatus = executeCommand(
          request(
            command,
            {
              id: desktopTransition.id,
              expectedVersion: desktopTransition.version,
            },
            `desktop-status-${desktopTransition.version}`,
          ),
          databasePath,
        );
        const androidStatus = await handleAndroidRequest(
          request(
            command,
            {
              id: androidTransition.id,
              expectedVersion: androidTransition.version,
            },
            `android-status-${androidTransition.version}`,
          ),
        );
        assert.equal(
          androidStatus.ok,
          true,
          androidStatus.ok ? undefined : androidStatus.error.message,
        );
        desktopTransition = desktopStatus.task;
        androidTransition = androidStatus.result.task;
        assert.equal(desktopTransition.status, status);
        assert.equal(androidTransition.status, status);
        assert.equal(androidTransition.version, desktopTransition.version);
      }

      const partialDesktop = executeCommand(
        request(
          "task.update",
          {
            id: desktopTransition.id,
            title: "Partial update accepted by Node",
            expectedVersion: desktopTransition.version,
          },
          "desktop-partial-update",
        ),
        databasePath,
      );
      assert.equal(partialDesktop.task.title, "Partial update accepted by Node");
      const partialAndroid = await handleAndroidRequest(
        request(
          "task.update",
          {
            id: androidTransition.id,
            title: "Partial update rejected by Android",
            expectedVersion: androidTransition.version,
          },
          "android-partial-update",
        ),
      );
      assert.equal(partialAndroid.ok, false);
      if (!partialAndroid.ok) assert.equal(partialAndroid.error.code, "INVALID_ARGUMENT");

      const replayRequest = request(
        "task.create",
        { title: "Receipt @review #once" },
        "shared-receipt",
      );
      const desktopFirst = executeCommand(replayRequest, databasePath);
      const androidFirst = await handleAndroidRequest(replayRequest);
      assert.equal(androidFirst.ok, true);
      const replay = { ...replayRequest, requestId: "replay-with-new-request-id" };
      assert.deepEqual(executeCommand(replay, databasePath), desktopFirst);
      const androidReplay = await handleAndroidRequest(replay);
      assert.equal(androidReplay.ok, true);
      assert.deepEqual(androidReplay.result, androidFirst.result);

      const desktopUndo = executeCommand(
        request(
          "operation.undo",
          {
            operationId: desktopFirst.operationId,
          },
          "desktop-undo",
        ),
        databasePath,
      );
      const androidUndo = await handleAndroidRequest(
        request(
          "operation.undo",
          {
            operationId: androidFirst.result.operationId,
          },
          "android-undo",
        ),
      );
      assert.equal(androidUndo.ok, true, androidUndo.ok ? undefined : androidUndo.error.message);
      assert.equal(desktopUndo.deletedTaskIds.length, 1);
      assert.equal(androidUndo.result.deletedTaskIds.length, 1);
      const unsupportedRestore = await handleAndroidRequest(
        request("workspace.restore", {
          sourcePath: "snapshot.json",
          destinationPath: "restored.db",
        }),
      );
      assert.equal(unsupportedRestore.ok, false);
      if (!unsupportedRestore.ok)
        assert.equal(unsupportedRestore.error.code, "ANDROID_COMMAND_UNSUPPORTED");
      assert.equal(
        executeCommand(request("task.list", { search: "Receipt @review" }), databasePath).total,
        0,
      );
      const remainingAndroid = await handleAndroidRequest(
        request("task.list", { search: "Receipt @review" }),
      );
      assert.equal(remainingAndroid.ok, true);
      assert.equal(remainingAndroid.result.total, 0);
    } finally {
      androidLocal.restore();
    }
  } finally {
    androidCanonical?.restore();
    rmSync(directory, { recursive: true, force: true });
  }
});
