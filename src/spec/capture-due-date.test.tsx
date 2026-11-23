import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { addDays, localToday, parseDueWord } from "@/backend/dueDate";
import { formatDueDate, shortDueDate } from "@/backend/taskDates";
import { AppWorkspace } from "@/testing/appWorkspace";
import { expectListFocused, focusedTitleField } from "@/testing/taskList";

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

function titleField(): HTMLInputElement {
  return within(editor()).getByPlaceholderText("What needs doing?");
}

function pills(): string[] {
  return ["Category", "Tags", "Due date"].flatMap((name) =>
    within(within(editor()).getByRole("list", { name }))
      .queryAllByRole("listitem")
      .map((item) => item.textContent?.replace(/^#/, "") ?? ""),
  );
}

describe("due dates", () => {
  test("shorthand.due: !tmr lifts into a date pill, saves the date and comes off with a click", async () => {
    const tomorrow = addDays(localToday(), 1);
    const { user } = await workspace.render();
    await capture(user, "Pay now! !tmr rent");
    expect(titleField().value).toBe("Pay now! rent");
    expect(pills()).toEqual([shortDueDate(tomorrow, localToday())]);
    await user.hover(screen.getByRole("button", { name: /^Remove due date/ }).firstElementChild!);
    await screen.findByText(`Due ${formatDueDate(tomorrow, localToday())}`);
    await user.keyboard("{Enter}");
    await waitFor(async () => {
      const task = await onlyTask();
      expect([task.title, task.due]).toEqual(["Pay now! rent", tomorrow]);
    });
    await expectListFocused();
    await user.keyboard("{Enter}");
    expect((await focusedTitleField()).value).toBe("Pay now! rent ");
    await user.click(within(editor()).getByRole("button", { name: /^Remove due date/ }));
    expect(pills()).toEqual([]);
    await user.keyboard("{Enter}");
    await waitFor(async () => expect((await onlyTask()).due).toBeNull());
  });

  test("shorthand.suggest-due: ! opens a month that follows the typed word and the arrow keys", async () => {
    const today = localToday();
    const friday = parseDueWord("fri", today)!;
    const { user } = await workspace.render();
    await capture(user, "Pay !");
    await screen.findByRole("group", { name: "Due date picker" });
    const footer = (): string =>
      screen.getByRole("group", { name: "Due date picker" }).querySelector("p")?.textContent ?? "";
    expect(footer()).toBe(`${formatDueDate(today, today)}↵ select`);
    await user.keyboard("fr");
    expect(footer()).toBe(`${formatDueDate(friday, today)}↵ select`);
    await user.keyboard("{ArrowDown}{ArrowLeft}");
    const picked = addDays(friday, 6);
    expect(footer()).toBe(`${formatDueDate(picked, today)}↵ select`);
    await user.keyboard("{Enter}");
    expect(titleField().value).toBe("Pay ");
    expect(pills()).toEqual([shortDueDate(picked, today)]);
    expect(screen.queryByRole("group", { name: "Due date picker" })).toBeNull();
    await user.keyboard("{Enter}");
    await waitFor(async () => expect((await onlyTask()).due).toBe(picked));
  });

  test("shorthand.suggest-due: clicking a day picks it, and the date already set offers remove", async () => {
    const tomorrow = addDays(localToday(), 1);
    const { user } = await workspace.render();
    await capture(user, "Pay !");
    const picker = await screen.findByRole("group", { name: "Due date picker" });
    await user.click(picker.querySelector(`[data-day="${tomorrow}"] button`)!);
    expect(pills()).toEqual([shortDueDate(tomorrow, localToday())]);
    await user.keyboard("!tmr");
    const again = await screen.findByRole("group", { name: "Due date picker" });
    expect(again.querySelector("p")?.textContent).toMatch(/↵ remove$/);
    await user.keyboard("{Enter}");
    expect(pills()).toEqual([]);
  });

  test("shorthand.suggest-due: a bare ! starts on the date already set, so arrows shift it and Enter removes it", async () => {
    const today = localToday();
    const tomorrow = addDays(today, 1);
    const { user } = await workspace.render();
    await capture(user, "Pay !tmr ");
    expect(pills()).toEqual([shortDueDate(tomorrow, today)]);
    await user.keyboard("!");
    const picker = await screen.findByRole("group", { name: "Due date picker" });
    expect(picker.querySelector("p")?.textContent).toBe(
      `${formatDueDate(tomorrow, today)}↵ remove`,
    );
    await user.keyboard("{ArrowRight}{Enter}");
    expect(pills()).toEqual([shortDueDate(addDays(today, 2), today)]);
    await user.keyboard("!{Enter}");
    expect(pills()).toEqual([]);
  });

  test("shorthand.due-strip: a short window shows only the highlighted week, which follows the arrow keys", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: query === "(max-height: 600px)",
          media: query,
          addEventListener() {},
          removeEventListener() {},
        }) as unknown as MediaQueryList,
    );
    try {
      const nextWeek = addDays(localToday(), 7);
      const { user } = await workspace.render();
      await capture(user, "Pay !{ArrowDown}");
      const picker = screen.getByRole("group", { name: "Due date picker" });
      expect(picker.querySelectorAll("tbody tr")).toHaveLength(1);
      expect(picker.querySelector(`[data-day="${nextWeek}"]`)).not.toBeNull();
      expect(within(picker).queryByRole("button", { name: /next month/i })).toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });

  test("shorthand.tab: Tab lifts a date at once", async () => {
    const { user } = await workspace.render();
    await capture(user, "Pay !tm");
    await screen.findByRole("group", { name: "Due date picker" });
    await user.keyboard("{Tab}");
    expect(titleField().value).toBe("Pay ");
    expect(pills()).toEqual([shortDueDate(addDays(localToday(), 1), localToday())]);
  });
});
