import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { bakeSea } from "./sea.mjs";

const root = path.resolve(import.meta.dirname, "..");
const outputDirectory = path.join(root, "dist", "sidecar");
const extension = process.platform === "win32" ? ".exe" : "";
const target = execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();

// One SEA executable baked from the esbuild bundle, so installed machines never need Node. The
// app runs it with --stdio as its backend; people and agents run it as tasks-cli.
bakeSea({
  node: process.execPath,
  bundle: path.join(outputDirectory, "tasks-cli.cjs"),
  output: path.join(root, "src-tauri", "binaries", `tasks-cli-${target}${extension}`),
});
