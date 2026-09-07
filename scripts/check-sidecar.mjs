import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const target = execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
const extension = process.platform === "win32" ? ".exe" : "";
const binary = path.join(root, "src-tauri", "binaries", `tasks-backend-${target}${extension}`);

if (!existsSync(binary)) {
  throw new Error(`Sidecar does not exist: ${path.relative(root, binary)}. Run pnpm build:sidecar first.`);
}

const probeDirectory = mkdtempSync(path.join(os.tmpdir(), "tasks-sidecar-check-"));
const databasePath = path.join(probeDirectory, "probe.db");
const environment = { ...process.env };
environment.PATH = process.platform === "win32" ? `${process.env.SystemRoot ?? "C:\\Windows"}\\System32` : "/usr/bin:/bin";
delete environment.NODE_PATH;
delete environment.NODE_OPTIONS;

try {
  const output = execFileSync(binary, ["--probe", "--database", databasePath], {
    cwd: root,
    encoding: "utf8",
    env: environment,
  });
  const response = JSON.parse(output);

  if (!response.ok || !response.result?.fts5Enabled || response.result.searchMatches !== 1) {
    throw new Error(response.error?.message ?? "Sidecar probe did not pass");
  }

  console.log(`PASS: ${path.relative(root, binary)} returned an FTS5 probe result.`);
} finally {
  rmSync(probeDirectory, { recursive: true, force: true });
}
