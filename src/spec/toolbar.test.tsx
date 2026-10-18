import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { AppWorkspace } from "@/testing/appWorkspace";
import { expectListFocused, expectRows } from "@/testing/taskList";

let workspace: AppWorkspace;
beforeEach(async () => {
  workspace = await AppWorkspace.start();
});
afterEach(async () => {
  await workspace.stop();
});

function pressed(selector: string): string | null {
  return document.querySelector(selector)?.getAttribute("aria-pressed") ?? null;
}

function countLine(): string {
  return document.querySelector("[data-filter-summary]")?.textContent ?? "";
}

describe("count line", () => {
  test("count.line: one line reports the matching count and never mentions sort", async () => {
    await workspace.create("A");
    await workspace.create("B");
    const { user } = await workspace.render();
    await waitFor(() => expect(countLine()).toBe("2 active tasks"));
    await user.keyboard("sp");
    await waitFor(() => expect(pressed("[data-sort=task-sort-priority]")).toBe("true"));
    expect(countLine()).toBe("2 active tasks");
  });

  test("count.clear-one: clicking a filter in the count line resets only that filter", async () => {
    await workspace.create("Low", { priority: 4 });
    await workspace.create("Urgent", { priority: 0, tags: ["x"] });
    const { user } = await workspace.render();
    await user.keyboard("f0");
    await expectRows(["Urgent"]);
    await user.keyboard("{Escape}");
    await expectRows(["Urgent", "Low"]);
    await user.keyboard("f0fu");
    await waitFor(() => expect(pressed("[data-filter=task-unblocked]")).toBe("true"));
    const priority = screen
      .getAllByRole("button")
      .find(
        (button) => button.closest("[data-filter-summary]") && /P0/.test(button.textContent ?? ""),
      );
    expect(priority).toBeDefined();
    await user.click(priority!);
    await waitFor(() => expect(pressed("[data-filter=task-priority]")).toBe("false"));
    expect(pressed("[data-filter=task-unblocked]")).toBe("true");
  });
});

describe("touch feedback", () => {
  const tooltip = { selector: "[data-slot=tooltip-content][data-open]" };
  async function tap(
    selector: string,
    user: Awaited<ReturnType<AppWorkspace["render"]>>["user"],
  ): Promise<void> {
    const target = document.querySelector<HTMLButtonElement>(selector)!;
    await user.pointer({ keys: "[TouchA]", target });
  }

  test("toolbar.touch-feedback: taps act immediately, confirm the result and replace feedback without taking focus", async () => {
    await workspace.create("A");
    const { user } = await workspace.render();
    await tap("[data-sort=task-sort-priority]", user);
    expect(pressed("[data-sort=task-sort-priority]")).toBe("true");
    await screen.findByText("Sorted by priority, highest first", tooltip);
    // Chromium emits a synthetic hover-end after completing a touch click.
    fireEvent.mouseLeave(document.querySelector("[data-sort=task-sort-priority]")!);
    expect(screen.getByText("Sorted by priority, highest first", tooltip)).toBeDefined();
    await expectListFocused();

    await tap("[data-sort=task-sort-reverse]", user);
    await screen.findByText("Lowest priority first", tooltip);
    expect(screen.queryByText("Sorted by priority, highest first", tooltip)).toBeNull();

    await tap("[data-view=task-details]", user);
    await screen.findByText("Details shown", tooltip);
    await tap("[data-view=task-details]", user);
    await screen.findByText("Details hidden", tooltip);
    await expectListFocused();

    await tap("[data-filter=task-unblocked]", user);
    await screen.findByText("Showing unblocked tasks", tooltip);
    await tap("[data-filter=task-unblocked]", user);
    await screen.findByText("Showing all tasks", tooltip);
    await waitFor(() => expect(screen.queryByText("Showing all tasks", tooltip)).toBeNull(), {
      timeout: 2000,
    });
  });

  test("toolbar.touch-feedback: menus dismiss feedback, disabled reverse stays silent and mouse hover still works", async () => {
    await workspace.create("A");
    const { user } = await workspace.render();
    const created = document.querySelector<HTMLButtonElement>("[data-sort=task-sort-created]")!;
    await user.hover(created);
    await screen.findByText("Created", tooltip);
    expect(screen.queryByText("Sorted by created date, newest first", tooltip)).toBeNull();
    await user.unhover(created);
    await waitFor(() => expect(screen.queryByText("Created", tooltip)).toBeNull());

    await tap("[data-sort=task-sort-manual]", user);
    await screen.findByText("Sorted by manual order", tooltip);
    await tap("[data-sort=task-sort-reverse]", user);
    await waitFor(() => expect(screen.queryByText("Sorted by manual order", tooltip)).toBeNull());
    expect(document.querySelector(tooltip.selector)).toBeNull();

    await tap("[data-view=task-details]", user);
    await screen.findByText("Details shown", tooltip);
    await tap("[data-filter=task-priority]", user);
    await screen.findByRole("dialog");
    expect(screen.queryByText("Details shown", tooltip)).toBeNull();
    expect(document.querySelector(tooltip.selector)).toBeNull();
    await user.keyboard("{Escape}");
  });
});

describe("focus modes", () => {
  test("filter.mode: F focuses the filter group; the next key picks a filter", async () => {
    await workspace.create("A");
    const { user } = await workspace.render();
    await expectListFocused();
    await user.keyboard("f");
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("data-toolbar")).toBe("filters"),
    );
    await user.keyboard("u");
    await waitFor(() => expect(pressed("[data-filter=task-unblocked]")).toBe("true"));
  });

  test("sort.mode: S focuses the sort group; the next key picks a sort", async () => {
    await workspace.create("A");
    const { user } = await workspace.render();
    await user.keyboard("s");
    await waitFor(() => expect(document.activeElement?.getAttribute("data-toolbar")).toBe("sort"));
    await user.keyboard("u");
    await waitFor(() => expect(pressed("[data-sort=task-sort-updated]")).toBe("true"));
  });

  test("toolbar.mode-exit: choosing, the same key again, or Escape returns focus to the list", async () => {
    await workspace.create("A");
    const { user } = await workspace.render();
    await user.keyboard("fu");
    await expectListFocused();
    await user.keyboard("ss");
    await expectListFocused();
    await user.keyboard("f{Escape}");
    await expectListFocused();
  });
});

describe("filters", () => {
  async function seedStatuses(): Promise<void> {
    await workspace.create("Open one");
    await workspace.change("task.pause", (await workspace.create("Paused one")).id);
    await workspace.change("task.complete", (await workspace.create("Done one")).id);
    await workspace.change("task.cancel", (await workspace.create("Canceled one")).id);
  }

  test("filter.status-toggle: F S switches between active and inactive", async () => {
    await seedStatuses();
    const { user } = await workspace.render();
    await expectRows(["Open one"]);
    await user.keyboard("fs");
    await expectRows(["Canceled one", "Done one", "Paused one"]);
    await user.keyboard("fs");
    await expectRows(["Open one"]);
  });

  test("filter.status-exact: F then D shows only done tasks", async () => {
    await seedStatuses();
    const { user } = await workspace.render();
    await user.keyboard("fd");
    await expectRows(["Done one"]);
    await user.keyboard("fx");
    await expectRows(["Canceled one"]);
  });

  test("filter.priority: F then a digit filters, the same digit clears", async () => {
    await workspace.create("Low", { priority: 4 });
    await workspace.create("Urgent", { priority: 0 });
    const { user } = await workspace.render();
    await user.keyboard("f0");
    await expectRows(["Urgent"]);
    await user.keyboard("f0");
    await expectRows(["Urgent", "Low"]);
  });

  test("filter.unblocked: done blockers still block, canceled ones don't", async () => {
    const doneBlocker = await workspace.create("Done blocker");
    const canceledBlocker = await workspace.create("Canceled blocker");
    const stillBlocked = await workspace.create("Still blocked");
    const freed = await workspace.create("Freed");
    await workspace.change("task.dependency.add", stillBlocked.id, { dependsOnId: doneBlocker.id });
    await workspace.change("task.dependency.add", freed.id, { dependsOnId: canceledBlocker.id });
    await workspace.change("task.complete", doneBlocker.id);
    await workspace.change("task.cancel", canceledBlocker.id);
    const { user } = await workspace.render();
    await expectRows(["Freed", "Still blocked"]);
    await user.keyboard("fu");
    await expectRows(["Freed"]);
  });

  test("filter.category: @ opens the category picker with search focused, one category at a time", async () => {
    await workspace.create("Home chore", { category: "home" });
    await workspace.create("Work item", { category: "work" });
    const { user } = await workspace.render();
    await user.keyboard("@");
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(dialog.contains(document.activeElement) && document.activeElement?.tagName).toBe(
        "INPUT",
      ),
    );
    await user.keyboard("work{Enter}");
    await expectRows(["Work item"]);
    await expectListFocused();
  });

  test("filter.tags: tags combine with AND", async () => {
    await workspace.create("Only x", { tags: ["x"] });
    await workspace.create("Both", { tags: ["x", "y"] });
    const { user } = await workspace.render();
    await user.keyboard("#");
    await screen.findByRole("dialog");
    await user.keyboard("x");
    await user.keyboard(" ");
    await user.clear(document.activeElement as HTMLInputElement);
    await user.keyboard("y");
    await user.keyboard(" {Escape}");
    await expectRows(["Both"]);
  });

  test("filter.search: / searches titles and descriptions and the query stays applied", async () => {
    await workspace.create("Groceries");
    await workspace.create("Plain", { description: "mentions groceries too" });
    await workspace.create("Unrelated");
    const { user } = await workspace.render();
    await user.keyboard("/");
    await screen.findByRole("dialog");
    await user.keyboard("groceries{Enter}");
    await expectRows(["Plain", "Groceries"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await expectRows(["Plain", "Groceries"]);
  });

  test("filter.escape: Escape with one task selected resets filters but keeps sort and Details", async () => {
    await workspace.create("Low", { priority: 4 });
    await workspace.create("Urgent", { priority: 0 });
    const { user } = await workspace.render();
    await user.keyboard("spvf0");
    await expectRows(["Urgent"]);
    await user.keyboard("{Escape}");
    await expectRows(["Urgent", "Low"]);
    expect(pressed("[data-sort=task-sort-priority]")).toBe("true");
    expect(pressed("[data-view=task-details]")).toBe("true");
  });
});

describe("sort", () => {
  async function seedSortable(): Promise<void> {
    await workspace.create("Oldest", { priority: 1 });
    await workspace.create("Middle", { priority: 3 });
    await workspace.create("Newest", { priority: 0 });
  }

  test("sort.default: first launch sorts by created, newest first", async () => {
    await seedSortable();
    await workspace.render();
    await expectRows(["Newest", "Middle", "Oldest"]);
    expect(pressed("[data-sort=task-sort-created]")).toBe("true");
  });

  test("sort.created: S C sorts by created date", async () => {
    await seedSortable();
    const { user } = await workspace.render();
    await user.keyboard("spsc");
    await expectRows(["Newest", "Middle", "Oldest"]);
  });

  test("sort.updated: S U sorts by updated date", async () => {
    await seedSortable();
    const { tasks } = await workspace.command<{ tasks: { id: string; title: string }[] }>(
      "task.list",
      {},
    );
    await workspace.change("task.update", tasks.find((task) => task.title === "Oldest")!.id, {
      description: "touched",
    });
    const { user } = await workspace.render();
    await user.keyboard("su");
    await expectRows(["Oldest", "Newest", "Middle"]);
  });

  test("sort.priority: S P sorts P0 first", async () => {
    await seedSortable();
    const { user } = await workspace.render();
    await user.keyboard("sp");
    await expectRows(["Newest", "Oldest", "Middle"]);
  });

  test("sort.reverse: S R reverses date order and isn't available for Manual", async () => {
    await seedSortable();
    const { user } = await workspace.render();
    await user.keyboard("sr");
    await expectRows(["Oldest", "Middle", "Newest"]);
    await user.keyboard("sm");
    await waitFor(() => expect(pressed("[data-sort=task-sort-manual]")).toBe("true"));
    expect(
      (document.querySelector("[data-sort=task-sort-reverse]") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  test("sort.manual: S M shows the manual order shared with the CLI", async () => {
    await workspace.create("First");
    const second = await workspace.create("Second");
    await workspace.create("Third");
    const { task } = await workspace.command<{ task: { version: number } }>("task.get", {
      id: second.id,
    });
    await workspace.command("task.reorder", {
      tasks: [{ id: second.id, expectedVersion: task.version }],
      placement: { first: true },
    });
    const { user } = await workspace.render();
    await user.keyboard("sm");
    await waitFor(() => expect(pressed("[data-sort=task-sort-manual]")).toBe("true"));
    const { tasks } = await workspace.command<{ tasks: { title: string }[] }>("task.list", {
      sort: "manual",
    });
    expect(tasks[0].title).toBe("Second");
    await expectRows(tasks.map((task) => task.title));
  });
});
