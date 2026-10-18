import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { AppWorkspace } from "@/testing/appWorkspace";
import { expectActive, expectListFocused, focusedTitleField } from "@/testing/taskList";

let workspace: AppWorkspace;
beforeEach(async () => {
  workspace = await AppWorkspace.start();
});
afterEach(async () => {
  await workspace.stop();
});

test("toolbar.task-actions: empty and editing states disable the action buttons", async () => {
  const { user } = await workspace.render();
  const undo = screen.getByRole<HTMLButtonElement>("button", { name: "Undo" });
  const actions = screen.getByRole<HTMLButtonElement>("button", { name: "Task actions" });
  expect(undo.disabled).toBe(true);
  expect(actions.disabled).toBe(true);
  expect(undo.tabIndex).toBe(-1);
  expect(actions.tabIndex).toBe(-1);
  const group = screen.getByRole("group", { name: "Task list actions" });
  expect(group.contains(undo)).toBe(true);
  expect(group.contains(actions)).toBe(true);
  expect(undo.textContent).toBe("");
  expect(actions.textContent).toBe("");
  await user.click(screen.getByRole("button", { name: "New task" }));
  await focusedTitleField();
  expect(actions.disabled).toBe(true);
  expect(undo.disabled).toBe(true);
});

test("toolbar.task-actions: the menu exposes shortcuts and Escape returns to the list", async () => {
  await workspace.create("Task");
  const { user } = await workspace.render();
  await expectActive("Task");
  await user.click(screen.getByRole("button", { name: "Task actions" }));
  for (const name of [
    /Blockers.*B/,
    /Move under.*M/,
    /New child.*Shift\+C/,
    /Copy text.*C/,
    /Pause\/resume.*P/,
  ]) {
    await screen.findByRole("menuitem", { name });
  }
  await user.keyboard("{Escape}");
  await expectListFocused();
  expect(screen.queryByRole("menu")).toBeNull();
});

test("pick.blocker: Task actions opens the blocker picker without stealing its focus", async () => {
  const blocker = await workspace.create("Blocker");
  const task = await workspace.create("Task");
  const { user } = await workspace.render();
  await expectActive("Task");
  await user.click(screen.getByRole("button", { name: "Task actions" }));
  await user.click(await screen.findByRole("menuitem", { name: /Blockers/ }));
  await screen.findByRole("dialog", { name: "Blocked by: Task" });
  await user.keyboard("Blocker{Enter}");
  await waitFor(async () =>
    expect((await workspace.task(task.id)).dependencyIds).toEqual([blocker.id]),
  );
  await expectListFocused();
});

test("pick.parent: Task actions moves the active task under a parent", async () => {
  const parent = await workspace.create("Parent");
  const task = await workspace.create("Task");
  const { user } = await workspace.render();
  await expectActive("Task");
  await user.click(screen.getByRole("button", { name: "Task actions" }));
  await user.click(await screen.findByRole("menuitem", { name: /Move under/ }));
  await screen.findByRole("dialog", { name: "Move Task under…" });
  await user.keyboard("Parent{Enter}");
  await waitFor(async () => expect((await workspace.task(task.id)).parentId).toBe(parent.id));
  await expectListFocused();
});

test("capture.child: New child in Task actions opens the child editor with focus", async () => {
  const parent = await workspace.create("Parent");
  const { user } = await workspace.render();
  await expectActive("Parent");
  await user.click(screen.getByRole("button", { name: "Task actions" }));
  await user.click(await screen.findByRole("menuitem", { name: /New child/ }));
  await focusedTitleField();
  await user.keyboard("Child{Enter}");
  await waitFor(async () => {
    const { tasks } = await workspace.command<{
      tasks: { title: string; parentId: string | null }[];
    }>("task.list", {});
    expect(tasks.find((task) => task.title === "Child")?.parentId).toBe(parent.id);
  });
  await expectListFocused();
});

test("copy.text: Copy text in Task actions copies the active task and restores focus", async () => {
  await workspace.create("Task", { description: "Notes" });
  const { user } = await workspace.render();
  await expectActive("Task");
  await user.click(screen.getByRole("button", { name: "Task actions" }));
  await user.click(await screen.findByRole("menuitem", { name: /Copy text/ }));
  await waitFor(async () => expect(await navigator.clipboard.readText()).toBe("Task Notes"));
  await expectListFocused();
});

test("undo.latest: the Undo button reverses a menu pause and is unavailable when history is empty", async () => {
  const task = await workspace.create("Task");
  const { user } = await workspace.render();
  await expectActive("Task");
  const undo = screen.getByRole<HTMLButtonElement>("button", { name: "Undo" });
  expect(undo.disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "Task actions" }));
  await user.click(await screen.findByRole("menuitem", { name: /Pause\/resume/ }));
  await waitFor(async () => expect((await workspace.task(task.id)).status).toBe("paused"));
  await waitFor(() => expect(undo.disabled).toBe(false));
  await user.click(undo);
  await waitFor(async () => expect((await workspace.task(task.id)).status).toBe("open"));
  await expectListFocused();
  await waitFor(() => expect(undo.disabled).toBe(true));
});
