import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { devWebOptions } from "./dev-web-options.mjs";
import { realSnapshot } from "./dev-web-real.mjs";

const options = devWebOptions(process.argv.slice(2));
const { viteArgs } = options;
const root = path.resolve(import.meta.dirname, "..");
const env = { ...process.env };
let backendArgs = options.backendArgs;
let viteEnv = process.env;
let copy;
if (options.real) {
  copy = await realSnapshot(options.refresh);
} else if (backendArgs.length === 0) {
  // Without a selection, run on a fresh copy of the fixture so the real workspace is never opened.
  const scratch = mkdtempSync(path.join(tmpdir(), "tasks-dev-"));
  copy = {
    root: path.join(scratch, "root"),
    database: path.join(scratch, "cache.db"),
    profile: path.join(scratch, "profile"),
  };
  cpSync(path.join(root, "scripts/fixtures/workspace/root"), copy.root, { recursive: true });
  process.stdout.write(`[dev:web] disposable workspace in ${scratch}\n`);
}
if (copy) {
  env.XDG_DATA_HOME = copy.profile;
  backendArgs = ["--root", copy.root, "--database", copy.database];
  // The UI asks before opening a folder picked by hand; copies made here open directly.
  viteEnv = { ...process.env, VITE_DEV_WORKSPACE_COPY: "1" };
}

execFileSync("pnpm", ["build:backend"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});

const backend = spawn(process.execPath, ["dist/backend/devServer.js", ...backendArgs], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env,
});
// Vite directly, not the vp wrapper: vp exits on SIGTERM without stopping its Vite child.
const vite = spawn(
  process.execPath,
  ["node_modules/vite/dist/vite/node/cli.js", "dev", ...viteArgs],
  {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: viteEnv,
  },
);

function pipe(child, name) {
  child.stdout.on("data", (data) => process.stdout.write(`[${name}] ${data}`));
  child.stderr.on("data", (data) => process.stderr.write(`[${name}] ${data}`));
}

pipe(backend, "backend");
pipe(vite, "vite");

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  backend.kill(signal);
  vite.kill(signal);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

let exited = 0;
function onExit(child, name, code) {
  if (shuttingDown) {
    return;
  }
  exited += 1;
  process.stderr.write(`[dev:web] ${name} exited with code ${code ?? "unknown"}; stopping.\n`);
  shutdown("SIGTERM");
  if (exited === 1) {
    setTimeout(() => process.exit(typeof code === "number" ? code : 1), 500).unref();
  }
}

backend.on("exit", (code) => onExit(backend, "backend", code));
vite.on("exit", (code) => onExit(vite, "vite", code));

process.stdout.write("[dev:web] backend + vite starting. Open the URL vite prints below.\n");
