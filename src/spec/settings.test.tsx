import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { AppWorkspace } from "@/testing/appWorkspace";
import { expectListFocused, expectRows } from "@/testing/taskList";

let workspace: AppWorkspace;
beforeEach(async () => {
  workspace = await AppWorkspace.start();
});
afterEach(async () => {
  await workspace.stop();
});

test("settings.open: Ctrl+, opens Settings with focus on its tabs", async () => {
  await workspace.create("Task");
  const { user } = await workspace.render();
  await expectListFocused();
  await user.keyboard("{Control>},{/Control}");
  await waitFor(() => expect(document.activeElement?.getAttribute("role")).toBe("tab"));
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["General", "Data"]);
  const settings = within(screen.getByRole("dialog", { name: "Settings" }));
  expect(settings.queryByText("Theme", { exact: true })).toBeNull();
  expect(settings.queryByRole("combobox", { name: /theme/i })).toBeNull();
  await user.tab();
  expect(document.activeElement).toBe(settings.getByRole("slider", { name: "Font size" }));
});

test("settings.close: Escape closes Settings and returns focus to the list", async () => {
  await workspace.create("Task");
  const { user } = await workspace.render();
  await user.keyboard("{Control>},{/Control}");
  await screen.findByRole("tab", { name: "General" });
  await user.keyboard("{Escape}");
  await expectListFocused();
});

test("settings.tabs: Left and Right switch sections", async () => {
  const { user } = await workspace.render();
  await user.keyboard("{Control>},{/Control}");
  await waitFor(() => expect(document.activeElement?.textContent).toBe("General"));
  await user.keyboard("{ArrowRight}");
  await waitFor(() => expect(document.activeElement?.textContent).toBe("Data"));
  const panel = within(screen.getByRole("tabpanel"));
  panel.getByRole("heading", { name: "Tasks home" });
  expect(panel.queryByRole("button", { name: "Archive tasks…" })).toBeNull();
  expect(panel.queryByRole("heading", { name: "Launch time" })).toBeNull();
  expect(panel.queryByRole("heading", { name: "Local" })).toBeNull();
  expect(panel.queryByText("Local cache", { exact: true })).toBeNull();
  await user.keyboard("{ArrowLeft}");
  await waitFor(() => expect(document.activeElement?.textContent).toBe("General"));
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("slider", { name: "Font size" }));
  await user.tab({ shift: true });
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "General" }));
});

test("settings.home: Data shows the home and copies its sync folder's path", async () => {
  const { user } = await workspace.render();
  await user.keyboard("{Control>},{/Control}");
  await user.click(await screen.findByRole("tab", { name: "Data" }));
  const panel = within(screen.getByRole("tabpanel"));
  panel.getByText(/Add only this sync folder to Syncthing, not the Tasks home/);
  await user.click(panel.getByRole("button", { name: "Copy path" }));
  await panel.findByText("Sync folder path copied.");
  expect(await navigator.clipboard.readText()).toMatch(/[\\/]sync$/);
  // The web client has no file manager to open.
  expect(panel.queryByRole("button", { name: "Open folder" })).toBeNull();
});

async function openData(user: Awaited<ReturnType<AppWorkspace["render"]>>["user"]) {
  await user.keyboard("{Control>},{/Control}");
  await user.click(await screen.findByRole("tab", { name: "Data" }));
  return within(screen.getByRole("region", { name: "Delete tasks" }));
}

test("settings.delete-canceled: counts canceled tasks and deletes them after asking", async () => {
  await workspace.create("Keep");
  const drop = await workspace.create("Drop");
  await workspace.change("task.cancel", drop.id);
  const { user } = await workspace.render();
  const section = await openData(user);
  await section.findByText("1 canceled task, kept until you delete them.");
  await user.click(section.getByRole("button", { name: "Delete canceled tasks" }));
  section.getByText("Delete 1 canceled task for good? This can't be undone.");
  await user.click(section.getByRole("button", { name: "Delete 1 task" }));
  await section.findByText("Deleted 1 canceled task.");
  await section.findByText("There are no canceled tasks.");
  expect(section.getByRole("button", { name: "Delete canceled tasks" })).toHaveProperty(
    "disabled",
    true,
  );
  await expect(workspace.task(drop.id)).rejects.toThrow(/TASK_NOT_FOUND/);
});

test("settings.delete-canceled: links to canceled tasks are named and nothing is deleted", async () => {
  const blocker = await workspace.create("Old blocker");
  const blocked = await workspace.create("Still open");
  await workspace.change("task.dependency.add", blocked.id, { dependsOnId: blocker.id });
  await workspace.change("task.cancel", blocker.id);
  const { user } = await workspace.render();
  const section = await openData(user);
  await section.findByText("“Still open” is blocked by canceled “Old blocker”");
  expect(section.getByRole("button", { name: "Delete canceled tasks" })).toHaveProperty(
    "disabled",
    true,
  );
  expect((await workspace.task(blocker.id)).status).toBe("canceled");
});

test("settings.delete-done: the dialog previews both choices and deletes the chosen one", async () => {
  const image = await workspace.storeImage(1);
  const finished = await workspace.create("Finished", { attachments: [image] });
  await workspace.change("task.complete", finished.id);
  await workspace.create("Open");
  const { user } = await workspace.render();
  const section = await openData(user);
  await user.click(section.getByRole("button", { name: "Delete done tasks…" }));
  const dialog = within(await screen.findByRole("dialog", { name: "Delete done tasks" }));
  dialog.getByText(/can't be undone/);
  await dialog.findByText(/^0 tasks · 0 images/);
  await user.click(dialog.getByRole("combobox", { name: "Done" }));
  await user.click(await screen.findByRole("option", { name: "any time" }));
  await dialog.findByText(/^1 task · 1 image · /);
  dialog.getByText(/^1 image · /);
  await user.click(dialog.getByRole("radio", { name: /Images only/ }));
  await user.click(dialog.getByRole("button", { name: "Delete" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Delete done tasks" })).toBeNull(),
  );
  await section.findByText(/^Deleted 1 image \(.+\) from 1 done task\.$/);
  const kept = await workspace.task(finished.id);
  expect(kept.status).toBe("done");
  expect(kept.attachments).toEqual([]);
});

test("settings.delete-result: the result names the export and what was kept", async () => {
  const parent = await workspace.create("Done parent");
  const loose = await workspace.create("Done loose");
  await workspace.create("Open child", { parentId: parent.id });
  await workspace.change("task.complete", parent.id);
  await workspace.change("task.complete", loose.id);
  const { user } = await workspace.render();
  const section = await openData(user);
  await user.click(section.getByRole("button", { name: "Delete done tasks…" }));
  const dialog = within(await screen.findByRole("dialog", { name: "Delete done tasks" }));
  await user.click(dialog.getByRole("combobox", { name: "Done" }));
  await user.click(await screen.findByRole("option", { name: "any time" }));
  await dialog.findByText(/^1 task · 0 images/);
  await user.click(dialog.getByRole("button", { name: "Export and delete" }));
  await section.findByText(
    /^Deleted 1 done task and 0 images \(.+\)\. 1 task kept because other tasks link to them\.$/,
  );
  section.getByText(/[\\/]exports[\\/]done-tasks-.+\.zip$/);
  // The web client has no file manager to open.
  expect(section.queryByRole("button", { name: "Open folder" })).toBeNull();
  await expect(workspace.task(loose.id)).rejects.toThrow(/TASK_NOT_FOUND/);
  expect((await workspace.task(parent.id)).status).toBe("done");
});

test("help.palette: Ctrl+K opens a searchable palette of shortcuts", async () => {
  await workspace.create("Task");
  const { user } = await workspace.render();
  await user.keyboard("{Control>}k{/Control}");
  const dialog = await screen.findByRole("dialog", { name: "Shortcuts and syntax" });
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
});

test("home.dialog-return: closing the palette returns focus to the list", async () => {
  await workspace.create("Task");
  const { user } = await workspace.render();
  await user.keyboard("{Control>}k{/Control}");
  await screen.findByRole("dialog", { name: "Shortcuts and syntax" });
  await user.keyboard("{Escape}");
  await expectListFocused();
});

test("theme.picker: Alt+T opens the shared ring, selection persists and focus returns", async () => {
  const task = await workspace.create("Task");
  const { user } = await workspace.render();
  await expectListFocused();
  // Plain D opens Done today now; neither key may open the theme ring.
  await user.keyboard("td");
  expect(screen.queryByRole("listbox", { name: "Themes" })).toBeNull();
  expect(document.documentElement.dataset.theme).toBe("gilt");
  await user.keyboard("{Alt>}t{/Alt}");
  const ring = await screen.findByRole("listbox", { name: "Themes" });
  await waitFor(() => expect(document.activeElement).toBe(ring));
  expect(ring.getAttribute("aria-activedescendant")).toBe("theme-card-gilt");
  await user.keyboard("latte");
  expect(document.documentElement.dataset.theme).toBe("gilt");
  await user.keyboard("{Enter}");
  await waitFor(() => expect(document.documentElement.dataset.theme).toBe("catppuccin-latte"));
  expect(localStorage.getItem("tasks.selectedTheme")).toBe("catppuccin-latte");
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  await expectListFocused();
  expect(await workspace.task(task.id)).toEqual(task);
  await user.keyboard("{Alt>}t{/Alt}");
  await screen.findByRole("listbox", { name: "Themes" });
  expect(ring.getAttribute("aria-activedescendant")).toBe("theme-card-catppuccin-latte");
  await user.keyboard("{Escape}");
  await expectListFocused();
});

test("theme.select: the dedicated picker remembers the selection across reloads", async () => {
  await workspace.create("Task");
  const first = await workspace.render();
  await first.user.click(screen.getByRole("button", { name: "Themes" }));
  const ring = await screen.findByRole("listbox", { name: "Themes" });
  await waitFor(() => expect(document.activeElement).toBe(ring));
  await first.user.keyboard("latte{Enter}");
  await waitFor(() => expect(localStorage.getItem("tasks.selectedTheme")).toBe("catppuccin-latte"));
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  await expectListFocused();
  first.view.unmount();
  const second = await workspace.render();
  await second.user.keyboard("{Alt>}t{/Alt}");
  const reopened = await screen.findByRole("listbox", { name: "Themes" });
  await waitFor(() =>
    expect(reopened.getAttribute("aria-activedescendant")).toBe("theme-card-catppuccin-latte"),
  );
  expect(document.documentElement.classList.contains("dark")).toBe(false);
});

test("theme.picker: help opens the ring without losing the list return target", async () => {
  await workspace.create("Task");
  const { user } = await workspace.render();
  await expectListFocused();
  await user.keyboard("{Control>}k{/Control}themes{Enter}");
  await screen.findByRole("listbox", { name: "Themes" });
  await user.keyboard("{Escape}");
  await expectListFocused();
});

test("home.dialog-return: the prewarmed hidden theme dialog does not block capture", async () => {
  await workspace.create("Task");
  const { user } = await workspace.render();
  await expectListFocused();
  await waitFor(() => expect(document.querySelector('[role="dialog"][hidden]')).not.toBeNull(), {
    timeout: 5000,
  });
  await user.keyboard("c");
  await screen.findByRole("form", { name: "New task" });
});

test("prefs.remembered: sort and Details survive a reload", async () => {
  await workspace.create("Low", { priority: 4 });
  await workspace.create("Urgent", { priority: 0 });
  const first = await workspace.render();
  await first.user.keyboard("sp{Shift>}v{/Shift}");
  await expectRows(["Urgent", "Low"]);
  first.view.unmount();
  await workspace.render();
  await waitFor(() =>
    expect(
      document.querySelector("[data-sort=task-sort-menu]")?.getAttribute("data-sort-field"),
    ).toBe("priority"),
  );
  expect(document.querySelector("[data-view=task-details]")?.getAttribute("aria-pressed")).toBe(
    "true",
  );
});
