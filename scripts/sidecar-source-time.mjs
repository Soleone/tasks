import { readdirSync, statSync } from "node:fs";
import path from "node:path";

/** Source copies without .git need the same freshness check as a checkout. */
export function sidecarSourceTime(root) {
  const backend = path.join(root, "src/backend");
  const filenames = [
    backend,
    "scripts/build-sidecar.mjs",
    "package.json",
    "pnpm-lock.yaml",
    "tsconfig.backend.json",
    "tsconfig.json",
  ].map((filename) => (path.isAbsolute(filename) ? filename : path.join(root, filename)));
  for (const entry of readdirSync(backend, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory() || entry.name.endsWith(".ts"))
      filenames.push(path.join(entry.parentPath, entry.name));
  }
  return Math.max(...filenames.map((filename) => statSync(filename).mtimeMs));
}
