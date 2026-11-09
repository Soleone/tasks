import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { dayStart } from "@/goals";
import { WEEKDAYS, readSharedSettings } from "@/platform/sharedSettings";
import { AppWorkspace } from "@/testing/appWorkspace";
import { expectListFocused, expectRows } from "@/testing/taskList";

let workspace: AppWorkspace;
beforeEach(async () => {
  workspace = await AppWorkspace.start();
});
afterEach(async () => {
  await workspace.stop();
});

const doneCount = () => document.querySelector<HTMLElement>("[data-lens-count=done]");
const countLine = () => document.querySelector("[data-filter-summary]")?.textContent;

async function done(title: string, category?: string): Promise<void> {
  const task = await workspace.create(title, category ? { category } : {});
  await workspace.change("task.complete", task.id);
}

/** Today's weekday as the week's first, so a weekly goal spreads over all seven days. */
const today = () => WEEKDAYS[dayStart(readSharedSettings()).getDay()];

test("goals.header: open goals ring the count, met ones fold into a check, even at zero", async () => {
  await workspace.writeSharedSettings({
    colors: { life: "magenta" },
    goals: { life: { count: 1, per: "day" }, work: { count: 2, per: "day" } },
    otherGoal: { count: 3, per: "day" },
  });
  await workspace.create("Open");
  const { user } = await workspace.render({ home: true });
  await waitFor(() => expect(doneCount()?.getAttribute("aria-label")).toBe("0 done today"));
  expect(
    [...document.querySelectorAll("[data-goal-ring]")].map((ring) =>
      ring.getAttribute("data-goal-ring"),
    ),
  ).toEqual(["life", "work"]);

  await done("Called mom", "life");
  await done("Fixed the tap", "home");
  await user.keyboard("{Control>}{/Control}");
  await waitFor(() => expect(doneCount()?.getAttribute("aria-label")).toBe("2 done today"), {
    timeout: 4000,
  });
  await waitFor(() => expect(document.querySelector("[data-goal-ring=life]")).toBeNull());
  expect(document.querySelector("[data-goal-met] circle[data-swatch=magenta]")).not.toBeNull();

  await user.hover(doneCount()!);
  const tip = await screen.findByText("Done today");
  const lines = tip.closest("[data-slot=tooltip-content]")!.textContent;
  expect(lines).toContain("Done today2");
  expect(lines).toContain("@life✓1/1");
  expect(lines).toContain("Everything else1/3");
});

test("goals.celebrate: once every goal is met, the met check folds into the done count", async () => {
  await workspace.writeSharedSettings({
    goals: { life: { count: 1, per: "day" }, work: { count: 1, per: "day" } },
  });
  await done("Called mom", "life");
  const { user } = await workspace.render({ home: true });
  await waitFor(() => expect(document.querySelector("[data-goal-met]")).not.toBeNull());

  await done("Shipped it", "work");
  await user.keyboard("{Control>}{/Control}");
  await waitFor(() => expect(doneCount()?.getAttribute("aria-label")).toBe("2 done today"), {
    timeout: 4000,
  });
  expect(document.querySelector("[data-goal-rings]")).toBeNull();
});

test("goals.names: the only goal is All tasks and needs no small rings", async () => {
  await workspace.writeSharedSettings({ otherGoal: { count: 2, per: "day" } });
  await done("Anything", "home");
  const { user } = await workspace.render({ home: true });
  await waitFor(() => expect(doneCount()?.getAttribute("aria-label")).toBe("1 done today"));
  expect(document.querySelector("[data-goal-rings]")).toBeNull();
  await user.hover(doneCount()!);
  const tip = (await screen.findByText("Done today")).closest("[data-slot=tooltip-content]")!;
  expect(tip.textContent).toContain("All tasks1/2");
});

test("goals.tooltips: a weekly goal labels today and this week", async () => {
  await workspace.writeSharedSettings({
    goals: { work: { count: 14, per: "week" } },
    otherGoal: { count: 1, per: "day" },
    weekStartsOn: today(),
  });
  const { user } = await workspace.render({ home: true });
  const ring = await waitFor(() => {
    const found = document.querySelector<HTMLElement>("[data-goal-ring=work]");
    expect(found).not.toBeNull();
    return found!;
  });
  await user.hover(ring);
  const tip = (await screen.findByText("This week")).closest("[data-slot=tooltip-content]")!;
  expect(tip.textContent).toContain("Today0/2");
  expect(tip.textContent).toContain("This week0/14");

  await user.keyboard("d");
  const pill = await waitFor(() =>
    within(document.querySelector<HTMLElement>("[data-done-lens-goals]")!).getByRole("button", {
      name: /@work/,
    }),
  );
  await user.hover(pill);
  await waitFor(() =>
    expect(
      [...document.querySelectorAll("[data-slot=tooltip-content]")].some((content) =>
        content.textContent?.includes("This week0/14"),
      ),
    ).toBe(true),
  );
  expect(pill.closest("[title]")).toBeNull();
});

test("goals.lens: the done lens counts against the goals and narrows to one", async () => {
  await workspace.writeSharedSettings({
    goals: { life: { count: 2, per: "day" } },
    otherGoal: { count: 3, per: "day" },
  });
  await done("Called mom", "life");
  await done("Fixed the tap", "home");
  await done("Groceries");
  const { user } = await workspace.render({ home: true });
  await waitFor(() => expect(doneCount()?.getAttribute("aria-label")).toBe("3 done today"));
  await user.keyboard("d");
  await expectRows(["Groceries", "Fixed the tap", "Called mom"]);
  const goals = within(document.querySelector<HTMLElement>("[data-done-lens-goals]")!);
  await waitFor(() => expect(countLine()).toMatch(/^3 done today/));
  await user.click(goals.getByRole("button", { name: /Everything else/ }));
  await expectRows(["Groceries", "Fixed the tap"]);
  expect(countLine()).toMatch(/^2\/3 done today/);
  await user.click(goals.getByRole("button", { name: /@life/ }));
  await expectRows(["Called mom"]);
  await user.click(goals.getByRole("button", { name: /@life/ }));
  await expectRows(["Groceries", "Fixed the tap", "Called mom"]);
});

test("settings.goals: a number sets a goal, a day or a week, clearing it removes the goal", async () => {
  await workspace.create("Review", { category: "work" });
  const { user } = await workspace.render({ home: true });
  await user.keyboard("{Control>},{/Control}");
  await user.click(await screen.findByRole("tab", { name: "Goals" }));
  const other = await screen.findByRole("textbox", { name: "All tasks" });
  await user.type(other, "3");
  await user.click(screen.getByRole("combobox", { name: "Add a goal" }));
  await user.click(await screen.findByRole("option", { name: "@work" }));
  const work = await screen.findByRole("textbox", { name: "@work" });
  await waitFor(() => expect(document.activeElement).toBe(work));
  screen.getByRole("textbox", { name: "Everything else" });
  await user.clear(work);
  await user.type(work, "10");
  await user.click(
    within(screen.getByRole("radiogroup", { name: "@work per" })).getByRole("radio", {
      name: "a week",
    }),
  );
  await waitFor(async () =>
    expect(JSON.parse((await workspace.homeDocument("shared"))!)).toMatchObject({
      goals: { work: { count: 10, per: "week" } },
      otherGoal: { count: 3, per: "day" },
    }),
  );
  await user.clear(work);
  await user.tab();
  await waitFor(async () =>
    expect(JSON.parse((await workspace.homeDocument("shared"))!).goals).toEqual({}),
  );
});

test("settings.goals: a category goal's × removes it and focuses the next row", async () => {
  await workspace.writeSharedSettings({
    goals: { home: { count: 1, per: "day" }, work: { count: 2, per: "week" } },
    otherGoal: { count: 3, per: "day" },
  });
  const { user } = await workspace.render({ home: true });
  await user.keyboard("{Control>},{/Control}");
  await user.click(await screen.findByRole("tab", { name: "Goals" }));
  expect(screen.queryByRole("button", { name: "Remove Everything else goal" })).toBeNull();
  await user.click(await screen.findByRole("button", { name: "Remove @home goal" }));
  expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "@work" }));
  await waitFor(async () =>
    expect(JSON.parse((await workspace.homeDocument("shared"))!).goals).toEqual({
      work: { count: 2, per: "week" },
    }),
  );
  expect(screen.queryByRole("textbox", { name: "@home" })).toBeNull();
});

test("capture.log: L logs a task already done, at the time its pill says", async () => {
  await workspace.create("Open");
  const { user } = await workspace.render();
  await expectListFocused();
  await user.keyboard("l");
  await user.keyboard("Ran 5k");
  await user.tab();
  expect(document.activeElement?.getAttribute("data-logged-when")).toBe("now");
  await user.keyboard("{ArrowRight}{ArrowRight}");
  expect(document.activeElement?.getAttribute("data-logged-when")).toBe("yesterday");
  await user.keyboard("{Enter}");
  await waitFor(async () => {
    const { tasks } = await workspace.cli<{
      tasks: { title: string; status: string; closedAt: string }[];
    }>("task.list", { status: "done" });
    expect(tasks.map((task) => task.title)).toEqual(["Ran 5k"]);
    const closed = new Date(tasks[0].closedAt);
    expect(closed.getHours()).toBe(12);
    expect(Date.now() - closed.getTime()).toBeGreaterThan(12 * 60 * 60 * 1000);
  });
});
