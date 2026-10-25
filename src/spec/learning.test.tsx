import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { resetProgress } from "@/learning/progress";
import { AppWorkspace } from "@/testing/appWorkspace";
import { expectListFocused, focusedTitleField, row } from "@/testing/taskList";

let workspace: AppWorkspace;
beforeEach(async () => {
  // Pointer tips are remembered per session, which is this whole file.
  resetProgress();
  workspace = await AppWorkspace.start();
});
afterEach(async () => {
  await workspace.stop();
});

function learnedMoves(): string[] {
  return JSON.parse(localStorage.getItem("tasks.learnedMoves") ?? "[]") as string[];
}

function guide(): Element | null {
  return document.querySelector("[data-shortcut-guide=filter]");
}

async function openSettings(user: Awaited<ReturnType<AppWorkspace["render"]>>["user"]) {
  await user.keyboard("{Control>},{/Control}");
  return within(await screen.findByRole("dialog", { name: "Settings" }));
}

test("learn.panel: ? opens the Learn panel by chapter without taking focus, and ? closes it", async () => {
  await workspace.create("Task");
  const { user } = await workspace.render();
  await expectListFocused();
  await user.keyboard("?");
  const panel = await screen.findByRole("complementary", { name: "Learn" });
  expect(
    within(panel)
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent),
  ).toEqual(["Capture", "Editor", "Work", "Find", "Shape", "Look back"]);
  expect(panel.querySelector("[data-learn-count]")?.textContent).toMatch(
    /^0 of \d+ moves learned$/,
  );
  expect(panel.querySelector("[data-next]")?.getAttribute("data-move")).toBe("capture.open");
  await expectListFocused();
  await user.keyboard("?");
  expect(screen.queryByRole("complementary", { name: "Learn" })).toBeNull();
});

test("learn.nudge: the editor teaches one unlearned move, checks it once done, then moves on", async () => {
  const { user } = await workspace.render();
  await user.keyboard("c");
  const title = await focusedTitleField();
  const nudge = document.querySelector("[data-move-nudge]");
  expect(nudge?.getAttribute("data-move-nudge")).toBe("shorthand.category");
  expect(title.getAttribute("aria-describedby")).toBe(nudge?.id);
  expect(nudge?.hasAttribute("data-done")).toBe(false);
  await user.keyboard("Call mom @home ");
  await waitFor(() => expect(nudge?.hasAttribute("data-done")).toBe(true));
  await user.keyboard("{Enter}");
  // The optimistic row shows before the save is confirmed and the editor closes.
  await waitFor(() => expect(document.querySelector("[data-inline-task-editor]")).toBeNull());
  await expectListFocused();
  await user.keyboard("c");
  await focusedTitleField();
  expect(document.querySelector("[data-move-nudge]")?.getAttribute("data-move-nudge")).toBe(
    "shorthand.tags",
  );
});

test("learn.pointer-tip: the mouse names a move's keys once per session and never learns it", async () => {
  await workspace.create("A");
  await workspace.create("B");
  const { user } = await workspace.render();
  const glyph = (title: string) => row(title).querySelector("[data-status]")!;
  await user.click(glyph("A"));
  await screen.findByText("Next time, press Space");
  await user.click(glyph("B"));
  await waitFor(() => expect(glyph("B").getAttribute("data-status")).toBe("in_progress"));
  expect(screen.getAllByText("Next time, press Space")).toHaveLength(1);
  expect(learnedMoves()).not.toContain("status.forward");
  await user.keyboard(" ");
  await waitFor(() => expect(learnedMoves()).toContain("status.forward"));
});

test("learn.hesitation: the filter guide opens at once until a filter is chosen, then after a pause", async () => {
  await workspace.create("Task");
  const { user } = await workspace.render();
  await user.keyboard("f");
  await waitFor(() => expect(guide()).not.toBeNull());
  await user.keyboard("o");
  await waitFor(() => expect(guide()).toBeNull());
  expect(learnedMoves()).toContain("filter.mode");
  await user.keyboard("f");
  expect(guide()).toBeNull();
  await waitFor(() => expect(guide()).not.toBeNull(), { timeout: 2000 });
});

test("learn.reset: Reset progress in Settings forgets every learned move", async () => {
  await workspace.create("Task");
  const { user } = await workspace.render();
  await user.keyboard("v");
  const settings = await openSettings(user);
  settings.getByText(/^1 of \d+ moves learned$/);
  await user.click(settings.getByRole("button", { name: "Reset progress" }));
  await settings.findByText("Progress reset. Hints start over.");
  settings.getByText(/^0 of \d+ moves learned$/);
  expect(learnedMoves()).toEqual([]);
});

test("learn.hints-off: without hints the editor has no nudge and the Help icon no ring", async () => {
  const { user } = await workspace.render();
  expect(document.querySelector("[data-learn-progress]")).not.toBeNull();
  const settings = await openSettings(user);
  await user.click(settings.getByRole("checkbox", { name: "Show hints" }));
  expect(localStorage.getItem("tasks.hints")).toBe("off");
  expect(document.querySelector("[data-learn-progress]")).toBeNull();
  await user.keyboard("{Escape}");
  await user.keyboard("c");
  await screen.findByRole("textbox", { name: "Title" });
  expect(document.querySelector("[data-move-nudge]")).toBeNull();
});
