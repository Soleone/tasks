import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { readGlobalHotkeys, rememberGlobalHotkeys } from "@/platform/globalHotkeys";
import { AppWorkspace } from "@/testing/appWorkspace";
import { focusedTitleField } from "@/testing/taskList";

// The list runs on the browser route; only the hotkeys see a desktop app and its native side.
const native = vi.hoisted(() => ({
  launcher: null as string | null,
  taken: new Set<string>(),
  newTask: null as null | (() => void),
}));
const invoke = vi.hoisted(() =>
  vi.fn(async (command: string, args?: { focus: string | null; create: string | null }) => {
    if (command === "hyprland_launcher") return native.launcher;
    const taken = [args?.focus, args?.create].find((hotkey) => hotkey && native.taken.has(hotkey));
    if (taken) throw taken;
  }),
);
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (_event: string, handler: () => void) => {
    native.newTask = handler;
    return () => undefined;
  },
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: async () => null }));
vi.mock("@/platform/runtime", async (original) => ({
  ...(await original<typeof import("@/platform/runtime")>()),
  isDesktopApp: () => true,
  keyName: (key: string) => (key === "Super" ? "Win" : key),
}));

let workspace: AppWorkspace;
beforeEach(async () => {
  workspace = await AppWorkspace.start();
});
afterEach(async () => {
  native.launcher = null;
  native.taken.clear();
  native.newTask = null;
  invoke.mockClear();
  await workspace.stop();
});

function registered() {
  return invoke.mock.calls.filter(([command]) => command === "global_hotkeys_set").at(-1)?.[1];
}

async function openHotkeys() {
  const { user } = await workspace.render();
  await user.keyboard("{Control>},{/Control}");
  await waitFor(() => expect(document.activeElement?.textContent).toBe("General"));
  await user.keyboard("{ArrowRight}");
  await waitFor(() => expect(document.activeElement?.textContent).toBe("Hotkeys"));
  return { user, panel: within(screen.getByRole("tabpanel")) };
}

const PICKED = { focus: "Ctrl+Alt+Space", create: "Ctrl+Alt+N" };

test("platform.global-focus: the saved hotkeys register at start and New task opens the editor", async () => {
  rememberGlobalHotkeys(PICKED);
  await workspace.render();
  await waitFor(() => expect(registered()).toEqual(PICKED));
  native.newTask!();
  await focusedTitleField();
});

test("settings.hotkey-record: both start off; pressed keys become the hotkey and are remembered", async () => {
  const { user, panel } = await openHotkeys();
  await user.tab();
  const focus = panel.getByRole("button", { name: "Bring Tasks forward" });
  expect(document.activeElement).toBe(focus);
  expect(focus.textContent).toBe("Off");
  expect(panel.getByRole("button", { name: "New task" }).textContent).toBe("Off");
  await user.keyboard("{Enter}");
  await waitFor(() => expect(registered()).toEqual({ focus: null, create: null }));
  expect(focus.textContent).toBe("Press keys…");
  // The Windows key is saved as Super and shown by its name on this platform.
  await user.keyboard("{Meta>}{Shift>}c{/Shift}{/Meta}");
  await waitFor(() => expect(focus.textContent).toBe("ShiftWinC"));
  expect(registered()).toEqual({ focus: "Shift+Super+C", create: null });
  expect(readGlobalHotkeys()).toEqual({ focus: "Shift+Super+C", create: null });
  await user.keyboard("{Enter}{Backspace}");
  await waitFor(() => expect(focus.textContent).toBe("Off"));
  expect(registered()).toEqual({ focus: null, create: null });
  expect(readGlobalHotkeys().focus).toBeNull();
  // Escape ends recording without closing Settings.
  await user.keyboard("{Enter}{Escape}");
  await waitFor(() => expect(focus.textContent).toBe("Off"));
  screen.getByRole("dialog", { name: "Settings" });
});

test("settings.hotkey-refused: keys another app holds, or the other hotkey uses, keep the old one", async () => {
  native.taken.add("Ctrl+Alt+J");
  rememberGlobalHotkeys(PICKED);
  const { user, panel } = await openHotkeys();
  const focus = panel.getByRole("button", { name: "Bring Tasks forward" });
  await user.click(focus);
  await user.keyboard("{Control>}{Alt>}j{/Alt}{/Control}");
  await panel.findByText("Ctrl+Alt+J is taken by the system or another app.");
  expect(focus.textContent).toBe("CtrlAltSpace");
  expect(registered()).toEqual(PICKED);
  await user.click(focus);
  await user.keyboard("{Control>}{Alt>}n{/Alt}{/Control}");
  await panel.findByText("Ctrl+Alt+N already does New task.");
});

test("settings.hotkey-hyprland: Hyprland gets bind lines to copy instead of registered hotkeys", async () => {
  native.launcher = "/home/me/Apps/Tasks.AppImage";
  rememberGlobalHotkeys(PICKED);
  const { user, panel } = await openHotkeys();
  const binds = await panel.findByText(/^bind = /);
  expect(binds.textContent).toBe(
    [
      'bind = CTRL ALT, SPACE, exec, "/home/me/Apps/Tasks.AppImage"',
      'bind = CTRL ALT, N, exec, "/home/me/Apps/Tasks.AppImage" --new-task',
    ].join("\n"),
  );
  await user.click(panel.getByRole("button", { name: "New task" }));
  await user.keyboard("{Alt>}{Meta>}5{/Meta}{/Alt}");
  await waitFor(() =>
    expect(binds.textContent).toContain(
      'bind = ALT SUPER, 5, exec, "/home/me/Apps/Tasks.AppImage" --new-task',
    ),
  );
  expect(registered()).toBeUndefined();
});
