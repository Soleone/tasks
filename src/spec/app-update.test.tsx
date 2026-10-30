import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import * as backendClient from "@/platform/backendClient";
import { AppWorkspace } from "@/testing/appWorkspace";

const release = vi.hoisted(() => ({
  update: null as null | {
    version: string;
    download: () => Promise<void>;
    install: () => Promise<void>;
  },
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: async () => release.update }));
const relaunch = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch }));
// The list runs on the browser route; only the update check sees a desktop app.
vi.mock("@/platform/runtime", async (original) => ({
  ...(await original<typeof import("@/platform/runtime")>()),
  isDesktopApp: () => true,
}));
vi.mock("@/useGlobalHotkeys", () => ({ useGlobalHotkeys: () => undefined }));

let workspace: AppWorkspace;
beforeEach(async () => {
  workspace = await AppWorkspace.start();
  vi.stubEnv("DEV", false);
});
afterEach(async () => {
  release.update = null;
  relaunch.mockClear();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await workspace.stop();
});

test("platform.update: Update downloads, saves and closes the home, installs, then restarts", async () => {
  const download = vi.fn(async () => undefined);
  const install = vi.fn(async () => undefined);
  release.update = { version: "9.9.9", download, install };
  const closing = vi.spyOn(backendClient, "closeHome");
  await workspace.create("Task");
  const { user } = await workspace.render();
  await screen.findByText("Tasks 9.9.9 is available");
  await user.dblClick(screen.getByRole("button", { name: "Update" }));
  await waitFor(() => expect(relaunch).toHaveBeenCalledTimes(1));
  expect(install).toHaveBeenCalledTimes(1);
  expect(download).toHaveBeenCalledTimes(1);
  expect(closing).toHaveBeenCalledTimes(1);
  expect(download.mock.invocationCallOrder[0]).toBeLessThan(closing.mock.invocationCallOrder[0]!);
  expect(closing.mock.invocationCallOrder[0]).toBeLessThan(install.mock.invocationCallOrder[0]!);
  expect(install.mock.invocationCallOrder[0]).toBeLessThan(relaunch.mock.invocationCallOrder[0]!);
  screen.getByText("Updating to Tasks 9.9.9…");
});

test("platform.update: a failed download keeps the home open and offers Retry", async () => {
  const download = vi.fn(async () => {
    throw new Error("offline");
  });
  release.update = { version: "9.9.9", download, install: async () => undefined };
  const closing = vi.spyOn(backendClient, "closeHome");
  await workspace.create("Task");
  const { user } = await workspace.render();
  await user.click(await screen.findByRole("button", { name: "Update" }));
  await screen.findByText("Couldn't update: offline");
  expect(closing).not.toHaveBeenCalled();
  expect(relaunch).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(download).toHaveBeenCalledTimes(2));
});
