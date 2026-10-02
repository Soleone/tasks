import { CommandError } from "./errors.js";
import { inspectV2CanonicalRoot, readV2RootDescriptor } from "./v2CanonicalReader.js";
import { readV1MigrationRootDescriptor } from "./v2MigrationSource.js";
import type { V2RootBinding } from "./v2QueryCache.js";

/** Recovery recognizes v1 migration owners, without admitting v1 task queries/writes. */
export function readV2ControlRoot(directory: string): V2RootBinding {
  try {
    return readV2RootDescriptor(directory);
  } catch (error) {
    if (!(error instanceof CommandError) || error.code !== "UNSUPPORTED_SCHEMA" || inspectV2CanonicalRoot(directory).schemaVersion !== 1) throw error;
    return readV1MigrationRootDescriptor(directory);
  }
}
