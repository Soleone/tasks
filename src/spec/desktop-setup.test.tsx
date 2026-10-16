import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vite-plus/test";
import DesktopWorkspace from "@/DesktopWorkspace";

const existing = new Set<string>();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string, { path }: { path: string }) =>
    command === "path_exists" ? existing.has(path) : undefined,
}));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "/app-data",
  documentDir: async () => "/documents",
  join: async (...parts: string[]) => parts.join("/"),
  dirname: async (value: string) => value.slice(0, value.lastIndexOf("/")),
}));

describe("desktop setup", () => {
  test("platform.open-workspace: first launch suggests a folder and offers to import the old version's tasks", async () => {
    existing.clear();
    existing.add("/app-data/sync");
    render(<DesktopWorkspace />);
    expect(await screen.findByLabelText("Task folder")).toHaveProperty("value", "/documents/Tasks");
    expect(screen.getByLabelText("Tasks from the old version")).toHaveProperty(
      "value",
      "/app-data/sync",
    );
    expect(screen.getByRole("button", { name: "Import and open" })).toHaveProperty(
      "type",
      "submit",
    );
    expect(screen.getByRole("button", { name: "Open without importing" })).toBeDefined();
  });

  test("platform.open-workspace: without old tasks, setup only opens the folder", async () => {
    existing.clear();
    render(<DesktopWorkspace />);
    expect(await screen.findByLabelText("Tasks from the old version")).toHaveProperty("value", "");
    expect(screen.getByRole("button", { name: "Open" })).toHaveProperty("type", "submit");
    expect(screen.queryByRole("button", { name: "Open without importing" })).toBeNull();
  });
});
