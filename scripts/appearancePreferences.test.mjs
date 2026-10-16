import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const compiled = await build({
  stdin: {
    contents: `export * from './src/fontSize'; export * from './src/theme';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});

async function disposableAppearance(t, values = new Map()) {
  const originals = new Map(
    ["localStorage", "window", "document", "getComputedStyle"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const properties = new Map();
  const root = {
    style: {
      setProperty: (key, value) => properties.set(key, value),
      removeProperty: (key) => properties.delete(key),
    },
    classList: { toggle() {} },
  };
  const globals = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
    window: {
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    },
    document: { documentElement: root, querySelector: () => null },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
  };
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const appearance = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}#${crypto.randomUUID()}`
  );
  return { appearance, root, properties, values };
}

test("stored theme and font size reapply on reopen", async (t) => {
  const { appearance, root, properties, values } = await disposableAppearance(t);
  appearance.storeFontSizeIncrease(25);
  appearance.applyTheme({ name: "test-theme", mode: "dark", palette: { background: "#123456" } });
  properties.clear();
  root.style.fontSize = "";
  appearance.applyStoredTheme();
  appearance.applyStoredFontSizeIncrease();
  assert.equal(appearance.readStoredFontSizeIncrease(), 25);
  assert.equal(root.style.fontSize, "125%");
  assert.equal(properties.get("--om-background"), "#123456");
  assert.deepEqual([...values.keys()].sort(), ["tasks.fontSizeIncrease", "tasks.theme"]);
});

test("malformed or unusable storage falls back to the default appearance", async (t) => {
  const { appearance, values } = await disposableAppearance(
    t,
    new Map([
      ["tasks.fontSizeIncrease", "999"],
      ["tasks.theme", "{broken"],
    ]),
  );
  assert.equal(appearance.readStoredFontSizeIncrease(), 0);
  assert.doesNotThrow(() => appearance.applyStoredTheme());
  values.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("Storage disabled");
    },
  });
  assert.equal(appearance.readStoredFontSizeIncrease(), 0);
  assert.doesNotThrow(() => appearance.applyStoredTheme());
});
