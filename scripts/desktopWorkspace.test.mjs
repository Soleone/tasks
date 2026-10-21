import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

// The desktop setup runs against the real backend; only Tauri's bridge is replaced, with the
// sidecar started as `node dist/backend/cli.js`, the pointer kept in memory and the user folder
// and app data answered from a scratch folder.
const scratch = mkdtempSync(path.join(tmpdir(), "tasks-desktop-setup-"));
const appData = path.join(scratch, "app-data");
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
    export const appDataDir = async () => ${JSON.stringify(appData)};
    export const homeDir = async () => ${JSON.stringify(scratch)};
    export const join = async (...parts) => path.join(...parts);`,
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

/** Runs one request the way the app did before Tasks homes, against a bare folder and cache. */
function previousBackend(root, cache, envelope) {
  const child = spawnSync(process.execPath, [cli, "--stdio", "--root", root, "--database", cache], {
    input: `${JSON.stringify({ version: 2, requestId: "previous", ...envelope })}\n`,
    encoding: "utf8",
  });
  const response = JSON.parse(child.stdout);
  assert.equal(response.ok, true, child.stdout);
  return response;
}

test("home.adopt: setup brings the task folder from before homes into a new home", async () => {
  const folder = path.join(scratch, "Documents", "Tasks");
  cpSync("scripts/fixtures/workspace/root", folder, { recursive: true });
  const name = createHash("sha256").update(folder).digest().subarray(0, 12).toString("hex");
  const cache = path.join(appData, "caches", `${name}.db`);
  const { writeContext } = previousBackend(folder, cache, { command: "workspace.info" });
  previousBackend(folder, cache, {
    command: "task.create",
    args: { title: "Written before homes" },
    writeContext,
    idempotencyKey: "create",
    actor: { kind: "human", label: "desktop setup test" },
  });
  // The old app kept recovery files in app data under the key other roots use beside a cache.
  mkdirSync(path.join(appData, "taskdb-v2"));
  renameSync(path.join(appData, "caches", "roots"), path.join(appData, "taskdb-v2", "roots"));

  const home = path.join(scratch, "Adopted");
  assert.equal(await withSetup(home, (setup) => setup.adopt(folder)), home);
  await withSetup(home, async (setup) => {
    assert.deepEqual(await setup.info(), { state: "ready", writeContext });
  });
  assert.ok(existsSync(path.join(folder, "workspace.json")));
});
