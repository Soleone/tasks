import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vite-plus/test";
import DesktopWorkspace from "@/DesktopWorkspace";

// No folder exists yet, so setup shows its form.
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => false }));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "/app-data",
  documentDir: async () => "/documents",
  join: async (...parts: string[]) => parts.join("/"),
}));

describe("desktop setup", () => {
  test("platform.open-workspace: first launch suggests a folder in Documents", async () => {
    render(<DesktopWorkspace />);
    expect(await screen.findByLabelText("Task folder")).toHaveProperty("value", "/documents/Tasks");
    expect(screen.getByRole("button", { name: "Open" })).toHaveProperty("type", "submit");
  });
});
