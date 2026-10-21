import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const target = execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
const extension = process.platform === "win32" ? ".exe" : "";
const binary = path.join(root, "src-tauri", "binaries", `tasks-backend-${target}${extension}`);
const cliBinary = path.join(root, "src-tauri", "binaries", `tasks-cli-${target}${extension}`);

if (!existsSync(binary)) {
  throw new Error(
    `Sidecar does not exist: ${path.relative(root, binary)}. Run pnpm build:sidecar first.`,
  );
}
if (!existsSync(cliBinary)) {
  throw new Error(
    `tasks-cli does not exist: ${path.relative(root, cliBinary)}. Run pnpm build:sidecar first.`,
  );
}

const probeDirectory = mkdtempSync(path.join(os.tmpdir(), "tasks-sidecar-check-"));
const homePath = path.join(probeDirectory, "home");
const environment = { ...process.env };
environment.PATH =
  process.platform === "win32"
    ? `${process.env.SystemRoot ?? "C:\\Windows"}\\System32`
    : "/usr/bin:/bin";
delete environment.NODE_PATH;
delete environment.NODE_OPTIONS;
const selection = ["--home", homePath];
const run = (file, args, input) =>
  execFileSync(file, args, { cwd: root, encoding: "utf8", env: environment, input });

try {
  run(cliBinary, [...selection, "init", "--json"]);
  run(cliBinary, [...selection, "add", "Sidecar search probe", "--json"]);
  console.log(`PASS: ${path.relative(root, cliBinary)} created a home and added a task.`);

  const request = { version: 2, command: "task.list", args: { search: "probe" } };
  const response = JSON.parse(
    run(binary, ["--stdio", ...selection, "--client", "cli"], `${JSON.stringify(request)}\n`),
  );
  if (!response.ok || response.result.total !== 1)
    throw new Error(response.error?.message ?? "Sidecar search did not find the probe task");
  console.log(`PASS: ${path.relative(root, binary)} found the task through search.`);
} finally {
  rmSync(probeDirectory, { recursive: true, force: true });
}
