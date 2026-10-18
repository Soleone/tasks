#!/usr/bin/env node
// Ratchet against version-named code: counts v1/v2 in paths and identifiers
// under src/ and scripts/ and fails if the count rises above the baseline.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const baselinePath = join(root, "scripts/naming-baseline.json");
const scannedDirs = ["src", "scripts"];
// Registry preview copy (for example a sample version badge) is not application architecture.
const allowedPrefixes = ["src/migration/", "src/components/soleone/", "scripts/check-naming.mjs"];
const codeExtensions = /\.(ts|tsx|js|mjs|cjs)$/;
const versionName = /v[12](?!\d)/i;
// Names already persisted on users' machines: cache tables, a browser storage key and the
// local folder that holds locks, journals and recovery copies.
const storedNames = /^(v2_[a-z_]+|tasks_v2|v2UndoHistory)$/;
const storedFolder = /taskdb-v2(?![-\w])/g;
const identifier = /[A-Za-z_$][\w$]*/g;

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

function countFile(path) {
  let count = versionName.test(path) ? 1 : 0;
  if (codeExtensions.test(path)) {
    const tokens =
      readFileSync(join(root, path), "utf8").replace(storedFolder, "").match(identifier) ?? [];
    count += tokens.filter((token) => versionName.test(token) && !storedNames.test(token)).length;
  }
  return count;
}

const counts = scannedDirs
  .flatMap((dir) => listFiles(join(root, dir)))
  .map((path) => relative(root, path).split("\\").join("/"))
  .filter((path) => !allowedPrefixes.some((prefix) => path.startsWith(prefix)))
  .map((path) => [path, countFile(path)])
  .filter(([, count]) => count > 0)
  .sort((a, b) => b[1] - a[1]);
const total = counts.reduce((sum, [, count]) => sum + count, 0);

if (process.argv.includes("--update")) {
  writeFileSync(baselinePath, `${JSON.stringify({ versionNames: total }, null, 2)}\n`);
  console.log(`naming baseline set to ${total}`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8")).versionNames;
if (total > baseline) {
  console.error(`Version-named paths/identifiers rose from ${baseline} to ${total}.`);
  console.error("Name by responsibility, not version. Largest counts:");
  for (const [path, count] of counts.slice(0, 10)) console.error(`  ${count}\t${path}`);
  process.exit(1);
}
if (total < baseline) {
  console.log(`naming: ${total} (baseline ${baseline}); run with --update to lower the baseline`);
}
