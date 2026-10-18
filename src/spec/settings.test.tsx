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
  for (const name of ["General", "Shortcuts", "Data"]) screen.getByRole("tab", { name });
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
  await waitFor(() => expect(document.activeElement?.textContent).toBe("Shortcuts"));
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

test("help.starter: ? opens the starter help panel", async () => {
  await workspace.create("Task");
  const { user } = await workspace.render();
  await user.keyboard("?");
  await screen.findByRole("button", { name: "Close help" });
});

test("theme.picker: Alt+T opens the theme picker", async () => {
  await workspace.create("Task");
  const { user } = await workspace.render();
  await user.keyboard("{Alt>}t{/Alt}");
  await screen.findByRole("dialog", { name: "Themes" });
});

test("theme.select: the dedicated picker applies a theme and remembers it across reloads", async () => {
  const first = await workspace.render();
  await first.user.click(screen.getByRole("button", { name: "Themes" }));
  const picker = within(await screen.findByRole("dialog", { name: "Themes" }));
  await first.user.type(picker.getByRole("combobox"), "Catppuccin Latte");
  await first.user.click(await picker.findByRole("option", { name: /Catppuccin Latte/ }));
  await waitFor(() => expect(localStorage.getItem("tasks.selectedTheme")).toBe("catppuccin-latte"));
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  first.view.unmount();
  const second = await workspace.render();
  await second.user.keyboard("{Alt>}t{/Alt}");
  const reopened = within(await screen.findByRole("dialog", { name: "Themes" }));
  await reopened.findByRole("option", { name: /Catppuccin Latte.*Active/ });
  expect(document.documentElement.classList.contains("dark")).toBe(false);
});

test("prefs.remembered: sort and Details survive a reload", async () => {
  await workspace.create("Low", { priority: 4 });
  await workspace.create("Urgent", { priority: 0 });
  const first = await workspace.render();
  await first.user.keyboard("spv");
  await expectRows(["Urgent", "Low"]);
  first.view.unmount();
  await workspace.render();
  await waitFor(() =>
    expect(
      document.querySelector("[data-sort=task-sort-priority]")?.getAttribute("aria-pressed"),
    ).toBe("true"),
  );
  expect(document.querySelector("[data-view=task-details]")?.getAttribute("aria-pressed")).toBe(
    "true",
  );
});
