import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { AppWorkspace } from "@/testing/appWorkspace";
import { announcements, expectActive, expectRows, row, selectedTitles } from "@/testing/taskList";

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

  test("copy.text: Ctrl+C copies the title and description without shorthand", async () => {
    await workspace.create("Call Sam", {
      description: "about the lease",
      category: "home",
      tags: ["phone"],
    });
    const { user } = await workspace.render();
    await expectActive("Call Sam");
    await user.keyboard("{Control>}c{/Control}");
    await waitFor(async () =>
      expect(await navigator.clipboard.readText()).toBe("Call Sam about the lease"),
    );
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
    await screen.findByText("Undo status change to Open");
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
    first.view.unmount();

    const second = await workspace.render();
    await expectActive("Task");
    await second.user.keyboard("{Control>}z{/Control}");
    await waitFor(async () => expect((await workspace.task(task.id)).priority).toBe(2));
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
