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

function classified(text: string): { title: string; category: string | null; tags: string[] } {
  const { title, category, tags } = parseShorthand(text);
  return { title, category, tags };
}

test("shorthand evaluates escaped-marker boundaries on decoded characters", () => {
  assert.deepEqual(classified("See \\@#tag"), { title: "See @#tag", category: null, tags: [] });
  assert.deepEqual(classified("See \\#literal #Real"), {
    title: "See #literal",
    category: null,
    tags: ["real"],
  });
  assert.deepEqual(classified("Keep \\q \\\\ @Work"), {
    title: "Keep \\q \\",
    category: "work",
    tags: [],
  });
});

test("text.markers: joined category and tag names stay literal", () => {
  assert.deepEqual(classified("Keep #one@two @one-long#two @work #real"), {
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

// 2026-10-22 is a Thursday.
const today = "2026-10-22";

test("text.due: due words resolve against today; anything else stays text", () => {
  const due = (word: string): string | null => parseShorthand(`Pay ^${word}`, today).due;
  assert.equal(due("today"), "2026-10-22");
  assert.equal(due("tmr"), "2026-10-23");
  assert.equal(due("Tomorrow"), "2026-10-23");
  assert.equal(due("fri"), "2026-10-23");
  assert.equal(due("thursday"), "2026-10-29");
  assert.equal(due("3d"), "2026-10-25");
  assert.equal(due("2w"), "2026-11-05");
  assert.equal(parseShorthand("Pay ^1m", "2026-01-31").due, "2026-02-28");
  assert.equal(due("1y"), "2027-10-22");
  assert.equal(parseShorthand("Pay ^1y", "2028-02-29").due, "2029-02-28");
  assert.equal(due("oct31"), "2026-10-31");
  assert.equal(due("october22"), "2026-10-22");
  assert.equal(due("oct21"), "2027-10-21");
  assert.equal(due("2026-02-03"), "2026-02-03");
  for (const text of ["x^2 = 4", "Pay ^soon", "Pay ^feb30", "Pay \\^fri", "Pay `^fri`", "a^fri"])
    assert.deepEqual(parseShorthand(text, today).due, null, text);
  assert.equal(parseShorthand("Pay \\^fri", today).title, "Pay ^fri");
  assert.equal(parseShorthand("Pay ^fri rent", today).title, "Pay rent");
});

test("text.due-fixed: the stored text holds the date, not the relative word", () => {
  assert.equal(
    parseShorthand(" Pay ^fri \\@home #bills ", today).text,
    "Pay ^2026-10-23 \\@home #bills",
  );
  assert.equal(parseShorthand("`^x` Pay ^tmr", today).text, "`^x` Pay ^2026-10-23");
  assert.throws(
    () => parseUpdate({ id: "a", expectedVersion: 1, text: `${"a".repeat(995)} ^1d` }),
    (error) => error instanceof CommandError && error.code === "INVALID_ARGUMENT",
  );
});

test("text.one-due: two different due dates are refused; the same one twice is fine", () => {
  assert.throws(
    () => parseShorthand("Pay ^fri ^mon", today),
    (error) => error instanceof CommandError && error.code === "INVALID_ARGUMENT",
  );
  assert.equal(parseShorthand("Pay ^fri ^2026-10-23", today).due, "2026-10-23");
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
  for (const args of [
    { title: "Call!" },
    { category: "work" },
    { category: null },
    { tags: [] },
    { due: "2026-11-01" },
  ]) {
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
    { due: null },
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
