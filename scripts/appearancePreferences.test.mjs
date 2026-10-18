import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

const compiled = await build({
  stdin: {
    contents: `export * from './src/fontSize'; export * from './src/theme/config'; export * from './src/components/soleone/theme/head';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const appearance = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);

function restoreTheme(storage) {
  const root = { dataset: {}, classList: { toggle: (_name, dark) => (root.dark = dark) } };
  const head = appearance.createThemeHead(appearance.THEME_CONFIG);
  runInNewContext(head.themeScript, {
    document: { documentElement: root },
    localStorage: storage,
    matchMedia: () => ({ matches: false }),
  });
  return { root, head };
}

test("theme.select: shared head restores the existing preference before paint", () => {
  const { root, head } = restoreTheme({
    getItem(key) {
      assert.equal(key, "tasks.selectedTheme");
      return "catppuccin-latte";
    },
  });
  assert.equal(root.dataset.theme, "catppuccin-latte");
  assert.equal(root.dark, false);
  assert.equal(head.themeOptions[0].name, "gilt");
  assert.match(head.themeStyles, /\[data-theme="gilt"\]/);
});

test("theme.select: missing, retired and denied storage use Gilt", () => {
  for (const value of [null, "retired-theme", "{broken"]) {
    const { root } = restoreTheme({ getItem: () => value });
    assert.equal(root.dataset.theme, "gilt");
    assert.equal(root.dark, true);
  }
  const { root } = restoreTheme({
    getItem() {
      throw new Error("Storage disabled");
    },
  });
  assert.equal(root.dataset.theme, "gilt");
  assert.equal(root.dark, true);
});

async function disposableFontSize(t, values = new Map()) {
  const originals = new Map(
    ["localStorage", "document"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const root = { style: {} };
  const globals = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
    document: { documentElement: root },
  };
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { root, values };
}

test("stored font size reapplies on reopen", async (t) => {
  const { root, values } = await disposableFontSize(t);
  appearance.storeFontSizeIncrease(25);
  root.style.fontSize = "";
  appearance.applyStoredFontSizeIncrease();
  assert.equal(appearance.readStoredFontSizeIncrease(), 25);
  assert.equal(root.style.fontSize, "125%");
  assert.deepEqual([...values.keys()], ["tasks.fontSizeIncrease"]);
});

test("malformed or unusable storage falls back to the default font size", async (t) => {
  await disposableFontSize(t, new Map([["tasks.fontSizeIncrease", "999"]]));
  assert.equal(appearance.readStoredFontSizeIncrease(), 0);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("Storage disabled");
    },
  });
  assert.equal(appearance.readStoredFontSizeIncrease(), 0);
});
