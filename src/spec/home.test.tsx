import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { revealScrollbarsWhileScrolling } from "@/scrollbars";
import { AppWorkspace } from "@/testing/appWorkspace";
import { selectedMainWorkspace } from "@/platform/backendClient";
import { EditorError } from "@/platform/editorClient";
import {
  activeTitle,
  announcements,
  expectActive,
  focusedTitleField,
  expectListFocused,
  expectRows,
  row,
  selectedTitles,
  taskList,
} from "@/testing/taskList";

let workspace: AppWorkspace;
beforeEach(async () => {
  workspace = await AppWorkspace.start();
});
afterEach(async () => {
  await workspace.stop();
});

/** Seeds tasks oldest first, so the default newest-first list shows them reversed. */
async function seed(...titles: string[]): Promise<void> {
  for (const title of titles) await workspace.create(title);
}

describe("launch", () => {
  test("home.launch-focus: the list has focus and the first visible task is active", async () => {
    await seed("Older", "Newer");
    await workspace.render();
    await expectListFocused();
    await expectActive("Newer");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("home.launch-empty: the empty shell has focus and C opens capture", async () => {
    const { user } = await workspace.render();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("region", { name: "Saved tasks" })),
    );
    await user.keyboard("c");
    await focusedTitleField();
  });

  test("home.new-task-secondary: New task is never initial focus nor a Tab stop", async () => {
    await seed("Task");
    await workspace.render();
    const button = screen.getByRole("button", { name: "New task" });
    await expectListFocused();
    expect(button.tabIndex).toBe(-1);
  });
});

describe("focus", () => {
  test("home.single-tab-stop: Tab and Shift+Tab keep focus on the list", async () => {
    await seed("A", "B");
    const { user } = await workspace.render();
    await expectListFocused();
    await user.tab();
    expect(document.activeElement).toBe(taskList());
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(taskList());
  });

  test("home.aria: active, selected and expanded state are exposed on the listbox", async () => {
    const parent = await workspace.create("Parent");
    await workspace.create("Child", { parentId: parent.id });
    await workspace.render();
    await expectActive("Parent");
    expect(row("Parent").getAttribute("aria-selected")).toBe("true");
    const described = document.getElementById(row("Parent").getAttribute("aria-describedby") ?? "");
    expect(described?.textContent).toMatch(/collapsed/i);
  });
});

describe("moving around", () => {
  test("home.arrows: Up and Down move the active row and make it the only selection", async () => {
    await seed("C", "B", "A");
    const { user } = await workspace.render();
    await expectActive("A");
    await user.keyboard("{ArrowDown}");
    await expectActive("B");
    expect(selectedTitles()).toEqual(["B"]);
    await user.keyboard("{ArrowUp}");
    await expectActive("A");
    expect(selectedTitles()).toEqual(["A"]);
    // Repeats can arrive before React commits the preceding active-row change.
    act(() => {
      fireEvent.keyDown(taskList(), { key: "ArrowDown" });
      fireEvent.keyDown(taskList(), { key: "ArrowDown", repeat: true });
      fireEvent.keyDown(taskList(), { key: "ArrowUp" });
    });
    await expectActive("B");
    expect(selectedTitles()).toEqual(["B"]);
  });

  test("home.home-end: Home and End jump to the first and last visible task", async () => {
    await seed("C", "B", "A");
    const { user } = await workspace.render();
    await expectActive("A");
    await user.keyboard("{End}");
    await expectActive("C");
    expect(selectedTitles()).toEqual(["C"]);
    await user.keyboard("{Home}");
    await expectActive("A");
  });

  test("home.right-expand: Right expands a collapsed parent", async () => {
    const parent = await workspace.create("Parent");
    await workspace.create("Child", { parentId: parent.id });
    const { user } = await workspace.render();
    await expectRows(["Parent"]);
    await user.keyboard("{ArrowRight}");
    await expectRows(["Parent", "Child"]);
    await user.keyboard("{ArrowRight}");
    await expectRows(["Parent", "Child"]);
    expect(activeTitle()).toBe("Parent");
  });

  test("home.left: Left on a child activates its parent", async () => {
    const parent = await workspace.create("Parent");
    await workspace.create("Child", { parentId: parent.id });
    const { user } = await workspace.render();
    await user.keyboard("{ArrowRight}{ArrowDown}");
    await expectActive("Child");
    await user.keyboard("{ArrowLeft}");
    await expectActive("Parent");
  });

  test("home.left-collapse: Left on an expanded parent collapses it", async () => {
    const parent = await workspace.create("Parent");
    await workspace.create("Child", { parentId: parent.id });
    const { user } = await workspace.render();
    await user.keyboard("{ArrowRight}");
    await expectRows(["Parent", "Child"]);
    await user.keyboard("{ArrowLeft}");
    await expectRows(["Parent"]);
  });

  test("home.right-category: Right on a childless task filters to its category", async () => {
    await workspace.create("Elsewhere");
    await workspace.create("Work item", { category: "work" });
    const { user } = await workspace.render();
    await expectActive("Work item");
    await user.keyboard("{ArrowRight}");
    await expectRows(["Work item"]);
    expect(selectedTitles()).toEqual(["Work item"]);
  });

  test("home.right-category: Right filters a parent before expanding its children", async () => {
    const parent = await workspace.create("Parent", { category: "work" });
    await workspace.create("Child", { parentId: parent.id });
    const { user } = await workspace.render();

    await user.keyboard("{ArrowRight}");
    await expectRows(["Parent"]);
    expect(
      screen
        .getAllByRole("button", { name: "Clear category filter: work" })
        .some((button) => button.getAttribute("aria-pressed") === "true"),
    ).toBe(true);
    expect(selectedTitles()).toEqual(["Parent"]);

    await user.keyboard("{ArrowRight}");
    await expectRows(["Parent", "Child"]);
    expect(row("Child").getAttribute("data-context-child")).toBe("true");
  });

  test("home.left-clear-category: Left on a root task clears the category filter and keeps it active", async () => {
    await workspace.create("Elsewhere");
    await workspace.create("Work item", { category: "work" });
    const { user } = await workspace.render();
    await user.keyboard("{ArrowRight}");
    await expectRows(["Work item"]);
    await user.keyboard("{ArrowLeft}");
    await expectRows(["Work item", "Elsewhere"]);
    await expectActive("Work item");
  });

  test("home.open-editor: Enter replaces the active row with its editor, title focused", async () => {
    await seed("Edit me");
    const { user } = await workspace.render();
    await expectActive("Edit me");
    await user.keyboard("{Enter}");
    expect((await focusedTitleField()).value).toBe("Edit me ");
  });
});

describe("selection", () => {
  test("select.extend: Shift+Down extends the selection through siblings", async () => {
    await seed("C", "B", "A");
    const { user } = await workspace.render();
    await expectActive("A");
    await user.keyboard("{Shift>}{ArrowDown}{ArrowDown}{/Shift}");
    await waitFor(() => expect(selectedTitles()).toEqual(["A", "B", "C"]));
  });

  test("select.extend-edge: Shift+End extends the selection to the last sibling", async () => {
    await seed("C", "B", "A");
    const { user } = await workspace.render();
    await expectActive("A");
    await user.keyboard("{Shift>}{End}{/Shift}");
    await waitFor(() => expect(selectedTitles()).toEqual(["A", "B", "C"]));
  });

  test("select.pointer: Ctrl+click toggles one task and Shift+click selects a range", async () => {
    await seed("C", "B", "A");
    const { user } = await workspace.render();
    await expectActive("A");
    await user.keyboard("{Control>}");
    await user.click(row("C"));
    await user.keyboard("{/Control}");
    await waitFor(() => expect(selectedTitles()).toEqual(["A", "C"]));
    await user.keyboard("{Control>}");
    await user.click(row("C"));
    await user.keyboard("{/Control}");
    await waitFor(() => expect(selectedTitles()).toEqual(["A"]));
    await user.keyboard("{Shift>}");
    await user.click(row("B"));
    await user.keyboard("{/Shift}");
    // The range runs from the last clicked task.
    await waitFor(() => expect(selectedTitles()).toEqual(["B", "C"]));
  });

  test("select.escape: Escape with several selected clears the selection, not filters", async () => {
    await seed("C", "B", "A");
    const { user } = await workspace.render();
    await expectActive("A");
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    await waitFor(() => expect(selectedTitles()).toEqual(["A", "B"]));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(selectedTitles().length).toBeLessThanOrEqual(1));
  });
});

describe("reorder", () => {
  async function manualTitles(): Promise<string[]> {
    const { tasks } = await workspace.command<{ tasks: { title: string }[] }>("task.list", {
      sort: "manual",
    });
    return tasks.map((task) => task.title);
  }

  test("reorder.step: Ctrl+Down moves the selection one sibling slot and saves it", async () => {
    await seed("A", "B", "C");
    const { user } = await workspace.render();
    await user.keyboard("sm");
    const before = await manualTitles();
    await expectRows(before);
    await user.keyboard("{Control>}{ArrowDown}{/Control}");
    const expected = [before[1], before[0], before[2]];
    await waitFor(async () => expect(await manualTitles()).toEqual(expected));
    await expectRows(expected);
    await expectActive(before[0]);
    expect(selectedTitles()).toEqual([before[0]]);
    await expectListFocused();
  });

  test("reorder.step: repeated keys move immediately through slow saves and survive refresh", async () => {
    await seed("A", "B", "C", "D");
    const { user } = await workspace.render();
    await user.keyboard("sm");
    const before = await manualTitles();
    await expectRows(before);
    const original = globalThis.fetch;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let writes = 0;
    globalThis.fetch = async (...args) => {
      const body = typeof args[1]?.body === "string" ? JSON.parse(args[1].body) : null;
      if (body?.command === "task.reorder" && ++writes === 1) await held;
      return original(...args);
    };
    try {
      // All three keydowns arrive before React commits or the first write answers.
      act(() => {
        fireEvent.keyDown(taskList(), { key: "ArrowDown", ctrlKey: true });
        fireEvent.keyDown(taskList(), { key: "ArrowDown", ctrlKey: true, repeat: true });
        fireEvent.keyDown(taskList(), { key: "ArrowUp", ctrlKey: true });
      });
      await expectRows([before[1], before[0], before[2], before[3]]);
      await expectActive(before[0]);
      await waitFor(() => expect(writes).toBe(1));
      expect(await manualTitles()).toEqual(before);
      // Refreshing an unchanged workspace must not erase the pending moves.
      act(() => window.dispatchEvent(new Event("focus")));
      await user.keyboard("{End}");
      await expectActive(before[3]);
      await expectRows([before[1], before[0], before[2], before[3]]);
    } finally {
      release();
      globalThis.fetch = original;
    }
    const expected = [before[1], before[0], before[2], before[3]];
    await waitFor(async () => expect(await manualTitles()).toEqual(expected));
    await waitFor(() => expect(announcements()).toMatch(/moved up/));
    await expectRows(expected);
    await expectActive(before[3]);
    expect(selectedTitles()).toEqual([before[3]]);
    // Every accepted step still has its own undo operation.
    await user.keyboard("{Control>}z{/Control}");
    await waitFor(async () =>
      expect(await manualTitles()).toEqual([before[1], before[2], before[0], before[3]]),
    );
  });

  test("reorder.step: a refused save drops queued moves and restores confirmed order", async () => {
    await seed("A", "B", "C");
    const { user } = await workspace.render();
    await user.keyboard("sm");
    const before = await manualTitles();
    await expectRows(before);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reorder = vi
      .spyOn(selectedMainWorkspace()!, "reorder")
      .mockImplementationOnce(async () => {
        await held;
        throw new EditorError("STALE_TASK_VERSION", "changed elsewhere");
      });
    try {
      act(() => {
        fireEvent.keyDown(taskList(), { key: "ArrowDown", ctrlKey: true });
        fireEvent.keyDown(taskList(), { key: "ArrowDown", ctrlKey: true, repeat: true });
      });
      await expectRows([before[1], before[2], before[0]]);
      await waitFor(() => expect(reorder).toHaveBeenCalledTimes(1));
    } finally {
      release();
    }
    await waitFor(() => expect(announcements()).toMatch(/changed elsewhere/));
    await expectRows(before);
    expect(await manualTitles()).toEqual(before);
    expect(reorder).toHaveBeenCalledTimes(1);
    reorder.mockRestore();
    await user.keyboard("{Control>}{ArrowDown}{/Control}");
    await waitFor(async () =>
      expect(await manualTitles()).toEqual([before[1], before[0], before[2]]),
    );
  });

  test("reorder.edge: Ctrl+End moves the selection to the end of its scope", async () => {
    await seed("A", "B", "C");
    const { user } = await workspace.render();
    await user.keyboard("sm");
    const before = await manualTitles();
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    await waitFor(() => expect(selectedTitles()).toEqual(before.slice(0, 2)));
    await user.keyboard("{Control>}{End}{/Control}");
    const expected = [before[2], before[0], before[1]];
    await waitFor(async () => expect(await manualTitles()).toEqual(expected));
    await expectRows(expected);
    await expectActive(before[1]);
    expect(selectedTitles()).toEqual(before.slice(0, 2));
    await expectListFocused();
  });

  test("reorder.switch-sort: the first reorder in another sort switches to Manual", async () => {
    await seed("A", "B");
    const { user } = await workspace.render();
    await user.keyboard("{Control>}{ArrowDown}{/Control}");
    await waitFor(() =>
      expect(
        document.querySelector("[data-sort=task-sort-manual]")?.getAttribute("aria-pressed"),
      ).toBe("true"),
    );
  });

  test("reorder.allowed-view: outside the default view nothing moves and the filter is named", async () => {
    await seed("A", "B");
    const { user } = await workspace.render();
    await user.keyboard("sm");
    const before = await manualTitles();
    await user.keyboard("fu{Control>}{ArrowDown}{/Control}");
    await waitFor(() => expect(announcements()).toMatch(/Clear the Unblocked filter/));
    expect(await manualTitles()).toEqual(before);
  });

  test("reorder.children-follow: a moved root keeps its expanded children before and after saving", async () => {
    const parent = await workspace.create("Parent");
    const child = await workspace.create("Child", { parentId: parent.id });
    await workspace.create("Other");
    const { user } = await workspace.render();
    await user.keyboard("sm{Home}");
    const parentFirst = activeTitle() === "Parent";
    if (!parentFirst) await user.keyboard("{ArrowDown}");
    await expectActive("Parent");
    await user.keyboard("{ArrowRight}");
    await expectRows(parentFirst ? ["Parent", "Child", "Other"] : ["Other", "Parent", "Child"]);
    const selected = selectedMainWorkspace()!;
    const original = selected.reorder.bind(selected);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reorder = vi.spyOn(selected, "reorder").mockImplementationOnce(async (...args) => {
      await held;
      return original(...args);
    });
    const expected = parentFirst ? ["Other", "Parent", "Child"] : ["Parent", "Child", "Other"];
    try {
      await user.keyboard(
        parentFirst ? "{Control>}{ArrowDown}{/Control}" : "{Control>}{ArrowUp}{/Control}",
      );
      await expectRows(expected);
      await expectActive("Parent");
      await waitFor(() => expect(reorder).toHaveBeenCalledTimes(1));
    } finally {
      release();
    }
    await waitFor(async () => expect(await manualTitles()).toEqual(expected));
    await expectRows(expected);
    expect((await workspace.task(child.id)).parentId).toBe(parent.id);
    reorder.mockRestore();
  });

  test("reorder.mouse: the Reorder button opens move controls, closed by default", async () => {
    await seed("A", "B");
    const { user } = await workspace.render();
    const toggle = screen.getByRole("button", { name: "Reorder" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await user.click(toggle);
    for (const name of ["Move up", "Move down", "Move to beginning", "Move to end"])
      await screen.findByRole("button", { name: new RegExp(name, "i") });
  });
});

describe("hierarchy in a filtered list", () => {
  test("home.context-ancestor: a non-matching ancestor shows as an uncounted context row", async () => {
    const parent = await workspace.create("Parent", { priority: 4 });
    await workspace.create("Urgent child", { parentId: parent.id, priority: 0 });
    const { user } = await workspace.render();
    await user.keyboard("f0");
    await waitFor(() =>
      expect(document.querySelector("[data-filter-summary]")?.textContent).toMatch(/^1 /),
    );
    await expectRows(["Parent"]);
    await user.keyboard("{ArrowRight}");
    await expectRows(["Parent", "Urgent child"]);
  });

  test("home.context-children: paused children stay discoverable after resuming their parent and reopening", async () => {
    const parent = await workspace.create("Parent");
    const child = await workspace.create("Child", { parentId: parent.id });
    const { user, view } = await workspace.render();
    await expectActive("Parent");
    await user.keyboard("{ArrowRight}p");
    await waitFor(async () => expect((await workspace.task(parent.id)).status).toBe("paused"));
    await expectRows(["Parent", "Child"]);
    await waitFor(() => expect(row("Parent").hasAttribute("data-context-parent")).toBe(true));
    await user.keyboard("{ArrowDown}p");
    await waitFor(async () => expect((await workspace.task(child.id)).status).toBe("paused"));
    await expectRows([]);
    await user.keyboard("fs");
    await expectRows(["Parent", "Child"]);
    await user.keyboard("{Home}p");
    await waitFor(async () => expect((await workspace.task(parent.id)).status).toBe("in_progress"));
    await expectRows(["Parent", "Child"]);
    await user.keyboard("fs");
    await expectRows(["Parent", "Child"]);
    await waitFor(() => expect(row("Child").hasAttribute("data-context-child")).toBe(true));
    expect(row("Child").textContent).toContain("Shown with parent, outside current results.");
    expect(document.querySelector("[data-filter-summary]")?.textContent).toMatch(/^1 active task$/);
    expect((await workspace.task(child.id)).status).toBe("paused");

    view.unmount();
    const reopened = await workspace.render();
    await expectRows(["Parent"]);
    expect(row("Parent").querySelector('[aria-label="Expand children"]')).not.toBeNull();
    await reopened.user.keyboard("{ArrowRight}");
    await expectRows(["Parent", "Child"]);
    expect(row("Child").hasAttribute("data-context-child")).toBe(true);
  });

  test("home.context-children: context children can resume and undo individually but cannot join bulk selection", async () => {
    const parent = await workspace.create("Parent");
    const child = await workspace.create("Child", { parentId: parent.id });
    await workspace.change("task.pause", child.id);
    const { user } = await workspace.render();
    await user.keyboard("{ArrowRight}{ArrowDown}");
    await expectActive("Child");
    expect(selectedTitles()).toEqual([]);
    await user.keyboard("p");
    await waitFor(async () => expect((await workspace.task(child.id)).status).toBe("in_progress"));
    await waitFor(() => expect(row("Child").hasAttribute("data-context-child")).toBe(false));
    await user.keyboard("{Control>}z{/Control}");
    await waitFor(async () => expect((await workspace.task(child.id)).status).toBe("paused"));
    await waitFor(() => expect(row("Child").hasAttribute("data-context-child")).toBe(true));
    await expectRows(["Parent", "Child"]);
    await user.keyboard("{Home}{Shift>}{ArrowDown}{/Shift}");
    expect(selectedTitles()).toEqual(["Parent"]);
    expect((await workspace.task(parent.id)).status).toBe("open");
  });

  test("home.context-children: editing and loading context from another page never double-counts or duplicates tasks", async () => {
    const parent = await workspace.create("Parent");
    for (let index = 0; index < 51; index += 1) {
      await workspace.create(`Child ${index}`, { parentId: parent.id });
    }
    const { user } = await workspace.render();
    await expectActive("Parent");
    await user.keyboard("{ArrowRight}0");
    await waitFor(async () => expect((await workspace.task(parent.id)).priority).toBe(0));
    expect(document.querySelector("[data-filter-summary]")?.textContent).toBe("52 active tasks");
    expect(screen.getAllByRole("option")).toHaveLength(52);
    await user.click(screen.getByRole("button", { name: "Load more tasks" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Load more tasks" })).toBeNull(),
    );
    expect(screen.getAllByRole("option")).toHaveLength(52);
    expect(document.querySelector("[data-filter-summary]")?.textContent).toBe("52 active tasks");
    expect(row("Child 0").hasAttribute("data-context-child")).toBe(false);
  });

  test("home.filtered-empty: filters that match nothing show a shell with Clear filters", async () => {
    await seed("A");
    const { user } = await workspace.render();
    await user.keyboard("f0");
    await screen.findByText("No tasks match the current filters");
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await expectRows(["A"]);
  });
});

describe("details", () => {
  test("details.toggle: V shows descriptions and the time footer; Escape never clears it", async () => {
    await workspace.create("Task", { description: "Some notes" });
    const { user } = await workspace.render();
    expect(screen.queryByText("Some notes")).toBeNull();
    await user.keyboard("v");
    await screen.findByText("Some notes");
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Some notes")).not.toBeNull();
  });

  test("details.keep-active-visible: toggling details scrolls the active task into view", async () => {
    await workspace.create("Task", { description: "Some notes" });
    const { user } = await workspace.render();
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    await user.keyboard("v");
    await waitFor(() => expect(scroll.mock.contexts).toContain(row("Task")));
    scroll.mockRestore();
  });

  test("details.blocked-by: Blocked by stays visible with Details off", async () => {
    const blocker = await workspace.create("Blocker");
    const task = await workspace.create("Task");
    await workspace.change("task.dependency.add", task.id, { dependsOnId: blocker.id });
    await workspace.render();
    await waitFor(() => expect(row("Task").textContent).toMatch(/Blocked by.*Blocker/));
  });

  test("details.footer: with Details on, the last row shows Created", async () => {
    await workspace.create("Task");
    const { user } = await workspace.render();
    await user.keyboard("v");
    await waitFor(() => expect(row("Task").querySelector("[title^=Created]")).not.toBeNull());
  });

  test("details.relative-dates: today's dates read today", async () => {
    await workspace.create("Task");
    const { user } = await workspace.render();
    await user.keyboard("v");
    await waitFor(() =>
      expect(row("Task").querySelector("[title^=Created]")?.textContent).toMatch(/today/),
    );
  });
});

describe("scrolling", () => {
  test("home.quiet-scrollbar: a scrolling element is marked until it rests", () => {
    vi.useFakeTimers();
    const stop = revealScrollbarsWhileScrolling();
    const panel = document.createElement("div");
    document.body.append(panel);
    try {
      fireEvent.scroll(panel);
      expect(panel.hasAttribute("data-scrolling")).toBe(true);
      vi.advanceTimersByTime(500);
      fireEvent.scroll(panel);
      vi.advanceTimersByTime(500);
      expect(panel.hasAttribute("data-scrolling")).toBe(true);
      vi.advanceTimersByTime(500);
      expect(panel.hasAttribute("data-scrolling")).toBe(false);
    } finally {
      stop();
      panel.remove();
      vi.useRealTimers();
    }
  });
});
