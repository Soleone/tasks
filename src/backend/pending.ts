import { lstatSync } from "node:fs";
import path from "node:path";
import { CommandError } from "./errors.js";
import { parseV2CanonicalJson } from "./strictJson.js";
import { readV2RegularFile } from "./canonicalReader.js";
import { parseV2CopyIntent } from "./copyJournal.js";
import type { V2CopyIntent } from "./copyJournal.js";
import { parseV2InitIntent } from "./initJournal.js";
import type { V2InitIntent } from "./initJournal.js";
import { parseV2CreateIntent } from "./createJournal.js";
import type { V2CreateIntent } from "./createJournal.js";
import { parseV2OrderIntent } from "./orderJournal.js";
import type { V2OrderIntent } from "./orderJournal.js";
import { parseV2BatchIntent } from "./batchJournal.js";
import type { V2BatchIntent } from "./batchJournal.js";
import { parseV2PurgeIntent } from "./purgeJournal.js";
import type { V2PurgeIntent } from "./purgeJournal.js";
import { parseV2DoctorIntent } from "./doctorJournal.js";
import type { V2DoctorIntent } from "./doctorJournal.js";
import { pendingV2Path } from "./localDomain.js";
import type { V2RootBinding } from "./queryCache.js";
import { readV2Pending as readUpdatePending } from "./updateJournal.js";
import type { V2UpdateIntent } from "./updateJournal.js";

export type V2CopyTarget = { format: "taskdb.pending-copy-target"; version: 1; root: V2RootBinding; owner: V2RootBinding; operationId: string };
export type V2PendingIntent = V2UpdateIntent | V2CopyIntent | V2CopyTarget | V2InitIntent | V2CreateIntent | V2OrderIntent | V2BatchIntent | V2PurgeIntent | V2DoctorIntent;

export function readV2Pending(root: V2RootBinding): V2PendingIntent | undefined {
  const file = pendingV2Path(root);
  if (!lstatSync(file, { throwIfNoEntry: false })) {
    if (lstatSync(`${file}.preparing`, { throwIfNoEntry: false })) throw new CommandError("RECOVERY_CONFLICT", "unpublished intent requires inspection");
    return undefined;
  }
  try {
    const value = parseV2CanonicalJson(readV2RegularFile(file)) as V2PendingIntent;
    if (value.format === "taskdb.pending-update") return readUpdatePending(root);
    if (value.format === "taskdb.pending-copy") return parseV2CopyIntent(value, root);
    if (value.format === "taskdb.pending-init") return parseV2InitIntent(value, root);
    if (value.format === "taskdb.pending-create") return parseV2CreateIntent(value, root);
    if (value.format === "taskdb.pending-order") return parseV2OrderIntent(value, root);
    if (value.format === "taskdb.pending-batch") return parseV2BatchIntent(value, root);
    if (value.format === "taskdb.pending-purge") return parseV2PurgeIntent(value, root);
    if (value.format === "taskdb.pending-doctor") return parseV2DoctorIntent(value, root);
    if (value.format !== "taskdb.pending-copy-target" || value.version !== 1 || value.root.rootPath !== root.rootPath || value.root.rootIdentity !== root.rootIdentity
      || !path.isAbsolute(value.owner.rootPath) || !/^\d+:\d+$/.test(value.owner.rootIdentity)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.operationId)) {
      throw new Error("invalid pending target");
    }
    return value;
  } catch { throw new CommandError("RECOVERY_CONFLICT", "pending intent has missing, divergent or invalid evidence"); }
}
