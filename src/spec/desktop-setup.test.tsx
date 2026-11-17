import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vite-plus/test";
import { themeOptions } from "virtual:theme-options";
import { ThemeProvider } from "@/components/soleone/theme";
import { version } from "../../package.json";
import DesktopWorkspace from "@/DesktopWorkspace";
import { THEME_STORAGE_KEY } from "@/theme/config";

// No home is remembered yet, so setup shows its form.
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => null }));
vi.mock("@tauri-apps/api/path", () => ({
  homeDir: async () => "/home/owner",
  join: async (...parts: string[]) => parts.join("/"),
}));

const pickedFolder = vi.hoisted(() => ({ path: null as string | null, defaultPath: "" }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: async (options: { defaultPath?: string }) => {
    pickedFolder.defaultPath = options.defaultPath ?? "";
    return pickedFolder.path;
  },
}));

const release = vi.hoisted(() => ({ update: null as null | { version: string } }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: async () => release.update }));
vi.mock("@/platform/runtime", async (original) => ({
  ...(await original<typeof import("@/platform/runtime")>()),
  isDesktopApp: () => true,
}));

function renderSetup() {
  render(
    <ThemeProvider themes={themeOptions} storageKey={THEME_STORAGE_KEY}>
      <DesktopWorkspace />
    </ThemeProvider>,
  );
}

describe("desktop setup", () => {
  test("platform.open-workspace: first launch suggests a Tasks home in the user folder", async () => {
    renderSetup();
    expect(await screen.findByLabelText("Tasks home")).toHaveProperty("value", "/home/owner/Tasks");
    expect(screen.getByText("/home/owner/Tasks/sync")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create home" })).toHaveProperty("type", "submit");
    expect(screen.getByRole("button", { name: "Open existing home" })).toBeTruthy();
  });

  test("platform.open-workspace: Browse… fills the home from the system folder picker", async () => {
    renderSetup();
    const input = await screen.findByLabelText("Tasks home");
    pickedFolder.path = null;
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await vi.waitFor(() => expect(pickedFolder.defaultPath).toBe("/home/owner/Tasks"));
    expect(input).toHaveProperty("value", "/home/owner/Tasks");

    pickedFolder.path = "/data/Tasks";
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await vi.waitFor(() => expect(input).toHaveProperty("value", "/data/Tasks"));
    expect(screen.getByText("/data/Tasks/sync")).toBeTruthy();
  });

  test("platform.update: setup shows the version and offers a newer release", async () => {
    vi.stubEnv("DEV", false);
    release.update = { version: "9.9.9" };
    renderSetup();
    expect(await screen.findByText("Tasks 9.9.9 is available")).toBeTruthy();
    expect(screen.getByText(`Tasks ${version}`)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update" })).toBeTruthy();
    release.update = null;
    vi.unstubAllEnvs();
  });
});
