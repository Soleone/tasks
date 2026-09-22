import type { AndroidPendingWrite } from "./androidStorage";
import type { AndroidCanonicalFile } from "./androidWorkspace";

/** A changed file is a conflict, not permission to overwrite another device's work. */
export function filesToRecover(
  pending: AndroidPendingWrite,
  currentFiles: AndroidCanonicalFile[],
): AndroidPendingWrite["files"] {
  const contents = new Map(currentFiles.map((file) => [file.relativePath, file.content]));
  return pending.files.filter((file) => {
    const actual = contents.get(file.relativePath) ?? null;
    if (actual === file.content) return false;
    if (actual === file.previousContent || (actual !== null && file.content.startsWith(actual))) return true;
    throw new Error(`${file.relativePath} changed during an interrupted Android write`);
  });
}
