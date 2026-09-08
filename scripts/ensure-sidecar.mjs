import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const infoPath = path.join(root, "dist", "sidecar", ".sidecar-info.json");

function targetBinary() {
  const target = execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
  const extension = process.platform === "win32" ? ".exe" : "";
  return path.join(root, "src-tauri", "binaries", `tasks-backend-${target}${extension}`);
}

function newestSourceTime() {
  const output = execFileSync("git", ["ls-files", "src/backend", "scripts/build-sidecar.mjs", "package.json"], {
    cwd: root,
    encoding: "utf8",
  });
  let newest = 0;
  for (const file of output.split("\n").map((line) => line.trim()).filter(Boolean)) {
    newest = Math.max(newest, statSync(path.join(root, file)).mtimeMs);
  }
  return newest;
}

function readInfo() {
  try {
    return JSON.parse(readFileSync(infoPath, "utf8"));
  } catch {
    return null;
  }
}

function pnpm(args) {
  execFileSync("pnpm", args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
}

const binary = targetBinary();
const info = readInfo();
if (
  existsSync(binary)
  && info?.nodeVersion === process.version
  && statSync(binary).mtimeMs >= newestSourceTime()
) {
  console.log(`Sidecar is up to date for ${process.version}; skipping the SEA rebuild.`);
} else {
  pnpm(["build:sidecar"]);
  writeFileSync(infoPath, `${JSON.stringify({ nodeVersion: process.version, builtAt: new Date().toISOString() }, null, 2)}\n`);
}
