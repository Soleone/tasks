import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CommandError } from "./errors.js";
import { applyUpdate, parseUpdate } from "./updateInputs.js";
import { parseShorthand, typedText } from "./shorthand.js";
import { buildCreatedTask, parseCreate } from "./createInputs.js";
import { projectTasks } from "./queries.js";
import type { QueryAuthority } from "./queryCache.js";
import { validateTask } from "./taskModel.js";

const corpus = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../scripts/fixtures/workspace/cases.json", import.meta.url)),
    "utf8",
  ),
) as {
  taskTemplate: Record<string, unknown>;
  cases: {
    id: string;
    profile: string;
    given: { patch?: object };
    action: { command?: string; args: Record<string, unknown> };
    expect: { error?: string; fields?: Record<string, unknown> };
  }[];
};
for (const entry of corpus.cases.filter(
  (entry) => entry.profile === "inputs" && entry.action.command === "task.update",
)) {
  test(`update input vector ${entry.id} (not create-command conformance)`, () => {
    const task = validateTask({ ...corpus.taskTemplate, ...entry.given.patch }, "a");
    const execute = () =>
      applyUpdate(
        task,
        parseUpdate({ id: "a", expectedVersion: 1, ...entry.action.args }),
        "2026-10-01T00:00:00.000Z",
      );
    if (entry.expect.error) {
      assert.throws(
        execute,
        (error) => error instanceof CommandError && error.code === entry.expect.error,
      );
    } else {
      const result = execute();
      for (const [field, value] of Object.entries(entry.expect.fields ?? {}))
        assert.deepEqual(result.task[field as keyof typeof result.task], value);
    }
  });
}

test("shorthand evaluates escaped-marker boundaries on decoded characters", () => {
  assert.deepEqual(parseShorthand("See \\@#tag"), { title: "See @#tag", category: null, tags: [] });
  assert.deepEqual(parseShorthand("See \\#literal #Real"), {
    title: "See #literal",
    category: null,
    tags: ["real"],
  });
  assert.deepEqual(parseShorthand("Keep \\q \\\\ @Work"), {
    title: "Keep \\q \\",
    category: "work",
    tags: [],
  });
});

test("text.markers: joined category and tag names stay literal", () => {
  assert.deepEqual(parseShorthand("Keep #one@two @one-long#two @work #real"), {
    title: "Keep #one@two @one-long#two",
    category: "work",
    tags: ["real"],
  });
});

test("text.remove-span: a marker between two spaces leaves one; other spacing stays", () => {
  assert.equal(parseShorthand("Review @work now").title, "Review now");
  assert.equal(parseShorthand("Call #a #b  now").title, "Call  now");
  assert.equal(parseShorthand("Ask  @work, then go").title, "Ask  , then go");
  assert.equal(parseShorthand("@home Call #phone").title, "Call");
});

const at = "2026-10-01T00:00:00.000Z";
function typed(text: string) {
  return applyUpdate(
    validateTask(corpus.taskTemplate, "a"),
    parseUpdate({ id: "a", expectedVersion: 1, text: `  ${text} ` }),
    at,
  ).task;
}

test("text.kept: shorthand input is stored trimmed next to what it produced; create with title stores null", () => {
  assert.deepEqual(pick(typed("Call #phone now @Home")), {
    title: "Call now",
    text: "Call #phone now @Home",
    category: "home",
    tags: ["phone"],
  });
  assert.equal(
    buildCreatedTask(parseCreate({ text: "Ship @work" }), { id: "b", at }, []).text,
    "Ship @work",
  );
  assert.equal(
    buildCreatedTask(parseCreate({ title: "Ship @work" }), { id: "b", at }, []).text,
    null,
  );
});

test("text.cleared: title, category or tag changes without text clear it; other changes keep it", () => {
  const task = typed("Call @home #phone");
  for (const args of [{ title: "Call!" }, { category: "work" }, { category: null }, { tags: [] }]) {
    assert.equal(
      applyUpdate(task, parseUpdate({ id: "a", expectedVersion: 1, ...args }), at).task.text,
      null,
      JSON.stringify(args),
    );
  }
  for (const args of [
    { description: "More" },
    { priority: 0 },
    { category: "home" },
    { tags: ["phone"] },
    { title: "Call" },
  ]) {
    assert.equal(
      applyUpdate(task, parseUpdate({ id: "a", expectedVersion: 1, ...args }), at).task.text,
      "Call @home #phone",
      JSON.stringify(args),
    );
  }
});

test("text.stale: results report text only while it still produces the title, category and tags", () => {
  const task = typed("Call @home");
  const authority = { versions: new Map([["a", 1]]) } as unknown as QueryAuthority;
  assert.equal(projectTasks([task], authority)[0].text, "Call @home");
  const handEdited = validateTask({ ...task, title: "Call mom" }, "a");
  assert.equal(projectTasks([handEdited], authority)[0].text, null);
  assert.equal(typedText({ ...task, category: "work" }), null);
});

function pick(task: {
  title: string;
  text: string | null;
  category: string | null;
  tags: string[];
}) {
  return { title: task.title, text: task.text, category: task.category, tags: task.tags };
}
