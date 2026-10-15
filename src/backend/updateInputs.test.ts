import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CommandError } from "./errors.js";
import { applyUpdate, parseShorthand, parseUpdate } from "./updateInputs.js";
import { validateTask } from "./taskModel.js";

const corpus = JSON.parse(readFileSync(fileURLToPath(new URL("../../scripts/fixtures/workspace/cases.json", import.meta.url)), "utf8")) as {
  taskTemplate: Record<string, unknown>;
  cases: { id: string; profile: string; given: { patch?: object }; action: { command?: string; args: Record<string, unknown> }; expect: { error?: string; fields?: Record<string, unknown> } }[];
};
for (const entry of corpus.cases.filter(entry => entry.profile === "inputs" && entry.action.command === "task.update")) {
  test(`update input vector ${entry.id} (not create-command conformance)`, () => {
    const task = validateTask({ ...corpus.taskTemplate, ...entry.given.patch }, "a");
    const execute = () => applyUpdate(task, parseUpdate({ id: "a", expectedVersion: 1, ...entry.action.args }), "2026-10-01T00:00:00.000Z");
    if (entry.expect.error) {
      assert.throws(execute, error => error instanceof CommandError && error.code === entry.expect.error);
    } else {
      const result = execute();
      for (const [field, value] of Object.entries(entry.expect.fields ?? {})) assert.deepEqual(result.task[field as keyof typeof result.task], value);
    }
  });
}

test("shorthand evaluates escaped-marker boundaries on decoded characters", () => {
  assert.deepEqual(parseShorthand("See \\@#tag"), { title: "See @#tag", category: null, tags: [] });
  assert.deepEqual(parseShorthand("See \\#literal #Real"), { title: "See #literal", category: null, tags: ["real"] });
  assert.deepEqual(parseShorthand("Keep \\q \\\\ @Work"), { title: "Keep \\q \\" , category: "work", tags: [] });
});
