import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: `export * from './src/platform/workspaceReader';export * from './src/platform/editorClient';export * from './src/backend/editorCommands';export {JsonLineSession} from './src/platform/backendSession';export {parseResponse} from './src/backend/protocol';export {MainWorkspace} from './src/platform/mainWorkspace';export {taskView} from './src/components/taskView';export {liftAll,shorthandText,shorthandTitle} from './src/components/composerShorthand';export {parseShorthand} from './src/backend/shorthand';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  external: ["@tauri-apps/plugin-shell"],
});
const {
  sidecarArgs,
  EDITOR_COMMANDS,
  WorkspaceReader,
  EditorClient,
  EditorError,
  JsonLineSession,
  parseResponse,
  MainWorkspace,
  taskView,
  liftAll,
  shorthandText,
  shorthandTitle,
  parseShorthand,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const selection = {
  rootPath: "C:\\proof\\home\\sync",
  databasePath: "C:\\proof\\home\\local\\app.db",
  profilePath: "C:\\proof\\home",
};
const argv = ["--stdio", "--home", selection.profilePath, "--client", "app"];
const editorSelection = {
  ...selection,
  version: 2,
  readOnly: false,
  selectionToken: "native-memory-selection",
  writeCommands: EDITOR_COMMANDS,
};
const task = {
  ...JSON.parse(
    readFileSync("scripts/fixtures/workspace/root/tasks/c8d4206d-c25a-4317-baa4-a2c5443060e9.json"),
  ),
  version: 1,
  blockedByIds: [],
};
const info = {
  state: "ready",
  schemaVersion: 2,
  commands: [...EDITOR_COMMANDS, "activity.list", "task.get", "task.list", "workspace.info"].sort(),
  issues: [],
  pendingOperationId: null,
  workspaceRevision: 1,
};

function desktop(t) {
  const beforeWindow = Object.getOwnPropertyDescriptor(globalThis, "window"),
    beforeNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    beforeFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { __TAURI_INTERNALS__: {} },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "Windows NT 10.0" },
  });
  globalThis.fetch = () => {
    throw new Error("Native test must never use HTTP");
  };
  t.after(() => {
    if (beforeWindow) Object.defineProperty(globalThis, "window", beforeWindow);
    else delete globalThis.window;
    if (beforeNavigator) Object.defineProperty(globalThis, "navigator", beforeNavigator);
    else delete globalThis.navigator;
    globalThis.fetch = beforeFetch;
  });
}
function sessionFixture(t, respond) {
  const requests = [],
    launches = [];
  let kills = 0;
  const session = new JsonLineSession(async () => {
    launches.push(sidecarArgs(selection.profilePath));
    let stdout, close;
    return {
      stdout: {
        on(_event, callback) {
          stdout = callback;
        },
      },
      on(event, callback) {
        if (event === "close") close = callback;
      },
      async spawn() {
        return {
          async write(line) {
            const request = JSON.parse(line);
            requests.push(request);
            const result = respond(request, () => close({ code: 1, signal: null }));
            if (result)
              stdout(
                JSON.stringify(
                  result.version === 2
                    ? result
                    : {
                        version: 2,
                        requestId: request.requestId,
                        ok: true,
                        writeContext: "native-context",
                        result,
                      },
                ) + "\n",
              );
          },
          async kill() {
            kills++;
          },
        };
      },
    };
  }, parseResponse);
  t.after(() => session.close());
  return { session, requests, launches, kills: () => kills };
}

test("reader and editor share one selected native session without HTTP or duplicate sidecars", async (t) => {
  desktop(t);
  const state = sessionFixture(t, (request) =>
    request.command === "workspace.info"
      ? info
      : request.command === "task.get"
        ? { task }
        : {
            task: { ...task, title: request.args.title },
            changed: true,
            operationId: "native-operation",
          },
  );
  const reader = new WorkspaceReader(selection, undefined, state.session),
    editor = new EditorClient(state.session, editorSelection);
  await reader.workspaceInfo();
  const baseline = await editor.begin(task.id);
  const prepared = editor.prepare(baseline, { ...task, title: "Native content" });
  const original = prepared.originalRequest;
  await prepared.execute();
  await prepared.execute();
  assert.equal(prepared.originalRequest, original);
  assert.equal(state.launches.length, 1);
  assert.deepEqual(state.launches[0], argv);
  assert.deepEqual(state.requests.at(-1), state.requests.at(-2));
  await reader.close();
  assert.equal(state.kills(), 1);
});
test("native lost reply preserves original request through same-selection process restart", async (t) => {
  desktop(t);
  let loseReply = true;
  const state = sessionFixture(t, (request, close) => {
    if (request.command === "workspace.info") return info;
    if (request.command === "task.get") return { task };
    if (loseReply) {
      loseReply = false;
      close();
      return null;
    }
    return {
      task: { ...task, title: request.args.title },
      changed: true,
      operationId: "retained-operation",
    };
  });
  const editor = new EditorClient(state.session, editorSelection),
    baseline = await editor.begin(task.id),
    prepared = editor.prepare(baseline, { ...task, title: "Uncertain native edit" });
  const original = prepared.originalRequest;
  await assert.rejects(() => prepared.execute(), /backend process closed/);
  assert.equal(prepared.hasExecuted, true);
  await assert.rejects(() => prepared.preview(), /cannot renew uncertain authority/);
  await prepared.execute();
  assert.equal(prepared.originalRequest, original);
  assert.deepEqual(state.requests.at(-1), state.requests.at(-2));
  assert.equal(state.launches.length, 2);
  for (const launched of state.launches) assert.deepEqual(launched, argv);
});
test("native editing without its desktop session is refused", (t) => {
  desktop(t);
  assert.throws(() => new EditorClient("http://127.0.0.1", editorSelection), /browser-only/);
});

test("main-client presentation preserves literal text and round-trips inline classification", () => {
  for (const title of [
    "Call @alice #literal",
    "Backslash \\ and \\@literal",
    "Code `@alice #literal \\`",
    "Unclosed ```@alice",
    "Email a@b.example",
    "Unicode Ω 😀",
    "Two  spaces",
    "Unclosed ` @alice",
    "Mixed `code` @literal",
  ]) {
    const canonical = { ...task, title, category: "work", tags: ["alpha", "todo"] };
    const view = taskView(canonical);
    assert.equal(view.title, title);
    assert.equal(view.text, canonical.text);
    const field = shorthandTitle(view.title);
    const pills = { category: "work", tags: ["alpha", "todo"] };
    // Nothing in the escaped title lifts, so saving it unchanged keeps the title literal.
    assert.deepEqual(liftAll(field, pills), { text: field, classification: pills });
    assert.deepEqual(parseShorthand(shorthandText(field, pills)), {
      title,
      category: "work",
      tags: ["alpha", "todo"],
    });
    assert.equal(view.description, canonical.description);
    assert.equal(view.closedAt, canonical.closedAt);
  }
});

test("established inline save uses the new protocol directly, without a preview dialog or legacy request", async (t) => {
  desktop(t);
  const state = sessionFixture(t, (request) =>
    request.command === "workspace.info"
      ? info
      : request.command === "task.get"
        ? { task }
        : { task, changed: true, operationId: "inline-save" },
  );
  const workspace = new MainWorkspace(
    new WorkspaceReader(selection, undefined, state.session),
    new EditorClient(state.session, editorSelection),
  );
  await workspace.save(
    "Keep the main UI @work #todo",
    "Markdown",
    2,
    "inline-key",
    task.id,
    task.version,
  );
  const write = state.requests.at(-1);
  assert.equal(write.version, 2);
  assert.equal(write.command, "task.update");
  assert.deepEqual(write.args, {
    text: "Keep the main UI @work #todo",
    description: "Markdown",
    priority: 2,
    id: task.id,
    expectedVersion: task.version,
  });
  assert.equal(write.idempotencyKey, "inline-key");
  assert.equal(write.dryRun, false);
  assert.equal(state.requests.filter((request) => !request.readOnly).length, 1);
  assert.equal(workspace.getUnresolved(), null);
});

test("main-client revision reads readiness once without listing tasks", async (t) => {
  desktop(t);
  const state = sessionFixture(t, (request) => {
    assert.equal(request.command, "workspace.info");
    return info;
  });
  const workspace = new MainWorkspace(
    new WorkspaceReader(selection, undefined, state.session),
    new EditorClient(state.session, editorSelection),
  );
  assert.equal(await workspace.revision(), info.workspaceRevision);
  assert.deepEqual(
    state.requests.map((request) => request.command),
    ["workspace.info"],
  );
});

test("main-client stale selection never replaces the expected version or sends a mutation", async (t) => {
  desktop(t);
  const state = sessionFixture(t, (request) =>
    request.command === "workspace.info" ? info : { task: { ...task, version: 2 } },
  );
  const workspace = new MainWorkspace(
    new WorkspaceReader(selection, undefined, state.session),
    new EditorClient(state.session, editorSelection),
  );
  await assert.rejects(
    () => workspace.save("Draft", "", 2, "stale-key", task.id, 1),
    /draft was not sent/,
  );
  assert.ok(state.requests.every((request) => request.readOnly));
  assert.equal(workspace.getUnresolved(), null);
});

test("main-client lost reply blocks new writes and retries only the frozen request", async (t) => {
  desktop(t);
  let lose = true;
  const state = sessionFixture(t, (request, close) => {
    if (request.command === "workspace.info") return info;
    if (request.command === "task.get") return { task };
    if (lose) {
      lose = false;
      close();
      return null;
    }
    return { task, changed: true, operationId: "one-effect" };
  });
  const workspace = new MainWorkspace(
    new WorkspaceReader(selection, undefined, state.session),
    new EditorClient(state.session, editorSelection),
  );
  const unresolved = new Promise((resolve) => {
    const unsubscribe = workspace.subscribe(() => {
      if (workspace.getUnresolved()) {
        unsubscribe();
        resolve(workspace.getUnresolved());
      }
    });
  });
  const saving = workspace.save("Retained draft", "", 2, "original-key", task.id, task.version);
  const retained = await unresolved;
  await assert.rejects(
    () => workspace.priority(task.id, 1, 0, "replacement"),
    /Finish the current/,
  );
  const original = JSON.parse(retained.prepared.originalRequest),
    before = state.requests.length;
  await retained.retry();
  await saving;
  assert.equal(state.requests.length, before + 1);
  assert.deepEqual(state.requests.at(-1), original);
  assert.equal(state.launches.length, 2);
  assert.equal(workspace.getUnresolved(), null);
});

function answeredRefusal(request, code) {
  return {
    version: 2,
    requestId: request.requestId,
    ok: false,
    error: { code, message: "fixture refusal" },
  };
}

function nextUnresolved(workspace) {
  return new Promise((resolve) => {
    const unsubscribe = workspace.subscribe(() => {
      if (workspace.getUnresolved()) {
        unsubscribe();
        resolve(workspace.getUnresolved());
      }
    });
  });
}

for (const code of ["INVALID_REQUEST", "UNSUPPORTED_VERSION", "UNKNOWN_COMMAND"]) {
  test(
    `main-client correlated pre-effect ${code} rejects inline and leaves writes enabled`,
    { timeout: 5000 },
    async (t) => {
      desktop(t);
      let refuse = true;
      const state = sessionFixture(t, (request) => {
        if (request.command === "workspace.info") return info;
        if (request.command === "task.get") return { task };
        if (refuse) {
          refuse = false;
          return answeredRefusal(request, code);
        }
        return { task, changed: true, operationId: "next-write" };
      });
      const workspace = new MainWorkspace(
        new WorkspaceReader(selection, undefined, state.session),
        new EditorClient(state.session, editorSelection),
      );
      await assert.rejects(workspace.save("Refused", "", 2, "refused-key", task.id, 1), { code });
      assert.equal(workspace.getUnresolved(), null);
      assert.equal(workspace.hasWriteInProgress(), false);
      assert.equal(state.requests.filter((request) => !request.readOnly).length, 1);
      await workspace.save("Corrected", "", 2, "next-key", task.id, 1);
      assert.equal(state.requests.at(-1).idempotencyKey, "next-key");
    },
  );
}

for (const code of [
  "INVALID_STORAGE",
  "INVALID_ARGUMENT",
  "MULTIPLE_CATEGORIES",
  "UNSUPPORTED_COMMAND",
  "RECOVERY_CONFLICT",
  "INTERNAL_ERROR",
  "FUTURE_ERROR",
]) {
  test(
    `main-client answered ${code} remains uncertain even after a pre-effect retry refusal`,
    { timeout: 5000 },
    async (t) => {
      desktop(t);
      let attempts = 0;
      const state = sessionFixture(t, (request) => {
        if (request.command === "workspace.info") return info;
        return answeredRefusal(request, ++attempts === 1 ? code : "INVALID_REQUEST");
      });
      const workspace = new MainWorkspace(
        new WorkspaceReader(selection, undefined, state.session),
        new EditorClient(state.session, editorSelection),
      );
      const unresolved = nextUnresolved(workspace);
      const saving = workspace.save("Uncertain create", "", 2, "original-key");
      let settled = false;
      void saving.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      const rejected = assert.rejects(saving, /external reconciliation/);
      const retained = await unresolved;
      const original = JSON.parse(retained.prepared.originalRequest),
        metadata = retained.prepared.retryMetadata;
      assert.equal(original.command, "task.create");
      assert.equal(workspace.hasWriteInProgress(), true);
      await assert.rejects(workspace.save("Replacement", "", 2, "replacement-key"), {
        code: "WRITE_IN_PROGRESS",
      });
      const before = state.requests.length;
      await retained.retry();
      assert.equal(settled, false);
      assert.equal(state.requests.length, before + 1);
      assert.deepEqual(state.requests.at(-1), original);
      assert.equal(
        workspace.getUnresolved().prepared.originalRequest,
        retained.prepared.originalRequest,
      );
      assert.equal(workspace.getUnresolved().prepared.retryMetadata, metadata);
      assert.match(metadata, /original-key/);
      workspace.getUnresolved().preserveForReconciliation();
      await rejected;
      await assert.rejects(workspace.save("Replacement", "", 2, "new-key"), {
        code: "MANUAL_RECONCILIATION",
      });
    },
  );
}

test(
  "main-client answered storage refusal retries the frozen create and accepts retained success",
  { timeout: 5000 },
  async (t) => {
    desktop(t);
    let applied = false;
    const state = sessionFixture(t, (request) => {
      if (request.command === "workspace.info") return info;
      if (!applied) {
        applied = true;
        return answeredRefusal(request, "INVALID_STORAGE");
      }
      // Model a committed receipt replay, not a guarantee every create failure has a receipt.
      return { task, changed: true, operationId: "retained-create" };
    });
    const workspace = new MainWorkspace(
      new WorkspaceReader(selection, undefined, state.session),
      new EditorClient(state.session, editorSelection),
    );
    const unresolved = nextUnresolved(workspace);
    const saving = workspace.save("Possibly published", "", 2, "original-key");
    const retained = await unresolved,
      before = state.requests.length;
    await retained.retry();
    assert.equal((await saving).operationId, "retained-create");
    assert.equal(state.requests.length, before + 1);
    assert.deepEqual(state.requests.at(-1), JSON.parse(retained.prepared.originalRequest));
    assert.equal(workspace.getUnresolved(), null);
    assert.equal(workspace.hasWriteInProgress(), false);
  },
);

for (const fault of ["local-error", "wrong-correlation", "malformed-response"]) {
  test(
    `main-client does not trust ${fault} as a pre-effect answer`,
    { timeout: 5000 },
    async (t) => {
      desktop(t);
      const state = sessionFixture(t, (request) => {
        if (request.command === "workspace.info") return info;
        if (request.command === "task.get") return { task };
        const response = answeredRefusal(request, "INVALID_REQUEST");
        if (fault === "wrong-correlation") response.requestId = "another-request";
        if (fault === "malformed-response") response.error.message = 42;
        return response;
      });
      const editor = new EditorClient(state.session, editorSelection);
      if (fault === "local-error") {
        const prepare = editor.prepareInline.bind(editor);
        editor.prepareInline = (...args) => {
          const prepared = prepare(...args);
          prepared.execute = async () => {
            throw new EditorError("INVALID_REQUEST", "local failure, not an answer");
          };
          return prepared;
        };
      }
      const workspace = new MainWorkspace(
        new WorkspaceReader(selection, undefined, state.session),
        editor,
      );
      const unresolved = nextUnresolved(workspace);
      const saving = workspace.save("Uncertain", "", 2, "original-key", task.id, 1);
      const rejected = assert.rejects(saving, /external reconciliation/);
      const retained = await unresolved;
      await assert.rejects(workspace.save("Replacement", "", 2, "replacement-key"), {
        code: "WRITE_IN_PROGRESS",
      });
      retained.preserveForReconciliation();
      await rejected;
    },
  );
}

test("acknowledged external reconciliation keeps main-client writes paused", async (t) => {
  desktop(t);
  const state = sessionFixture(t, (request, close) =>
    request.command === "workspace.info"
      ? info
      : request.command === "task.get"
        ? { task }
        : (close(), null),
  );
  const workspace = new MainWorkspace(
    new WorkspaceReader(selection, undefined, state.session),
    new EditorClient(state.session, editorSelection),
  );
  const unresolved = new Promise((resolve) => {
    const unsubscribe = workspace.subscribe(() => {
      if (workspace.getUnresolved()) {
        unsubscribe();
        resolve(workspace.getUnresolved());
      }
    });
  });
  const saving = workspace.save("Uncertain", "", 2, "retained-key", task.id, task.version);
  const rejected = assert.rejects(saving, /external reconciliation/);
  const retained = await unresolved;
  retained.preserveForReconciliation();
  await rejected;
  const before = state.requests.length;
  await assert.rejects(() => workspace.save("Replacement", "", 2, "new-key"), /Writes are paused/);
  assert.equal(state.requests.length, before);
});
