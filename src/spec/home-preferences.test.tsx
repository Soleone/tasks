import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { readPreference } from "@/platform/preferences";
import { AppWorkspace } from "@/testing/appWorkspace";

// One file per home: preferences belong to the home the app loaded last.
let workspace: AppWorkspace;
beforeEach(async () => {
  workspace = await AppWorkspace.start();
});
afterEach(async () => {
  await workspace.stop();
});

async function savedPreferences(): Promise<Record<string, string>> {
  const text = await workspace.homeDocument("settings");
  return text === null
    ? {}
    : (JSON.parse(text) as { preferences: Record<string, string> }).preferences;
}

test("platform.prefs-scope: preferences live in the home and survive cleared browser storage", async () => {
  await workspace.create("A", { description: "Notes A" });
  localStorage.setItem("tasks.sortField", "priority");
  localStorage.setItem("tasks.showTimestamps", "false");
  const { user } = await workspace.render({ home: true });
  // A home without settings starts from what this browser remembered, once, plus the theme shown.
  await waitFor(async () =>
    expect(await savedPreferences()).toEqual({
      "tasks.sortField": "priority",
      "tasks.showDetails": "false",
      "tasks.selectedTheme": document.documentElement.dataset.theme,
    }),
  );
  await user.keyboard("{Shift>}v{/Shift}");
  await screen.findByText("Notes A");
  await waitFor(async () => expect((await savedPreferences())["tasks.showDetails"]).toBe("true"));

  cleanup();
  localStorage.clear();
  await workspace.render({ home: true });
  expect(readPreference("tasks.showDetails")).toBe("true");
  expect(readPreference("tasks.sortField")).toBe("priority");
  expect(screen.queryByText("Notes A")).not.toBeNull();
  // The browser keeps a copy only so the next start paints the right theme and font size.
  expect(localStorage.getItem("tasks.showDetails")).toBe("true");
});
