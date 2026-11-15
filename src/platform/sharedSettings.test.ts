import { expect, test } from "vite-plus/test";
import { HomeDocuments } from "./homeDocuments";
import {
  addToTally,
  loadSharedSettings,
  readSharedSettings,
  renameCategorySettings,
  setCategoryColor,
  setGoal,
} from "./sharedSettings";

function homeWith(text: string | null) {
  const disk = { text };
  const documents = new HomeDocuments((command, args) => {
    if (command === "home.document.read") return Promise.resolve({ text: disk.text });
    disk.text = args.text as string;
    return Promise.resolve({});
  });
  return { disk, documents };
}

test("home.shared-settings: a save keeps what another device synced meanwhile, and unknown fields", async () => {
  const { disk, documents } = homeWith(
    JSON.stringify({ format: "tasks.shared", version: 1, colors: { work: "blue" }, later: 1 }),
  );
  await loadSharedSettings(documents);
  disk.text = JSON.stringify({
    format: "tasks.shared",
    version: 1,
    colors: { work: "blue", home: "red" },
    later: 1,
  });
  await setCategoryColor("life", "orange");
  expect(JSON.parse(disk.text!)).toEqual({
    format: "tasks.shared",
    version: 1,
    colors: { work: "blue", home: "red", life: "orange" },
    later: 1,
  });
  expect(readSharedSettings().colors).toEqual({ work: "blue", home: "red", life: "orange" });
});

test("home.shared-settings: bad values are skipped and a damaged file is kept aside on save", async () => {
  const { disk, documents } = homeWith(
    JSON.stringify({
      format: "tasks.shared",
      colors: { work: "plaid", Bad: "red" },
      dayEndsAt: "4",
      tally: { "2026-11-09": { life: 2, Bad: 1, home: 0 }, someday: { life: 1 } },
    }),
  );
  await loadSharedSettings(documents);
  expect(readSharedSettings()).toMatchObject({
    colors: {},
    dayEndsAt: "04:00",
    tally: { "2026-11-09": { life: 2 } },
  });
  disk.text = "{damaged";
  await setGoal(null, { count: 3, per: "day" });
  expect(JSON.parse(disk.text!)).toEqual({
    format: "tasks.shared",
    version: 1,
    otherGoal: { count: 3, per: "day" },
  });
});

test("settings.category-colors: a rename carries the color, goal and tally to the new name", async () => {
  const { disk, documents } = homeWith(null);
  await loadSharedSettings(documents);
  await setCategoryColor("job", "blue");
  await setGoal("job", { count: 10, per: "week" });
  await addToTally({ "2026-11-09": { job: 2, work: 1 } });
  await addToTally({ "2026-11-09": { job: 1 }, "2026-11-10": { "": 1 } });
  await renameCategorySettings("job", "work");
  expect(JSON.parse(disk.text!)).toMatchObject({
    colors: { work: "blue" },
    goals: { work: { count: 10, per: "week" } },
    tally: { "2026-11-09": { work: 4 }, "2026-11-10": { "": 1 } },
  });
});
