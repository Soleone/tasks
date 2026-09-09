import { execFileSync, spawn } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const previewPort = process.env.TASKS_THEMES_PORT ?? "5175";
const backendPort = process.env.TASKS_THEMES_BACKEND_PORT ?? "5176";

execFileSync("pnpm", ["build:backend"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });

const backend = spawn(process.execPath, ["dist/backend/devServer.js", "--port", backendPort], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
});
const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--mode", "themes", "--host", "127.0.0.1"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    TASKS_THEMES_PORT: previewPort,
    VITE_DEV_BACKEND_URL: `http://127.0.0.1:${backendPort}`,
  },
});

function pipe(child, name) {
  child.stdout.on("data", (data) => process.stdout.write(`[${name}] ${data}`));
  child.stderr.on("data", (data) => process.stderr.write(`[${name}] ${data}`));
}

pipe(backend, "backend");
pipe(vite, "vite");

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  backend.kill(signal);
  vite.kill(signal);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

let exited = 0;
function onExit(child, name, code) {
  if (shuttingDown) return;
  exited += 1;
  process.stderr.write(`[dev:themes] ${name} exited with code ${code ?? "unknown"}; stopping.\n`);
  shutdown("SIGTERM");
  if (exited === 1) {
    setTimeout(() => process.exit(typeof code === "number" ? code : 1), 500).unref();
  }
}

backend.on("exit", (code) => onExit(backend, "backend", code));
vite.on("exit", (code) => onExit(vite, "vite", code));

process.stdout.write(`[dev:themes] preview at http://127.0.0.1:${previewPort}/themes.html\n`);
process.stdout.write(`[dev:themes] backend at http://127.0.0.1:${backendPort}\n`);
