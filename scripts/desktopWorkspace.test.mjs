import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

// The desktop setup runs against the real backend; only Tauri's bridge is replaced, with the
// sidecar started as `node dist/backend/cli.js`, the pointer kept in memory and the user folder
// answered from a scratch folder.
const scratch = mkdtempSync(path.join(tmpdir(), "tasks-desktop-setup-"));
const cli = path.resolve("dist/backend/cli.js");

const tauri = {
  "@tauri-apps/api/core": `
    export class Channel {}
    let pointer = null;
    export async function invoke(command, args) {
      if (command === "home_pointer_read") return pointer;
      if (command === "home_pointer_write") return void (pointer = args.home);
      throw new Error("unknown command " + command);
    }`,
  "@tauri-apps/api/path": `
    import path from "node:path";
    export const homeDir = async () => ${JSON.stringify(scratch)};
    export const join = async (...parts) => path.join(...parts);`,
  "@tauri-apps/plugin-dialog": `
    export async function open() {
      throw new Error("setup tests type the home");
    }`,
  "@tauri-apps/plugin-shell": `
    import { spawn } from "node:child_process";
    export const Command = {
      sidecar(name, args) {
        const listeners = {}, stdout = {};
        return {
          stdout: { on: (_event, callback) => (stdout.data = callback) },
          on: (event, callback) => (listeners[event] = callback),
          async spawn() {
            const child = spawn(process.execPath, [${JSON.stringify(cli)}, ...args]);
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
const { HomeError, HomeSetup, rememberHome, rememberedHome, suggestedHome } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test.after(() => rmSync(scratch, { recursive: true, force: true }));

async function withSetup(home, action) {
  const setup = await HomeSetup.open(home);
  try {
    return await action(setup);
  } finally {
    await setup.close();
  }
}

test("platform.open-workspace: setup suggests a Tasks home in the user folder", async () => {
  assert.equal(await suggestedHome(), path.join(scratch, "Tasks"));
  assert.equal(await rememberedHome(), null);
});

test("platform.open-workspace: setup creates a home, starts its list and remembers it", async () => {
  const home = path.join(scratch, "Tasks");
  const created = await withSetup(home, (setup) => setup.create());
  assert.equal(created, home);
  assert.deepEqual(readdirSync(home).sort(), ["local", "sync"]);
  await withSetup(home, async (setup) => {
    assert.equal((await setup.info()).state, "empty");
    await setup.init();
    assert.equal((await setup.info()).state, "ready");
  });
  assert.ok(existsSync(path.join(home, "sync", "workspace.json")));
  assert.ok(existsSync(path.join(home, "local", "app.db")));
  await rememberHome(home);
  assert.equal(await rememberedHome(), home);
});

test("platform.open-workspace: a missing home is reported, never created", async () => {
  const home = path.join(scratch, "unplugged");
  await assert.rejects(
    withSetup(home, (setup) => setup.info()),
    (error) => error instanceof HomeError && error.code === "HOME_MISSING",
  );
  assert.equal(existsSync(home), false);
});
