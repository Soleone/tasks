import { lstatSync } from "node:fs";
import { CommandError } from "./errors.js";
import { parseCanonicalJson } from "./strictJson.js";
import { readRegularFile } from "./canonicalReader.js";
import { parseOrderIntent } from "./orderJournal.js";
import type { OrderIntent } from "./orderJournal.js";
import { parseBatchIntent } from "./batchJournal.js";
import type { BatchIntent } from "./batchJournal.js";
import { parsePurgeIntent } from "./purgeJournal.js";
import type { PurgeIntent } from "./purgeJournal.js";
import { parseDoctorIntent } from "./doctorJournal.js";
import type { DoctorIntent } from "./doctorJournal.js";
import { pendingIntentPath } from "./localDomain.js";
import type { RootBinding } from "./queryCache.js";

export type PendingIntent = OrderIntent | BatchIntent | PurgeIntent | DoctorIntent;

export function readPending(root: RootBinding): PendingIntent | undefined {
  const file = pendingIntentPath(root);
  if (!lstatSync(file, { throwIfNoEntry: false })) {
    if (lstatSync(`${file}.preparing`, { throwIfNoEntry: false }))
      throw new CommandError("RECOVERY_CONFLICT", "unpublished intent requires inspection");
    return undefined;
  }
  try {
    const value = parseCanonicalJson(readRegularFile(file)) as PendingIntent;
    if (value.format === "taskdb.pending-order") return parseOrderIntent(value, root);
    if (value.format === "taskdb.pending-batch") return parseBatchIntent(value, root);
    if (value.format === "taskdb.pending-purge") return parsePurgeIntent(value, root);
    if (value.format === "taskdb.pending-doctor") return parseDoctorIntent(value, root);
    throw new Error("unknown pending format");
  } catch {
    throw new CommandError(
      "RECOVERY_CONFLICT",
      "pending intent has missing, divergent or invalid evidence",
    );
  }
}
