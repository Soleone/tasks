// Disposable diagnostics, not timing-based acceptance. Run after pnpm build:backend.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import { executeV2Line } from "../dist/backend/gateway.js";
import { readV2CanonicalRoot } from "../dist/backend/canonicalReader.js";

assert.equal(process.platform, "linux", "No-op update measurements require the Linux writer");
const scratch = mkdtempSync(path.join(os.tmpdir(), "tasks-authority-measure-"));
const previousProfile = process.env.XDG_DATA_HOME;
process.env.XDG_DATA_HOME = path.join(scratch, "local-data");
const template = JSON.parse(readFileSync(new URL("./fixtures/taskdb-v2/root/tasks/c8d4206d-c25a-4317-baa4-a2c5443060e9.json", import.meta.url), "utf8"));
const measurements = [];
function elapsed(action) {
  const start = performance.now();
  const result = action();
  return { result, ms: Number((performance.now() - start).toFixed(2)) };
}
function repeated(action) {
  const samples = Array.from({ length: 5 }, () => elapsed(action).ms).sort((a, b) => a - b);
  return { min: samples[0], median: samples[2], max: samples[4] };
}
function cacheSize(cache) {
  const database = new DatabaseSync(cache);
  try {
    const { total, max } = database.prepare("SELECT sum(length(fingerprint)) AS total, max(length(fingerprint)) AS max FROM v2_query_tasks").get();
    const freePages = database.prepare("PRAGMA freelist_count").get().freelist_count;
    const pageBytes = database.prepare("PRAGMA page_size").get().page_size;
    return { fileBytes: statSync(cache).size, freeBytes: freePages * pageBytes, fingerprintChars: total, maxFingerprintChars: max };
  } finally { database.close(); }
}
try {
  for (const layout of ["flat", "nested"]) for (const count of [1_000, 5_000]) {
    const directory = path.join(scratch, `${layout}-${count}`);
    const root = path.join(directory, "root");
    const cache = path.join(directory, "cache.db");
    mkdirSync(path.join(root, "tasks"), { recursive: true });
    writeFileSync(path.join(root, "workspace.json"), '{"schemaVersion":2}\n');
    const tasks = Array.from({ length: count }, (_, index) => ({
      ...template, id: `task-${String(index).padStart(5, "0")}`, orderKey: "a0",
      parentId: layout === "nested" && index >= 10 ? `task-${String(index % 10).padStart(5, "0")}` : null,
    }));
    for (const task of tasks) writeFileSync(path.join(root, "tasks", `${task.id}.json`), JSON.stringify(task) + "\n");
    const send = request => {
      const response = executeV2Line(Buffer.from(JSON.stringify({ version: 2, ...request })), root, cache);
      assert.equal(response.ok, true, JSON.stringify(response));
      return response;
    };
    const initial = elapsed(() => send({ command: "workspace.info" }));
    const current = send({ command: "task.get", args: { id: tasks.at(-1).id } });
    const args = { id: current.result.task.id, expectedVersion: current.result.task.version, title: current.result.task.title };
    const request = { command: "task.update", args, writeContext: current.writeContext, idempotencyKey: "retained-noop" };
    const receipt = send(request);
    assert.equal(receipt.result.changed, false);
    let key = 0;
    const snapshot = readV2CanonicalRoot(root);
    const compact = cacheSize(cache);
    assert.equal(compact.fingerprintChars, count * 135);
    const unchangedMs = {
      info: repeated(() => send({ command: "workspace.info" })),
      get: repeated(() => send({ command: "task.get", args: { id: args.id } })),
      updateNoopNewKey: repeated(() => send({ ...request, idempotencyKey: `noop-${++key}` })),
    };
    // Reproduce the old schema-5 representation in the SAME physical cache, retaining receipts.
    const database = new DatabaseSync(cache);
    try {
      database.exec("BEGIN IMMEDIATE");
      const update = database.prepare("UPDATE v2_query_tasks SET fingerprint = ? WHERE id = ?");
      const hashes = new Map(snapshot.files.map(file => [file.relativePath, file.sha256]));
      const scopes = new Map();
      for (const task of snapshot.tasks) {
        const ids = scopes.get(task.parentId) ?? [];
        ids.push(task.id);
        scopes.set(task.parentId, ids);
      }
      for (const task of snapshot.tasks) update.run(JSON.stringify([hashes.get(`tasks/${task.id}.json`), scopes.get(task.parentId)]), task.id);
      database.exec("COMMIT");
      assert.equal(database.prepare("PRAGMA user_version").get().user_version, 5);
    } finally { database.close(); }
    const legacy = cacheSize(cache);
    const refresh = elapsed(() => send({ command: "workspace.info" }));
    assert.equal(refresh.result.writeContext, current.writeContext);
    assert.equal(refresh.result.result.workspaceRevision, initial.result.result.workspaceRevision);
    assert.deepEqual(send(request).result, receipt.result);
    assert.deepEqual(readV2CanonicalRoot(root).files, snapshot.files);
    const refreshed = cacheSize(cache);
    assert.equal(refreshed.fingerprintChars, count * 135);
    const retainedCacheInfoMs = repeated(() => send({ command: "workspace.info" }));
    measurements.push({ layout, count, initialInfoMs: initial.ms, compact, unchangedMs, legacy, refreshMs: refresh.ms, refreshed, retainedCacheInfoMs });
  }
  console.log(JSON.stringify({ platform: `${os.platform()} ${os.release()}`, node: process.version, samplesPerCommand: 5, measurements }, null, 2));
} finally {
  if (previousProfile === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previousProfile;
  rmSync(scratch, { recursive: true, force: true });
}
