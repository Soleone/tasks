import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { devWebOptions } from "./dev-web-options.mjs";

const { backendArgs, viteArgs, legacy } = devWebOptions(process.argv.slice(2));
const root = path.resolve(import.meta.dirname, "..");

execFileSync("pnpm", ["build:backend"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});

const backend = spawn(process.execPath, ["dist/backend/devServer.js", ...backendArgs], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
});
// Vite directly, not the vp wrapper: vp exits on SIGTERM without stopping its Vite child.
const vite = spawn(
  process.execPath,
  ["node_modules/vite/dist/vite/node/cli.js", "dev", ...viteArgs],
  {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, VITE_TASKS_LEGACY: legacy ? "1" : "0" },
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
