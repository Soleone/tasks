import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { AppWorkspace } from "@/testing/appWorkspace";
import { announcements, expectActive } from "@/testing/taskList";

let workspace: AppWorkspace;
beforeEach(async () => {
  workspace = await AppWorkspace.start();
});
afterEach(async () => {
  await workspace.stop();
});

describe("pickers", () => {
  function options(): string[] {
    return within(screen.getByRole("dialog"))
      .queryAllByRole("option")
      .map((option) => option.textContent ?? "");
  }

  test("pick.parent: M then choosing a task nests the active task under it", async () => {
    const parent = await workspace.create("Parent @literal");
    const child = await workspace.create("Loose #literal");
    const { user } = await workspace.render();
    await expectActive("Loose #literal");
    await user.keyboard("m");
    await screen.findByRole("dialog", { name: "Move Loose #literal under…" });
    await waitFor(() =>
      expect(options().some((option) => option.includes("Parent @literal"))).toBe(true),
    );
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
    expect(
      options().some((option) => option.includes("Finished") || option.includes("Dropped")),
    ).toBe(false);
    await user.keyboard("Blocker{Enter}");
    await waitFor(async () =>
      expect((await workspace.task(task.id)).dependencyIds).toEqual([blocker.id]),
    );
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

  test("pick.refusals: backend preview refuses a cycle before an executing mutation", async () => {
    const first = await workspace.create("First");
    const second = await workspace.create("Second");
    await workspace.change("task.dependency.add", first.id, { dependsOnId: second.id });
    const { user } = await workspace.render();
    await expectActive("Second");
    await user.keyboard("b");
    await screen.findByRole("dialog");
    await user.keyboard("First");
    await waitFor(() =>
      expect(
        within(screen.getByRole("dialog"))
          .getByRole("option", { name: /First/ })
          .getAttribute("aria-selected"),
      ).toBe("true"),
    );
    await user.keyboard("{Enter}");
    await waitFor(() => expect(announcements()).toMatch(/cycle|refused|can't|cannot/i));
    expect((await workspace.task(second.id)).dependencyIds).toEqual([]);
  });
});
