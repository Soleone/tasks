import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { resetProgress } from "@/learning/progress";
import { AppWorkspace, pngBytes } from "@/testing/appWorkspace";
import {
  activeTitle,
  expectActive,
  expectListFocused,
  expectRows,
  focusedTitleField,
  row,
} from "@/testing/taskList";

let workspace: AppWorkspace;
beforeEach(async () => {
  // Rewards on screen and editor steps done ahead live for the whole file.
  resetProgress();
  workspace = await AppWorkspace.start();
});
afterEach(async () => {
  await workspace.stop();
});

type User = Awaited<ReturnType<AppWorkspace["render"]>>["user"];

function learnedMoves(): string[] {
  return JSON.parse(localStorage.getItem("tasks.learnedMoves") ?? "[]") as string[];
}

function card(): HTMLElement | null {
  return document.querySelector("[data-quest-card]");
}

function questLine(): string | null | undefined {
  return card()?.querySelector("[data-quest-line]")?.textContent;
}

function questHint(): string | null | undefined {
  return card()?.querySelector("[data-quest-hint]")?.textContent;
}

async function expectStep(step: number): Promise<void> {
  await waitFor(() => expect(card()?.getAttribute("data-quest-step")).toBe(String(step)));
}

function guide(): Element | null {
  return document.querySelector("[data-shortcut-guide=filter]");
}

async function openSettings(user: User) {
  await user.keyboard("{Control>},{/Control}");
  return within(await screen.findByRole("dialog", { name: "Settings" }));
}

async function openPanel(user: User) {
  await user.keyboard("?");
  return within(await screen.findByRole("complementary", { name: "Learn" }));
}

async function saveEditor(user: User): Promise<void> {
  await user.keyboard("{Enter}");
  // The optimistic row shows before the save is confirmed and the editor closes.
  await waitFor(() => expect(document.querySelector("[data-inline-task-editor]")).toBeNull());
  await expectListFocused();
}

test("quest.offer: a fresh app offers Task basics, and doing its first step starts it", async () => {
  const { user } = await workspace.render();
  await waitFor(() => expect(card()?.getAttribute("data-quest-card")).toBe("first-task"));
  expect(questLine()).toBe("Press C to create your first task");
  expect(questHint()).toBe("Create, tag and complete a task in about two minutes");
  expect(card()?.hasAttribute("data-quest-step")).toBe(false);
  await user.click(within(card()!).getByRole("button", { name: "All quests" }));
  await screen.findByRole("complementary", { name: "Learn" });
  await user.keyboard("?");
  await user.keyboard("c");
  await focusedTitleField();
  await expectStep(1);
  expect(questLine()).toBe("New task");
});

test("quest.step: Task basics by keys, with a success line naming what was typed", async () => {
  const { user } = await workspace.render();
  await user.keyboard("c");
  await focusedTitleField();
  await expectStep(1);
  await user.keyboard("Call mom @life ");
  await expectStep(2);
  expect(questLine()).toBe("Filed under life");
  await user.keyboard("#quick ");
  await expectStep(3);
  expect(questLine()).toBe("Tagged quick");
  await saveEditor(user);
  await expectStep(4);
  expect(questLine()).toBe("Saved");
  const glyph = () => row("Call mom").querySelector("[data-status]");
  await user.keyboard(" ");
  await expectStep(5);
  expect(questLine()).toBe("In progress");
  await waitFor(() => expect(glyph()?.getAttribute("data-status")).toBe("in_progress"));
  await user.keyboard(" ");
  await expectStep(6);
  expect(questLine()).toBe("Done");
  expect(learnedMoves()).toEqual(
    expect.arrayContaining([
      "capture.open",
      "shorthand.category",
      "shorthand.tags",
      "capture.save",
      "status.forward",
    ]),
  );
});

test("quest.step: editor steps done out of turn still count", async () => {
  const { user } = await workspace.render();
  await user.keyboard("c");
  await expectStep(1);
  await user.keyboard("Call mom #quick ");
  expect(card()?.getAttribute("data-quest-step")).toBe("1");
  await waitFor(() => expect(questLine()).toBe("Tagged quick"));
  await user.keyboard("@life ");
  await expectStep(3);
});

test("quest.step: Enter right after the tag saves, finishing the tag and save steps at once", async () => {
  const { user } = await workspace.render();
  await user.keyboard("c");
  await user.keyboard("Call mom @life #quick");
  await saveEditor(user);
  await expectStep(4);
  expect(questLine()).toBe("Saved");
});

test("quest.step: a description counts even when the task has one, then an image, and Ctrl+Enter saves", async () => {
  await workspace.create("Task", { description: "Already here" });
  startAt("fast-hands", 4);
  const { user } = await workspace.render();
  await expectStep(4);
  await user.keyboard("{Enter}");
  await focusedTitleField();
  await user.keyboard("{Tab}{Tab} more");
  await expectStep(5);
  expect(questLine()).toBe("Description added");
  const image = new File([new Uint8Array(pngBytes())], "shot.png", { type: "image/png" });
  fireEvent.paste(document.activeElement!, {
    clipboardData: { files: [image], getData: () => "" },
  });
  await expectStep(6);
  await user.keyboard("{Control>}{Enter}{/Control}");
  await expectStep(7);
});

function startAt(quest: string, step: number, complete: string[] = []): void {
  localStorage.setItem(
    "tasks.questProgress",
    JSON.stringify({ active: quest, steps: { [quest]: step }, complete }),
  );
}

test("quest.step: Change of plans pauses, undoes and cancels only its own practice task", async () => {
  const real = await workspace.create("Real task");
  startAt("change-of-plans", 0);
  const { user } = await workspace.render();
  await user.keyboard("c");
  await focusedTitleField();
  await user.keyboard("Practice");
  await saveEditor(user);
  await expectStep(2);
  await expectActive("Practice");
  await user.keyboard(" ");
  await expectStep(3);
  await user.keyboard("{Shift>} {/Shift}");
  await expectStep(4);
  await user.keyboard("p");
  await expectStep(5);
  await expectRows(["Real task"]);
  await user.keyboard("{Control>}z{/Control}");
  await expectStep(6);
  await expectActive("Practice");
  await user.keyboard("{Delete}");
  await waitFor(() =>
    expect(document.querySelector("[data-quest-complete=change-of-plans]")).not.toBeNull(),
  );
  await expectRows(["Real task"]);
  expect((await workspace.task(real.id)).status).toBe("open");
});

test("quest.step: Shape your list collapses the new child's parent, then expands it past its category", async () => {
  await workspace.create("Parent", { category: "work" });
  startAt("shape-your-list", 0);
  const { user } = await workspace.render();
  await expectActive("Parent");
  await user.keyboard("{Shift>}c{/Shift}");
  await focusedTitleField();
  await user.keyboard("Child");
  await saveEditor(user);
  await expectStep(2);
  await expectActive("Child");
  await user.keyboard("{ArrowLeft}{ArrowLeft}");
  await expectStep(3);
  await expectRows(["Parent"]);
  await user.keyboard("{ArrowRight}");
  expect(card()?.getAttribute("data-quest-step")).toBe("3");
  await user.keyboard("{ArrowRight}");
  await expectStep(4);
  await expectRows(["Parent", "Child"]);
  expect(activeTitle()).toBe("Parent");
});

test("quest.complete: the last quest, ending on Shift+V after the palette, is the finale and leaves the plain help icon", async () => {
  await workspace.create("Task", { description: "Notes" });
  startAt("fast-hands", 7, [
    "first-task",
    "plan-ahead",
    "change-of-plans",
    "find-your-way",
    "shape-your-list",
  ]);
  const { user } = await workspace.render();
  await expectStep(7);
  await user.keyboard("{Control>}k{/Control}");
  await screen.findByRole("dialog");
  await expectStep(8);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await user.keyboard("v");
  await expectStep(9);
  await user.keyboard("{Shift>}v{/Shift}");
  const finale = await waitFor(() => {
    const element = document.querySelector("[data-quest-complete=fast-hands][data-quest-finale]");
    expect(element).not.toBeNull();
    return element as HTMLElement;
  });
  within(finale).getByText("Every quest complete");
  const helpIcon = () => screen.getByRole("button", { name: "Learn" }).querySelector("svg");
  expect(helpIcon()?.hasAttribute("data-learn-finale")).toBe(true);
  expect(helpIcon()?.getAttribute("data-learn-progress")).toBe("1.00");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(finale.isConnected).toBe(false));
  expect(document.querySelector("[data-learn-progress]")).toBeNull();
});

test("quest.success: a step's line keeps showing for about a second and a half, then the next prompt", async () => {
  const { user } = await workspace.render();
  await user.keyboard("c");
  await expectStep(1);
  expect(questLine()).toBe("New task");
  expect(card()?.querySelectorAll("[data-step-done]")).toHaveLength(1);
  await waitFor(() => expect(questLine()).toMatch(/^Type what needs doing/), { timeout: 3000 });
});

test("quest.complete: the recap names the next quest, then the card leaves and offers it without starting it", async () => {
  await workspace.create("Task");
  localStorage.setItem(
    "tasks.questProgress",
    JSON.stringify({ active: "first-task", steps: { "first-task": 6 }, complete: [] }),
  );
  const { user } = await workspace.render();
  await expectStep(6);
  await user.keyboard("d");
  await expectStep(7);
  expect(questLine()).toBe("Done today");
  await waitFor(() => expect(questLine()).toBe("Press D again to go back to your previous view"), {
    timeout: 3000,
  });
  await user.keyboard("d");
  const complete = await waitFor(() => {
    const element = document.querySelector("[data-quest-complete=first-task]");
    expect(element).not.toBeNull();
    return element as HTMLElement;
  });
  within(complete).getByText("Task basics complete");
  const learnIcon = () => screen.getByRole("button", { name: "Learn" }).querySelector("svg");
  expect(learnIcon()?.hasAttribute("data-learn-celebrate")).toBe(true);
  within(complete).getByText("Next: Plan ahead, whenever you like");
  await waitFor(() => within(complete).getByText("D"));
  expect(card()).toBeNull();
  const panel = await openPanel(user);
  expect(complete.hasAttribute("data-quest-leaving")).toBe(true);
  expect(learnIcon()?.hasAttribute("data-learn-celebrate")).toBe(false);
  await waitFor(() => expect(complete.isConnected).toBe(false));
  expect(panel.getByRole("region", { name: "Task basics" }).getAttribute("data-quest-state")).toBe(
    "complete",
  );
  expect(panel.getByRole("region", { name: "Plan ahead" }).getAttribute("data-quest-state")).toBe(
    "new",
  );
  await user.keyboard("?");
  await waitFor(() => expect(card()?.getAttribute("data-quest-card")).toBe("plan-ahead"));
  expect(questLine()).toBe("Press C for a new task");
  expect(questHint()).toBe("Due dates, priorities and what's due now");
  await user.keyboard("c");
  await expectStep(1);
});

test("quest.pointer: the mouse finishes a step but names its keys and doesn't learn them", async () => {
  await workspace.create("Task");
  localStorage.setItem(
    "tasks.questProgress",
    JSON.stringify({ active: "first-task", steps: { "first-task": 4 }, complete: [] }),
  );
  const { user } = await workspace.render();
  await expectStep(4);
  await user.click(row("Task").querySelector("[data-status]")!);
  await expectStep(5);
  expect(card()?.querySelector("[data-quest-try]")?.textContent).toBe("Next time, try Space");
  expect(learnedMoves()).not.toContain("status.forward");
});

test("quest.pause: Later puts the offer aside with a friendly toast, and nothing asks again", async () => {
  await workspace.create("Task");
  const { user } = await workspace.render();
  await waitFor(() => expect(card()).not.toBeNull());
  await user.click(within(card()!).getByRole("button", { name: "Later" }));
  await screen.findByText("Quest paused. Pick it up from ? whenever you like.");
  expect(card()).toBeNull();
  await expectListFocused();
  await user.keyboard("c");
  await focusedTitleField();
  expect(card()).toBeNull();
  await user.keyboard("{Escape}");
  const panel = await openPanel(user);
  panel.getByText("Paused at step 1 of 8");
});

test("quest.reopen: saving before the tag keeps the category, and the edited task takes the tag", async () => {
  const { user } = await workspace.render();
  await user.keyboard("c");
  await user.keyboard("Call mom @life");
  await saveEditor(user);
  await expectStep(2);
  expect(questLine()).toBe("Filed under life");
  await waitFor(
    () => expect(questLine()).toBe("Press Enter to open the active task, or C for a new one"),
    { timeout: 3000 },
  );
  expect(card()?.hasAttribute("data-quest-reopen")).toBe(true);
  await user.keyboard("{Enter}");
  await focusedTitleField();
  await waitFor(() => expect(questLine()).toBe("Add a tag with #, like #quick"));
  expect(questHint()).toBe("Space turns it into a pill");
  await user.keyboard(" #quick");
  await saveEditor(user);
  await expectStep(4);
});

test("quest.reopen: an editor step left by Escape waits for any editor to open", async () => {
  const { user } = await workspace.render();
  await user.keyboard("c");
  await user.keyboard("Call mom @life ");
  await expectStep(2);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(card()?.hasAttribute("data-quest-reopen")).toBe(true));
  await expectStep(2);
  await user.keyboard("c");
  await focusedTitleField();
  expect(card()?.hasAttribute("data-quest-reopen")).toBe(false);
  await expectStep(2);
});

test("quest.resume: Resume in the Learn panel brings the card back where it was left", async () => {
  await workspace.create("Task");
  localStorage.setItem(
    "tasks.questProgress",
    JSON.stringify({ active: null, steps: { "first-task": 4 }, complete: [] }),
  );
  const { user } = await workspace.render();
  const panel = await openPanel(user);
  panel.getByText("Paused at step 5 of 8");
  await user.click(panel.getByRole("button", { name: "Resume" }));
  expect(screen.queryByRole("complementary", { name: "Learn" })).toBeNull();
  await expectStep(4);
  expect(questLine()).toBe("Press Space to start the task");
  await expectListFocused();
});

test("quest.one-at-a-time: starting a quest puts the one under way aside, quietly", async () => {
  const { user } = await workspace.render();
  await user.keyboard("c");
  await user.keyboard("{Escape}");
  await expectStep(1);
  const panel = await openPanel(user);
  await user.click(
    within(panel.getByRole("region", { name: "Plan ahead" })).getByRole("button", {
      name: "Start",
    }),
  );
  await waitFor(() => expect(card()?.getAttribute("data-quest-card")).toBe("plan-ahead"));
  expect(screen.queryByText(/^Quest paused/)).toBeNull();
  const reopened = await openPanel(user);
  reopened.getByText("Paused at step 2 of 8");
});

test("learn.panel: ? opens the quest log without taking focus, and ? closes it", async () => {
  await workspace.create("Task");
  const { user } = await workspace.render();
  await expectListFocused();
  const panel = await openPanel(user);
  expect(panel.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(
    [
      "Task basics",
      "Plan ahead",
      "Change of plans",
      "Find your way",
      "Shape your list",
      "Fast hands",
    ],
  );
  expect(panel.getAllByText("New")).toHaveLength(6);
  expect(
    within(panel.getByRole("region", { name: "Task basics" }))
      .getAllByRole("listitem")
      .map((item) => item.getAttribute("data-move")),
  ).toEqual([
    "capture.open",
    "shorthand.category",
    "shorthand.tags",
    "capture.save",
    "status.forward",
    "done.lens",
  ]);
  await expectListFocused();
  await user.keyboard("?");
  expect(screen.queryByRole("complementary", { name: "Learn" })).toBeNull();
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

test("learn.reset: Reset progress forgets learned moves and quests, so the offer returns", async () => {
  await workspace.create("Task");
  const { user } = await workspace.render();
  await user.click(within(card()!).getByRole("button", { name: "Later" }));
  await user.keyboard("v");
  const settings = await openSettings(user);
  settings.getByText(/^1 of \d+ moves learned$/);
  await user.click(settings.getByRole("button", { name: "Reset progress" }));
  await settings.findByText("Progress reset. Quests start over.");
  settings.getByText(/^0 of \d+ moves learned$/);
  expect(learnedMoves()).toEqual([]);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(card()?.getAttribute("data-quest-card")).toBe("first-task"));
});

test("learn.quests: with quests off there is no offer or ring, but the panel still starts one", async () => {
  const { user } = await workspace.render();
  expect(document.querySelector("[data-learn-progress]")).not.toBeNull();
  const settings = await openSettings(user);
  await user.click(settings.getByRole("checkbox", { name: "Show quests" }));
  expect(localStorage.getItem("tasks.showQuests")).toBe("off");
  await user.keyboard("{Escape}");
  expect(card()).toBeNull();
  expect(document.querySelector("[data-learn-progress]")).toBeNull();
  const panel = await openPanel(user);
  await user.click(
    within(panel.getByRole("region", { name: "Task basics" })).getByRole("button", {
      name: "Start",
    }),
  );
  await expectStep(0);
});
