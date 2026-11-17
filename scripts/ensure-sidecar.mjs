import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sidecarSourceTime } from "./sidecar-source-time.mjs";

const root = path.resolve(import.meta.dirname, "..");
const infoPath = path.join(root, "dist", "sidecar", ".sidecar-info.json");

function readInfo() {
  try {
    return JSON.parse(readFileSync(infoPath, "utf8"));
  } catch {
    return null;
  }
}

const target = execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
const extension = process.platform === "win32" ? ".exe" : "";
const binary = path.join(root, "src-tauri", "binaries", `tasks-cli-${target}${extension}`);
const info = readInfo();
if (
  existsSync(binary) &&
  info?.nodeVersion === process.version &&
  statSync(binary).mtimeMs >= sidecarSourceTime(root)
) {
  console.log(`Sidecar is up to date for ${process.version}; skipping the SEA rebuild.`);
} else {
  execFileSync("pnpm", ["build:sidecar"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  writeFileSync(
    infoPath,
    `${JSON.stringify({ nodeVersion: process.version, builtAt: new Date().toISOString() }, null, 2)}\n`,
  );
}
