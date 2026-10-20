import assert from "node:assert/strict";
import {
  cpSync,
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

const fixtures = fileURLToPath(new URL("../../scripts/fixtures/workspace/", import.meta.url));
const corpus = JSON.parse(readFileSync(path.join(fixtures, "cases.json"), "utf8")) as {
  taskTemplate: Record<string, unknown>;
  cases: {
    id: string;
    given: { records?: Record<string, unknown>; patch?: object; manifest?: object };
    action: { rawEnvelope?: string; envelope?: object; command?: string; args?: object };
    expect: { error?: string; categories?: unknown[]; fields?: Record<string, unknown> };
  }[];
};
type Workspace = { root: string; cache: string };

function workspace(t: TestContext, records: Record<string, unknown> = { a: {} }): Workspace {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-gateway-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, "root");
  mkdirSync(path.join(root, "tasks"), { recursive: true });
  writeFileSync(path.join(root, "workspace.json"), '{"schemaVersion":2}\n');
  for (const [id, patch] of Object.entries(records))
    writeFileSync(
      path.join(root, "tasks", `${id}.json`),
      JSON.stringify({ ...corpus.taskTemplate, id, ...(patch as object) }),
    );
  return { root, cache: path.join(directory, "cache.db") };
}

function query(workspace: Workspace, command: string, args: object = {}): Response {
  return executeLine(
    Buffer.from(JSON.stringify({ version: 2, command, args })),
    workspace.root,
    workspace.cache,
  );
}

function result(response: Response): Record<string, unknown> {
  assert.equal(response.ok, true, JSON.stringify(response));
  if (!response.ok) throw new Error("query failed");
  return response.result;
}

const caseIds = [
  "protocol-version",
  "protocol-schema",
  "protocol-duplicate",
  "protocol-nonfinite",
  "capability-refusal",
  "query-literal",
  "query-readiness",
];
for (const entry of corpus.cases.filter((entry) => caseIds.includes(entry.id))) {
  test(
    `Node query gateway executes ${entry.id}`,
    {
      skip:
        entry.id === "capability-refusal" && process.platform === "linux"
          ? "Fixture requires withheld doctor.apply; Linux now advertises it. Do not substitute a different command."
          : false,
    },
    (t) => {
      const current = workspace(t, entry.given.records ?? { a: entry.given.patch ?? {} });
      if (entry.given.manifest)
        writeFileSync(
          path.join(current.root, "workspace.json"),
          JSON.stringify(entry.given.manifest),
        );
      const manifest = readFileSync(path.join(current.root, "workspace.json"));
      const before = readdirSync(path.join(current.root, "tasks")).map((name) =>
        readFileSync(path.join(current.root, "tasks", name)),
      );
      const envelope =
        entry.action.rawEnvelope ??
        JSON.stringify(
          entry.action.envelope ?? {
            version: 2,
            command: entry.action.command,
            args: entry.action.args,
          },
        );
      const response = executeLine(Buffer.from(envelope), current.root, current.cache);
      if (entry.expect.error) {
        assert.equal(response.ok, false);
        if (!response.ok) assert.equal(response.error.code, entry.expect.error);
      } else {
        const output = result(response);
        if (entry.expect.categories) assert.deepEqual(output.categories, entry.expect.categories);
        const task = output.task as Record<string, unknown>;
        for (const [field, expected] of Object.entries(entry.expect.fields ?? {}))
          assert.deepEqual(task[field], expected);
      }
      assert.deepEqual(readFileSync(path.join(current.root, "workspace.json")), manifest);
      assert.deepEqual(
        readdirSync(path.join(current.root, "tasks")).map((name) =>
          readFileSync(path.join(current.root, "tasks", name)),
        ),
        before,
      );
    },
  );
}

test("envelope correlation, strict types, unsupported names and previews cannot enable writes", (t) => {
  const current = workspace(t);
  for (const [patch, code] of [
    [{ extra: true }, "INVALID_REQUEST"],
    [{ args: null }, "INVALID_REQUEST"],
    [{ actor: { kind: "human", label: " " } }, "INVALID_REQUEST"],
    [{ actor: { kind: "agent", label: "ok", extra: 1 } }, "INVALID_REQUEST"],
    [{ requestId: 42 }, "INVALID_REQUEST"],
    [{ readOnly: "true" }, "INVALID_REQUEST"],
    [{ writeContext: null }, "INVALID_REQUEST"],
    [{ command: "made.up" }, "UNKNOWN_COMMAND"],
    [
      {
        command: "workspace.receive.prepare",
        readOnly: true,
        dryRun: true,
        args: { title: "private text" },
      },
      "UNSUPPORTED_COMMAND",
    ],
  ] as const) {
    const response = executeLine(
      Buffer.from(
        JSON.stringify({ version: 2, requestId: "correlated", command: "task.list", ...patch }),
      ),
      current.root,
      current.cache,
    );
    assert.equal(response.ok, false);
    if (!response.ok) {
      assert.equal(response.error.code, code);
      assert.equal(response.requestId, "requestId" in patch ? null : "correlated");
      assert.equal(response.error.message.includes("private text"), false);
    }
  }
  const malformed = executeLine(
    Buffer.from('{"requestId":"unsafe","version":2,"command":"task.list","command":"task.get"}'),
    current.root,
    current.cache,
  );
  assert.equal(malformed.requestId, null);
  const valid = query(current, "task.get", { id: "a" });
  const task = result(valid).task as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(task).sort(),
    [...Object.keys(corpus.taskTemplate), "version", "blockedByIds"].sort(),
  );
  assert.ok(Number.isSafeInteger(task.version) && (task.version as number) > 0);
});

test("info inspects empty, partial and unsupported roots without creating canonical files", (t) => {
  const current = workspace(t);
  const ready = result(query(current, "workspace.info"));
  assert.equal(ready.state, "ready");
  assert.deepEqual(
    ready.commands,
    process.platform === "linux"
      ? [
          "activity.list",
          "category.list",
          "operation.redo",
          "operation.undo",
          "tag.list",
          "task.cancel",
          "task.complete",
          "task.create",
          "task.delete",
          "task.dependency.add",
          "task.dependency.remove",
          "task.get",
          "task.list",
          "task.move",
          "task.order.normalize",
          "task.pause",
          "task.purgeCanceled",
          "task.reopen",
          "task.reorder",
          "task.start",
          "task.status.undo",
          "task.status.undoMany",
          "task.transitionMany",
          "task.update",
          "workspace.archive",
          "workspace.doctor.apply",
          "workspace.doctor.inspect",
          "workspace.doctor.plan",
          "workspace.info",
          "workspace.init",
          "workspace.migrate",
          "workspace.rebuild",
          "workspace.recovery.resume",
          "workspace.restore",
        ]
      : ["category.list", "tag.list", "task.get", "task.list", "workspace.info"],
  );
  writeFileSync(path.join(current.root, "tasks/a.json"), '{"title":"partial secret');
  const incomplete = result(query(current, "workspace.info"));
  assert.equal(incomplete.state, "incomplete");
  assert.equal(JSON.stringify(incomplete.issues).includes("partial secret"), false);
  assert.equal(query(current, "task.list").ok, false);
  writeFileSync(path.join(current.root, "workspace.json"), '{"schemaVersion":1}');
  const unsupported = result(query(current, "workspace.info"));
  assert.equal(unsupported.state, "unsupported");
  assert.equal(unsupported.schemaVersion, 1);
  rmSync(current.root, { recursive: true });
  mkdirSync(current.root);
  const empty = result(query(current, "workspace.info"));
  assert.equal(empty.state, "empty");
  assert.deepEqual(readdirSync(current.root), []);
});

test("list.descendants: a filtered page includes its whole tree without changing matching pagination", (t) => {
  const current = workspace(t, {
    root: { title: "Parent" },
    child: { parentId: "root", status: "paused" },
    grandchild: { parentId: "child" },
    sibling: { parentId: "root" },
    unrelated: {},
    unrelatedChild: { parentId: "unrelated", status: "paused" },
  });
  const page = result(
    query(current, "task.list", {
      search: "Parent",
      includeDescendants: true,
      limit: 1,
    }),
  );
  assert.equal(page.total, 1);
  assert.equal(page.limit, 1);
  assert.deepEqual(
    (page.tasks as { id: string }[]).map((task) => task.id),
    ["root"],
  );
  assert.deepEqual(
    (page.contextTasks as { id: string }[]).map((task) => task.id),
    ["child", "grandchild", "sibling"],
  );
  const childPage = result(
    query(current, "task.list", {
      status: "paused",
      includeDescendants: true,
      limit: 1,
      sort: "manual",
    }),
  );
  assert.equal(childPage.total, 2);
  assert.deepEqual(
    (childPage.tasks as { id: string }[]).map((task) => task.id),
    ["child"],
  );
  assert.deepEqual(
    (childPage.contextTasks as { id: string }[]).map((task) => task.id),
    ["root", "grandchild", "sibling"],
  );
  const paged = result(
    query(current, "task.list", {
      status: "open",
      includeDescendants: true,
      limit: 1,
      sort: "manual",
    }),
  );
  assert.equal(paged.total, 4);
  assert.equal((paged.tasks as unknown[]).length, 1);
  assert.equal((paged.contextTasks as unknown[]).length, 3);
  const empty = result(
    query(current, "task.list", {
      search: "missing",
      includeDescendants: true,
    }),
  );
  assert.deepEqual(empty.contextTasks, []);
  assert.equal(query(current, "task.list", { includeDescendants: "yes" }).ok, false);
});

test("query filters preserve graph context, AND tags, ASCII search and full manual preorder", (t) => {
  const current = workspace(t, {
    root: {
      title: "Parent",
      status: "paused",
      orderKey: "a1",
      category: "work",
      tags: ["alpha", "beta"],
    },
    child: {
      title: "Child",
      parentId: "root",
      orderKey: "a0",
      category: "work",
      tags: ["alpha", "beta"],
      description: "Literal %_ ASCII",
    },
    before: { orderKey: "a0", tags: ["alpha"], title: "Ä Unicode" },
    canceled: {
      status: "canceled",
      closedAt: corpus.taskTemplate.createdAt,
      category: "old",
      tags: ["unused"],
    },
  });
  const page = result(
    query(current, "task.list", {
      status: "open",
      tags: ["#ALPHA", "beta"],
      category: "@WORK",
      includeAncestors: true,
      sort: "manual",
      direction: "desc",
    }),
  );
  assert.equal(page.total, 1);
  assert.deepEqual(
    (page.tasks as { id: string }[]).map((task) => task.id),
    ["child"],
  );
  assert.deepEqual(
    (page.contextTasks as { id: string }[]).map((task) => task.id),
    ["root"],
  );
  const manual = result(query(current, "task.list", { sort: "manual" }));
  assert.deepEqual(
    (manual.tasks as { id: string }[]).map((task) => task.id),
    ["before", "canceled", "root", "child"],
  );
  assert.equal(result(query(current, "task.list", { search: "%_ ascii" })).total, 1);
  assert.equal(result(query(current, "task.list", { search: "ä" })).total, 0);
  assert.equal(result(query(current, "task.list", { categoryIsNull: true })).total, 1);
  assert.deepEqual(result(query(current, "category.list")).categories, [
    { slug: "work", taskCount: 2 },
  ]);
  assert.deepEqual(result(query(current, "tag.list")).tags, [
    { slug: "alpha", taskCount: 3 },
    { slug: "beta", taskCount: 2 },
  ]);
  for (const args of [
    { sourceKey: "old" },
    { category: { kind: "all" } },
    { category: "work", categoryIsNull: true },
    { tags: [] },
    { search: " " },
    { limit: 1.5 },
    { direction: "sideways" },
    { sort: null },
    { direction: null },
  ]) {
    const response = query(current, "task.list", args);
    assert.equal(response.ok, false);
    if (!response.ok) assert.equal(response.error.code, "INVALID_ARGUMENT");
  }
  const bounded = result(query(current, "task.list", { limit: 500, offset: -5, priority: 2 }));
  assert.equal(bounded.limit, 100);
  assert.equal(bounded.offset, 0);
});

test("date/priority ties use exact IDs and search truncation never leaves a half scalar", (t) => {
  const current = workspace(t, {
    Z: { priority: 4 },
    a: { priority: 0 },
    A: { priority: 0 },
    text: { title: `${"x".repeat(199)}end` },
  });
  assert.deepEqual(
    (result(query(current, "task.list", { sort: "priority" })).tasks as { id: string }[]).map(
      (task) => task.id,
    ),
    ["A", "a", "text", "Z"],
  );
  assert.deepEqual(
    (
      result(query(current, "task.list", { sort: "created", direction: "desc" })).tasks as {
        id: string;
      }[]
    ).map((task) => task.id),
    ["A", "Z", "a", "text"],
  );
  assert.equal(
    result(query(current, "task.list", { search: `${"x".repeat(199)}😀suffix` })).total,
    1,
  );
});

test("gateway reads the golden fixture with unchanged canonical bytes", (t) => {
  const current = workspace(t);
  rmSync(current.root, { recursive: true });
  cpSync(path.join(fixtures, "root"), current.root, { recursive: true });
  const page = result(query(current, "task.list", { sort: "manual" }));
  assert.equal(page.total, 4);
  assert.deepEqual(
    (page.tasks as { id: string }[]).map((task) => task.id),
    [
      "62f159c1-22a7-45cb-89a0-c0c35aaeb1ed",
      "f3e5499b-402e-4d7d-8b61-eefc4409ca32",
      "c8d4206d-c25a-4317-baa4-a2c5443060e9",
      "6e1bf023-da3c-4785-b8a9-a696ac1fa5c1",
    ],
  );
  assert.equal(
    readFileSync(path.join(current.root, "workspace.json"), "utf8"),
    '{"schemaVersion":2}\n',
  );
});
