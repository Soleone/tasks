import { lstatSync, readdirSync } from "node:fs";
import { CommandError } from "./errors.js";
import { readCanonicalRoot } from "./canonicalReader.js";
import type { CanonicalSnapshot } from "./canonicalReader.js";

export function directoryIdentity(directory: string): string {
  const stat = lstatSync(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new CommandError("INVALID_ARGUMENT", "expected a physical directory");
  return `${stat.dev}:${stat.ino}`;
}

/** Writers that observed the root a moment ago need only this part of guardObservedRoot. */
export function refuseDescriptorConflicts(rootPath: string): void {
  if (readdirSync(rootPath).some((name) => /^workspace\.sync-conflict-.+\.json$/.test(name))) {
    throw new CommandError(
      "INVALID_CANONICAL",
      "descriptor conflict copies require explicit inspection before staging",
    );
  }
}

export function guardObservedRoot(expected: CanonicalSnapshot): void {
  refuseDescriptorConflicts(expected.rootPath);
  const current = readCanonicalRoot(expected.rootPath);
  if (
    current.rootIdentity !== expected.rootIdentity ||
    current.files.length !== expected.files.length ||
    current.files.some((file, index) => file.relativePath !== expected.files[index].relativePath)
  ) {
    throw new CommandError("STALE_SCOPE", "root membership or binding changed");
  }
  if (current.files.some((file, index) => file.sha256 !== expected.files[index].sha256)) {
    throw new CommandError("STALE_FILE", "root bytes changed");
  }
}
