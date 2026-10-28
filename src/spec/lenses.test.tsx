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
