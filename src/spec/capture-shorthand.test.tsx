import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { AppWorkspace } from "@/testing/appWorkspace";
import { expectActive, expectListFocused, focusedTitleField, row } from "@/testing/taskList";

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

describe("shorthand", () => {
  function titleField(): HTMLInputElement {
    return within(editor()).getByPlaceholderText("What needs doing?");
  }

  function pills(): string[] {
    return ["Category", "Tags", "Due date"].flatMap((name) =>
      within(within(editor()).getByRole("list", { name }))
        .queryAllByRole("listitem")
        // A tag's leading # is decoration.
        .map((item) => item.textContent?.replace(/^#/, "") ?? ""),
    );
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

  test("shorthand.match: typed letters light up in the pills they start", async () => {
    const { user } = await workspace.render();
    await capture(user, "Read @home #books #bonus !tomorrow #b");
    const lit = () =>
      [...editor().querySelectorAll("[data-pill] mark")].map((mark) => mark.textContent);
    expect(lit()).toEqual(["#b", "#b"]);
    await user.keyboard("oo");
    expect(lit()).toEqual(["#boo"]);
    await user.keyboard("{Backspace}{Backspace}{Backspace}{Backspace}@ho");
    expect(lit()).toEqual(["ho"]);
    await user.keyboard("{Backspace}{Backspace}{Backspace}!t");
    expect(lit()).toEqual([]);
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

  test("shorthand.unlift: Backspace after a paste restores only the last lifted token", async () => {
    const { user } = await workspace.render();
    await capture(user, "Read ");
    await user.paste("#one #two ");
    expect(pills()).toEqual(["one", "two"]);
    await user.keyboard("{Backspace}");
    expect(titleField().value).toBe("Read #two");
    expect(pills()).toEqual(["one"]);
    await user.keyboard("{Enter}");
    await waitFor(async () => expect((await onlyTask()).tags).toEqual(["one", "two"]));
  });

  test.each(["#one@two", "@one#two"])(
    "shorthand.literal: joined markers %s stay plain text",
    async (text) => {
      const { user } = await workspace.render();
      await capture(user, `Keep ${text} @work #real `);
      expect(pills()).toEqual(["work", "real"]);
      await user.keyboard("{Enter}");
      await waitFor(async () => {
        const task = await onlyTask();
        expect([task.title, task.category, task.tags]).toEqual([`Keep ${text}`, "work", ["real"]]);
      });
    },
  );

  test("shorthand.pill-click: clicking a pill removes it and keeps the title focused", async () => {
    const { user } = await workspace.render();
    await capture(user, "Read #books ");
    await user.click(within(editor()).getByRole("button", { name: "Remove tag books" }));
    expect(pills()).toEqual([]);
    await focusedTitleField();
  });

  test("shorthand.pill-exit: a removed pill fades out where it was, then goes", async () => {
    const { user } = await workspace.render();
    await capture(user, "Read #books #later ");
    let finish = () => {};
    HTMLElement.prototype.animate = vi.fn(
      () =>
        ({
          finished: new Promise<void>((resolve) => {
            finish = resolve;
          }),
        }) as unknown as Animation,
    );
    try {
      const row = within(editor()).getByRole("list", { name: "Tags" });
      await user.click(within(row).getByRole("button", { name: "Remove tag books" }));
      expect(pills()).toEqual(["later"]);
      expect(row.textContent).toBe("#books#later");
      act(() => finish());
      await waitFor(() => expect(row.textContent).toBe("#later"));
    } finally {
      delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
    }
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

  test("shorthand.tab: a second Tab chooses the completed name, and the editor stays open", async () => {
    await createTagged("Old #errand");
    const { user } = await workspace.render();
    await capture(user, "Buy #e");
    await suggestion(/errand/);
    await user.keyboard("{Tab}{Tab}");
    expect(pills()).toEqual(["errand"]);
    expect(titleField().value).toBe("Buy ");
    await focusedTitleField();
  });

  describe("on Android", () => {
    beforeEach(() => {
      vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Linux; Android 16)");
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    test("platform.editor-buttons: no Cancel or Save in the editor; the description line opens the description", async () => {
      const { user } = await workspace.render();
      await capture(user, "Task");
      for (const name of ["Cancel", "Add task"])
        expect(within(editor()).queryByRole("button", { name })).toBeNull();
      await user.click(within(editor()).getByRole("button", { name: "Add a description…" }));
      const notes = await screen.findByPlaceholderText("Write in Markdown…");
      await waitFor(() => expect(document.activeElement).toBe(notes));
      expect(within(editor()).queryByRole("button", { name: "Add a description…" })).toBeNull();
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
      ).toEqual(["Escape", "@", "#", "!", "Move cursor left", "Move cursor right", "Add task"]);
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
      await barKey(user, "Escape");
      expect(screen.queryByRole("toolbar", { name: "Keyboard keys" })).toBeNull();
    });

    test("platform.keyboard-bar: the tap that closes the editor with Escape doesn't reach the list", async () => {
      await workspace.create("Buy milk");
      const { user } = await workspace.render();
      await capture(user, "Draft");
      const bar = screen.getByRole("toolbar", { name: "Keyboard keys" });
      fireEvent.pointerDown(within(bar).getByRole("button", { name: "Escape" }), {
        button: 0,
        pointerType: "touch",
      });
      await waitFor(() =>
        expect(screen.queryByRole("toolbar", { name: "Keyboard keys" })).toBeNull(),
      );
      fireEvent.click(within(row("Buy milk")).getByRole("img", { name: /^Status: Open/ }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect((await onlyTask()).status).toBe("open");
    });

    test("platform.keyboard-bar: Save saves from the description", async () => {
      await workspace.create("Buy milk");
      const { user } = await workspace.render();
      await user.keyboard("{ArrowDown}");
      await expectActive("Buy milk");
      await user.keyboard("{Enter}");
      await focusedTitleField();
      await user.keyboard("{Tab}Oat, not dairy");
      await barKey(user, "Save changes");
      await waitFor(async () => expect((await onlyTask()).description).toBe("Oat, not dairy"));
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
