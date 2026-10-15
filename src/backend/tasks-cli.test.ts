import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cliPath = fileURLToPath(new URL("./tasks-cli.js", import.meta.url));

function runCli(args: string[], extraEnv: Record<string, string> = {}): string {
  return execFileSync(process.execPath, [cliPath, "--legacy", ...args], {
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
  });
}

function tempDatabase(): { directory: string; databasePath: string } {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tasks-cli-test-"));
  return { directory, databasePath: path.join(directory, "cli.db") };
}

test("tasks-cli resolves the database internally and runs add/list/show/complete", () => {
  const { directory, databasePath } = tempDatabase();
  try {
    const added = JSON.parse(runCli(["add", "Plan launch", "--json", "--database", databasePath]));
    const id = (added.task as { id: string }).id;
    assert.ok(typeof id === "string" && id.length > 0);

    const listed = JSON.parse(runCli(["list", "--json", "--database", databasePath]));
    assert.equal(listed.total, 1);

    const shown = JSON.parse(runCli(["show", id, "--json", "--database", databasePath]));
    assert.equal((shown.task as { title: string }).title, "Plan launch");

    const completed = JSON.parse(
      runCli(["complete", id, "--json", "--database", databasePath]),
    );
    assert.equal((completed.task as { status: string }).status, "done");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("tasks-cli can clear a description with an empty value", () => {
  const { directory, databasePath } = tempDatabase();
  try {
    const added = JSON.parse(runCli(["add", "Clear notes", "--description", "notes", "--json", "--database", databasePath]));
    const id = (added.task as { id: string }).id;
    runCli(["update", id, "--description", "", "--json", "--database", databasePath]);
    runCli(["update", id, "--description", "--literal", "--json", "--database", databasePath]);
    const shown = JSON.parse(runCli(["show", id, "--json", "--database", databasePath]));
    assert.equal((shown.task as { descriptionMarkdown: string }).descriptionMarkdown, "--literal");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("tasks-cli uses TASKS_DATABASE_PATH when --database is omitted", () => {
  const { directory, databasePath } = tempDatabase();
  try {
    runCli(["add", "From env", "--json"], { TASKS_DATABASE_PATH: databasePath });
    const listed = JSON.parse(runCli(["list", "--json"], { TASKS_DATABASE_PATH: databasePath }));
    assert.equal(listed.total, 1);
    assert.equal((listed.tasks as Array<{ title: string }>)[0]?.title, "From env");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("tasks-cli with no arguments suggests --help", () => {
  try {
    execFileSync(process.execPath, [cliPath, "--legacy"], { encoding: "utf8" });
    assert.fail("expected a usage failure");
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    assert.equal(failure.status, 2);
    assert.match(String(failure.stderr), /--help/);
  }
});

test("tasks-cli reports stale versions with a distinct exit code", () => {
  const { directory, databasePath } = tempDatabase();
  try {
    const added = JSON.parse(runCli(["add", "Versioned", "--json", "--database", databasePath]));
    const id = (added.task as { id: string }).id;
    try {
      execFileSync(process.execPath, [cliPath, "--legacy", "complete", id, "--expected-version", "999", "--database", databasePath], {
        encoding: "utf8",
      });
      assert.fail("expected a stale version failure");
    } catch (error) {
      const failure = error as { status?: number };
      assert.equal(failure.status, 3);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
