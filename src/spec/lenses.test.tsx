import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { addDays, localToday } from "@/backend/dueDate";
import { AppWorkspace } from "@/testing/appWorkspace";
import { expectActive, expectRows } from "@/testing/taskList";

let workspace: AppWorkspace;
beforeEach(async () => {
  workspace = await AppWorkspace.start();
});
afterEach(async () => {
  await workspace.stop();
});

function dueNowButton(): HTMLElement | null {
  return document.querySelector("[data-lens-count=due]");
}

function countLine(): string | null | undefined {
  return document.querySelector("[data-filter-summary]")?.textContent;
}

/** Late, paused-late and due-today tasks, plus a later and a finished one the lens leaves out. */
async function createDueTasks(): Promise<{ late: string }> {
  const today = localToday();
  await workspace.create("Later", { due: addDays(today, 3) });
  await workspace.create("Today", { due: today });
  const paused = await workspace.create("Paused late", { due: addDays(today, -1) });
  await workspace.change("task.pause", paused.id);
  const finished = await workspace.create("Finished late", { due: addDays(today, -1) });
  await workspace.change("task.complete", finished.id);
  const late = await workspace.create("Late", { due: addDays(today, -2) });
  await workspace.create("Undated");
  return { late: late.id };
}

describe("due now", () => {
  test("due.count: the header counts tasks due today or late, from any client", async () => {
    const { late } = await createDueTasks();
    await workspace.render();
    await waitFor(() => expect(dueNowButton()?.getAttribute("aria-label")).toBe("3 due now"));
    const { task: seen } = await workspace.cli<{ task: { version: number } }>("task.get", {
      id: late,
    });
    await workspace.cli("task.complete", { id: late, expectedVersion: seen.version });
    // The list picks up the outside write on its next revision check.
    await waitFor(() => expect(dueNowButton()?.getAttribute("aria-label")).toBe("2 due now"), {
      timeout: 4000,
    });
  });

  test("due.lens: !, the count and the palette show what's due, most overdue first", async () => {
    await createDueTasks();
    const { user } = await workspace.render();
    await expectRows(["Undated", "Late", "Today", "Later"]);
    await user.keyboard("!");
    await expectRows(["Late", "Paused late", "Today"]);
    expect(countLine()).toBe("3 due now");
    expect(dueNowButton()?.getAttribute("aria-pressed")).toBe("true");
    await user.keyboard("!");
    await expectRows(["Undated", "Late", "Today", "Later"]);

    await user.click(dueNowButton()!);
    await expectRows(["Late", "Paused late", "Today"]);
    await user.click(dueNowButton()!);
    await expectRows(["Undated", "Late", "Today", "Later"]);

    await user.keyboard("{Control>}k{/Control}");
    await user.click(await screen.findByRole("option", { name: /Due now/ }));
    await expectRows(["Late", "Paused late", "Today"]);
  });

  test("lens.switch: moving from one lens to another still goes back to the view before both", async () => {
    await createDueTasks();
    const { user } = await workspace.render();
    await user.keyboard("/undated{Enter}");
    await expectRows(["Undated"]);
    await user.keyboard("d");
    await expectRows(["Finished late"]);
    await user.keyboard("!");
    await expectRows(["Late", "Paused late", "Today"]);
    await user.keyboard("{Escape}");
    await expectRows(["Undated"]);
  });

  test("due.all-clear: finishing the last due task says so and offers the way back", async () => {
    await workspace.create("Someday");
    await workspace.create("Today", { due: localToday() });
    const { user } = await workspace.render();
    await user.keyboard("!");
    await expectRows(["Today"]);
    await expectActive("Today");
    await user.keyboard("{Shift>} {/Shift}");
    await waitFor(() => expect(screen.getByText("All clear")).toBeTruthy());
    expect(countLine()).toBe("0 due now");
    // The lens keeps its count and way back at zero.
    expect(dueNowButton()?.getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Go back" }));
    await expectRows(["Someday"]);
    expect(dueNowButton()).toBeNull();
  });
});

function agentsButton(): HTMLElement | null {
  return document.querySelector("[data-lens-count=agents]");
}

/** Completes a task the way an agent with `--actor-label claude` would, or a person at the CLI. */
async function completeFromCli(id: string, agent?: string): Promise<void> {
  const { task } = await workspace.cli<{ task: { version: number } }>("task.get", { id });
  await workspace.cli("task.complete", { id, expectedVersion: task.version }, agent);
}

describe("changed by agents", () => {
  test("agents.count: the header counts tasks an agent changed with the CLI, not a person's changes", async () => {
    const mine = await workspace.create("Closed by me");
    const theirs = await workspace.create("Closed by claude");
    await workspace.render();
    await expectRows(["Closed by claude", "Closed by me"]);
    expect(agentsButton()).toBeNull();
    await completeFromCli(mine.id);
    await completeFromCli(theirs.id, "claude");
    // The list picks up the outside writes on its next revision check.
    await waitFor(
      () => expect(agentsButton()?.getAttribute("aria-label")).toBe("1 changed by agents"),
      { timeout: 4000 },
    );
  });

  test("agents.lens: Shift+A shows the tasks agents changed, in any status, naming the change", async () => {
    await workspace.create("Untouched");
    const closed = await workspace.create("Closed by claude");
    await completeFromCli(closed.id, "claude");
    const { user } = await workspace.render();
    await expectRows(["Untouched"]);
    await waitFor(() => expect(agentsButton()).not.toBeNull());
    await user.keyboard("{Shift>}A{/Shift}");
    await expectRows(["Closed by claude"]);
    expect(countLine()).toBe("1 changed by agents");
    expect(agentsButton()?.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector("[data-task-note]")?.textContent).toMatch(
      /^Completed by claude · \d\d:\d\d$/,
    );
  });

  test("agents.seen: closing the lens clears the count until an agent changes something again", async () => {
    const first = await workspace.create("First");
    const second = await workspace.create("Second");
    await completeFromCli(first.id, "claude");
    const { user } = await workspace.render();
    await waitFor(() => expect(agentsButton()).not.toBeNull());
    await user.click(agentsButton()!);
    await expectRows(["First"]);
    await user.keyboard("{Shift>}A{/Shift}");
    await expectRows(["Second"]);
    await waitFor(() => expect(agentsButton()).toBeNull());
    await user.keyboard("{Shift>}A{/Shift}");
    await waitFor(() => expect(screen.getByText("Nothing changed by agents")).toBeTruthy());
    await user.keyboard("{Shift>}A{/Shift}");
    await completeFromCli(second.id, "claude");
    await waitFor(
      () => expect(agentsButton()?.getAttribute("aria-label")).toBe("1 changed by agents"),
      { timeout: 4000 },
    );
  });
});
