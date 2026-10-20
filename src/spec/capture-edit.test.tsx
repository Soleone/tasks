import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { AppWorkspace } from "@/testing/appWorkspace";
import {
  announcements,
  expectActive,
  expectListFocused,
  expectRows,
  focusedTitleField,
  row,
} from "@/testing/taskList";

let workspace: AppWorkspace;
beforeEach(async () => {
  workspace = await AppWorkspace.start();
});
afterEach(async () => {
  await workspace.stop();
});

async function onlyTask() {
  const { tasks } = await workspace.command<{ tasks: { id: string }[] }>("task.list", {
    status: [],
  });
  expect(tasks).toHaveLength(1);
  return workspace.task(tasks[0].id);
}

function editor(): HTMLElement {
  return screen.getByRole("form", { name: /New task|Edit task/ });
}

async function capture(user: UserEvent, text: string): Promise<void> {
  await user.keyboard("c");
  await focusedTitleField();
  await user.keyboard(text);
}

describe("opening and closing", () => {
  test("capture.open: C opens the editor with the title focused", async () => {
    const { user } = await workspace.render();
    await user.keyboard("c");
    await focusedTitleField();
  });

  test("capture.child: Shift+C saves the new task as a child of the active task", async () => {
    const parent = await workspace.create("Parent");
    const { user } = await workspace.render();
    await expectActive("Parent");
    await user.keyboard("{Shift>}C{/Shift}");
    await focusedTitleField();
    await user.keyboard("Child{Enter}");
    await expectListFocused();
    const { tasks } = await workspace.command<{
      tasks: { title: string; parentId: string | null }[];
    }>("task.list", {});
    expect(tasks.find((task) => task.title === "Child")?.parentId).toBe(parent.id);
  });

  test("capture.child-canceled: Shift+C on a canceled task is refused with a message", async () => {
    await workspace.change("task.cancel", (await workspace.create("Gone")).id);
    const { user } = await workspace.render();
    await user.keyboard("fx");
    await expectRows(["Gone"]);
    await user.keyboard("{Shift>}C{/Shift}");
    await waitFor(() => expect(announcements()).toMatch(/canceled/i));
    expect(screen.queryByPlaceholderText("What needs doing?")).toBeNull();
  });

  test("edit.inline: clicking a row replaces it with the editor", async () => {
    await workspace.create("Click me");
    const { user } = await workspace.render();
    await user.click(row("Click me"));
    expect((await focusedTitleField()).value).toBe("Click me ");
  });

  test("edit.save: Enter saves and focus returns to the list on the saved task", async () => {
    const task = await workspace.create("Old title");
    await workspace.create("Other");
    const { user } = await workspace.render();
    await user.keyboard("{ArrowDown}");
    await expectActive("Old title");
    await user.keyboard("{Enter}");
    const title = await focusedTitleField();
    await user.clear(title);
    await user.keyboard("New title{Enter}");
    await waitFor(async () => expect((await workspace.task(task.id)).title).toBe("New title"));
    await expectListFocused();
    await expectActive("New title");
  });

  test("edit.cancel: Escape cancels; from the description the first Escape returns to the title", async () => {
    await workspace.create("Keep me");
    const { user } = await workspace.render();
    await user.keyboard("{Enter}");
    await focusedTitleField();
    await user.keyboard("{Tab}{Tab}");
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("placeholder")).toBe("Write in Markdown…"),
    );
    await user.keyboard("{Escape}");
    await focusedTitleField();
    await user.keyboard(" changed{Escape}");
    await expectListFocused();
    await expectRows(["Keep me"]);
  });

  test("edit.keeps-draft: a workspace change while editing keeps the draft", async () => {
    await workspace.create("Task");
    const { user } = await workspace.render();
    await capture(user, "Half typed");
    await workspace.create("Arrived elsewhere");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await focusedTitleField()).value).toBe("Half typed");
  });
});

describe("inside the editor", () => {
  test("edit.tab-order: Tab goes title, priority, description", async () => {
    const { user } = await workspace.render();
    await capture(user, "Task");
    await user.keyboard("{Tab}");
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("aria-keyshortcuts")).toBe(
        "0 1 2 3 4 ArrowLeft ArrowRight",
      ),
    );
    await user.keyboard("{Tab}");
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("placeholder")).toBe("Write in Markdown…"),
    );
    await user.keyboard("{Shift>}{Tab}{Tab}{/Shift}");
    await focusedTitleField();
  });

  test("edit.priority: new tasks start at P2; a digit on the priority stop sets it", async () => {
    const { user } = await workspace.render();
    await capture(user, "Task");
    await user.keyboard("{Tab}0{Control>}{Enter}{/Control}");
    await waitFor(async () => expect((await onlyTask()).priority).toBe(0));
  });

  test("edit.description-button: Add description opens the description for the mouse", async () => {
    const { user } = await workspace.render();
    await capture(user, "Task");
    await user.click(within(editor()).getByRole("button", { name: /description/i }));
    await screen.findByPlaceholderText("Write in Markdown…");
  });

  test("edit.description-visible: opening the description scrolls it into view", async () => {
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    const { user } = await workspace.render();
    await capture(user, "Task");
    await user.click(within(editor()).getByRole("button", { name: /description/i }));
    const field = await screen.findByPlaceholderText("Write in Markdown…");
    await waitFor(() => expect(scroll.mock.contexts).toContain(field));
    scroll.mockRestore();
  });

  test("edit.buttons: Cancel precedes Add description and stays labeled Cancel when editing", async () => {
    await workspace.create("Existing task");
    const { user } = await workspace.render();
    await capture(user, "Task");
    const cancel = within(editor()).getByRole("button", { name: "Cancel" });
    const description = within(editor()).getByRole("button", { name: "Add description" });
    expect(
      cancel.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    for (const name of ["Add task", "Cancel", "Add description"])
      expect(within(editor()).getByRole("button", { name }).tabIndex).toBe(-1);
    await user.click(cancel);
    await expectListFocused();
    await user.click(row("Existing task"));
    await focusedTitleField();
    expect(within(editor()).getByRole("button", { name: "Cancel" }).tabIndex).toBe(-1);
    await user.keyboard(" changed");
    await user.click(within(editor()).getByRole("button", { name: "Cancel" }));
    await expectListFocused();
    await expectRows(["Existing task"]);
  });
});

describe("shorthand", () => {
  function titleField(): HTMLInputElement {
    return within(editor()).getByPlaceholderText("What needs doing?");
  }

  function pills(): string[] {
    return within(within(editor()).getByRole("list", { name: "Category and tags" }))
      .queryAllByRole("listitem")
      .map((item) => item.textContent ?? "");
  }

  async function suggestion(name: RegExp): Promise<HTMLElement> {
    const list = await screen.findByRole("listbox", { name: "Tags autocomplete" });
    return within(list).findByRole("option", { name });
  }

  async function createTagged(text: string): Promise<string> {
    const { task } = await workspace.command<{ task: { id: string } }>("task.create", { text });
    return task.id;
  }

  async function taskTitled(title: string) {
    const { tasks } = await workspace.command<{ tasks: { id: string; title: string }[] }>(
      "task.list",
      {},
    );
    const found = tasks.find((task) => task.title === title);
    expect(found).toBeDefined();
    return workspace.task(found!.id);
  }

  test("shorthand.lift: a finished marker leaves the title for a pill; escapes stay text", async () => {
    const { user } = await workspace.render();
    await capture(user, "Fix \\#one #bug on @work login ");
    expect(titleField().value).toBe("Fix \\#one on login ");
    expect(pills()).toEqual(["work", "bug"]);
    await user.keyboard("{Enter}");
    await waitFor(async () => {
      const task = await onlyTask();
      expect([task.title, task.category, task.tags]).toEqual([
        "Fix #one on login",
        "work",
        ["bug"],
      ]);
    });
  });

  test("shorthand.category: a second category replaces the first", async () => {
    const { user } = await workspace.render();
    await capture(user, "Call @home @work ");
    expect(pills()).toEqual(["work"]);
    await user.keyboard("{Enter}");
    await waitFor(async () => {
      const task = await onlyTask();
      expect([task.title, task.category]).toEqual(["Call", "work"]);
    });
  });

  test("shorthand.tags: #word adds tags", async () => {
    const { user } = await workspace.render();
    await capture(user, "Read #books #later{Enter}");
    await waitFor(async () => expect((await onlyTask()).tags).toEqual(["books", "later"]));
  });

  test("shorthand.toggle: typing a pill again removes it", async () => {
    const { user } = await workspace.render();
    await capture(user, "Read #books #later #books ");
    expect(pills()).toEqual(["later"]);
    await user.keyboard("{Enter}");
    await waitFor(async () => expect((await onlyTask()).tags).toEqual(["later"]));
  });

  test("shorthand.unlift: Backspace right after a lift puts the marker back to fix", async () => {
    const { user } = await workspace.render();
    await capture(user, "Read #bokos ");
    expect(pills()).toEqual(["bokos"]);
    await user.keyboard("{Backspace}");
    expect(titleField().value).toBe("Read #bokos");
    expect(pills()).toEqual([]);
    await user.keyboard("{Backspace}{Backspace}{Backspace}{Backspace}ooks ");
    expect(pills()).toEqual(["books"]);
  });

  test("shorthand.pill-click: clicking a pill removes it and keeps the title focused", async () => {
    const { user } = await workspace.render();
    await capture(user, "Read #books ");
    await user.click(within(editor()).getByRole("button", { name: "Remove tag books" }));
    expect(pills()).toEqual([]);
    await focusedTitleField();
  });

  test("shorthand.enter: Enter on a pill the task already has removes it", async () => {
    const id = await createTagged("Old #errand");
    const { user } = await workspace.render();
    await user.click(row("Old"));
    await focusedTitleField();
    await user.keyboard("{End} #e");
    await suggestion(/errand.*remove/);
    await user.keyboard("{Enter}");
    expect(pills()).toEqual([]);
    await user.keyboard("{Enter}");
    await waitFor(async () => expect((await workspace.task(id)).tags).toEqual([]));
  });

  test("shorthand.tab: Tab completes a suggestion as text, then Enter saves it", async () => {
    await createTagged("Old #errand");
    const { user } = await workspace.render();
    await capture(user, "Buy #e");
    await suggestion(/errand/);
    await user.keyboard("{Tab}");
    expect(titleField().value).toBe("Buy #errand");
    expect(pills()).toEqual([]);
    await user.keyboard("{Enter}");
    await waitFor(async () => expect((await taskTitled("Buy")).tags).toEqual(["errand"]));
  });

  describe("on Android", () => {
    beforeEach(() => {
      vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Linux; Android 16)");
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    function barKey(user: UserEvent, name: string): Promise<void> {
      const bar = screen.getByRole("toolbar", { name: "Keyboard keys" });
      const button = within(bar).getByRole("button", { name });
      button.setPointerCapture = vi.fn();
      return user.click(button);
    }

    test("platform.keyboard-bar: markers and cursor arrows keep focus in text fields", async () => {
      const { user } = await workspace.render();
      await capture(user, "Buy milk");
      const bar = screen.getByRole("toolbar", { name: "Keyboard keys" });
      expect(
        within(bar)
          .getAllByRole("button")
          .map((button) => button.getAttribute("aria-label")),
      ).toEqual(["Escape", "@", "#", "Move cursor left", "Move cursor right"]);
      await barKey(user, "Move cursor left");
      expect(titleField().selectionStart).toBe(7);
      await barKey(user, "Move cursor right");
      expect(titleField().selectionStart).toBe(8);
      titleField().setSelectionRange(4, 8);
      await barKey(user, "Move cursor left");
      expect(titleField().selectionStart).toBe(4);
      await barKey(user, "#");
      expect(titleField().value).toBe("Buy #milk");
      await focusedTitleField();
      await user.keyboard("{Tab}");
      await barKey(user, "@");
      await focusedTitleField();
      await user.keyboard("{Tab}{Tab}");
      const notes =
        within(editor()).getByPlaceholderText<HTMLTextAreaElement>("Write in Markdown…");
      await user.keyboard("A😀B");
      await barKey(user, "Move cursor left");
      expect(notes.selectionStart).toBe(3);
      await barKey(user, "Move cursor left");
      expect(notes.selectionStart).toBe(1);
      await barKey(user, "#");
      expect(notes.value).toBe("A#😀B");
      expect(document.activeElement).toBe(notes);
    });

    test("platform.keyboard-bar: Escape uses the focused field's behavior before canceling", async () => {
      const { user } = await workspace.render();
      await capture(user, "Buy #er");
      await barKey(user, "Escape");
      expect(titleField().value).toBe("Buy ");
      await focusedTitleField();
      await user.keyboard("{Tab}{Tab}Notes");
      await barKey(user, "Escape");
      await focusedTitleField();
      await barKey(user, "Escape");
      expect(screen.queryByRole("toolbar", { name: "Keyboard keys" })).toBeNull();
      await capture(user, "Another task");
      await user.keyboard("{Tab}");
      await barKey(user, "Escape");
      expect(screen.queryByRole("toolbar", { name: "Keyboard keys" })).toBeNull();
    });

    test("platform.keyboard-bar: holding a touch arrow repeats and release stops it", async () => {
      const { user } = await workspace.render();
      await capture(user, "Buy milk");
      const bar = screen.getByRole("toolbar", { name: "Keyboard keys" });
      const left = within(bar).getByRole("button", { name: "Move cursor left" });
      left.setPointerCapture = vi.fn();
      await user.pointer({ keys: "[TouchA>]", target: left });
      expect(titleField().selectionStart).toBe(7);
      await waitFor(() => expect(titleField().selectionStart).toBeLessThan(7));
      await user.pointer({ keys: "[/TouchA]", target: left });
      const caret = titleField().selectionStart;
      await new Promise((resolve) => setTimeout(resolve, 160));
      expect(titleField().selectionStart).toBe(caret);
      const right = within(bar).getByRole("button", { name: "Move cursor right" });
      right.setPointerCapture = vi.fn();
      await user.pointer({ keys: "[TouchA>]", target: right });
      fireEvent.pointerCancel(right, { pointerId: 2, pointerType: "touch" });
      const canceledCaret = titleField().selectionStart;
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(titleField().selectionStart).toBe(canceledCaret);
      await focusedTitleField();
    });
  });

  test("platform.keyboard-bar: desktop has no keyboard bar", async () => {
    const { user } = await workspace.render();
    await capture(user, "Buy ");
    expect(screen.queryByRole("toolbar", { name: "Keyboard keys" })).toBeNull();
  });

  test("shorthand.escape: Escape drops the marker being typed and keeps the editor open", async () => {
    const { user } = await workspace.render();
    await capture(user, "Buy #er{Escape}");
    expect(titleField().value).toBe("Buy ");
    await user.keyboard("milk{Enter}");
    await waitFor(async () => expect((await onlyTask()).title).toBe("Buy milk"));
  });

  test("shorthand.save: a marker left in the title counts on save but never removes a pill", async () => {
    const { user } = await workspace.render();
    await capture(user, "Read #later #soon #later{Control>}{Enter}{/Control}");
    await waitFor(async () => {
      const task = await onlyTask();
      expect([task.title, task.tags]).toEqual(["Read", ["later", "soon"]]);
    });
  });

  test("shorthand.literal: editing shows the title without markers and the classification as pills", async () => {
    const { task } = await workspace.command<{ task: { id: string } }>("task.create", {
      text: "Call #phone tomorrow @home",
      description: "Ask about @work #later",
    });
    await workspace.command("task.create", { title: "Ping @alice" });
    const { user } = await workspace.render();
    await user.click(row("Call tomorrow"));
    expect((await focusedTitleField()).value).toBe("Call tomorrow ");
    expect(pills()).toEqual(["home", "phone"]);
    await user.keyboard("#later {Enter}");
    await waitFor(async () => {
      const saved = await workspace.task(task.id);
      expect([saved.title, saved.category, saved.tags, saved.description]).toEqual([
        "Call tomorrow",
        "home",
        ["later", "phone"],
        "Ask about @work #later",
      ]);
    });
    await expectListFocused();
    await user.click(row("Ping @alice"));
    expect((await focusedTitleField()).value).toBe("Ping \\@alice ");
  });

  test("shorthand.empty: a title that is only shorthand is refused", async () => {
    const { user } = await workspace.render();
    await capture(user, "@home{Enter}");
    await waitFor(() => expect(titleField().getAttribute("aria-invalid")).toBe("true"));
    const { tasks } = await workspace.command<{ tasks: unknown[] }>("task.list", {});
    expect(tasks).toHaveLength(0);
  });
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

  test("pick.refusals: a choice that would create a cycle is refused before sending", async () => {
    const first = await workspace.create("First");
    const second = await workspace.create("Second");
    await workspace.change("task.dependency.add", first.id, { dependsOnId: second.id });
    const { user } = await workspace.render();
    await expectActive("Second");
    await user.keyboard("b");
    await screen.findByRole("dialog");
    await user.keyboard("First{Enter}");
    await waitFor(() => expect(announcements()).toMatch(/cycle|refused|can't|cannot/i));
    expect((await workspace.task(second.id)).dependencyIds).toEqual([]);
  });
});
