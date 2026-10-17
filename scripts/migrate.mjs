import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Converts the old version's task folder into a new one: `pnpm migrate OLD_FOLDER NEW_FOLDER`.
// The old folder is only read. The new one must be absent or empty.
const [source, destination, ...rest] = process.argv.slice(2);
if (!source || !destination || rest.length) {
  process.stderr.write("usage: pnpm migrate OLD_FOLDER NEW_FOLDER\n");
  process.exit(2);
}

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
    path.resolve(destination),
  ],
  { stdio: "inherit" },
);
if (run.status === 0) rmSync(cacheDirectory, { recursive: true, force: true });
else process.stderr.write(`The conversion cache is kept at ${cacheDirectory}\n`);
process.exit(run.status ?? 1);
