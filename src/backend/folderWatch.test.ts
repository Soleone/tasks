import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { inspectCanonicalRoot, watchTaskFolders } from "./canonicalReader.js";

const template = (
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../../scripts/fixtures/workspace/cases.json", import.meta.url)),
      "utf8",
    ),
  ) as { taskTemplate: Record<string, unknown> }
).taskTemplate;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const titles = (root: string) =>
  inspectCanonicalRoot(root).snapshot!.tasks.map((task) => task.title);

test("observe.watched: a running backend sees in-place edits once reported and renamed files at once", async (t) => {
  watchTaskFolders();
  const root = mkdtempSync(path.join(os.tmpdir(), "tasks-watch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "tasks"));
  writeFileSync(path.join(root, "workspace.json"), '{"schemaVersion":2}\n');
  const task = (id: string, title: string) =>
    `${JSON.stringify({ ...template, id, title, orderKey: id === "a" ? "a0" : "a1" })}\n`;
  writeFileSync(path.join(root, "tasks", "a.json"), task("a", "First"));
  // Past the racy window, so the folders' own times are trusted.
  await pause(3_200);
  assert.deepEqual(titles(root), ["First"]);

  writeFileSync(path.join(root, "tasks", "a.json"), task("a", "Other"));
  await pause(200);
  assert.deepEqual(titles(root), ["Other"]);

  await pause(3_200);
  assert.deepEqual(titles(root), ["Other"]);
  writeFileSync(path.join(root, "b.tmp"), task("b", "Second"));
  renameSync(path.join(root, "b.tmp"), path.join(root, "tasks", "b.json"));
  assert.deepEqual(titles(root).sort(), ["Other", "Second"]);
});
