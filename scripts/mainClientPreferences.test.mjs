import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { build, transformSync } from "esbuild";

const compiled = await build({
  stdin: { contents: `export * from './src/fontSize'; export * from './src/theme'; export {isKeyboardHelpMode} from './src/keyboardHelp';`, resolveDir: process.cwd() },
  bundle: true, platform: "node", format: "esm", write: false,
});

// Execute the actual App preference functions with inert state callbacks, not
// a rendered component. Browser events, focus and visual paint are not proved.
const appSource = readFileSync("src/App.tsx", "utf8");
const readers = ["readStatusPreset", "readExactStatus", "readPriorityFilter", "readInitialTagFilter", "readInitialCategoryFilter", "readSortField", "readSortDirection", "readShowDetails", "readHelpMode"];
const functions = [...readers, "readStored", "writeStored", "readCategorySlug", "readSlugs", "toggleDetails", "changeHelpMode", "changeFontSizeIncrease"];
const bodies = functions.map(name => {
  const declaration = appSource.match(new RegExp(`^( *)function ${name}\\([^\\n]*\\n[\\s\\S]*?^\\1}`, "m"));
  assert.ok(declaration, `Missing App preference function: ${name}`);
  return declaration[0];
});
const keys = appSource.match(/^const [A-Z_]+_KEY = .*;$/gm);
const preferenceCode = transformSync([...keys, ...bodies, `return {${functions.join(",")}};`].join("\n"), { loader: "ts", target: "esnext" }).code;

function appPreferences(appearance, showDetails = false) {
  const bindings = {
    isKeyboardHelpMode: appearance.isKeyboardHelpMode,
    storeFontSizeIncrease: appearance.storeFontSizeIncrease,
    showDetails,
    setShowDetails() {}, setHelpMode() {}, setFontSizeIncrease() {}, setAnnouncement() {},
  };
  return new Function(...Object.keys(bindings), preferenceCode)(...Object.values(bindings));
}

async function disposableAppearance(t, values = new Map()) {
  const originals = new Map(["localStorage", "window", "document", "getComputedStyle"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const properties = new Map();
  const root = { style: { setProperty: (key, value) => properties.set(key, value), removeProperty: key => properties.delete(key) }, classList: { toggle() {} } };
  const globals = {
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    window: { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) },
    document: { documentElement: root, querySelector: () => null },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
  };
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const appearance = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}#${crypto.randomUUID()}`);
  return { appearance, root, properties, values };
}

test("existing App settings and display preferences reopen from the same storage", async t => {
  const { appearance, root, properties, values } = await disposableAppearance(t);
  const app = appPreferences(appearance);
  app.toggleDetails();
  app.changeHelpMode("basic");
  app.changeFontSizeIncrease(25);
  assert.equal(root.style.fontSize, "125%");
  const theme = { name: "test-theme", mode: "dark", palette: { background: "#123456" } };
  appearance.applyTheme(theme);
  properties.clear();
  root.style.fontSize = "";
  appearance.applyStoredTheme();
  appearance.applyStoredFontSizeIncrease();
  const reopened = appPreferences(appearance);
  assert.equal(reopened.readShowDetails(), true);
  assert.equal(reopened.readHelpMode(), "basic");
  assert.equal(appearance.readStoredFontSizeIncrease(), 25);
  assert.equal(root.style.fontSize, "125%");
  assert.equal(properties.get("--om-background"), "#123456");
  assert.deepEqual([...values.keys()].sort(), ["tasks.fontSizeIncrease", "tasks.helpMode", "tasks.showDetails", "tasks.theme"]);
});

test("App restores stored filters/sort and rejects malformed preference values", async t => {
  const { appearance, values } = await disposableAppearance(t, new Map([
    ["tasks.statusPreset", "inactive"], ["tasks.exactStatus", "paused"], ["tasks.priorityFilter", "0"],
    ["tasks.categoryFilter", "work"], ["tasks.tagFilter", '["home","next"]'],
    ["tasks.sortField", "manual"], ["tasks.sortDirection", "asc"],
  ]));
  const app = appPreferences(appearance);
  assert.deepEqual(readFilters(app), ["inactive", "paused", 0, "work", ["home", "next"], "manual", "asc"]);
  for (const key of values.keys()) values.set(key, "invalid");
  values.set("tasks.categoryFilter", "");
  values.set("tasks.tagFilter", '["ok",1]');
  values.set("tasks.fontSizeIncrease", "999");
  values.set("tasks.theme", "{broken");
  assert.deepEqual(readFilters(app), ["active", null, null, undefined, [], "created", "desc"]);
  assert.equal(appearance.readStoredFontSizeIncrease(), 0);
  assert.doesNotThrow(() => appearance.applyStoredTheme());
  values.set("tasks.showTimestamps", "true");
  values.set("tasks.helpMode", "false");
  assert.equal(app.readShowDetails(), true);
  assert.equal(app.readHelpMode(), "basic");
});

function readFilters(app) {
  return [app.readStatusPreset(), app.readExactStatus(), app.readPriorityFilter(), app.readInitialCategoryFilter()?.slug, app.readInitialTagFilter().map(tag => tag.slug), app.readSortField(), app.readSortDirection()];
}

test("unusable display storage keeps existing safe defaults and does not prevent appearance changes", async t => {
  const { appearance, root } = await disposableAppearance(t);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("Storage disabled"); } });
  const app = appPreferences(appearance);
  assert.deepEqual(readFilters(app), ["active", null, null, undefined, [], "created", "desc"]);
  assert.equal(app.readHelpMode(), "full");
  assert.equal(app.readShowDetails(), false);
  assert.equal(appearance.readStoredFontSizeIncrease(), 0);
  assert.doesNotThrow(() => { app.toggleDetails(); app.changeHelpMode("none"); app.changeFontSizeIncrease(10); });
  assert.equal(root.style.fontSize, "110%");
});
