import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { AppWorkspace } from "@/testing/appWorkspace";

// The list runs on the browser route; only Settings sees a desktop app and its native side.
const native = vi.hoisted(() => ({ cli: null as string | null }));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: async (command: string) => (command === "cli_path" ? native.cli : null),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => undefined }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: async () => null }));
vi.mock("@/platform/runtime", async (original) => ({
  ...(await original<typeof import("@/platform/runtime")>()),
  isDesktopApp: () => true,
}));

let workspace: AppWorkspace;
beforeEach(async () => {
  workspace = await AppWorkspace.start();
});
afterEach(async () => {
  await workspace.stop();
});

async function openData() {
  const { user } = await workspace.render();
  await user.keyboard("{Control>},{/Control}");
  await user.click(await screen.findByRole("tab", { name: "Data" }));
  return { user, panel: within(screen.getByRole("tabpanel")) };
}

test("settings.agents: Data shows the CLI's path and copies instructions naming it, for WSL too", async () => {
  native.cli = "D:\\apps\\My Tasks\\tasks-cli.exe";
  const { user, panel } = await openData();
  await panel.findByText(native.cli);
  await user.click(panel.getByRole("button", { name: "Copy CLI path" }));
  expect(await navigator.clipboard.readText()).toBe(native.cli);
  await user.click(panel.getByRole("button", { name: "Copy agent instructions" }));
  const block = await navigator.clipboard.readText();
  expect(block).toContain('`"D:\\apps\\My Tasks\\tasks-cli.exe"`');
  expect(block).toContain("`help`");
  expect(block).not.toContain("--home");
  await user.click(panel.getByRole("button", { name: "Copy for WSL" }));
  expect(await navigator.clipboard.readText()).toContain('`"/mnt/d/apps/My Tasks/tasks-cli.exe"`');
});

test("settings.agents: a Linux path offers no WSL form, and a build without a CLI has no section", async () => {
  native.cli = "/home/me/.local/share/tasks/tasks-cli";
  const first = await openData();
  await first.panel.findByText(native.cli);
  expect(first.panel.queryByRole("button", { name: "Copy for WSL" })).toBeNull();
  await workspace.stop();

  native.cli = null;
  workspace = await AppWorkspace.start();
  const { panel } = await openData();
  panel.getByText(/Add only this sync folder/);
  expect(panel.queryByRole("heading", { name: "Agents" })).toBeNull();
});
