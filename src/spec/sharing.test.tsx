import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { AppWorkspace } from "@/testing/appWorkspace";

let workspace: AppWorkspace;
beforeEach(async () => {
  workspace = await AppWorkspace.start();
});
afterEach(async () => {
  await workspace.stop();
});

// The app checks the workspace revision every 1.5 seconds.
const refreshed = { timeout: 5000 };

test("share.refresh: the open list shows tasks from the CLI and from other devices without a restart", async () => {
  await workspace.create("Already here");
  await workspace.render({ home: true });

  await workspace.cli("task.create", { title: "From the CLI" });
  expect(await screen.findByText("From the CLI", {}, refreshed)).not.toBeNull();

  await workspace.arrive("c8d4206d-c25a-4317-baa4-a2c5443060e9.json");
  expect(await screen.findByText("Plan launch", {}, refreshed)).not.toBeNull();
  expect(screen.queryByText("Already here")).not.toBeNull();
});

test("conflict.count: the header counts tasks that sync left in two versions and hides at none", async () => {
  const task = await workspace.create("Call the plumber");
  await workspace.render({ home: true });
  expect(document.querySelector("[data-conflict-count]")).toBeNull();

  await workspace.conflict(task.id, { title: "Call the electrician" });

  const count = await screen.findByRole(
    "button",
    { name: "1 task changed on two devices" },
    refreshed,
  );
  expect(count.textContent).toBe("1");
});

test("conflict.dialog: both versions show as tasks, with what differs named", async () => {
  const task = await workspace.create("Call the plumber");
  await workspace.conflict(task.id, { title: "Call the electrician", priority: 0 });
  const { user } = await workspace.render({ home: true });

  await user.click(
    await screen.findByRole("button", { name: "1 task changed on two devices" }, refreshed),
  );

  const dialog = await screen.findByRole("dialog", { name: "Changed on two devices" });
  expect(within(dialog).getByText(/They differ in title and priority\./)).not.toBeNull();
  const [listed, copy] = dialog.querySelectorAll<HTMLElement>("[data-conflict-version]");
  expect(within(listed).getByText("In your list")).not.toBeNull();
  expect(within(listed).getByText("Call the plumber")).not.toBeNull();
  expect(within(copy).getByText("Set aside by sync")).not.toBeNull();
  expect(within(copy).getByText("Call the electrician")).not.toBeNull();
});

test("conflict.keep: keeping the copy puts it in the list, removes the conflict and closes the dialog", async () => {
  const task = await workspace.create("Call the plumber");
  await workspace.conflict(task.id, { title: "Call the electrician" });
  const { user } = await workspace.render({ home: true });
  await user.click(
    await screen.findByRole("button", { name: "1 task changed on two devices" }, refreshed),
  );
  const dialog = await screen.findByRole("dialog", { name: "Changed on two devices" });
  const copy = dialog.querySelectorAll<HTMLElement>("[data-conflict-version]")[1];

  await user.click(within(copy).getByRole("button", { name: "Keep this one" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.querySelector("[data-conflict-count]")).toBeNull();
  expect(await screen.findByText("Call the electrician")).not.toBeNull();
  expect(screen.queryByText("Call the plumber")).toBeNull();
  expect((await workspace.task(task.id)).title).toBe("Call the electrician");
});

test("conflict.keep: keeping the listed version only removes the copy", async () => {
  const task = await workspace.create("Call the plumber");
  await workspace.conflict(task.id, { title: "Call the electrician" });
  const { user } = await workspace.render({ home: true });
  await user.click(
    await screen.findByRole("button", { name: "1 task changed on two devices" }, refreshed),
  );
  const dialog = await screen.findByRole("dialog", { name: "Changed on two devices" });

  await user.click(within(dialog).getAllByRole("button", { name: "Keep this one" })[0]);

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.queryByText("Call the plumber")).not.toBeNull();
  expect((await workspace.task(task.id)).title).toBe("Call the plumber");
});
