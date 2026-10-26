import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: ["src/platform/homeDocuments.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { HomeDocuments, homeUndoStorage } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** A backend whose writes finish only when the test releases them. */
function slowBackend() {
  const writes = [];
  const release = [];
  return {
    writes,
    release: () => release.shift()?.(),
    send: (command, args) => {
      if (command === "home.document.read") return Promise.resolve({ text: null });
      writes.push(args);
      return new Promise((resolve, reject) =>
        release.push(() => (args.text === "fail" ? reject(new Error("disk full")) : resolve({}))),
      );
    },
  };
}

test("home.documents: saves run one at a time and only the newest waiting text is written", async () => {
  const backend = slowBackend();
  const documents = new HomeDocuments(backend.send);
  const first = documents.save("settings", '{"n":1}');
  const typed = ['{"n":2}', '{"n":3}', '{"n":4}'].map((text) => documents.save("settings", text));
  await Promise.resolve();
  assert.deepEqual(
    backend.writes.map((write) => write.text),
    ['{"n":1}'],
  );
  backend.release();
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    backend.writes.map((write) => write.text),
    ['{"n":1}', '{"n":4}'],
  );
  backend.release();
  await Promise.all(typed);
});

test("home.documents: a failed save is reported and later saves still run", async () => {
  const backend = slowBackend();
  const documents = new HomeDocuments(backend.send);
  const failures = [];
  documents.onFailure((name, error) => failures.push([name, error.message]));
  const failed = documents.save("undo", "fail");
  backend.release();
  await failed;
  assert.deepEqual(failures, [["undo", "disk full"]]);
  const next = documents.save("undo", "{}");
  backend.release();
  await next;
  assert.equal(backend.writes.length, 2);
});

test("home.documents: idle waits for queued settings and undo, and refuses an unsaved document", async () => {
  const backend = slowBackend();
  const documents = new HomeDocuments(backend.send);
  void documents.save("settings", "first");
  void documents.save("settings", "last");
  void documents.save("undo", "fail");
  let idle = false;
  const waiting = assert
    .rejects(documents.waitForIdle(), /Couldn't save undo: disk full/)
    .then(() => {
      idle = true;
    });
  backend.release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(idle, false);
  backend.release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(idle, false);
  backend.release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(idle, false, "the failed undo is retried once before refusing");
  backend.release();
  await waiting;
  const refused = assert.rejects(documents.waitForIdle(), /disk full/);
  await new Promise((resolve) => setImmediate(resolve));
  backend.release();
  await refused;
  const saved = documents.save("undo", "recovered");
  backend.release();
  await saved;
  await documents.waitForIdle();
  assert.deepEqual(
    backend.writes.map(({ name, text }) => [name, text]),
    [
      ["settings", "first"],
      ["undo", "fail"],
      ["settings", "last"],
      ["undo", "fail"],
      ["undo", "fail"],
      ["undo", "recovered"],
    ],
  );
});

test("home.documents: idle retries a failed save once and goes ahead when storage recovers", async () => {
  const writes = [];
  let healthy = false;
  const documents = new HomeDocuments(async (_command, args) => {
    writes.push(args);
    if (!healthy) throw new Error("storage busy");
    return {};
  });
  await documents.save("settings", "kept", true);
  healthy = true;
  await documents.waitForIdle();
  await documents.waitForIdle();
  const write = { name: "settings", text: "kept", replaceDamaged: true };
  assert.deepEqual(writes, [write, write]);
});

test("home.documents: undo records are kept in the home in browser storage's shape", async () => {
  const backend = slowBackend();
  const storage = homeUndoStorage(new HomeDocuments(backend.send), null);
  assert.equal(storage.getItem("tasks.v2UndoHistory"), null);
  storage.setItem("tasks.v2UndoHistory", '{"version":1,"workspaces":[]}');
  assert.equal(storage.getItem("tasks.v2UndoHistory"), '{"version":1,"workspaces":[]}');
  assert.deepEqual(backend.writes, [{ name: "undo", text: '{"version":1,"workspaces":[]}' }]);
  backend.release();
});
