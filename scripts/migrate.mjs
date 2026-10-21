import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Converts the old version's task folder into a new Tasks home: `pnpm migrate OLD_FOLDER NEW_HOME`.
// The old folder is only read. The home must be new or empty; the tasks land in its sync folder.
const [source, destination, ...rest] = process.argv.slice(2);
if (!source || !destination || rest.length) {
  process.stderr.write("usage: pnpm migrate OLD_FOLDER NEW_HOME\n");
  process.exit(2);
}

const { createHome } = await import("../dist/backend/home.js");
const home = createHome(path.resolve(destination));

// The cache only serves this one conversion. It stays behind for `recover` if the run fails.
const cacheDirectory = mkdtempSync(path.join(tmpdir(), "tasks-migrate-"));
const cli = path.resolve(import.meta.dirname, "../dist/backend/tasks-cli.js");
const run = spawnSync(
  process.execPath,
  [
    cli,
    "--root",
    path.resolve(source),
    "--database",
    path.join(cacheDirectory, "cache.db"),
    "migrate",
    home.rootPath,
  ],
  { stdio: "inherit" },
);
if (run.status === 0) rmSync(cacheDirectory, { recursive: true, force: true });
else process.stderr.write(`The conversion cache is kept at ${cacheDirectory}\n`);
process.exit(run.status ?? 1);
