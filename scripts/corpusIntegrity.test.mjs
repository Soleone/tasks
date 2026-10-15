import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const fixtureDirectory = fileURLToPath(new URL("./fixtures/workspace/", import.meta.url));
const specDirectory = fileURLToPath(new URL("../spec/", import.meta.url));
const schema1Directory = fileURLToPath(new URL("./fixtures/schema1/sync/", import.meta.url));
const corpus = JSON.parse(readFileSync(path.join(fixtureDirectory, "cases.json"), "utf8"));
const specFiles = ["backend/data.md", "backend/commands.md", "backend/rules.md", "backend/safety.md", "ecosystem/cli.md", "ecosystem/sharing.md", "ecosystem/backup.md", "ecosystem/migration.md"];
const specs = new Map(specFiles.map((name) => [name, readFileSync(path.join(specDirectory, name), "utf8")]));
const taskFields = ["id", "title", "text", "description", "status", "priority", "category", "tags", "parentId", "dependencyIds", "orderKey", "createdAt", "updatedAt", "closedAt"].sort();
const statuses = ["open", "in_progress", "paused", "done", "canceled"];
const goldenTasks = readdirSync(path.join(fixtureDirectory, "root/tasks"))
  .map((name) => ({ name, record: JSON.parse(readFileSync(path.join(fixtureDirectory, "root/tasks", name), "utf8")) }));

function headingAnchor(heading) {
  return heading.toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-");
}

function referencedCases(value) {
  if (Array.isArray(value)) return value.flatMap(referencedCases);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => {
    if (["fixtureCase", "sameFinalAs", "migrate"].includes(key)) return [child];
    if (key === "operation" && typeof child === "string" && !["first", "pending", "reorder", "update"].includes(child)) return [child];
    return referencedCases(child);
  });
}

function assertAcyclicCaseReferences(id, dependencies, active = new Set()) {
  assert.equal(active.has(id), false, `cyclic fixture reference: ${id}`);
  active.add(id);
  for (const dependency of dependencies.get(id)) assertAcyclicCaseReferences(dependency, dependencies, active);
  active.delete(id);
}

test("target corpus integrity: case shapes, profiles, rule anchors and error names (not execution)", () => {
  assert.equal(corpus.format, "taskdb.conformance-cases");
  assert.equal(corpus.fixtureVersion, 1);
  assert.equal(corpus.status, "accepted-target");
  assert.deepEqual(Object.keys(corpus.taskTemplate).sort(), taskFields);
  const ids = corpus.cases.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...new Set(corpus.cases.map((entry) => entry.profile))].sort(), ["cli", "inputs", "migration", "model", "mutations", "ordering", "protocol", "storage"]);
  const protocolErrors = specs.get("backend/commands.md").split("## Errors")[1];
  for (const entry of corpus.cases) {
    assert.match(entry.id, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, entry.id);
    assert.deepEqual(Object.keys(entry).sort(), ["action", "expect", "given", "id", "profile", "rule"]);
    for (const field of ["given", "action", "expect"]) {
      assert.equal(typeof entry[field], "object", `${entry.id}.${field}`);
      assert.notEqual(entry[field], null);
      assert.equal(Array.isArray(entry[field]), false);
    }
    assert.ok(Object.keys(entry.action).length > 0, entry.id);
    assert.ok(Object.keys(entry.expect).length > 0, entry.id);
    const [file, anchor] = entry.rule.split("#");
    assert.ok(specs.has(file), `${entry.id}: ${file}`);
    const headings = [...specs.get(file).matchAll(/^#{1,2} (.+)$/gm)].map((match) => headingAnchor(match[1]));
    assert.ok(headings.includes(anchor), `${entry.id}: ${entry.rule}`);
    if (entry.expect.error) assert.ok(protocolErrors.includes(entry.expect.error), `${entry.id}: unknown error`);
    for (const reference of referencedCases(entry)) {
      assert.ok(ids.includes(reference), `${entry.id}: missing ${reference}`);
      assert.notEqual(reference, entry.id, `${entry.id}: self-reference`);
    }
  }
  const dependencies = new Map(corpus.cases.map((entry) => [entry.id, referencedCases(entry)]));
  for (const id of ids) assertAcyclicCaseReferences(id, dependencies);
});

test("golden fixture integrity: exact fields, literal data, local-state exclusion and graph", () => {
  const root = path.join(fixtureDirectory, "root");
  assert.deepEqual(readdirSync(root).sort(), ["tasks", "workspace.json"]);
  assert.equal(readFileSync(path.join(root, "workspace.json"), "utf8"), '{"schemaVersion":2}\n');
  assert.equal(goldenTasks.length, 4);
  const ids = new Set(goldenTasks.map(({ record }) => record.id));
  assert.equal(ids.size, 4);
  for (const { name, record } of goldenTasks) {
    assert.deepEqual(Object.keys(record).sort(), taskFields, name);
    assert.equal(name, `${record.id}.json`);
    assert.equal(record.title.trim(), record.title);
    assert.ok(record.title.length > 0 && record.title.length <= 1000);
    assert.equal(typeof record.description, "string");
    assert.ok(statuses.includes(record.status));
    assert.ok(Number.isInteger(record.priority) && record.priority >= 0 && record.priority <= 4);
    assert.deepEqual(record.tags, [...new Set(record.tags)].sort());
    assert.deepEqual(record.dependencyIds, [...new Set(record.dependencyIds)].sort());
    assert.equal(["done", "canceled"].includes(record.status), record.closedAt !== null);
    for (const target of [record.parentId, ...record.dependencyIds].filter((id) => id !== null)) {
      assert.ok(ids.has(target), `${name}: missing ${target}`);
      assert.notEqual(target, record.id);
    }
  }
  assert.equal(existsSync(path.join(root, "order")), false);
});

test("golden fixture integrity: complete legacy field and sibling-sequence mapping, not converter proof", () => {
  const byId = new Map(goldenTasks.map(({ record }) => [record.id, record]));
  const classifications = {
    "62f159c1-22a7-45cb-89a0-c0c35aaeb1ed": { title: "Park release notes", category: "operations", tags: [] },
    "f3e5499b-402e-4d7d-8b61-eefc4409ca32": { title: "Inbox note", category: null, tags: [] },
    "c8d4206d-c25a-4317-baa4-a2c5443060e9": { title: "Plan launch", category: "planning", tags: ["product"] },
    "6e1bf023-da3c-4785-b8a9-a696ac1fa5c1": { title: "Review checklist", category: "planning", tags: [] },
  };
  const sourceNames = readdirSync(path.join(schema1Directory, "tasks"));
  assert.deepEqual(sourceNames.sort(), goldenTasks.map(({ name }) => name).sort());
  for (const name of sourceNames) {
    const source = JSON.parse(readFileSync(path.join(schema1Directory, "tasks", name), "utf8"));
    const target = byId.get(source.id);
    for (const field of ["id", "status", "priority", "parentId", "dependencyIds", "createdAt", "updatedAt"]) {
      assert.deepEqual(target[field], source[field], `${name}: ${field}`);
    }
    assert.equal(target.description, source.descriptionMarkdown);
    assert.equal(target.closedAt, source.completedAt ?? source.canceledAt);
    for (const [field, expected] of Object.entries(classifications[source.id])) assert.deepEqual(target[field], expected);
  }
  for (const name of readdirSync(path.join(schema1Directory, "order"))) {
    const source = JSON.parse(readFileSync(path.join(schema1Directory, "order", name), "utf8"));
    const scope = goldenTasks.map(({ record }) => record).filter((record) => record.parentId === source.parentId);
    scope.sort((a, b) => a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    assert.deepEqual(scope.map((record) => record.id), source.taskIds, name);
    assert.deepEqual(scope.map((record) => record.orderKey), source.taskIds.map((_, index) => `a${index}`));
  }
});
