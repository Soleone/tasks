import type { DatabaseSync } from "node:sqlite";
import { applyCopyJournal } from "./copyJournal.js";
import type { CopyIntent } from "./copyJournal.js";
import { synchronizeAuthority } from "./queryCache.js";
import { storeReceipt } from "./receipts.js";

export function commitCopy(database: DatabaseSync, intent: CopyIntent): Record<string, unknown> {
  const result = applyCopyJournal(intent);
  const authority = synchronizeAuthority(database, intent.root);
  if (authority.writeContext === intent.request.writeContext)
    storeReceipt(database, intent.request, result);
  return result;
}
