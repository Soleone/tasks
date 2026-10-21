import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vite-plus/test";
import { themeOptions } from "virtual:theme-options";
import { ThemeProvider } from "@/components/soleone/theme";
import DesktopWorkspace from "@/DesktopWorkspace";
import { THEME_STORAGE_KEY } from "@/theme/config";

// No home is remembered yet, so setup shows its form.
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => null }));
vi.mock("@tauri-apps/api/path", () => ({
  homeDir: async () => "/home/owner",
  join: async (...parts: string[]) => parts.join("/"),
}));

describe("desktop setup", () => {
  test("platform.open-workspace: first launch suggests a Tasks home in the user folder", async () => {
    render(
      <ThemeProvider themes={themeOptions} storageKey={THEME_STORAGE_KEY}>
        <DesktopWorkspace />
      </ThemeProvider>,
    );
    expect(await screen.findByLabelText("Tasks home")).toHaveProperty("value", "/home/owner/Tasks");
    expect(screen.getByText("/home/owner/Tasks/sync")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create home" })).toHaveProperty("type", "submit");
    expect(screen.getByRole("button", { name: "Open existing home" })).toBeTruthy();
  });
});
