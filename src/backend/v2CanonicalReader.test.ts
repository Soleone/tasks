import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { TestContext } from "node:test";
import { CommandError } from "./errors.js";
import { readV2CanonicalRoot } from "./v2CanonicalReader.js";
import { parseV2CanonicalJson } from "./v2CanonicalJson.js";
import { compareV2Tasks, isV2OrderKey, validateV2Graph, validateV2Task } from "./v2TaskModel.js";

const fixtureDirectory = fileURLToPath(new URL("../../scripts/fixtures/taskdb-v2/", import.meta.url));
const corpus = JSON.parse(readFileSync(path.join(fixtureDirectory, "cases.json"), "utf8")) as {
  taskTemplate: Record<string, unknown>;
  cases: { id: string; profile: string; given: Record<string, unknown>; expect: { error?: string; fields?: Record<string, unknown> } }[];
};

function scratchRoot(t: TestContext): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "taskdb-v2-reader-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "tasks"));
  writeFileSync(path.join(root, "workspace.json"), '{"schemaVersion":2}\n');
  return root;
}

function recordBytes(record: Record<string, unknown>, given: Record<string, unknown>): Buffer {
  let text = JSON.stringify(record);
  for (const field of (given.remove ?? []) as string[]) {
    delete record[field];
    text = JSON.stringify(record);
  }
  for (const [field, raw] of Object.entries((given.rawField ?? {}) as Record<string, string>)) {
    text = text.replace(`${JSON.stringify(field)}:${JSON.stringify(record[field])}`, `${JSON.stringify(field)}:${raw}`);
  }
  const duplicate = given.duplicateField as { field: string; values: unknown[] } | undefined;
  if (duplicate) text = text.replace(`${JSON.stringify(duplicate.field)}:${JSON.stringify(record[duplicate.field])}`, duplicate.values.map(value => `${JSON.stringify(duplicate.field)}:${JSON.stringify(value)}`).join(","));
  const hex = given.rawFieldHex as Record<string, string> | undefined;
  if (!hex) return Buffer.from(text);
  const [field, bytes] = Object.entries(hex)[0];
  const token = `${JSON.stringify(field)}:${JSON.stringify(record[field])}`;
  const start = text.indexOf(token) + JSON.stringify(field).length + 1;
  const end = start + JSON.stringify(record[field]).length;
  return Buffer.concat([Buffer.from(text.slice(0, start)), Buffer.from(bytes, "hex"), Buffer.from(text.slice(end))]);
}

for (const entry of corpus.cases.filter(entry => entry.profile === "model")) {
  test(`Node read-only v2 reader executes ${entry.id}`, (t) => {
    const root = scratchRoot(t);
    const records = (entry.given.records ?? { a: entry.given.patch ?? {} }) as Record<string, Record<string, unknown>>;
    for (const [id, patch] of Object.entries(records)) {
      const record = { ...corpus.taskTemplate, id, ...patch };
      writeFileSync(path.join(root, "tasks", `${id}.json`), recordBytes(record, entry.given));
    }
    const before = readdirSync(path.join(root, "tasks")).map(name => readFileSync(path.join(root, "tasks", name)));
    if (entry.expect.error) {
      assert.throws(() => readV2CanonicalRoot(root), (error) => error instanceof CommandError && error.code === entry.expect.error);
    } else {
      const snapshot = readV2CanonicalRoot(root);
      const record = snapshot.tasks.find(task => task.id === "a")!;
      for (const [field, expected] of Object.entries(entry.expect.fields ?? {})) assert.deepEqual(record[field as keyof typeof record], expected);
      assert.equal(snapshot.files.length, snapshot.tasks.length + 1);
    }
    assert.deepEqual(readdirSync(path.join(root)).sort(), ["tasks", "workspace.json"]);
    assert.deepEqual(readdirSync(path.join(root, "tasks")).map(name => readFileSync(path.join(root, "tasks", name))), before);
  });
}

test("Node v2 reader preserves golden data/bytes and refuses v1 without writing", (t) => {
  const root = scratchRoot(t);
  cpSync(path.join(fixtureDirectory, "root"), root, { recursive: true });
  const snapshot = readV2CanonicalRoot(root);
  assert.equal(snapshot.tasks.length, 4);
  assert.equal(snapshot.conflictFiles.length, 0);
  for (const task of snapshot.tasks) assert.deepEqual(task, JSON.parse(readFileSync(path.join(root, "tasks", `${task.id}.json`), "utf8")));
  const manifest = readFileSync(path.join(root, "workspace.json"));
  writeFileSync(path.join(root, "workspace.json"), '{"schemaVersion":1,"format":"tasks.workspace"}\n');
  const unsupported = readFileSync(path.join(root, "workspace.json"));
  assert.throws(() => readV2CanonicalRoot(root), (error) => error instanceof CommandError && error.code === "UNSUPPORTED_SCHEMA");
  assert.deepEqual(readFileSync(path.join(root, "workspace.json")), unsupported);
  writeFileSync(path.join(root, "workspace.json"), manifest);
});

test("Node v2 reader validates key vectors and exact ID byte ordering", () => {
  for (const key of ["a0", "Zz", "a0V", "b00", `A${"0".repeat(26)}1`, `a0${"0".repeat(253)}1`]) assert.equal(isV2OrderKey(key), true);
  for (const key of ["", "a", "b0", "a_", "a0é", "a0V0", `A${"0".repeat(26)}`, `a0${"0".repeat(253)}1V`]) assert.equal(isV2OrderKey(key), false);
  const tasks = ["a", "Z", "A", "z"].map(id => validateV2Task({ ...corpus.taskTemplate, id }, id));
  assert.deepEqual(tasks.sort(compareV2Tasks).map(task => task.id), ["A", "Z", "a", "z"]);
});

test("v2 strict JSON catches escaped duplicate names, BOM, nested aliases and non-finite values without task-text diagnostics", () => {
  for (const text of ['{"title":"secret","\\u0074itle":"other"}', '\uFEFF{"schemaVersion":2}', '{"outer":{"key":1,"key":2}}', '{"number":1e999}', '{"text":"\\udc00"}']) {
    assert.throws(() => parseV2CanonicalJson(Buffer.from(text)), (error) => error instanceof CommandError && error.code === "INVALID_CANONICAL" && !error.message.includes("secret"));
  }
  assert.deepEqual(parseV2CanonicalJson(Buffer.from('{"text":"😀","array":[1, true, null, {"key":"value"}]}')), { text: "😀", array: [1, true, null, { key: "value" }] });
});

test("Node v2 reader refuses missing, mixed and unexpected entries; keeps conflict copies distinct", (t) => {
  const root = scratchRoot(t);
  writeFileSync(path.join(root, "tasks/a.json"), JSON.stringify(corpus.taskTemplate));
  const conflict = JSON.stringify({ ...corpus.taskTemplate, title: "Other" });
  writeFileSync(path.join(root, "tasks/a.sync-conflict-probe.json"), conflict);
  const snapshot = readV2CanonicalRoot(root);
  assert.equal(snapshot.tasks.length, 1);
  assert.equal(snapshot.conflictFiles.length, 1);
  assert.equal(readFileSync(path.join(root, "tasks/a.sync-conflict-probe.json"), "utf8"), conflict);
  mkdirSync(path.join(root, "order"));
  writeFileSync(path.join(root, "order/root.json"), "{}");
  assert.throws(() => readV2CanonicalRoot(root), { code: "INVALID_CANONICAL" });
  rmSync(path.join(root, "order"), { recursive: true });
  mkdirSync(path.join(root, "tasks/unexpected"));
  assert.throws(() => readV2CanonicalRoot(root), { code: "INVALID_CANONICAL" });
  rmSync(path.join(root, "tasks/unexpected"), { recursive: true });
  rmSync(path.join(root, "workspace.json"));
  assert.throws(() => readV2CanonicalRoot(root), { code: "INVALID_CANONICAL" });
});

test("Node v2 reader rejects an outside-tree symlink whose contents would otherwise be valid", (t) => {
  const root = scratchRoot(t);
  const outside = scratchRoot(t);
  const target = path.join(outside, "tasks/escape.json");
  const bytes = JSON.stringify({ ...corpus.taskTemplate, id: "escape" });
  writeFileSync(target, bytes);
  try {
    symlinkSync(target, path.join(root, "tasks/escape.json"));
  } catch (error) {
    if (process.platform !== "win32" || (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    t.skip("Windows symlink privilege unavailable; containment still needs native evidence");
    return;
  }
  assert.throws(() => readV2CanonicalRoot(root), { code: "INVALID_CANONICAL" });
  assert.equal(readFileSync(target, "utf8"), bytes);
});

test("v2 model handles year zero, rejects direct unpaired text and validates deep graphs without call-stack recursion", () => {
  const ancient = validateV2Task({ ...corpus.taskTemplate, createdAt: "0000-02-29T00:00:00.000Z" }, "a");
  assert.equal(ancient.createdAt, "0000-02-29T00:00:00.000Z");
  assert.throws(() => validateV2Task({ ...corpus.taskTemplate, title: "\ud800" }, "a"), { code: "INVALID_CANONICAL" });
  const tasks = Array.from({ length: 10_000 }, (_, index) => validateV2Task({ ...corpus.taskTemplate, id: `t${index}`, parentId: index === 0 ? null : `t${index - 1}` }, `t${index}`));
  validateV2Graph(tasks);
  tasks[0].parentId = "t9999";
  assert.throws(() => validateV2Graph(tasks), { code: "INVALID_CANONICAL" });
});
