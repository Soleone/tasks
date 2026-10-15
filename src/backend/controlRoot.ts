import { CommandError } from "./errors.js";
import { inspectV2CanonicalRoot, readV2PhysicalRoot, readV2RootDescriptor } from "./canonicalReader.js";
import { readV2Pending } from "./pending.js";
import { readV1MigrationRootDescriptor } from "../migration/schema1Source.js";
import type { V2RootBinding } from "./queryCache.js";

/** Recovery recognizes v1 migration owners and fixed pre-descriptor init, never their task projections. */
export function readV2ControlRoot(directory: string): V2RootBinding {
  try {
    return readV2RootDescriptor(directory);
  } catch (error) {
    const physical = readV2PhysicalRoot(directory);
    const legacy = error instanceof CommandError && error.code === "UNSUPPORTED_SCHEMA" && inspectV2CanonicalRoot(directory).schemaVersion === 1;
    try {
      if (readV2Pending(physical)?.format === "taskdb.pending-init") return physical;
    } catch (pendingError) {
      // Valid v1 descriptor authority still permits historical migration replay before malformed pending evidence.
      if (!legacy || !(pendingError instanceof CommandError) || pendingError.code !== "RECOVERY_CONFLICT") throw pendingError;
    }
    if (legacy) return readV1MigrationRootDescriptor(directory);
    throw error;
  }
}
