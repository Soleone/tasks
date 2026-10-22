import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { AppWorkspace } from "@/testing/appWorkspace";
import {
  announcements,
  expectActive,
  expectRows,
  focusedTitleField,
  row,
} from "@/testing/taskList";
import { selectedMainWorkspace } from "@/platform/backendClient";

let workspace: AppWorkspace;
beforeEach(async () => {
  workspace = await AppWorkspace.start();
});
afterEach(async () => {
  await workspace.stop();
});

function historyButton(name: "Undo" | "Redo"): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>("button", { name });
}

async function expectPriority(id: string, priority: number): Promise<void> {
  await waitFor(async () => expect((await workspace.task(id)).priority).toBe(priority));
  await waitFor(() => expect(historyButton("Undo").disabled).toBe(false));
}

for (const [name, keys] of [
  ["Ctrl+Y", "{Control>}y{/Control}"],
  ["Ctrl+Shift+Z", "{Control>}{Shift>}z{/Shift}{/Control}"],
  ["Meta+Shift+Z", "{Meta>}{Shift>}z{/Shift}{/Meta}"],
]) {
  test(`redo.latest: ${name} reapplies an undone change and makes it undoable again`, async () => {
    const task = await workspace.create("Task");
    const { user } = await workspace.render();
    await expectActive("Task");
    await user.keyboard("0");
    await expectPriority(task.id, 0);
    await user.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(historyButton("Redo").disabled).toBe(false));
    expect((await workspace.task(task.id)).priority).toBe(2);
    const undoToast = (await screen.findByText("Undo priority change to P2")).closest(
      "[data-slot=toast]",
    );
    expect(undoToast?.querySelector("[data-priority=P2]")).not.toBeNull();
    await user.keyboard(keys);
    await expectPriority(task.id, 0);
    const redoToast = (await screen.findByText("Redo priority change to P0")).closest(
      "[data-slot=toast]",
    );
    expect(redoToast?.querySelector("[data-priority=P0]")?.classList.contains("bg-red-500")).toBe(
      true,
    );
    await waitFor(() => expect(historyButton("Redo").disabled).toBe(true));
    await user.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(historyButton("Redo").disabled).toBe(false));
    expect((await workspace.task(task.id)).priority).toBe(2);
  });
}

test("redo.latest: a status redo shows the restored status icon", async () => {
  const task = await workspace.create("Task");
  const { user } = await workspace.render();
  await expectActive("Task");
  await user.keyboard("{Shift>} {/Shift}");
  await waitFor(() => expect(historyButton("Undo").disabled).toBe(false));
  await user.keyboard("{Control>}z{/Control}");
  await waitFor(() => expect(historyButton("Redo").disabled).toBe(false));
  await user.keyboard("{Control>}y{/Control}");
  const toast = (await screen.findByText("Redo status change to Done")).closest(
    "[data-slot=toast]",
  );
  expect(toast?.querySelector("svg.lucide-circle-check.task-completion-icon")).not.toBeNull();
  expect((await workspace.task(task.id)).status).toBe("done");
});

test("redo.capture: an undone sole capture survives reopen and the Redo button restores its ID", async () => {
  const first = await workspace.render();
  await first.user.keyboard("cCaptured{Enter}");
  await expectRows(["Captured"]);
  await waitFor(() => expect(historyButton("Undo").disabled).toBe(false));
  const before = await workspace.command<{ tasks: { id: string }[] }>("task.list");
  await first.user.keyboard("{Control>}z{/Control}");
  await expectRows([]);
  await waitFor(() => expect(historyButton("Redo").disabled).toBe(false));
  first.view.unmount();

  const second = await workspace.render();
  await waitFor(() => expect(historyButton("Redo").disabled).toBe(false));
  await second.user.click(historyButton("Redo"));
  await expectRows(["Captured"]);
  await expectActive("Captured");
  const after = await workspace.command<{ tasks: { id: string }[] }>("task.list");
  expect(after.tasks.map((task) => task.id)).toEqual(before.tasks.map((task) => task.id));
  await waitFor(() => expect(historyButton("Undo").disabled).toBe(false));
  await second.user.click(historyButton("Undo"));
  await expectRows([]);
  await waitFor(() => expect(historyButton("Redo").disabled).toBe(false));
});

test("redo.branch: history walks both ways and only an accepted meaningful edit clears redo", async () => {
  const task = await workspace.create("Task");
  const { user } = await workspace.render();
  await expectActive("Task");
  await user.keyboard("0");
  await expectPriority(task.id, 0);
  await user.keyboard("1");
  await expectPriority(task.id, 1);
  await user.keyboard("{Control>}z{/Control}");
  await waitFor(() => expect(historyButton("Redo").disabled).toBe(false));
  await expectPriority(task.id, 0);
  await user.keyboard("{Control>}z{/Control}");
  await waitFor(async () => expect((await workspace.task(task.id)).priority).toBe(2));
  await waitFor(() => expect(historyButton("Redo").disabled).toBe(false));
  await user.keyboard("{Control>}y{/Control}");
  await expectPriority(task.id, 0);
  await user.keyboard("{Control>}y{/Control}");
  await expectPriority(task.id, 1);
  await user.keyboard("{Control>}z{/Control}");
  await expectPriority(task.id, 0);
  await waitFor(() => expect(historyButton("Redo").disabled).toBe(false));
  await user.keyboard("0v");
  expect(historyButton("Redo").disabled).toBe(false);
  await workspace.change("task.update", task.id, { description: "An agent's note" });
  await user.keyboard("1");
  await waitFor(() => expect(announcements()).toMatch(/refresh|changed/i));
  document.body.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
  await waitFor(() => expect(row("Task").textContent).toContain("An agent's note"));
  await waitFor(() => expect(historyButton("Redo").disabled).toBe(false));
  await user.keyboard("3");
  await expectPriority(task.id, 3);
  await waitFor(() => expect(historyButton("Redo").disabled).toBe(true));
});

test("redo.refused: a conflicting step is dropped and the next redo preserves the external field", async () => {
  const task = await workspace.create("Task");
  const { user } = await workspace.render();
  await expectActive("Task");
  await user.keyboard("0");
  await expectPriority(task.id, 0);
  await user.keyboard(" ");
  await waitFor(async () => expect((await workspace.task(task.id)).status).toBe("in_progress"));
  await user.keyboard("{Control>}z{/Control}");
  await expectPriority(task.id, 0);
  await user.keyboard("{Control>}z{/Control}");
  await waitFor(() => expect(historyButton("Redo").disabled).toBe(false));
  await waitFor(async () => expect((await workspace.task(task.id)).priority).toBe(2));
  await workspace.change("task.update", task.id, { priority: 3 });
  await user.keyboard("{Control>}y{/Control}");
  await waitFor(() => expect(announcements()).toMatch(/Redo is no longer available/));
  await waitFor(() => expect(historyButton("Redo").disabled).toBe(false));
  await user.keyboard("{Control>}y{/Control}");
  await waitFor(async () => expect((await workspace.task(task.id)).status).toBe("in_progress"));
  expect((await workspace.task(task.id)).priority).toBe(3);
});

test("redo.text-history: editors, dialogs and toolbar modes keep task redo out of their keys", async () => {
  const task = await workspace.create("Task");
  const { user } = await workspace.render();
  await expectActive("Task");
  await user.keyboard("0");
  await expectPriority(task.id, 0);
  await user.keyboard("{Control>}z{/Control}");
  await waitFor(() => expect(historyButton("Redo").disabled).toBe(false));
  await user.keyboard("c");
  await focusedTitleField();
  await user.keyboard("Draft{Control>}y{/Control}{Control>}{Shift>}z{/Shift}{/Control}{Escape}");
  expect((await workspace.task(task.id)).priority).toBe(2);
  await user.keyboard("{Control>}k{/Control}{Control>}y{/Control}{Escape}");
  expect((await workspace.task(task.id)).priority).toBe(2);
  await user.keyboard("f{Control>}y{/Control}{Escape}");
  expect((await workspace.task(task.id)).priority).toBe(2);
  await user.keyboard("{Control>}k{/Control}redo");
  await user.click(screen.getByRole("option", { name: /Redo last change/ }));
  await expectPriority(task.id, 0);
});

test("redo.confirmed: a lost reply keeps history in place and retries the identical request once", async () => {
  const task = await workspace.create("Task");
  const { user } = await workspace.render();
  await expectActive("Task");
  await user.keyboard("0");
  await expectPriority(task.id, 0);
  await user.keyboard("{Control>}z{/Control}");
  await waitFor(() => expect(historyButton("Redo").disabled).toBe(false));
  const history = await selectedMainWorkspace()!.undoHistory();
  const entry = history.latestRedo();
  const original = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (...args) => {
    const response = await original(...args);
    const body = typeof args[1]?.body === "string" ? JSON.parse(args[1].body) : null;
    if (body?.command === "operation.redo" && !body.dryRun) {
      requests.push(args[1]!.body as string);
      if (requests.length === 1) throw new TypeError("Lost redo reply");
    }
    return response;
  };
  try {
    await user.keyboard("{Control>}y{/Control}");
    await screen.findByRole("button", { name: "Retry same request" });
    expect(history.latestRedo()).toEqual(entry);
    expect(history.latest()).toBeNull();
    await user.keyboard("{Control>}y{/Control}");
    expect(requests).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Retry same request" }));
    await expectPriority(task.id, 0);
    await waitFor(() => expect(history.latestRedo()).toBeNull());
    expect(requests).toHaveLength(2);
    expect(requests[0]).toBe(requests[1]);
  } finally {
    globalThis.fetch = original;
  }
});

test("redo.scope: a pending selected status batch stays one step in both directions", async () => {
  const first = await workspace.create("First");
  const second = await workspace.create("Second");
  const { user } = await workspace.render();
  await expectActive("Second");
  await user.keyboard("0");
  await expectPriority(second.id, 0);
  const original = globalThis.fetch;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalThis.fetch = async (...args) => {
    const response = await original(...args);
    const body = typeof args[1]?.body === "string" ? JSON.parse(args[1].body) : null;
    if (body?.command === "task.transitionMany" && !body.dryRun) await held;
    return response;
  };
  try {
    await user.keyboard("{Shift>}{ArrowDown}{/Shift} ");
    await waitFor(async () => expect((await workspace.task(first.id)).status).toBe("in_progress"));
    await user.keyboard("{Control>}z{/Control}");
    release();
    await waitFor(() => expect(historyButton("Redo").disabled).toBe(false));
    for (const id of [first.id, second.id]) expect((await workspace.task(id)).status).toBe("open");
    expect((await workspace.task(second.id)).priority).toBe(0);
    await user.keyboard("{Control>}y{/Control}");
    await waitFor(() => expect(historyButton("Redo").disabled).toBe(true));
    for (const id of [first.id, second.id])
      expect((await workspace.task(id)).status).toBe("in_progress");
  } finally {
    release();
    globalThis.fetch = original;
  }
});

test("redo.confirmed: undo waits for pending writes and reverses the newest accepted step", async () => {
  const task = await workspace.create("Task");
  const { user } = await workspace.render();
  await expectActive("Task");
  await user.keyboard("0");
  await expectPriority(task.id, 0);
  const original = globalThis.fetch;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalThis.fetch = async (...args) => {
    const response = await original(...args);
    const body = typeof args[1]?.body === "string" ? JSON.parse(args[1].body) : null;
    if (body?.command === "task.update" && body.args.priority === 1) await held;
    return response;
  };
  try {
    await user.keyboard("1");
    expect(row("Task").querySelector("[data-priority]")?.getAttribute("data-priority")).toBe("P1");
    await user.keyboard("{Control>}z{/Control}");
    release();
    await waitFor(() => expect(historyButton("Redo").disabled).toBe(false));
    await expectPriority(task.id, 0);
    await user.keyboard("{Control>}y{/Control}");
    await expectPriority(task.id, 1);
  } finally {
    release();
    globalThis.fetch = original;
  }
});
