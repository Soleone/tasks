import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/path", () => ({
  documentDir: async () => {
    vi.advanceTimersByTime(100);
    return "/documents";
  },
  appDataDir: async () => {
    vi.advanceTimersByTime(110);
    return "/app-data";
  },
  join: async (...parts: string[]) => {
    vi.advanceTimersByTime(105);
    return parts.join("/");
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["performance", "requestAnimationFrame", "setTimeout", "Date"] });
  vi.mocked(invoke).mockResolvedValue(800);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("settings.launch-time: separates module loading, mounting and each native path call", async () => {
  const timing = await import("./launchTiming");
  vi.advanceTimersByTime(100);
  timing.markScript();
  vi.advanceTimersByTime(30);
  timing.markStartupStep("desktop");
  vi.advanceTimersByTime(5);
  const { desktopPaths } = await import("./platform/desktopWorkspace");
  expect(await desktopPaths()).toEqual({
    appData: "/app-data",
    suggestedFolder: "/documents/Tasks",
  });
  await timing.startLaunchTiming();
  vi.advanceTimersByTime(150);
  timing.markBackendReady();
  vi.advanceTimersByTime(110);
  timing.markFirstList();
  timing.markRowsShown();
  await vi.runAllTimersAsync();

  const [launch] = timing.recentLaunches();
  expect(launch.steps.slice(0, -1)).toEqual([
    { label: "window", ms: 350 },
    { label: "page", ms: 100 },
    { label: "app load", ms: 30 },
    { label: "mount", ms: 5 },
    { label: "documents", ms: 100 },
    { label: "app data", ms: 110 },
    { label: "folder path", ms: 105 },
    { label: "backend", ms: 150 },
    { label: "first list", ms: 110 },
  ]);
  expect(launch.steps.at(-1)).toEqual({ label: "rows", ms: expect.any(Number) });
  expect(launch.totalMs).toBe(launch.steps.reduce((total, step) => total + step.ms, 0));
  expect(invoke).toHaveBeenCalledExactlyOnceWith("launch_elapsed_ms");
});

test("settings.launch-time: setup alone does not save a launch", async () => {
  const timing = await import("./launchTiming");
  timing.markScript();
  for (const point of ["desktop", "paths", "documents", "appData"] as const)
    timing.markStartupStep(point);
  timing.markBackendReady();
  timing.markFirstList();
  timing.markRowsShown();
  await vi.runAllTimersAsync();
  expect(timing.recentLaunches()).toEqual([]);
  expect(invoke).not.toHaveBeenCalled();
});

test("settings.launch-time: keeps older timing formats and saves only one result per launch", async () => {
  const older = Array.from({ length: 5 }, (_, index) => ({
    at: `2026-10-19T00:00:0${index}.000Z`,
    steps: [{ label: "app code", ms: 320 }],
    totalMs: 1000,
  }));
  localStorage.setItem("tasks.launchTimings", JSON.stringify(older));
  const timing = await import("./launchTiming");
  await timing.startLaunchTiming();
  timing.markBackendReady();
  timing.markFirstList();
  timing.markRowsShown();
  timing.markRowsShown();
  await vi.runAllTimersAsync();
  expect(timing.recentLaunches()).toHaveLength(5);
  expect(timing.recentLaunches().slice(1)).toEqual(older.slice(0, 4));
});
