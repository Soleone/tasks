import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { AppWorkspace } from "@/testing/appWorkspace";
import { expectListFocused, expectRows, focusedTitleField } from "@/testing/taskList";

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

  test("count.line: a refresh that lands while a new task saves doesn't count it twice", async () => {
    const { user } = await workspace.render();
    const original = globalThis.fetch;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = async (...args) => {
      const response = await original(...args);
      const body = typeof args[1]?.body === "string" ? JSON.parse(args[1].body) : null;
      if (body?.command === "task.create" && !body.dryRun) await held;
      return response;
    };
    try {
      await user.keyboard("c");
      await focusedTitleField();
      await user.keyboard("B{Enter}");
      await waitFor(async () =>
        expect((await workspace.command<{ total: number }>("task.list")).total).toBe(1),
      );
      // The refresh lists the saved task beside its optimistic row before the save replies.
      window.dispatchEvent(new Event("focus"));
      await waitFor(() =>
        expect(
          document.querySelector("#task-list [role=option]:not([data-optimistic-task])"),
        ).not.toBeNull(),
      );
    } finally {
      release();
      globalThis.fetch = original;
    }
    await expectListFocused();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(countLine()).toBe("1 active task");
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
  test("toolbar.tooltips: moving across filter, sort and action buttons replaces and dismisses hover tooltips", async () => {
    await workspace.create("A");
    const { user } = await workspace.render();
    for (const selector of [
      "[data-filter=task-unblocked]",
      "[data-sort=task-sort-created]",
      "[data-filter=task-category]",
      "[data-view=task-details]",
      "[data-filter=task-unblocked]",
    ]) {
      const button = document.querySelector<HTMLButtonElement>(selector)!;
      await user.hover(button);
      await waitFor(() => {
        const open = document.querySelectorAll(tooltip.selector);
        expect(open).toHaveLength(1);
        expect(button.hasAttribute("data-popup-open")).toBe(true);
      });
    }
    await user.unhover(document.querySelector("[data-filter=task-unblocked]")!);
    await waitFor(() => expect(document.querySelector(tooltip.selector)).toBeNull());
  });

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
    await screen.findByText("Priority", tooltip);
    // Chromium emits a synthetic hover-end after completing a touch click.
    fireEvent.mouseLeave(document.querySelector("[data-sort=task-sort-priority]")!);
    expect(screen.getByText("Priority", tooltip)).toBeDefined();
    await expectListFocused();

    await tap("[data-sort=task-sort-reverse]", user);
    await screen.findByText("Lowest priority first", tooltip);
    expect(screen.queryByText("Priority", tooltip)).toBeNull();

    await tap("[data-view=task-details]", user);
    await screen.findByText("Hide all details", tooltip);
    await tap("[data-view=task-details]", user);
    await screen.findByText("Show all details", tooltip);
    await expectListFocused();

    await tap("[data-filter=task-unblocked]", user);
    await screen.findByText("Unblocked", tooltip);
    await tap("[data-filter=task-unblocked]", user);
    await screen.findByText("All tasks", tooltip);
    await waitFor(() => expect(screen.queryByText("All tasks", tooltip)).toBeNull(), {
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
    await screen.findByText("Manual order", tooltip);
    await tap("[data-sort=task-sort-reverse]", user);
    await waitFor(() => expect(screen.queryByText("Manual order", tooltip)).toBeNull());
    expect(document.querySelector(tooltip.selector)).toBeNull();

    await tap("[data-view=task-details]", user);
    await screen.findByText("Hide all details", tooltip);
    await tap("[data-filter=task-priority]", user);
    await screen.findByRole("dialog");
    expect(screen.queryByText("Hide all details", tooltip)).toBeNull();
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

describe("button kinds and folding", () => {
  function folded(group: string): boolean {
    return document.querySelector(`[data-toolbar=${group}]`)?.closest("[hidden]") !== null;
  }

  test("toolbar.button-kinds: state buttons report pressed, commands report only expanded", async () => {
    await workspace.create("A");
    const { user } = await workspace.render();
    expect(pressed("[data-filter=task-unblocked]")).toBe("false");
    expect(pressed("[data-view=task-details]")).toBe("false");
    for (const name of ["New task", "Undo", "Reorder", "Task actions"])
      expect(screen.getByRole("button", { name }).hasAttribute("aria-pressed")).toBe(false);
    const actions = screen.getByRole("button", { name: "Task actions" });
    await user.click(actions);
    await screen.findByRole("menu");
    expect(actions.getAttribute("aria-expanded")).toBe("true");
    expect(actions.hasAttribute("aria-pressed")).toBe(false);
  });

  test("toolbar.fold: a group's glyph folds it to the glyph, remembered between launches", async () => {
    await workspace.create("A");
    const first = await workspace.render();
    const glyph = screen.getByRole("button", { name: "Filters" });
    expect(glyph.getAttribute("aria-expanded")).toBe("true");
    await first.user.click(glyph);
    await waitFor(() => expect(folded("filters")).toBe(true));
    expect(glyph.getAttribute("aria-expanded")).toBe("false");
    first.view.unmount();
    const second = await workspace.render();
    expect(folded("filters")).toBe(true);
    await second.user.click(screen.getByRole("button", { name: "Filters" }));
    await waitFor(() => expect(folded("filters")).toBe(false));
  });

  test("toolbar.fold-indicator: a folded glyph marks a group with a pressed button", async () => {
    await workspace.create("A");
    const { user } = await workspace.render();
    const dot = () =>
      document.querySelector("[data-toolbar-glyph=sort] [data-toolbar-glyph-active]");
    await user.click(screen.getByRole("button", { name: "Sort" }));
    await waitFor(() => expect(folded("sort")).toBe(true));
    expect(dot()).toBeNull();
    await user.keyboard("sp");
    await waitFor(() => expect(pressed("[data-sort=task-sort-priority]")).toBe("true"));
    expect(folded("sort")).toBe(true);
    expect(dot()).not.toBeNull();
  });

  test("toolbar.fold-mode: F opens folded Filters for the mode and refolds when it exits", async () => {
    await workspace.create("A");
    const { user } = await workspace.render();
    await user.click(screen.getByRole("button", { name: "Filters" }));
    await waitFor(() => expect(folded("filters")).toBe(true));
    await expectListFocused();
    await user.keyboard("f");
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("data-toolbar")).toBe("filters"),
    );
    expect(folded("filters")).toBe(false);
    await user.keyboard("{Escape}");
    await expectListFocused();
    await waitFor(() => expect(folded("filters")).toBe(true));
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

  test.each(["Enter", "Space", "click"])(
    "filter.tags: Clear tags empties the filter with %s",
    async (action) => {
      await workspace.create("Only x", { tags: ["x"] });
      await workspace.create("Both", { tags: ["x", "y"] });
      const { user } = await workspace.render();
      await user.keyboard("#");
      await screen.findByRole("dialog");
      await user.keyboard("x ");
      await user.clear(document.activeElement as HTMLInputElement);
      await user.keyboard("y {Escape}");
      await expectRows(["Both"]);

      await user.keyboard("#");
      await screen.findByRole("dialog");
      await user.keyboard("clear");
      const clearTags = await screen.findByRole("option", { name: "Clear tags" });
      await waitFor(() => expect(clearTags.getAttribute("aria-selected")).toBe("true"));
      if (action === "click") await user.click(clearTags);
      else await user.keyboard(action === "Enter" ? "{Enter}" : " ");
      if (action !== "Enter") await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await expectRows(["Both", "Only x"]);
      await expectListFocused();
    },
  );

  test("filter.search: / searches titles and descriptions and the query stays applied", async () => {
    await workspace.create("Groceries");
    await workspace.create("Plain", { description: "mentions groceries too" });
    await workspace.create("Unrelated");
    const { user } = await workspace.render();
    await user.keyboard("/");
    const input = await screen.findByRole("textbox", { name: "Search query" });
    await waitFor(() => expect(document.activeElement).toBe(input));
    const search = screen.getByRole("search", { name: "Search tasks" });
    const toolbar = document.querySelector("[data-filter=task-search]")!;
    const count = document.querySelector("[data-filter-summary]")!;
    expect(toolbar.closest("section")).toBe(search.closest("section"));
    expect(toolbar.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(search.compareDocumentPosition(count) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(/Titles and descriptions/)).toBeNull();
    expect(search.querySelectorAll("button").length).toBe(1);
    expect(screen.getByRole("button", { name: /^Clear search$/ }).textContent).toBe("");
    await user.keyboard("groceries{Enter}");
    await expectRows(["Plain", "Groceries"]);
    expect(screen.queryByRole("search")).toBeNull();
    await expectListFocused();

    await user.click(document.querySelector("[data-filter=task-search]")!);
    const reopened = await screen.findByRole("textbox", { name: "Search query" });
    expect((reopened as HTMLInputElement).value).toBe("groceries");
    await user.clear(reopened);
    await user.type(reopened, "unrelated");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("search")).toBeNull();
    await expectRows(["Plain", "Groceries"]);
    await expectListFocused();
  });

  test("filter.search: the palette opens or refocuses inline search without leaving a dialog", async () => {
    await workspace.create("Task");
    const { user } = await workspace.render();
    for (const draft of ["", "draft"]) {
      await user.keyboard("{Control>}k{/Control}");
      await screen.findByRole("dialog", { name: "Shortcuts and syntax" });
      await user.keyboard("search tasks{Enter}");
      const input = await screen.findByRole("textbox", { name: "Search query" });
      await waitFor(() => expect(document.activeElement).toBe(input));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect((input as HTMLInputElement).value).toBe(draft);
      if (draft === "") await user.type(input, "draft");
    }
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("search")).toBeNull();
    await expectListFocused();
  });

  test.each(["clear button", "empty Escape"])(
    "filter.search: %s clears the applied search and returns focus from filter mode",
    async (action) => {
      await workspace.create("Groceries");
      await workspace.create("Unrelated");
      const { user } = await workspace.render();
      await user.keyboard("/groceries{Enter}");
      await expectRows(["Groceries"]);
      await user.keyboard("f/");
      const input = await screen.findByRole("textbox", { name: "Search query" });
      await waitFor(() => expect(document.activeElement).toBe(input));
      if (action === "clear button") {
        await user.click(screen.getByRole("button", { name: /^Clear search$/ }));
      } else {
        await user.clear(input);
        await user.keyboard("{Escape}");
      }
      expect(screen.queryByRole("search")).toBeNull();
      await expectRows(["Unrelated", "Groceries"]);
      await expectListFocused();
    },
  );

  test("filter.escape: Escape with one task selected resets filters but keeps sort and Details", async () => {
    await workspace.create("Low", { priority: 4 });
    await workspace.create("Urgent", { priority: 0 });
    const { user } = await workspace.render();
    await user.keyboard("sp{Shift>}v{/Shift}f0");
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
