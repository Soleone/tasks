import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { AppWorkspace } from "@/testing/appWorkspace";
import { fakeImageClipboard } from "@/testing/imageClipboard";
import {
  expectActive,
  expectListFocused,
  focusedTitleField,
  searchPicker,
} from "@/testing/taskList";

let workspace: AppWorkspace;
beforeEach(async () => {
  workspace = await AppWorkspace.start();
});
afterEach(async () => {
  await workspace.stop();
});

test("home.task-context-menu: a long press targets its row and release never opens the editor", async () => {
  const held = await workspace.create("Held task");
  await workspace.create("Other task");
  const { user } = await workspace.render();
  await expectActive("Other task");
  const row = screen.getByText("Held task").closest('[role="option"]')!;
  const touch = { identifier: 1, clientX: 30, clientY: 60, target: row };
  fireEvent.touchStart(row, { touches: [touch] });
  const menu = await screen.findByRole("menu", { name: "Actions for Held task" });
  fireEvent.touchEnd(row, { touches: [] });
  fireEvent.click(row);
  expect(screen.queryByPlaceholderText("What needs doing?")).toBeNull();
  await user.click(within(menu).getByRole("menuitem", { name: "Pause" }));
  await waitFor(async () => expect((await workspace.task(held.id)).status).toBe("paused"));
  await expectListFocused();
});

test("home.task-context-menu: scrolling cancels a hold and a normal tap still edits", async () => {
  await workspace.create("Task");
  const { user } = await workspace.render();
  const row = screen.getByText("Task").closest('[role="option"]')!;
  fireEvent.touchStart(row, { touches: [{ identifier: 1, clientX: 20, clientY: 40 }] });
  fireEvent.touchMove(row, { touches: [{ identifier: 1, clientX: 20, clientY: 80 }] });
  // Wait beyond the library's long-press threshold to detect a late menu.
  await new Promise((resolve) => setTimeout(resolve, 600));
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.touchEnd(row, { touches: [] });
  await user.click(row);
  await focusedTitleField();
});

test("home.task-context-menu: moving another row opens its picker and preserves picker focus", async () => {
  const parent = await workspace.create("Parent");
  const moved = await workspace.create("Moved task");
  await workspace.create("Other task");
  const { user } = await workspace.render();
  await expectActive("Other task");
  const row = screen.getByText("Moved task").closest('[role="option"]')!;
  fireEvent.contextMenu(row, { clientX: 30, clientY: 60 });
  await user.click(await screen.findByRole("menuitem", { name: "Move under…" }));
  await screen.findByRole("dialog", { name: "Move Moved task under…" });
  await searchPicker(user, "Parent");
  await user.keyboard("{Enter}");
  await waitFor(async () => expect((await workspace.task(moved.id)).parentId).toBe(parent.id));
  await expectListFocused();
});

test("home.task-context-menu: actions have icons and Cancel task changes status without deleting", async () => {
  const task = await workspace.create("Task");
  const { user } = await workspace.render();
  fireEvent.contextMenu(screen.getByText("Task").closest('[role="option"]')!, {
    clientX: 30,
    clientY: 60,
  });
  const menu = await screen.findByRole("menu", { name: "Actions for Task" });
  for (const item of within(menu).getAllByRole("menuitem")) {
    expect(item.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  }
  expect(within(menu).queryByRole("menuitem", { name: "Delete" })).toBeNull();
  await user.click(within(menu).getByRole("menuitem", { name: "Cancel task" }));
  await waitFor(async () => expect((await workspace.task(task.id)).status).toBe("canceled"));
});

test("home.task-context-menu: Escape dismisses without editing", async () => {
  await workspace.create("Task");
  const { user } = await workspace.render();
  fireEvent.contextMenu(screen.getByText("Task").closest('[role="option"]')!, {
    clientX: 30,
    clientY: 60,
  });
  await screen.findByRole("menu");
  await user.keyboard("{Escape}");
  await expectListFocused();
  expect(screen.queryByRole("menu")).toBeNull();
  expect(screen.queryByPlaceholderText("What needs doing?")).toBeNull();
});

test("toolbar.task-actions: empty and editing states disable the action buttons", async () => {
  const { user } = await workspace.render();
  const undo = screen.getByRole<HTMLButtonElement>("button", { name: "Undo" });
  const redo = screen.getByRole<HTMLButtonElement>("button", { name: "Redo" });
  const actions = screen.getByRole<HTMLButtonElement>("button", { name: "Task actions" });
  expect(undo.disabled).toBe(true);
  expect(redo.disabled).toBe(true);
  expect(actions.disabled).toBe(true);
  expect(undo.tabIndex).toBe(-1);
  expect(redo.tabIndex).toBe(-1);
  expect(actions.tabIndex).toBe(-1);
  const group = screen.getByRole("group", { name: "Task list actions" });
  expect(group.contains(undo)).toBe(true);
  expect(group.contains(redo)).toBe(true);
  expect(group.contains(actions)).toBe(true);
  expect(undo.textContent).toBe("");
  expect(redo.textContent).toBe("");
  expect(actions.textContent).toBe("");
  await user.click(screen.getByRole("button", { name: "New task" }));
  await focusedTitleField();
  expect(actions.disabled).toBe(true);
  expect(undo.disabled).toBe(true);
  expect(redo.disabled).toBe(true);
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
  await searchPicker(user, "Blocker");
  await user.keyboard("{Enter}");
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
  await searchPicker(user, "Parent");
  await user.keyboard("{Enter}");
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

test("attach.copy: Copy image in Task actions copies the newest image", async () => {
  await workspace.create("Task", {
    attachments: [await workspace.storeImage(1), await workspace.storeImage(2)],
  });
  const { user } = await workspace.render();
  const copied = fakeImageClipboard();
  await expectActive("Task");
  await user.click(screen.getByRole("button", { name: "Task actions" }));
  await user.click(await screen.findByRole("menuitem", { name: /Copy image/ }));
  await screen.findByText("Image copied to clipboard");
  expect((await copied())?.at(-1)).toBe(2);
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
