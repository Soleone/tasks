import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { AppWorkspace } from "@/testing/appWorkspace";
import { fakeImageClipboard } from "@/testing/imageClipboard";
import {
  activeTitle,
  announcements,
  expectActive,
  expectListFocused,
  expectRows,
  row,
  selectedTitles,
} from "@/testing/taskList";

let workspace: AppWorkspace;
beforeEach(async () => {
  workspace = await AppWorkspace.start();
});
afterEach(async () => {
  await workspace.stop();
});

function rowStatus(title: string): string | null | undefined {
  return row(title).querySelector("[data-status]")?.getAttribute("data-status");
}

async function expectStatus(id: string, status: string): Promise<void> {
  await waitFor(async () => expect((await workspace.task(id)).status).toBe(status));
}

describe("status", () => {
  test("status.forward: Space moves open to in progress, then to done", async () => {
    const task = await workspace.create("Task");
    const { user } = await workspace.render();
    await expectActive("Task");
    await user.keyboard(" ");
    await expectStatus(task.id, "in_progress");
    await waitFor(() =>
      expect(row("Task").querySelector("[data-status]")?.getAttribute("data-status")).toBe(
        "in_progress",
      ),
    );
    await user.keyboard(" ");
    await expectStatus(task.id, "done");
  });

  test("status.back: Shift+Space moves open to done and in progress back to open", async () => {
    const open = await workspace.create("Open");
    const started = await workspace.create("Started");
    await workspace.change("task.start", started.id);
    const { user } = await workspace.render();
    await expectActive("Started");
    await user.keyboard("{Shift>} {/Shift}");
    await expectStatus(started.id, "open");
    await user.keyboard("{ArrowDown}");
    await expectActive("Open");
    await user.keyboard("{Shift>} {/Shift}");
    await expectStatus(open.id, "done");
  });

  test("status.pause: P pauses an open task and resumes a paused one to in progress", async () => {
    const task = await workspace.create("Task");
    const { user } = await workspace.render();
    await expectActive("Task");
    await user.keyboard("p");
    await expectStatus(task.id, "paused");
    await screen.findByText("Task marked as paused");
    await user.keyboard("fs");
    await expectRows(["Task"]);
    // The Active view's pending exit must not remove the task from Inactive.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await expectRows(["Task"]);
    expect(document.querySelector("[data-filter-summary]")?.textContent).toBe("1 inactive task");
    await user.keyboard("p");
    await expectStatus(task.id, "in_progress");
  });

  test("status.cancel: Delete cancels the task without erasing it", async () => {
    const task = await workspace.create("Task");
    const { user } = await workspace.render();
    await expectActive("Task");
    await user.keyboard("{Delete}");
    await expectStatus(task.id, "canceled");
  });

  test("status.batch: a status key with several selected changes them in one batch", async () => {
    const a = await workspace.create("A");
    const b = await workspace.create("B");
    const { user } = await workspace.render();
    await expectActive("B");
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    await waitFor(() => expect(selectedTitles()).toEqual(["B", "A"]));
    await user.keyboard(" ");
    await expectStatus(a.id, "in_progress");
    await expectStatus(b.id, "in_progress");
  });

  test("status.batch-pause: P skips done tasks in the selection and pauses the rest", async () => {
    const open = await workspace.create("Open");
    const done = await workspace.create("Done");
    await workspace.change("task.complete", done.id);
    const { user } = await workspace.render();
    await user.keyboard("fs");
    await expectRows(["Done"]);
    await user.keyboard("fs");
    await expectRows(["Open"]);
    await user.keyboard("p");
    await expectStatus(open.id, "paused");
    expect((await workspace.task(done.id)).status).toBe("done");
  });

  test("status.stale: a task changed elsewhere is not changed and the app says to refresh", async () => {
    const task = await workspace.create("Task");
    const { user } = await workspace.render();
    await expectActive("Task");
    await workspace.change("task.update", task.id, { description: "changed elsewhere" });
    await user.keyboard(" ");
    await waitFor(() => expect(announcements()).toMatch(/refresh|changed/i));
    expect((await workspace.task(task.id)).status).toBe("open");
    expect(rowStatus("Task")).toBe("open");
  });

  test("status.immediate: the row changes before the save and quick repeats apply in order", async () => {
    const task = await workspace.create("Task");
    const { user } = await workspace.render();
    await expectActive("Task");
    await user.keyboard(" ");
    expect(rowStatus("Task")).toBe("in_progress");
    await user.keyboard("0");
    expect(row("Task").querySelector("[data-priority]")?.getAttribute("data-priority")).toBe("P0");
    await waitFor(async () => {
      const saved = await workspace.task(task.id);
      expect([saved.status, saved.priority]).toEqual(["in_progress", 0]);
    });
    await waitFor(() => expect(announcements()).toMatch(/priority/));
  });

  test("status.immediate: a refresh during a save keeps the change and the next key builds on it", async () => {
    const task = await workspace.create("Task");
    const { user } = await workspace.render();
    await expectActive("Task");
    const original = globalThis.fetch;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = async (...args) => {
      const response = await original(...args);
      const body = typeof args[1]?.body === "string" ? JSON.parse(args[1].body) : null;
      if (body?.command === "task.start") await held;
      return response;
    };
    try {
      await user.keyboard(" ");
      window.dispatchEvent(new Event("focus"));
      await waitFor(async () => expect((await workspace.task(task.id)).status).toBe("in_progress"));
      // The refresh has answered with the saved state by now; the row still shows the change.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(rowStatus("Task")).toBe("in_progress");
      await user.keyboard(" ");
    } finally {
      release();
      globalThis.fetch = original;
    }
    await expectStatus(task.id, "done");
  });
});

function sheenStep(title: string): string | null {
  const status = row(title).querySelector("[data-status]") as HTMLElement | null;
  return status?.hasAttribute("data-completion-sheen")
    ? status.style.getPropertyValue("--sheen-step")
    : null;
}

function doneTodayButton(): HTMLElement | null {
  return document.querySelector("[data-done-today]");
}

describe("completion", () => {
  test("done.sheen: completing plays a wave once; undo, redo and outside changes never do", async () => {
    await workspace.create("Third");
    await workspace.create("Second");
    await workspace.create("First");
    const paused = await workspace.create("Paused");
    await workspace.change("task.pause", paused.id);
    const { user } = await workspace.render();
    await expectActive("First");
    await user.keyboard("{Shift>}{ArrowDown}{ArrowDown}{/Shift}{Shift>} {/Shift}");
    await waitFor(() =>
      expect(["First", "Second", "Third"].map(sheenStep)).toEqual(["0", "1", "2"]),
    );
    // The rows leave only after the wave has played.
    await expectRows([]);

    await user.keyboard("fs");
    await expectRows(["Paused", "First", "Second", "Third"]);
    await expectActive("Paused");
    await user.keyboard(" ");
    await waitFor(() => expect(sheenStep("Paused")).toBe("0"));
    await waitFor(() => expect(sheenStep("Paused")).toBeNull(), { timeout: 2000 });
    await expectStatus(paused.id, "done");
    await user.keyboard("{Control>}z{/Control}");
    await expectStatus(paused.id, "paused");
    await user.keyboard("{Control>}y{/Control}");
    await expectStatus(paused.id, "done");
    await waitFor(() => expect(rowStatus("Paused")).toBe("done"));
    expect(sheenStep("Paused")).toBeNull();
    expect(sheenStep("First")).toBeNull();
  });

  test("done.today: the header counts completions from any client and undo takes one back", async () => {
    const mine = await workspace.create("Mine");
    const theirs = await workspace.create("Theirs");
    const { user } = await workspace.render();
    await expectActive("Theirs");
    expect(doneTodayButton()).toBeNull();
    await user.keyboard("d");
    await waitFor(() => expect(announcements()).toMatch(/Nothing done in the last 24 hours/));
    await user.keyboard("{ArrowDown}{Shift>} {/Shift}");
    await expectStatus(mine.id, "done");
    await waitFor(() => expect(doneTodayButton()?.getAttribute("aria-label")).toBe("1 done today"));
    const { task: seen } = await workspace.cli<{ task: { version: number } }>("task.get", {
      id: theirs.id,
    });
    await workspace.cli("task.complete", { id: theirs.id, expectedVersion: seen.version });
    // The list picks up the outside write on its next revision check.
    await waitFor(
      () => expect(doneTodayButton()?.getAttribute("aria-label")).toBe("2 done today"),
      { timeout: 4000 },
    );
    await user.keyboard("{Control>}z{/Control}");
    await expectStatus(mine.id, "open");
    await waitFor(() => expect(doneTodayButton()?.getAttribute("aria-label")).toBe("1 done today"));
  });

  test("done.today-list: D, the count and the palette open the list, and closing returns focus", async () => {
    const older = await workspace.create("Older");
    const newer = await workspace.create("Newer");
    await workspace.change("task.complete", older.id);
    await workspace.change("task.complete", newer.id);
    await workspace.create("Still open");
    const { user } = await workspace.render();
    await expectActive("Still open");
    await waitFor(() => expect(doneTodayButton()).not.toBeNull());
    await user.click(doneTodayButton()!);
    const list = await screen.findByRole("dialog", { name: "Done today" });
    expect([...list.querySelectorAll("li")].map((item) => item.textContent)).toEqual([
      expect.stringContaining("Newer"),
      expect.stringContaining("Older"),
    ]);
    // A long title may be cut off, so its full text is on hover.
    expect(within(list).getByText("Newer").getAttribute("title")).toBe("Newer");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Done today" })).toBeNull());
    await expectListFocused();

    // The scrolling list takes focus, so arrows scroll it instead of moving the active row.
    await user.keyboard("d");
    const scroller = await screen.findByRole("list", { name: "Tasks done today" });
    await waitFor(() => expect(document.activeElement).toBe(scroller));
    await user.keyboard("{ArrowDown}{End}");
    expect(activeTitle()).toBe("Still open");
    await user.keyboard("{Escape}");
    await expectListFocused();

    await user.keyboard("{Control>}k{/Control}done today");
    await user.click(screen.getByRole("option", { name: /Done today/ }));
    await screen.findByRole("dialog", { name: "Done today" });
    await user.keyboard("{Escape}");
    await expectListFocused();
  });

  test("done.all-clear: emptying the Active view after completing work says so", async () => {
    await workspace.create("Last one");
    const { user } = await workspace.render();
    await expectActive("Last one");
    await user.keyboard("{Shift>} {/Shift}");
    await waitFor(() => expect(screen.getByText("All clear")).toBeTruthy());
    expect(screen.getByText(/1 done today\./)).toBeTruthy();
  });
});

describe("priority and copy", () => {
  test("priority.set: a digit sets the active task's priority", async () => {
    const task = await workspace.create("Task");
    const { user } = await workspace.render();
    await expectActive("Task");
    await user.keyboard("0");
    await waitFor(async () => expect((await workspace.task(task.id)).priority).toBe(0));
    await waitFor(() =>
      expect(row("Task").querySelector("[data-priority]")?.getAttribute("data-priority")).toBe(
        "P0",
      ),
    );
  });

  test("copy.text: Ctrl+C copies the title, description and tags without the category", async () => {
    await workspace.create("Call Sam", {
      description: "about the lease",
      category: "home",
      tags: ["phone", "urgent"],
    });
    const { user } = await workspace.render();
    await expectActive("Call Sam");
    await user.keyboard("{Control>}c{/Control}");
    await waitFor(async () =>
      expect(await navigator.clipboard.readText()).toBe("Call Sam about the lease #phone #urgent"),
    );
  });
});

describe("copy image", () => {
  test("attach.copy: Ctrl+Shift+C copies the newest image; a task without one, or missing it, says so", async () => {
    const lost = await workspace.storeImage(3);
    await workspace.create("Lost", { attachments: [lost] });
    await workspace.loseImage(lost);
    await workspace.create("Shots", {
      attachments: [await workspace.storeImage(1), await workspace.storeImage(2)],
    });
    await workspace.create("Plain");
    const { user } = await workspace.render();
    const copied = fakeImageClipboard();
    const copyImage = () => user.keyboard("{Control>}{Shift>}c{/Shift}{/Control}");
    await expectActive("Plain");
    await copyImage();
    await screen.findByText("This task has no images.");
    await user.keyboard("{ArrowDown}");
    await expectActive("Shots");
    await copyImage();
    await screen.findByText("Image copied to clipboard");
    expect((await copied())?.at(-1)).toBe(2);
    await user.keyboard("{ArrowDown}");
    await expectActive("Lost");
    await copyImage();
    await screen.findByText(/isn't on this device/);
  });

  test("platform.copy-image: where the browser can't write images, copying says so", async () => {
    await workspace.create("Shots", { attachments: [await workspace.storeImage()] });
    const { user } = await workspace.render();
    await expectActive("Shots");
    await user.keyboard("{Control>}{Shift>}c{/Shift}{/Control}");
    await screen.findByText("Couldn't copy the image. This device can't copy images.");
  });
});

describe("undo", () => {
  test("undo.latest: Ctrl+Z undoes and confirms the latest change; redo shortcuts never undo", async () => {
    const task = await workspace.create("Task");
    const { user } = await workspace.render();
    await expectActive("Task");
    await user.keyboard(" ");
    await expectStatus(task.id, "in_progress");
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Undo" }).disabled).toBe(false),
    );
    const saved = await workspace.task(task.id);
    await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}{Control>}y{/Control}");
    expect(await workspace.task(task.id)).toEqual(saved);
    await user.keyboard("{Control>}z{/Control}");
    await expectStatus(task.id, "open");
    const toast = (await screen.findByText("Undo status change to Open")).closest(
      "[data-slot=toast]",
    );
    expect(toast?.querySelector("svg.lucide-circle")).not.toBeNull();
    await user.keyboard("{Delete}");
    await expectStatus(task.id, "canceled");
    await user.keyboard("{Control>}z{/Control}");
    await expectStatus(task.id, "open");
    await expectRows(["Task"]);
    await expectActive("Task");
  });

  test("undo.batch: one undo restores every task in a batch", async () => {
    const a = await workspace.create("A");
    const b = await workspace.create("B");
    const { user } = await workspace.render();
    await expectActive("B");
    await user.keyboard("{Shift>}{ArrowDown}{/Shift} ");
    await expectStatus(a.id, "in_progress");
    await expectStatus(b.id, "in_progress");
    await user.keyboard("{Control>}z{/Control}");
    await expectStatus(a.id, "open");
    await expectStatus(b.id, "open");
    const toast = (
      await screen.findByText("Undid changes for 2 tasks", { selector: "[data-slot=toast-title]" })
    ).closest("[data-slot=toast]");
    expect(toast?.querySelector("svg.lucide-circle")).not.toBeNull();
  });

  test("undo.scope: changes from the CLI or agents are never offered", async () => {
    const task = await workspace.create("Task");
    await workspace.change("task.start", task.id);
    const { user } = await workspace.render();
    await expectActive("Task");
    await user.keyboard("{Control>}z{/Control}");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await workspace.task(task.id)).status).toBe("in_progress");
  });

  test("undo.depth: this client's change remains undoable after reopening the workspace", async () => {
    const task = await workspace.create("Task");
    const first = await workspace.render();
    await expectActive("Task");
    await first.user.keyboard("0");
    await waitFor(() =>
      expect(row("Task").querySelector("[data-priority]")?.getAttribute("data-priority")).toBe(
        "P0",
      ),
    );
    // The history entry is saved after the write; reopening before that would find nothing.
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Undo" }).disabled).toBe(false),
    );
    first.view.unmount();

    const second = await workspace.render();
    await expectActive("Task");
    await second.user.keyboard("{Control>}z{/Control}");
    await waitFor(async () => expect((await workspace.task(task.id)).priority).toBe(2));
    const toast = (await screen.findByText("Undo priority change to P2")).closest(
      "[data-slot=toast]",
    );
    expect(toast?.querySelector("[data-priority=P2]")?.classList.contains("bg-green-500")).toBe(
      true,
    );
    await waitFor(() =>
      expect(row("Task").querySelector("[data-priority]")?.getAttribute("data-priority")).toBe(
        "P2",
      ),
    );
  });

  test("undo.capture: undoing a capture removes the new task", async () => {
    const { user } = await workspace.render();
    await user.keyboard("c");
    await user.keyboard("Captured{Enter}");
    await expectRows(["Captured"]);
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Undo" }).disabled).toBe(false),
    );
    await user.keyboard("{Control>}z{/Control}");
    await expectRows([]);
  });

  test("undo.refused: an undo whose status changed since is refused, and the next undo tries the older change", async () => {
    const task = await workspace.create("Task");
    const { user } = await workspace.render();
    await expectActive("Task");
    await user.keyboard("1");
    await waitFor(async () => expect((await workspace.task(task.id)).priority).toBe(1));
    await user.keyboard(" ");
    await expectStatus(task.id, "in_progress");
    await workspace.change("task.pause", task.id);
    await user.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(announcements()).toMatch(/Undo is no longer available/));
    expect((await workspace.task(task.id)).status).toBe("paused");
    await user.keyboard("{Control>}z{/Control}");
    await waitFor(async () => expect((await workspace.task(task.id)).priority).toBe(2));
  });
});
