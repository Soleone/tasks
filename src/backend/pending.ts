import { lstatSync } from "node:fs";
import path from "node:path";
import { CommandError } from "./errors.js";
import { parseCanonicalJson } from "./strictJson.js";
import { readRegularFile } from "./canonicalReader.js";
import { parseCopyIntent } from "./copyJournal.js";
import type { CopyIntent } from "./copyJournal.js";
import { parseInitIntent } from "./initJournal.js";
import type { InitIntent } from "./initJournal.js";
import { parseCreateIntent } from "./createJournal.js";
import type { CreateIntent } from "./createJournal.js";
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
import { readPending as readUpdatePending } from "./updateJournal.js";
import type { UpdateIntent } from "./updateJournal.js";

export type CopyTarget = { format: "taskdb.pending-copy-target"; version: 1; root: RootBinding; owner: RootBinding; operationId: string };
export type PendingIntent = UpdateIntent | CopyIntent | CopyTarget | InitIntent | CreateIntent | OrderIntent | BatchIntent | PurgeIntent | DoctorIntent;

export function readPending(root: RootBinding): PendingIntent | undefined {
  const file = pendingIntentPath(root);
  if (!lstatSync(file, { throwIfNoEntry: false })) {
    if (lstatSync(`${file}.preparing`, { throwIfNoEntry: false })) throw new CommandError("RECOVERY_CONFLICT", "unpublished intent requires inspection");
    return undefined;
  }
  try {
    const value = parseCanonicalJson(readRegularFile(file)) as PendingIntent;
    if (value.format === "taskdb.pending-update") return readUpdatePending(root);
    if (value.format === "taskdb.pending-copy") return parseCopyIntent(value, root);
    if (value.format === "taskdb.pending-init") return parseInitIntent(value, root);
    if (value.format === "taskdb.pending-create") return parseCreateIntent(value, root);
    if (value.format === "taskdb.pending-order") return parseOrderIntent(value, root);
    if (value.format === "taskdb.pending-batch") return parseBatchIntent(value, root);
    if (value.format === "taskdb.pending-purge") return parsePurgeIntent(value, root);
    if (value.format === "taskdb.pending-doctor") return parseDoctorIntent(value, root);
    if (value.format !== "taskdb.pending-copy-target" || value.version !== 1 || value.root.rootPath !== root.rootPath || value.root.rootIdentity !== root.rootIdentity
      || !path.isAbsolute(value.owner.rootPath) || !/^\d+:\d+$/.test(value.owner.rootIdentity)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.operationId)) {
      throw new Error("invalid pending target");
    }
    return value;
  } catch { throw new CommandError("RECOVERY_CONFLICT", "pending intent has missing, divergent or invalid evidence"); }
}
