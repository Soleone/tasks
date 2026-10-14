import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

// Exercise the actual submit handler with inert hooks; this is not DOM/native focus evidence.
const compiled = await build({
  entryPoints: ["src/components/TaskComposer.tsx"], jsx: "automatic", bundle: true, platform: "node", format: "esm", write: false,
  define: { "import.meta.env": "{}" },
  plugins: [{ name: "composer-fixture", setup(builder) {
    builder.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "fixture" }));
    builder.onResolve({ filter: /platform\/backendClient$/ }, () => ({ path: "backend", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path: name }) => ({ resolveDir: process.cwd(), contents: name === "react" ? `
      export * from ${JSON.stringify(path.resolve("node_modules/react/index.js"))};
      export const useEffect = () => {}, useId = () => 'fixture';
      export const useRef = value => ({current: value});
      export const useState = value => [value, next => globalThis.composerFixture.states.push(next)];
    ` : `
      export const selectedMainWorkspace = () => globalThis.composerFixture.selected ? {} : null;
      export class BackendCommandError extends Error {}
      export const listCategories = async () => ({categories: []}), listTags = async () => ({tags: []});
      export const createTask = async (...args) => { globalThis.composerFixture.writes.push(['create', ...args]); return {}; };
      export const updateTask = async (...args) => { globalThis.composerFixture.writes.push(['update', ...args]); return {}; };
    ` }));
  } }],
});
const { TaskComposer } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);

for (const editing of [false, true]) {
  for (const [title, selected, accepted] of [
    ["#urgent", true, false], ["@work #urgent", true, false], ["@a @b", true, false],
    ["\\#urgent", true, true], ["`#urgent`", true, true], ["Work #urgent", true, true],
    ["#urgent", false, true],
  ]) {
    test(`composer ${editing ? "edit" : "capture"} ${JSON.stringify(title)} selected=${selected}`, async t => {
      const previous = globalThis.composerFixture, previousFrame = globalThis.requestAnimationFrame;
      const fixture = globalThis.composerFixture = { selected, states: [], writes: [] };
      globalThis.requestAnimationFrame = () => 0;
      t.after(() => {
        if (previous === undefined) delete globalThis.composerFixture; else globalThis.composerFixture = previous;
        if (previousFrame === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = previousFrame;
      });
      let optimistic = 0, saved = 0;
      const form = TaskComposer({ initialTitle: title,
        task: editing ? { id: "task", title, version: 1, priority: 2, descriptionMarkdown: "" } : undefined,
        onCreatePending: () => { optimistic++; }, onCreateFailed: () => {}, onSaved: () => { saved++; },
        onCancel: () => {}, helpMode: "off", onDisableHelp: () => {},
      });
      // onSubmit deliberately returns void; requestSubmit invokes this same save function.
      form.props.onSubmit({ preventDefault() {} });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(fixture.writes.length, accepted ? 1 : 0);
      assert.equal(optimistic, accepted && !editing ? 1 : 0);
      assert.equal(saved, accepted ? 1 : 0);
      if (selected && !accepted && title !== "@a @b") assert.deepEqual(fixture.states, [true, null, true, false]);
      if (title === "@a @b") assert.ok(fixture.states.some(value => typeof value === "string" && value.includes("MULTIPLE_CATEGORIES")));
    });
  }
}
