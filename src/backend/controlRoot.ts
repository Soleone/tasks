import { CommandError } from "./errors.js";
import { inspectCanonicalRoot, readRootDescriptor } from "./canonicalReader.js";
import { readSchema1MigrationRootDescriptor } from "../migration/schema1Source.js";
import type { RootBinding } from "./queryCache.js";

/** Recovery recognizes schema 1 migration owners, never their task projections. */
export function readControlRoot(directory: string): RootBinding {
  try {
    return readRootDescriptor(directory);
  } catch (error) {
    if (
      error instanceof CommandError &&
      error.code === "UNSUPPORTED_SCHEMA" &&
      inspectCanonicalRoot(directory).schemaVersion === 1
    )
      return readSchema1MigrationRootDescriptor(directory);
    throw error;
  }
}
