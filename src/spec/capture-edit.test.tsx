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

function saved(title: string): string | null {
  return row(title).getAttribute("data-saved-task");
}

describe("opening and closing", () => {
  test("capture.open: C opens the editor with the title focused", async () => {
    const { user } = await workspace.render();
    await user.keyboard("c");
    await focusedTitleField();
  });

  test("capture.child: Shift+C saves the new task as a child of the active task, shown and active", async () => {
    const parent = await workspace.create("Parent");
    const { user } = await workspace.render();
    await expectActive("Parent");
    await user.keyboard("{Shift>}C{/Shift}");
    await focusedTitleField();
    await user.keyboard("Child{Enter}");
    await expectListFocused();
    await expectRows(["Parent", "Child"]);
    await expectActive("Child");
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

  test("edit.switch: clicking another row while editing edits that row instead", async () => {
    const first = await workspace.create("First");
    await workspace.create("Second");
    const { user } = await workspace.render();
    await user.click(row("First"));
    await user.keyboard(" changed");
    await user.click(row("Second"));
    expect((await focusedTitleField()).value).toBe("Second ");
    expect(screen.getAllByRole("form", { name: "Edit task" })).toHaveLength(1);
    expect((await workspace.task(first.id)).title).toBe("First");
  });

  test("edit.click-away: pressing outside the rows cancels the edit and focuses the list", async () => {
    const task = await workspace.create("Edited");
    const { user } = await workspace.render();
    await user.click(row("Edited"));
    await user.keyboard(" changed");
    await user.click(screen.getByRole("listbox", { name: /visible task rows/ }));
    await waitFor(() => expect(screen.queryByRole("form", { name: "Edit task" })).toBeNull());
    await expectListFocused();
    expect((await workspace.task(task.id)).title).toBe("Edited");
  });

  test("edit.click-away: capture stays open", async () => {
    await workspace.create("Existing");
    const { user } = await workspace.render();
    await capture(user, "New");
    await user.click(row("Existing"));
    expect(editor().getAttribute("aria-label")).toBe("New task");
  });

  test("edit.inline: the whole editor scrolls into view, not only the title", async () => {
    await workspace.create("Low on the list");
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    const { user } = await workspace.render();
    await user.click(row("Low on the list"));
    await focusedTitleField();
    const form = editor();
    await waitFor(() => expect(scroll.mock.contexts).toContain(form));
    scroll.mockRestore();
  });

  test("edit.save: Enter saves and focus returns to the list on the saved task", async () => {
    const task = await workspace.create("Old title");
    await workspace.create("Other");
    const { user } = await workspace.render();
    await user.keyboard("{ArrowDown}");
    await expectActive("Old title");
    await user.keyboard("{Enter}");
    const title = await focusedTitleField();
    expect(title.getAttribute("enterkeyhint")).toBe("go");
    await user.clear(title);
    await user.keyboard("New title{Enter}");
    await waitFor(async () => expect((await workspace.task(task.id)).title).toBe("New title"));
    await expectListFocused();
    await expectActive("New title");
  });

  test("edit.saved: saving an edit plays on the saved row, and undo never does", async () => {
    await workspace.create("Old title");
    await workspace.create("Other");
    const { user } = await workspace.render();
    await user.keyboard("{ArrowDown}");
    await expectActive("Old title");
    await user.keyboard("{Enter}");
    await user.clear(await focusedTitleField());
    await user.keyboard("New title{Enter}");
    await waitFor(() => expect(saved("New title")).toBe("updated"));
    expect(saved("Other")).toBeNull();
    await waitFor(() => expect(saved("New title")).toBeNull(), { timeout: 2000 });

    await user.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(saved("Old title")).toBeNull());
  });

  test("edit.saved: saving an edit that changed nothing does not play", async () => {
    const { user } = await workspace.render();
    await capture(user, "Same #home{Enter}");
    await waitFor(() => expect(saved("Same")).toBe("created"));
    await waitFor(() => expect(saved("Same")).toBeNull(), { timeout: 2000 });
    await user.keyboard("{ArrowDown}");
    await expectActive("Same");
    await user.keyboard("{Enter}");
    await focusedTitleField();
    await user.keyboard("{Enter}");
    await expectListFocused();
    expect(saved("Same")).toBeNull();
  });

  test("capture.saved: saving a new task plays its own feedback", async () => {
    const { user } = await workspace.render();
    await capture(user, "Fresh{Enter}");
    await waitFor(() => expect(saved("Fresh")).toBe("created"));
    await waitFor(() => expect(saved("Fresh")).toBeNull(), { timeout: 2000 });
  });

  test("edit.cancel: Escape cancels from the title and from the description", async () => {
    const task = await workspace.create("Keep me");
    const { user } = await workspace.render();
    await user.keyboard("{Enter}");
    await focusedTitleField();
    await user.keyboard(" changed{Escape}");
    await expectListFocused();
    await user.keyboard("{Enter}");
    await focusedTitleField();
    await user.keyboard("{Tab}");
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("placeholder")).toBe("Write in Markdown…"),
    );
    await user.keyboard("Note{Escape}");
    await expectListFocused();
    await expectRows(["Keep me"]);
    expect((await workspace.task(task.id)).description).toBe("");
  });

  test("edit.keeps-draft: a workspace change while editing keeps the draft", async () => {
    await workspace.create("Task");
    const { user } = await workspace.render();
    await capture(user, "Half typed");
    await workspace.create("Arrived elsewhere");
    fireEvent.focus(window);
    await waitFor(() => expect(row("Arrived elsewhere")).toBeTruthy());
    expect((await focusedTitleField()).value).toBe("Half typed");
  });
});

describe("inside the editor", () => {
  test("edit.tab-order: Tab goes title, description and wraps; Shift+Tab opens it too", async () => {
    const { user } = await workspace.render();
    await capture(user, "Task");
    await user.keyboard("{Tab}");
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("placeholder")).toBe("Write in Markdown…"),
    );
    await user.keyboard("{Tab}");
    await focusedTitleField();
    await waitFor(() => expect(screen.queryByPlaceholderText("Write in Markdown…")).toBeNull());
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("placeholder")).toBe("Write in Markdown…"),
    );
  });

  test("edit.caret: Tab puts the caret after the text of the description and the title", async () => {
    const { user } = await workspace.render();
    await capture(user, "Task");
    await user.keyboard("{Tab}Some notes");
    await user.keyboard("{Home}{Tab}");
    const title = await focusedTitleField();
    expect(title.selectionStart).toBe(title.value.length);
    await user.keyboard("{Tab}");
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("placeholder")).toBe("Write in Markdown…"),
    );
    expect((document.activeElement as HTMLTextAreaElement).selectionStart).toBe(
      "Some notes".length,
    );
  });

  test("edit.priority: new tasks start at P2 and an edit keeps the task's priority", async () => {
    const { user } = await workspace.render();
    await capture(user, "Task");
    await user.keyboard("{Enter}");
    await waitFor(async () => expect((await onlyTask()).priority).toBe(2));
    await expectListFocused();
    await user.keyboard("0");
    await waitFor(async () => expect((await onlyTask()).priority).toBe(0));
    await user.keyboard("{Enter}");
    await focusedTitleField();
    await user.keyboard("renamed{Enter}");
    await waitFor(async () => expect((await onlyTask()).title).toBe("Task renamed"));
    expect((await onlyTask()).priority).toBe(0);
  });

  test("edit.description-button: Add description opens the description for the mouse", async () => {
    const { user } = await workspace.render();
    await capture(user, "Task");
    await user.click(within(editor()).getByRole("button", { name: /description/i }));
    await screen.findByPlaceholderText("Write in Markdown…");
  });

  test("edit.description-preview: Markdown typed in the description is styled with every character kept", async () => {
    const { user } = await workspace.render();
    await capture(user, "Task");
    await user.click(within(editor()).getByRole("button", { name: /description/i }));
    const field = await screen.findByPlaceholderText<HTMLTextAreaElement>("Write in Markdown…");
    await user.type(field, "- **Bold** and _under_ snake_case");
    const preview = field.nextElementSibling!;
    expect(preview.textContent).toBe(`${field.value}\n`);
    expect(preview.querySelector("strong")?.textContent).toBe("Bold");
    expect(preview.querySelector("em")?.textContent).toBe("under");
    await user.type(
      field,
      "{Shift>}{Enter}{/Shift}[[site](https://a.example) and https://b.example.",
    );
    expect([...preview.querySelectorAll(".underline")].map((link) => link.textContent)).toEqual([
      "site",
      "https://b.example",
    ]);
    expect(preview.querySelector("a")).toBeNull();
    await user.type(field, "{Shift>}{Enter}{/Shift}- [[x] done");
    expect(preview.textContent).toBe(`${field.value}\n`);
    expect(preview.querySelector("[aria-label=Done]")).not.toBeNull();
    await user.click(preview.querySelector("[aria-label=Done]")!);
    expect(field.value).toMatch(/- \[ \] done$/);
    expect(document.activeElement).toBe(field);
  });

  test("edit.description-list: Enter continues a list, and on an empty item ends it", async () => {
    const { user } = await workspace.render();
    await capture(user, "Task");
    await user.click(within(editor()).getByRole("button", { name: /description/i }));
    const field = await screen.findByPlaceholderText<HTMLTextAreaElement>("Write in Markdown…");
    await user.type(
      field,
      "- one{Enter}two{Enter}{Enter}  - [[x] three{Enter}four{Shift>}{Enter}{/Shift}x",
    );
    expect(field.value).toBe("- one\n- two\n  - [x] three\n  - [ ] four\nx");
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

  test("edit.buttons: each fallback shows the key that does the same from the focused field", async () => {
    const { user } = await workspace.render();
    await capture(user, "Task");
    const keyOf = (name: string) =>
      within(editor()).getByRole("button", { name }).querySelector("kbd")?.textContent ?? null;
    expect(["Cancel", "Add description", "Add task"].map(keyOf)).toEqual(["Esc", "Tab", "↵"]);
    await user.keyboard("{Tab}");
    await waitFor(() => expect(keyOf("Add task")).toBe("Ctrl ↵"));
    expect(keyOf("Cancel")).toBe("Esc");
  });

  test("undo.scope: an edit to title, category and description is undone and redone as one step", async () => {
    const { task } = await workspace.command<{ task: { id: string } }>("task.create", {
      text: "Call @home",
      description: "Old note",
    });
    const fields = async () => {
      const saved = await workspace.task(task.id);
      return [saved.title, saved.category, saved.description];
    };
    const { user } = await workspace.render();
    await user.click(row("Call"));
    await focusedTitleField();
    await user.keyboard("back @work {Tab}{Control>}{End}{/Control} and more");
    await user.keyboard("{Control>}{Enter}{/Control}");
    await expectListFocused();
    const edited = ["Call back", "work", "Old note and more"];
    await waitFor(async () => expect(await fields()).toEqual(edited));
    await user.keyboard("{Control>}z{/Control}");
    await waitFor(async () => expect(await fields()).toEqual(["Call", "home", "Old note"]));
    await user.keyboard("{Control>}y{/Control}");
    await waitFor(async () => expect(await fields()).toEqual(edited));
  });
});
