import { CommandError } from "./errors.js";
import { inspectCanonicalRoot, readPhysicalRoot, readRootDescriptor } from "./canonicalReader.js";
import { readPending } from "./pending.js";
import { readSchema1MigrationRootDescriptor } from "../migration/schema1Source.js";
import type { RootBinding } from "./queryCache.js";

/** Recovery recognizes schema 1 migration owners and fixed pre-descriptor init, never their task projections. */
export function readControlRoot(directory: string): RootBinding {
  try {
    return readRootDescriptor(directory);
  } catch (error) {
    const physical = readPhysicalRoot(directory);
    const legacy =
      error instanceof CommandError &&
      error.code === "UNSUPPORTED_SCHEMA" &&
      inspectCanonicalRoot(directory).schemaVersion === 1;
    try {
      if (readPending(physical)?.format === "taskdb.pending-init") return physical;
    } catch (pendingError) {
      // Valid schema 1 descriptor authority still permits historical migration replay before malformed pending evidence.
      if (
        !legacy ||
        !(pendingError instanceof CommandError) ||
        pendingError.code !== "RECOVERY_CONFLICT"
      )
        throw pendingError;
    }
    if (legacy) return readSchema1MigrationRootDescriptor(directory);
    throw error;
  }
}
