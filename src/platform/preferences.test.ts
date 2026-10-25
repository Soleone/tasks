import { expect, test } from "vite-plus/test";
import { HomeDocuments } from "./homeDocuments";
import { loadPreferences, readPreference } from "./preferences";

test("prefs.remembered: settings saved with the retired keyboard help level still load", async () => {
  const settings = JSON.stringify({
    format: "tasks.settings",
    version: 1,
    preferences: { "tasks.helpMode": "basic", "tasks.sortField": "priority" },
  });
  const documents = new HomeDocuments((command) =>
    Promise.resolve(command === "home.document.read" ? { text: settings } : {}),
  );
  await loadPreferences(documents);
  expect(readPreference("tasks.sortField")).toBe("priority");
  expect(readPreference("tasks.helpMode")).toBeNull();
});
