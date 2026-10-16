import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

// The desktop setup runs against the real backend; only Tauri's bridge is replaced, with the
// sidecar started as `node dist/backend/cli.js` and the path helpers answered from a scratch folder.
const scratch = mkdtempSync(path.join(tmpdir(), "tasks-desktop-setup-"));
const appData = path.join(scratch, "app-data");
const cli = path.resolve("dist/backend/cli.js");

const tauri = {
  "@tauri-apps/api/core": `
    import { existsSync, mkdirSync } from "node:fs";
    export async function invoke(command, { path }) {
      if (command === "path_exists") return existsSync(path);
      if (command === "create_folder") return void mkdirSync(path, { recursive: true });
      throw new Error("unknown command " + command);
    }`,
  "@tauri-apps/api/path": `
    import path from "node:path";
    export const appDataDir = async () => ${JSON.stringify(appData)};
    export const documentDir = async () => ${JSON.stringify(path.join(scratch, "documents"))};
    export const join = async (...parts) => path.join(...parts);
    export const dirname = async (value) => path.dirname(value);`,
  "@tauri-apps/plugin-shell": `
    import { spawn } from "node:child_process";
    export const Command = {
      sidecar(name, args) {
        const listeners = {}, stdout = {};
        return {
          stdout: { on: (_event, callback) => (stdout.data = callback) },
          on: (event, callback) => (listeners[event] = callback),
          async spawn() {
            const child = spawn(process.execPath, [${JSON.stringify(cli)}, ...args], {
              env: { ...process.env, XDG_DATA_HOME: ${JSON.stringify(appData)} },
            });
            child.stdout.setEncoding("utf8").on("data", (data) => stdout.data?.(data));
            child.on("close", (code, signal) => listeners.close?.({ code, signal }));
            return {
              write: async (line) => void child.stdin.write(line),
              kill: async () => void child.kill(),
            };
          },
        };
      },
    };`,
};

const bundle = await build({
  stdin: {
    contents: "export * from './src/platform/desktopWorkspace';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [
    {
      name: "tauri-stand-ins",
      setup(builder) {
        builder.onResolve({ filter: /^@tauri-apps\// }, (args) => ({
          path: args.path,
          namespace: "tauri",
        }));
        builder.onLoad({ filter: /.*/, namespace: "tauri" }, (args) => ({
          contents: tauri[args.path],
          resolveDir: process.cwd(),
        }));
      },
    },
  ],
});
const { FolderSetup, desktopPaths } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test.after(() => rmSync(scratch, { recursive: true, force: true }));

async function stateOf(folder) {
  const setup = await FolderSetup.open(appData, folder);
  try {
    return await setup.info();
  } finally {
    await setup.close();
  }
}

test("desktop setup suggests a folder in Documents and finds the old version's tasks", async () => {
  const paths = await desktopPaths();
  assert.equal(paths.appData, appData);
  assert.equal(paths.suggestedFolder, path.join(scratch, "documents", "Tasks"));
  assert.equal(paths.oldVersionFolder, path.join(appData, "sync"));
});

test("desktop setup turns an empty folder into a ready workspace", async () => {
  const folder = path.join(scratch, "fresh");
  mkdirSync(folder);
  assert.equal((await stateOf(folder)).state, "empty");
  const setup = await FolderSetup.open(appData, folder);
  try {
    await setup.init();
  } finally {
    await setup.close();
  }
  assert.equal((await stateOf(folder)).state, "ready");
  assert.ok(existsSync(path.join(folder, "workspace.json")));
});

test("desktop import copies the old version's tasks and leaves the old files untouched", async () => {
  const old = path.join(appData, "sync");
  cpSync("scripts/fixtures/schema1/sync", old, { recursive: true });
  const snapshot = () =>
    readdirSync(old, { recursive: true })
      .sort()
      .map((name) => [name, readIfFile(path.join(old, name))]);
  const before = snapshot();
  assert.equal((await stateOf(old)).state, "unsupported");
  const destination = path.join(scratch, "documents", "Tasks");
  mkdirSync(path.dirname(destination), { recursive: true });
  const setup = await FolderSetup.open(appData, old);
  try {
    await setup.importInto(destination);
  } finally {
    await setup.close();
  }
  assert.deepEqual(snapshot(), before);
  assert.equal((await stateOf(destination)).state, "ready");
  const imported = readdirSync(path.join(destination, "tasks")).filter((name) =>
    name.endsWith(".json"),
  );
  const original = readdirSync(path.join(old, "tasks")).filter((name) => name.endsWith(".json"));
  assert.equal(imported.length, original.length);
});

function readIfFile(file) {
  try {
    return readFileSync(file, "base64");
  } catch {
    return "directory";
  }
}
