import { screen } from "@testing-library/react";
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
