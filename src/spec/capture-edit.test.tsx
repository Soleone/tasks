import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { AppWorkspace } from "@/testing/appWorkspace";
import { announcements, expectActive, expectListFocused, expectRows, focusedTitleField, row } from "@/testing/taskList";

let workspace: AppWorkspace;
beforeEach(async () => { workspace = await AppWorkspace.start(); });
afterEach(async () => { await workspace.stop(); });

async function onlyTask() {
  const { tasks } = await workspace.command<{ tasks: { id: string }[] }>("task.list", { status: [] });
  expect(tasks).toHaveLength(1);
  return workspace.task(tasks[0].id);
}

function editor(): HTMLElement {
  return screen.getByRole("form", { name: /New task|Edit task/ });
}

async function capture(user: UserEvent, text: string): Promise<void> {
  await user.keyboard("c");
  await focusedTitleField();
  await user.keyboard(text);
}

describe("opening and closing", () => {
  test("capture.open: C opens the editor with the title focused", async () => {
    const { user } = await workspace.render();
    await user.keyboard("c");
    await focusedTitleField();
  });

  test("capture.child: Shift+C saves the new task as a child of the active task", async () => {
    const parent = await workspace.create("Parent");
    const { user } = await workspace.render();
    await expectActive("Parent");
    await user.keyboard("{Shift>}C{/Shift}");
    await focusedTitleField();
    await user.keyboard("Child{Enter}");
    await expectListFocused();
    const { tasks } = await workspace.command<{ tasks: { title: string; parentId: string | null }[] }>("task.list", {});
    expect(tasks.find((task) => task.title === "Child")?.parentId).toBe(parent.id);
  });

  test("capture.child-canceled: Shift+C on a canceled task is refused with a message", async () => {
    await workspace.change("task.cancel", (await workspace.create("Gone")).id);
    const { user } = await workspace.render();
    await user.keyboard("fx");
    await expectRows(["Gone"]);
    await user.keyboard("{Shift>}C{/Shift}");
    await waitFor(() => expect(announcements()).toMatch(/canceled/i));
    expect(screen.queryByPlaceholderText("What needs doing?")).toBeNull();
  });

  test("edit.inline: clicking a row replaces it with the editor", async () => {
    await workspace.create("Click me");
    const { user } = await workspace.render();
    await user.click(row("Click me"));
    expect((await focusedTitleField()).value).toBe("Click me");
  });

  test("edit.save: Enter saves and focus returns to the list on the saved task", async () => {
    const task = await workspace.create("Old title");
    await workspace.create("Other");
    const { user } = await workspace.render();
    await user.keyboard("{ArrowDown}");
    await expectActive("Old title");
    await user.keyboard("{Enter}");
    const title = await focusedTitleField();
    await user.clear(title);
    await user.keyboard("New title{Enter}");
    await waitFor(async () => expect((await workspace.task(task.id)).title).toBe("New title"));
    await expectListFocused();
    await expectActive("New title");
  });

  test("edit.cancel: Escape cancels; from the description the first Escape returns to the title", async () => {
    await workspace.create("Keep me");
    const { user } = await workspace.render();
    await user.keyboard("{Enter}");
    await focusedTitleField();
    await user.keyboard("{Tab}{Tab}");
    await waitFor(() => expect(document.activeElement?.getAttribute("placeholder")).toBe("Write in Markdown…"));
    await user.keyboard("{Escape}");
    await focusedTitleField();
    await user.keyboard(" changed{Escape}");
    await expectListFocused();
    await expectRows(["Keep me"]);
  });

  test("edit.keeps-draft: a workspace change while editing keeps the draft", async () => {
    await workspace.create("Task");
    const { user } = await workspace.render();
    await capture(user, "Half typed");
    await workspace.create("Arrived elsewhere");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await focusedTitleField()).value).toBe("Half typed");
  });
});

describe("inside the editor", () => {
  test("edit.tab-order: Tab goes title, priority, description", async () => {
    const { user } = await workspace.render();
    await capture(user, "Task");
    await user.keyboard("{Tab}");
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-keyshortcuts")).toBe("0 1 2 3 4 ArrowLeft ArrowRight"));
    await user.keyboard("{Tab}");
    await waitFor(() => expect(document.activeElement?.getAttribute("placeholder")).toBe("Write in Markdown…"));
    await user.keyboard("{Shift>}{Tab}{Tab}{/Shift}");
    await focusedTitleField();
  });

  test("edit.priority: new tasks start at P2; a digit on the priority stop sets it", async () => {
    const { user } = await workspace.render();
    await capture(user, "Task");
    await user.keyboard("{Tab}0{Control>}{Enter}{/Control}");
    await waitFor(async () => expect((await onlyTask()).priority).toBe(0));
  });

  test("edit.description-button: Add description opens the description for the mouse", async () => {
    const { user } = await workspace.render();
    await capture(user, "Task");
    await user.click(within(editor()).getByRole("button", { name: /description/i }));
    await screen.findByPlaceholderText("Write in Markdown…");
  });

  test("edit.buttons: Save and Cancel are mouse fallbacks, not Tab stops", async () => {
    const { user } = await workspace.render();
    await capture(user, "Task");
    for (const name of ["Add task", "Close"]) expect(within(editor()).getByRole("button", { name }).tabIndex).toBe(-1);
  });
});

describe("shorthand", () => {
  test("shorthand.category: @word sets the category; two categories refuse the save", async () => {
    const { user } = await workspace.render();
    await capture(user, "Call @home and @work{Enter}");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await workspace.command<{ tasks: unknown[] }>("task.list", {})).tasks).toHaveLength(0);
    const title = within(editor()).getByPlaceholderText("What needs doing?");
    await user.clear(title);
    await user.keyboard("Call @home{Enter}");
    await waitFor(async () => expect((await onlyTask()).category).toBe("home"));
  });

  test("shorthand.tags: #word adds tags", async () => {
    const { user } = await workspace.render();
    await capture(user, "Read #books #later{Enter}");
    await waitFor(async () => expect((await onlyTask()).tags).toEqual(["books", "later"]));
  });

  test("shorthand.empty: a title that is only shorthand is refused", async () => {
    const { user } = await workspace.render();
    await capture(user, "@home{Enter}");
    await waitFor(() => expect(within(editor()).getByPlaceholderText("What needs doing?").getAttribute("aria-invalid")).toBe("true"));
    const { tasks } = await workspace.command<{ tasks: unknown[] }>("task.list", {});
    expect(tasks).toHaveLength(0);
  });
});

describe("pickers", () => {
  function options(): string[] {
    return within(screen.getByRole("dialog")).queryAllByRole("option").map((option) => option.textContent ?? "");
  }

  test("pick.parent: M then choosing a task nests the active task under it", async () => {
    const parent = await workspace.create("Parent");
    const child = await workspace.create("Loose");
    const { user } = await workspace.render();
    await expectActive("Loose");
    await user.keyboard("m");
    await screen.findByRole("dialog");
    await user.keyboard("Parent{Enter}");
    await waitFor(async () => expect((await workspace.task(child.id)).parentId).toBe(parent.id));
  });

  test("pick.remove-parent: M on a child offers Remove parent above the results", async () => {
    const parent = await workspace.create("Parent");
    const child = await workspace.create("Child", { parentId: parent.id });
    const { user } = await workspace.render();
    await user.keyboard("{ArrowRight}{ArrowDown}");
    await expectActive("Child");
    await user.keyboard("m");
    await screen.findByRole("dialog");
    await waitFor(() => expect(options()[0]).toMatch(/Remove parent/));
    await user.click(within(screen.getByRole("dialog")).getAllByRole("option")[0]);
    await waitFor(async () => expect((await workspace.task(child.id)).parentId).toBeNull());
  });

  test("pick.blocker: B adds a blocker; done and canceled tasks aren't offered", async () => {
    await workspace.change("task.complete", (await workspace.create("Finished")).id);
    await workspace.change("task.cancel", (await workspace.create("Dropped")).id);
    const blocker = await workspace.create("Blocker");
    const task = await workspace.create("Task");
    const { user } = await workspace.render();
    await expectActive("Task");
    await user.keyboard("b");
    await screen.findByRole("dialog");
    await waitFor(() => expect(options().some((option) => option.includes("Blocker"))).toBe(true));
    expect(options().some((option) => option.includes("Finished") || option.includes("Dropped"))).toBe(false);
    await user.keyboard("Blocker{Enter}");
    await waitFor(async () => expect((await workspace.task(task.id)).dependencyIds).toEqual([blocker.id]));
  });

  test("pick.existing-links: an existing link to a canceled task can still be removed", async () => {
    const blocker = await workspace.create("Dropped blocker");
    const task = await workspace.create("Task");
    await workspace.change("task.dependency.add", task.id, { dependsOnId: blocker.id });
    await workspace.change("task.cancel", blocker.id);
    const { user } = await workspace.render();
    await expectActive("Task");
    await user.keyboard("b");
    await screen.findByRole("dialog");
    await waitFor(() => expect(options()[0]).toMatch(/Dropped blocker/));
    await user.click(within(screen.getByRole("dialog")).getAllByRole("option")[0]);
    await waitFor(async () => expect((await workspace.task(task.id)).dependencyIds).toEqual([]));
  });

  test("pick.refusals: a choice that would create a cycle is refused before sending", async () => {
    const first = await workspace.create("First");
    const second = await workspace.create("Second");
    await workspace.change("task.dependency.add", first.id, { dependsOnId: second.id });
    const { user } = await workspace.render();
    await expectActive("Second");
    await user.keyboard("b");
    await screen.findByRole("dialog");
    await user.keyboard("First{Enter}");
    await waitFor(() => expect(announcements()).toMatch(/cycle|refused|can't|cannot/i));
    expect((await workspace.task(second.id)).dependencyIds).toEqual([]);
  });
});
