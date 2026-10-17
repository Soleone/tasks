import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { bakeSea } from "./sea.mjs";

const root = path.resolve(import.meta.dirname, "..");
const outputDirectory = path.join(root, "dist", "sidecar");
const extension = process.platform === "win32" ? ".exe" : "";
const target = execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();

function removeSignature(executablePath) {
  if (process.platform !== "win32" && process.platform !== "darwin") return;
  try {
    execFileSync("codesign", ["--remove-signature", executablePath], { stdio: "ignore" });
  } catch {
    // Unsigned binaries are usable for local development. Signing belongs to release packaging.
  }
}

// Both packaged binaries are SEA executables baked from esbuild bundles, so
// installed machines never need Node. tasks-backend is the desktop sidecar;
// tasks-cli is the standalone agent-facing CLI.
for (const { name, bundle } of [
  { name: "tasks-backend", bundle: "cli.cjs" },
  { name: "tasks-cli", bundle: "tasks-cli.cjs" },
]) {
  bakeSea({
    node: process.execPath,
    bundle: path.join(outputDirectory, bundle),
    output: path.join(root, "src-tauri", "binaries", `${name}-${target}${extension}`),
    prepare: removeSignature,
  });
}
