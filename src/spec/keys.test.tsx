import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { readPreference } from "@/platform/preferences";
import { AppWorkspace } from "@/testing/appWorkspace";
import { expectListFocused, focusedTitleField } from "@/testing/taskList";

let workspace: AppWorkspace;
beforeEach(async () => {
  workspace = await AppWorkspace.start();
});
afterEach(async () => {
  await workspace.stop();
});

async function openKeys() {
  await workspace.create("Task");
  const { user } = await workspace.render();
  await expectListFocused();
  await user.keyboard("{Control>},{/Control}");
  await waitFor(() => expect(document.activeElement?.textContent).toBe("General"));
  await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
  await waitFor(() => expect(document.activeElement?.textContent).toBe("Keys"));
  return { user, panel: within(screen.getByRole("tabpanel")) };
}

test("keys.rebind: a clicked key takes the next key pressed, at once and remembered", async () => {
  const { user, panel } = await openKeys();
  const newTask = panel.getByRole("button", { name: "New task" });
  expect(newTask.textContent).toBe("C");
  await user.click(newTask);
  expect(newTask.textContent).toBe("Press a key…");
  await user.keyboard("n");
  expect(newTask.textContent).toBe("N");
  expect(JSON.parse(readPreference("tasks.keys")!)).toEqual({ "capture.open": "N" });
  panel.getByText("1 key changed from the defaults");

  // Escape keeps the key and leaves Settings open; Backspace turns it off.
  await user.click(newTask);
  await user.keyboard("{Escape}");
  expect(newTask.textContent).toBe("N");
  screen.getByRole("dialog", { name: "Settings" });

  await user.keyboard("{Escape}");
  await expectListFocused();
  await user.keyboard("c");
  expect(document.querySelector("[data-inline-task-editor]")).toBeNull();
  await user.keyboard("n");
  await focusedTitleField();
});

test("keys.rebind: Backspace turns a key off and reset brings back the default", async () => {
  const { user, panel } = await openKeys();
  const pause = panel.getByRole("button", { name: "Pause or resume task" });
  await user.click(pause);
  await user.keyboard("{Backspace}");
  expect(pause.textContent).toBe("Off");
  await user.click(panel.getByRole("button", { name: "Reset Pause or resume task to P" }));
  expect(pause.textContent).toBe("P");
  expect(readPreference("tasks.keys")).toBe("{}");
});

test("keys.conflict: a key another action has names it, and Swap trades the two", async () => {
  const { user, panel } = await openKeys();
  const blocker = panel.getByRole("button", { name: "Add blocker" });
  await user.click(blocker);
  await user.keyboard("d");
  const note = panel.getByRole("status");
  expect(note.querySelector("p")!.textContent).toBe("D already does Done today. Swap gives it B.");
  expect(blocker.textContent).toBe("B");
  await user.click(within(note).getByRole("button", { name: "Swap" }));
  expect(blocker.textContent).toBe("D");
  expect(panel.getByRole("button", { name: "Done today (changed)" }).textContent).toBe("B");
  panel.getByText("2 keys changed from the defaults");

  await user.click(panel.getByRole("button", { name: "Reset all keys" }));
  expect(blocker.textContent).toBe("B");
  expect(panel.getByRole("button", { name: "Done today" }).textContent).toBe("D");
});

test("keys.fixed: moving around and the editor's keys can't be picked", async () => {
  const { user, panel } = await openKeys();
  const search = panel.getByRole("button", { name: "Search tasks" });
  await user.click(search);
  await user.keyboard("{ArrowDown}");
  expect(panel.getByRole("status").querySelector("p")!.textContent).toBe(
    "↓ always keeps its own meaning. Pick another key.",
  );
  expect(search.textContent).toBe("/");
  await user.click(search);
  await user.keyboard("2");
  expect(panel.getByRole("status").textContent).toContain("2 always keeps its own meaning");
});

test("keys.everywhere: the palette, the filter guide and tooltips name the key set now", async () => {
  const { user, panel } = await openKeys();
  await user.click(panel.getByRole("button", { name: "New task" }));
  await user.keyboard("n");
  const filter = panel.getByRole("button", { name: "Filter shortcuts" });
  await user.click(filter);
  await user.keyboard("{Shift>}f{/Shift}");
  expect(filter.textContent).toBe("ShiftF");
  // A changed key says so.
  panel.getByRole("button", { name: "Filter shortcuts (changed)" });

  await user.type(panel.getByRole("searchbox", { name: "Search actions or keys" }), "shift+f");
  panel.getByRole("button", { name: "Filter shortcuts (changed)" });
  expect(panel.queryByRole("button", { name: /^New task/ })).toBeNull();

  await user.keyboard("{Escape}");
  await expectListFocused();
  await user.keyboard("{Control>}k{/Control}");
  const palette = await screen.findByRole("dialog", { name: "Shortcuts and syntax" });
  const newTask = within(palette).getByRole("option", { name: /^New task/ });
  expect(newTask.textContent).toContain("N");
  expect(newTask.textContent).not.toContain("C");
  await user.keyboard("{Escape}");
  await expectListFocused();

  await user.keyboard("{Shift>}f{/Shift}");
  const guide = await waitFor(() => document.querySelector("[data-shortcut-guide='filter']")!);
  expect(guide.querySelector("[data-shortcut-key='Shift+F']")).not.toBeNull();
});
